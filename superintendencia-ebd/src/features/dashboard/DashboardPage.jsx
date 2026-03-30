import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../../components/ui/Button'
import Card, { CardHeader, SummaryCard } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { listPeople } from '../../services/peopleService'
import { listTeachers } from '../../services/teacherService'
import { listClasses } from '../../services/classService'
import { listEnrollments } from '../../services/enrollmentService'
import { listAttendanceRegisters } from '../../services/attendanceService'
import { formatMonthYear } from '../../utils/attendanceUtils'

export default function DashboardPage() {
  const { user, canManageStructure, role } = useAuth()
  const navigate = useNavigate()

  const [people, setPeople] = useState([])
  const [teachers, setTeachers] = useState([])
  const [classes, setClasses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [registers, setRegisters] = useState([])

  useEffect(() => {
    if (!user?.uid) return

    async function load() {
      const [peopleList, teacherList, classList, enrollmentList, registerList] = await Promise.all([
        listPeople(user.uid),
        listTeachers(user.uid),
        listClasses(user.uid),
        listEnrollments(user.uid),
        listAttendanceRegisters(user.uid),
      ])
      setPeople(peopleList)
      setTeachers(teacherList)
      setClasses(classList)
      setEnrollments(enrollmentList)
      setRegisters(registerList)
    }

    load()
  }, [user?.uid])

  const activePeople = useMemo(() => people.filter((item) => item.active !== false).length, [people])
  const activeTeachers = useMemo(() => teachers.filter((item) => item.active !== false).length, [teachers])
  const activeClasses = useMemo(() => classes.filter((item) => item.active !== false).length, [classes])
  const activeEnrollments = useMemo(
    () => enrollments.filter((item) => item.status === 'active' && item.enrolledInEBD !== false).length,
    [enrollments],
  )

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Painel da Superintendência</h2>
          <p className="feature-subtitle">
            {canManageStructure ? 'Gestão administrativa da Escola Bíblica Dominical' : 'Área do professor para acompanhamento da EBD'}
          </p>
        </div>
        <Button onClick={() => navigate('/caderneta')}>
          {canManageStructure ? 'Nova Caderneta' : 'Abrir Caderneta'}
        </Button>
      </div>

      <div className="grid-cards">
        <SummaryCard label="Alunos ativos" value={String(activePeople)} color="primary" icon="👥" />
        <SummaryCard label="Professores ativos" value={String(activeTeachers)} color="secondary" icon="🧑‍🏫" />
        <SummaryCard label="Classes ativas" value={String(activeClasses)} color="success" icon="🏫" />
        <SummaryCard label="Matrículas ativas" value={String(activeEnrollments)} color="warning" icon="🧾" />
        <SummaryCard label="Cadernetas" value={String(registers.length)} color="neutral" icon="📒" />
      </div>

      <Card>
        <CardHeader title="Atalhos" subtitle={`Perfil atual: ${role === 'admin' ? 'Administrador' : 'Professor'}`} />
        <div className="feature-actions">
          {canManageStructure && <Button variant="secondary" onClick={() => navigate('/alunos')}>Alunos</Button>}
          {canManageStructure && <Button variant="secondary" onClick={() => navigate('/professores')}>Professores</Button>}
          <Button variant="secondary" onClick={() => navigate('/classes')}>Classes</Button>
          {canManageStructure && <Button variant="secondary" onClick={() => navigate('/matriculas')}>Matrículas</Button>}
          <Button variant="secondary" onClick={() => navigate('/caderneta')}>Caderneta</Button>
          <Button variant="secondary" onClick={() => navigate('/comunicacao')}>Comunicação</Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Cadernetas criadas" subtitle="Toque para continuar um lançamento" />
        <div className="entity-list">
          {registers.length === 0 && <p className="feature-subtitle">Nenhuma caderneta criada ainda.</p>}
          {registers.slice(0, 8).map((register) => (
            <div key={register.id} className="entity-row">
              <div>
                <div className="entity-title">{register.className || 'Classe sem nome'}</div>
                <div className="entity-meta">{formatMonthYear(register.month, register.year)} • {register.teacherName || 'Professor não informado'}</div>
              </div>
              <Button size="sm" onClick={() => navigate('/caderneta', { state: { registerId: register.id } })}>Abrir</Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
