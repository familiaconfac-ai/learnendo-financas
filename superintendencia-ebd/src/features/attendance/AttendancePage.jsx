import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { listAttendanceRegisters, saveAttendanceRegister } from '../../services/attendanceService'
import { listClasses } from '../../services/classService'
import { listTeachers } from '../../services/teacherService'
import { listEnrollments } from '../../services/enrollmentService'
import { listPeople } from '../../services/peopleService'
import { generateAttendanceNotebookPDF } from '../../services/pdfService'
import { belongsToTeacherRecord } from '../../utils/accessControl'
import {
  calculateClassSummary,
  calculateStudentAttendance,
  cycleAttendanceStatus,
  formatMonthYear,
  formatSundayLabel,
  getSundaysByMonthYear,
} from '../../utils/attendanceUtils'

const currentDate = new Date()

const REGISTER_DEFAULT = {
  teacherId: '',
  teacherName: '',
  classId: '',
  discipline: '',
  month: currentDate.getMonth() + 1,
  year: currentDate.getFullYear(),
}

export default function AttendancePage() {
  const { user, profile, canManageStructure } = useAuth()
  const location = useLocation()
  const [people, setPeople] = useState([])
  const [teachers, setTeachers] = useState([])
  const [classes, setClasses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [registers, setRegisters] = useState([])
  const [form, setForm] = useState(REGISTER_DEFAULT)
  const [selectedRegisterId, setSelectedRegisterId] = useState(location.state?.registerId || '')

  async function loadData() {
    if (!user?.uid) return
    const [peopleList, teacherList, classList, enrollmentList, registerList] = await Promise.all([
      listPeople(user.uid),
      listTeachers(user.uid),
      listClasses(user.uid),
      listEnrollments(user.uid),
      listAttendanceRegisters(user.uid),
    ])

    const allowedClasses = canManageStructure
      ? classList
      : classList.filter((item) => belongsToTeacherRecord(item, user, profile))

    const allowedClassIds = new Set(allowedClasses.map((item) => item.id))
    const allowedRegisters = canManageStructure
      ? registerList
      : registerList.filter((item) => allowedClassIds.has(item.classId) || belongsToTeacherRecord(item, user, profile))

    const allowedEnrollments = canManageStructure
      ? enrollmentList
      : enrollmentList.filter((item) => allowedClassIds.has(item.classId))

    setPeople(peopleList)
    setTeachers(teacherList)
    setClasses(allowedClasses)
    setEnrollments(allowedEnrollments)
    setRegisters(allowedRegisters)
  }

  useEffect(() => {
    loadData()
  }, [user?.uid])

  const classMap = useMemo(
    () => Object.fromEntries(classes.map((item) => [item.id, item])),
    [classes],
  )

  const personMap = useMemo(
    () => Object.fromEntries(people.map((item) => [item.id, item])),
    [people],
  )

  const activeEnrollments = useMemo(
    () => enrollments.filter((item) => item.status === 'active' && item.enrolledInEBD !== false),
    [enrollments],
  )

  const selectedRegister = useMemo(
    () => registers.find((item) => item.id === selectedRegisterId) || null,
    [registers, selectedRegisterId],
  )

  const registerStudents = useMemo(() => {
    if (!selectedRegister) return []
    const ids = selectedRegister.enrolledStudentIds || []
    return ids
      .map((personId) => personMap[personId])
      .filter(Boolean)
      .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
  }, [personMap, selectedRegister])

  const filteredRegisters = useMemo(() => {
    return registers.filter((item) => {
      if (form.classId && item.classId !== form.classId) return false
      if (Number(form.month) && Number(item.month) !== Number(form.month)) return false
      if (Number(form.year) && Number(item.year) !== Number(form.year)) return false
      return true
    })
  }, [registers, form.classId, form.month, form.year])

  async function handleCreateRegister() {
    if (!canManageStructure) {
      window.alert('Somente administradores podem criar cadernetas. Você pode apenas lançar presença nas turmas permitidas.')
      return
    }
    if (!form.classId) {
      window.alert('Selecione uma classe.')
      return
    }
    if (!form.teacherId) {
      window.alert('Selecione um professor.')
      return
    }
    if (!form.discipline.trim()) {
      window.alert('Informe a disciplina.')
      return
    }

    const selectedTeacher = teachers.find((t) => t.id === form.teacherId)

    const sundayDates = getSundaysByMonthYear(Number(form.month), Number(form.year))
    const classEnrollments = enrollments
      .filter((item) => item.classId === form.classId && item.status === 'active' && item.enrolledInEBD !== false)
      .map((item) => item.personId)

    const attendanceByStudent = classEnrollments.reduce((acc, personId) => {
      acc[personId] = {}
      return acc
    }, {})

    const payload = {
      teacherId: form.teacherId,
      teacherName: selectedTeacher?.fullName || '',
      classId: form.classId,
      className: classMap[form.classId]?.name || '',
      discipline: form.discipline.trim(),
      month: Number(form.month),
      year: Number(form.year),
      sundayDates,
      enrolledStudentIds: classEnrollments,
      attendanceByStudent,
    }

    const id = await saveAttendanceRegister(user.uid, payload)
    setSelectedRegisterId(id)
    await loadData()
  }

  async function handleToggleAttendance(personId, sunday) {
    if (!selectedRegister) return
    if (!canManageStructure && !belongsToTeacherRecord(selectedRegister, user, profile)) {
      window.alert('Você não tem permissão para alterar esta caderneta.')
      return
    }

    const attendance = selectedRegister.attendanceByStudent || {}
    const current = attendance[personId]?.[sunday] || ''
    const next = cycleAttendanceStatus(current)

    const nextAttendanceByStudent = {
      ...attendance,
      [personId]: {
        ...(attendance[personId] || {}),
        [sunday]: next,
      },
    }

    await saveAttendanceRegister(
      user.uid,
      {
        attendanceByStudent: nextAttendanceByStudent,
      },
      selectedRegister.id,
    )

    setRegisters((prev) => prev.map((item) => {
      if (item.id !== selectedRegister.id) return item
      return { ...item, attendanceByStudent: nextAttendanceByStudent }
    }))
  }

  async function handleUpdateMeta() {
    if (!selectedRegister) return
    if (!canManageStructure && !belongsToTeacherRecord(selectedRegister, user, profile)) {
      window.alert('Você não tem permissão para alterar esta caderneta.')
      return
    }

    await saveAttendanceRegister(
      user.uid,
      {
        teacherName: selectedRegister.teacherName,
        discipline: selectedRegister.discipline,
      },
      selectedRegister.id,
    )

    await loadData()
  }

  async function handleExportPdf() {
    if (!selectedRegister) return
    await generateAttendanceNotebookPDF({
      register: selectedRegister,
      students: registerStudents,
    })
  }

  const classSummary = useMemo(
    () => calculateClassSummary(selectedRegister, registerStudents),
    [selectedRegister, registerStudents],
  )

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Caderneta Mensal</h2>
          <p className="feature-subtitle">Presença por domingo com cálculo automático</p>
        </div>
      </div>

      {canManageStructure && <Card>
        <CardHeader title="Nova caderneta" subtitle="Núcleo principal do MVP" />
        <div className="inline-form">
          <label htmlFor="attendance-teacher">Professor</label>
          <select
            id="attendance-teacher"
            value={form.teacherId}
            onChange={(event) => {
              const teacherId = event.target.value
              const teacher = teachers.find((t) => t.id === teacherId)
              setForm((prev) => ({
                ...prev,
                teacherId,
                teacherName: teacher?.fullName || '',
              }))
            }}
          >
            <option value="">Selecione um professor</option>
            {teachers
              .filter((item) => item.active !== false)
              .map((teacher) => (
                <option key={teacher.id} value={teacher.id}>{teacher.fullName}</option>
              ))}
          </select>
          {teachers.filter((item) => item.active !== false).length === 0 && (
            <p className="feature-subtitle" style={{ marginTop: '8px', fontSize: '0.85rem' }}>
              📌 Nenhum professor ativo. <a href="/professores" style={{ textDecoration: 'underline', color: '#0066cc' }}>Cadastre um professor</a>
            </p>
          )}

          <label htmlFor="attendance-class">Classe</label>
          <select
            id="attendance-class"
            value={form.classId}
            onChange={(event) => setForm((prev) => ({ ...prev, classId: event.target.value }))}
          >
            <option value="">Selecione uma classe</option>
            {classes
              .filter((item) => item.active !== false)
              .map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
          </select>
          {classes.filter((item) => item.active !== false).length === 0 && (
            <p className="feature-subtitle" style={{ marginTop: '8px', fontSize: '0.85rem' }}>
              📌 Nenhuma classe ativa. <a href="/classes" style={{ textDecoration: 'underline', color: '#0066cc' }}>Cadastre uma classe</a>
            </p>
          )}

          <label htmlFor="attendance-discipline">Disciplina / Tema</label>
          <input
            id="attendance-discipline"
            value={form.discipline}
            onChange={(event) => setForm((prev) => ({ ...prev, discipline: event.target.value }))}
            placeholder="Ex: Gênesis, Parábolas do Reino, etc"
          />

          <div className="filter-row">
            <div>
              <label htmlFor="attendance-month">Mês</label>
              <input
                id="attendance-month"
                type="number"
                min="1"
                max="12"
                value={form.month}
                onChange={(event) => setForm((prev) => ({ ...prev, month: event.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="attendance-year">Ano</label>
              <input
                id="attendance-year"
                type="number"
                min="2020"
                value={form.year}
                onChange={(event) => setForm((prev) => ({ ...prev, year: event.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'end' }}>
              <Button onClick={handleCreateRegister}>Criar Caderneta</Button>
            </div>
          </div>
        </div>
      </Card>}

      <Card>
        <CardHeader title="Cadernetas criadas" subtitle="Filtradas por classe/mês/ano" />
        <div className="entity-list">
          {filteredRegisters.length === 0 && <p className="feature-subtitle">Nenhuma caderneta encontrada para os filtros atuais.</p>}
          {filteredRegisters.map((item) => (
            <div className="entity-row" key={item.id}>
              <div>
                <div className="entity-title">{item.className}</div>
                <div className="entity-meta">{formatMonthYear(item.month, item.year)} • {item.teacherName}</div>
              </div>
              <Button size="sm" onClick={() => setSelectedRegisterId(item.id)}>Abrir</Button>
            </div>
          ))}
        </div>
      </Card>

      {selectedRegister && (
        <>
          <Card>
            <CardHeader
              title={`${selectedRegister.className} - ${formatMonthYear(selectedRegister.month, selectedRegister.year)}`}
              subtitle="Toque em cada célula para alternar: vazio -> PP -> P -> A"
              action={<Button size="sm" variant="secondary" onClick={handleExportPdf}>PDF</Button>}
            />

            <div className="inline-form">
              <label htmlFor="selected-teacher">Professor</label>
              <input
                id="selected-teacher"
                value={selectedRegister.teacherName || ''}
                onChange={(event) => {
                  const value = event.target.value
                  setRegisters((prev) => prev.map((item) => item.id === selectedRegister.id ? { ...item, teacherName: value } : item))
                }}
              />

              <label htmlFor="selected-discipline">Disciplina</label>
              <input
                id="selected-discipline"
                value={selectedRegister.discipline || ''}
                onChange={(event) => {
                  const value = event.target.value
                  setRegisters((prev) => prev.map((item) => item.id === selectedRegister.id ? { ...item, discipline: value } : item))
                }}
              />

              <Button size="sm" variant="ghost" onClick={handleUpdateMeta}>Salvar registro</Button>
            </div>

            <div className="attendance-wrapper">
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th>Aluno</th>
                    {selectedRegister.sundayDates.map((sunday) => (
                      <th key={sunday}>{formatSundayLabel(sunday)}</th>
                    ))}
                    <th>PP</th>
                    <th>P</th>
                    <th>A</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {registerStudents.map((student) => {
                    const studentAttendance = selectedRegister.attendanceByStudent?.[student.id] || {}
                    const resume = calculateStudentAttendance(selectedRegister.sundayDates, studentAttendance)

                    return (
                      <tr key={student.id}>
                        <td>{student.fullName}</td>
                        {selectedRegister.sundayDates.map((sunday) => {
                          const value = studentAttendance[sunday] || ''
                          return (
                            <td key={`${student.id}-${sunday}`}>
                              <button
                                className={`attendance-cell status-${value || 'none'}`}
                                onClick={() => handleToggleAttendance(student.id, sunday)}
                                type="button"
                              >
                                {value || '-'}
                              </button>
                            </td>
                          )
                        })}
                        <td>{resume.totalPP}</td>
                        <td>{resume.totalP}</td>
                        <td>{resume.totalA}</td>
                        <td>{resume.percentualFinal.toFixed(1)}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title="Resumo geral da turma" subtitle="Indicadores consolidados da caderneta" />
            <div className="summary-grid">
              <div className="summary-item"><span className="summary-label">Matriculados</span><span className="summary-value">{classSummary.totalMatriculados}</span></div>
              <div className="summary-item"><span className="summary-label">Total PP</span><span className="summary-value">{classSummary.totalGeralPP}</span></div>
              <div className="summary-item"><span className="summary-label">Total P</span><span className="summary-value">{classSummary.totalGeralP}</span></div>
              <div className="summary-item"><span className="summary-label">Total A</span><span className="summary-value">{classSummary.totalGeralA}</span></div>
              <div className="summary-item"><span className="summary-label">Presenças</span><span className="summary-value">{classSummary.totalPresencas}</span></div>
              <div className="summary-item"><span className="summary-label">Ausências</span><span className="summary-value">{classSummary.totalAusencias}</span></div>
              <div className="summary-item"><span className="summary-label">Média da turma</span><span className="summary-value">{classSummary.mediaGeralTurma.toFixed(1)}%</span></div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
