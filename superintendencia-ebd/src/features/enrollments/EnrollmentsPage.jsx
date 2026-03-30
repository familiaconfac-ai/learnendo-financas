import { useEffect, useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { listClasses } from '../../services/classService'
import { listEnrollments, saveEnrollment } from '../../services/enrollmentService'
import { listPeople } from '../../services/peopleService'

const ENROLLMENT_DEFAULT = {
  personId: '',
  classId: '',
  enrolledInEBD: true,
  enrollmentDate: new Date().toISOString().slice(0, 10),
  status: 'active',
  notes: '',
}

export default function EnrollmentsPage() {
  const { user, canManageEnrollments } = useAuth()
  const [people, setPeople] = useState([])
  const [classes, setClasses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [isModalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(ENROLLMENT_DEFAULT)

  async function loadData() {
    if (!user?.uid) return

    const [peopleList, classList, enrollmentList] = await Promise.all([
      listPeople(user.uid),
      listClasses(user.uid),
      listEnrollments(user.uid),
    ])
    setPeople(peopleList)
    setClasses(classList)
    setEnrollments(enrollmentList)
  }

  useEffect(() => {
    loadData()
  }, [user?.uid])

  const personMap = useMemo(
    () => Object.fromEntries(people.map((item) => [item.id, item])),
    [people],
  )

  const classMap = useMemo(
    () => Object.fromEntries(classes.map((item) => [item.id, item])),
    [classes],
  )

  function openCreateModal() {
    if (!canManageEnrollments) {
      window.alert('Somente administradores podem criar matrículas.')
      return
    }
    setEditing(null)
    setForm(ENROLLMENT_DEFAULT)
    setModalOpen(true)
  }

  function openEditModal(item) {
    if (!canManageEnrollments) {
      window.alert('Somente administradores podem editar matrículas.')
      return
    }
    setEditing(item)
    setForm({
      personId: item.personId || '',
      classId: item.classId || '',
      enrolledInEBD: item.enrolledInEBD !== false,
      enrollmentDate: item.enrollmentDate || new Date().toISOString().slice(0, 10),
      status: item.status || 'active',
      notes: item.notes || '',
    })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!canManageEnrollments) {
      window.alert('Ação não permitida para o seu perfil.')
      return
    }
    if (!form.personId || !form.classId) return

    const className = classMap[form.classId]?.name || ''
    await saveEnrollment(
      user.uid,
      {
        personId: form.personId,
        classId: form.classId,
        className,
        enrolledInEBD: form.enrolledInEBD,
        enrollmentDate: form.enrollmentDate,
        status: form.status,
        notes: form.notes.trim(),
      },
      editing?.id,
    )

    setModalOpen(false)
    await loadData()
  }

  async function handleToggleStatus(item) {
    if (!canManageEnrollments) {
      window.alert('Ação não permitida para o seu perfil.')
      return
    }
    await saveEnrollment(
      user.uid,
      {
        status: item.status === 'active' ? 'inactive' : 'active',
        enrolledInEBD: item.status === 'active' ? false : true,
      },
      item.id,
    )
    await loadData()
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Matrículas EBD</h2>
          <p className="feature-subtitle">Vínculo entre cadastro geral e classes</p>
        </div>
        {canManageEnrollments && <Button onClick={openCreateModal}>Nova Matrícula</Button>}
      </div>

      <Card>
        <CardHeader title="Matriculados" subtitle={`${enrollments.length} registro(s)`} />
        <div className="entity-list">
          {enrollments.length === 0 && <p className="feature-subtitle">Nenhuma matrícula cadastrada.</p>}
          {enrollments.map((item) => (
            <div key={item.id} className="entity-row">
              <div>
                <div className="entity-title">{personMap[item.personId]?.fullName || 'Pessoa removida'}</div>
                <div className="entity-meta">
                  Classe: {classMap[item.classId]?.name || item.className || 'Não informada'} • Matrícula: {item.enrollmentDate || 'Sem data'}
                </div>
                <span className={`entity-status ${item.status === 'active' ? 'active' : 'inactive'}`}>
                  {item.status === 'active' ? 'Ativa' : 'Inativa'}
                </span>
              </div>
              <div className="row-actions">
                {canManageEnrollments && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => openEditModal(item)}>Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleToggleStatus(item)}>
                      {item.status === 'active' ? 'Inativar' : 'Ativar'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {canManageEnrollments && <Modal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar matrícula' : 'Matricular pessoa'}
        footer={<Button onClick={handleSave}>{editing ? 'Salvar alterações' : 'Matricular'}</Button>}
      >
        <div className="inline-form">
          <label htmlFor="enroll-person">Pessoa</label>
          <select
            id="enroll-person"
            value={form.personId}
            onChange={(event) => setForm((prev) => ({ ...prev, personId: event.target.value }))}
          >
            <option value="">Selecione</option>
            {people
              .filter((person) => person.active !== false)
              .map((person) => (
                <option key={person.id} value={person.id}>{person.fullName}</option>
              ))}
          </select>

          <label htmlFor="enroll-class">Classe</label>
          <select
            id="enroll-class"
            value={form.classId}
            onChange={(event) => setForm((prev) => ({ ...prev, classId: event.target.value }))}
          >
            <option value="">Selecione</option>
            {classes
              .filter((item) => item.active !== false)
              .map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
          </select>

          <label htmlFor="enroll-date">Data da matrícula</label>
          <input
            id="enroll-date"
            type="date"
            value={form.enrollmentDate}
            onChange={(event) => setForm((prev) => ({ ...prev, enrollmentDate: event.target.value }))}
          />

          <label htmlFor="enroll-status">Status</label>
          <select
            id="enroll-status"
            value={form.status}
            onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
          >
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
          </select>

          <label htmlFor="enroll-notes">Observações</label>
          <textarea
            id="enroll-notes"
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          />
        </div>
      </Modal>}
    </div>
  )
}
