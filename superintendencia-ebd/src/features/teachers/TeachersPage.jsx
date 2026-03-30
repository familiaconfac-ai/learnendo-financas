import { useEffect, useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { listTeachers, removeTeacher, saveTeacher, toggleTeacherStatus } from '../../services/teacherService'

const TEACHER_DEFAULT = {
  fullName: '',
  phone: '',
  notes: '',
  active: true,
}

export default function TeachersPage() {
  const { user, canManageTeachers } = useAuth()
  const [teachers, setTeachers] = useState([])
  const [query, setQuery] = useState('')
  const [isModalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(TEACHER_DEFAULT)

  async function loadTeachers() {
    if (!user?.uid) return
    const data = await listTeachers(user.uid)
    setTeachers(data)
  }

  useEffect(() => {
    loadTeachers()
  }, [user?.uid])

  const filtered = useMemo(() => {
    if (!query.trim()) return teachers
    const normalized = query.toLowerCase()
    return teachers.filter((teacher) => teacher.fullName?.toLowerCase().includes(normalized))
  }, [teachers, query])

  function openCreateModal() {
    if (!canManageTeachers) {
      window.alert('Somente administradores podem cadastrar professores.')
      return
    }
    setEditing(null)
    setForm(TEACHER_DEFAULT)
    setModalOpen(true)
  }

  function openEditModal(teacher) {
    if (!canManageTeachers) {
      window.alert('Somente administradores podem editar professores.')
      return
    }
    setEditing(teacher)
    setForm({
      fullName: teacher.fullName || '',
      phone: teacher.phone || '',
      notes: teacher.notes || '',
      active: teacher.active !== false,
    })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!canManageTeachers) {
      window.alert('Ação não permitida para o seu perfil.')
      return
    }
    if (!form.fullName.trim()) return

    await saveTeacher(
      user.uid,
      {
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        notes: form.notes.trim(),
        active: form.active,
      },
      editing?.id,
    )
    setModalOpen(false)
    await loadTeachers()
  }

  async function handleToggle(teacher) {
    if (!canManageTeachers) {
      window.alert('Ação não permitida para o seu perfil.')
      return
    }
    await toggleTeacherStatus(user.uid, teacher.id, teacher.active === false)
    await loadTeachers()
  }

  async function handleRemove(teacher) {
    if (!canManageTeachers) {
      window.alert('Ação não permitida para o seu perfil.')
      return
    }
    const confirmed = window.confirm(`Remover ${teacher.fullName}?`)
    if (!confirmed) return
    await removeTeacher(user.uid, teacher.id)
    await loadTeachers()
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Cadastro de Professores</h2>
          <p className="feature-subtitle">Gestão de professores da EBD</p>
        </div>
        {canManageTeachers && <Button onClick={openCreateModal}>Novo Professor</Button>}
      </div>

      <Card>
        <div className="inline-form">
          <label htmlFor="teachers-search">Buscar por nome</label>
          <input
            id="teachers-search"
            placeholder="Digite um nome"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Lista de professores" subtitle={`${filtered.length} registro(s)`} />
        <div className="entity-list">
          {filtered.length === 0 && <p className="feature-subtitle">Nenhum professor cadastrado.</p>}
          {filtered.map((teacher) => (
            <div className="entity-row" key={teacher.id}>
              <div>
                <div className="entity-title">{teacher.fullName}</div>
                <div className="entity-meta">
                  {teacher.phone || 'Sem telefone'}
                </div>
                <span className={`entity-status ${teacher.active === false ? 'inactive' : 'active'}`}>
                  {teacher.active === false ? 'Inativo' : 'Ativo'}
                </span>
              </div>
              <div className="row-actions">
                {canManageTeachers && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => openEditModal(teacher)}>Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleToggle(teacher)}>
                      {teacher.active === false ? 'Ativar' : 'Inativar'}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handleRemove(teacher)}>Remover</Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {canManageTeachers && <Modal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar professor' : 'Novo professor'}
        footer={<Button onClick={handleSave}>{editing ? 'Salvar alterações' : 'Cadastrar'}</Button>}
      >
        <div className="inline-form">
          <label htmlFor="teacher-name">Nome completo</label>
          <input
            id="teacher-name"
            value={form.fullName}
            onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
          />

          <label htmlFor="teacher-phone">Telefone / WhatsApp</label>
          <input
            id="teacher-phone"
            value={form.phone}
            onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
          />

          <label htmlFor="teacher-notes">Observações</label>
          <textarea
            id="teacher-notes"
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          />
        </div>
      </Modal>}
    </div>
  )
}
