import { useEffect, useState } from 'react'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { listClasses, removeClass, saveClass, toggleClassStatus } from '../../services/classService'
import { listTeachers } from '../../services/teacherService'
import { belongsToTeacherRecord } from '../../utils/accessControl'

const CLASS_DEFAULT = {
  name: '',
  department: '',
  defaultTeacherId: '',
  defaultTeacherName: '',
  active: true,
}

export default function ClassesPage() {
  const { user, profile, canManageClasses } = useAuth()
  const [classes, setClasses] = useState([])
  const [teachers, setTeachers] = useState([])
  const [isModalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(CLASS_DEFAULT)

  async function loadData() {
    if (!user?.uid) return
    const [classList, teacherList] = await Promise.all([
      listClasses(user.uid),
      listTeachers(user.uid),
    ])
    const allowedClasses = canManageClasses
      ? classList
      : classList.filter((item) => belongsToTeacherRecord(item, user, profile))
    setClasses(allowedClasses)
    setTeachers(teacherList)
  }

  useEffect(() => {
    loadData()
  }, [user?.uid])

  function openCreateModal() {
    if (!canManageClasses) {
      window.alert('Somente administradores podem criar classes.')
      return
    }
    setEditing(null)
    setForm(CLASS_DEFAULT)
    setModalOpen(true)
  }

  function openEditModal(item) {
    if (!canManageClasses) {
      window.alert('Somente administradores podem editar classes.')
      return
    }
    setEditing(item)
    setForm({
      name: item.name || '',
      department: item.department || '',
      defaultTeacherId: item.defaultTeacherId || '',
      defaultTeacherName: item.defaultTeacherName || '',
      active: item.active !== false,
    })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!canManageClasses) {
      window.alert('Ação não permitida para o seu perfil.')
      return
    }
    if (!form.name.trim()) return
    
    const selectedTeacher = teachers.find((t) => t.id === form.defaultTeacherId)
    
    await saveClass(
      user.uid,
      {
        name: form.name.trim(),
        department: form.department.trim(),
        defaultTeacherId: form.defaultTeacherId,
        defaultTeacherName: selectedTeacher?.fullName || '',
        defaultTeacherEmail: selectedTeacher?.email || '',
        teacherUserUid: selectedTeacher?.userUid || '',
        active: form.active,
      },
      editing?.id,
    )
    setModalOpen(false)
    await loadData()
  }

  async function handleToggle(item) {
    if (!canManageClasses) {
      window.alert('Ação não permitida para o seu perfil.')
      return
    }
    await toggleClassStatus(user.uid, item.id, item.active === false)
    await loadData()
  }

  async function handleRemove(item) {
    if (!canManageClasses) {
      window.alert('Ação não permitida para o seu perfil.')
      return
    }
    const confirmed = window.confirm(`Remover a classe ${item.name}?`)
    if (!confirmed) return
    await removeClass(user.uid, item.id)
    await loadData()
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Classes e Departamentos</h2>
          <p className="feature-subtitle">
            {canManageClasses ? 'Estrutura de turmas da EBD' : 'Visualização das suas classes'}
          </p>
        </div>
        {canManageClasses && <Button onClick={openCreateModal}>Nova Classe</Button>}
      </div>

      <Card>
        <CardHeader title="Lista de classes" subtitle={`${classes.length} registro(s)`} />
        <div className="entity-list">
          {classes.length === 0 && <p className="feature-subtitle">Nenhuma classe cadastrada.</p>}
          {classes.map((item) => (
            <div key={item.id} className="entity-row">
              <div>
                <div className="entity-title">{item.name}</div>
                <div className="entity-meta">Departamento: {item.department || 'Não informado'} • Professor padrão: {item.defaultTeacherName || 'Não informado'}</div>
                <span className={`entity-status ${item.active === false ? 'inactive' : 'active'}`}>
                  {item.active === false ? 'Inativa' : 'Ativa'}
                </span>
              </div>
              <div className="row-actions">
                {canManageClasses && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => openEditModal(item)}>Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleToggle(item)}>
                      {item.active === false ? 'Ativar' : 'Inativar'}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handleRemove(item)}>Excluir</Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {canManageClasses && <Modal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar classe' : 'Nova classe'}
        footer={<Button onClick={handleSave}>{editing ? 'Salvar alterações' : 'Cadastrar classe'}</Button>}
      >
        <div className="inline-form">
          <label htmlFor="class-name">Nome da classe</label>
          <input
            id="class-name"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          />

          <label htmlFor="class-department">Departamento</label>
          <input
            id="class-department"
            value={form.department}
            onChange={(event) => setForm((prev) => ({ ...prev, department: event.target.value }))}
            placeholder="Adultos, Jovens, Infantil..."
          />

          <label htmlFor="class-teacher">Professor padrão (opcional)</label>
          <select
            id="class-teacher"
            value={form.defaultTeacherId}
            onChange={(event) => {
              const teacherId = event.target.value
              const teacher = teachers.find((t) => t.id === teacherId)
              setForm((prev) => ({
                ...prev,
                defaultTeacherId: teacherId,
                defaultTeacherName: teacher?.fullName || '',
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
        </div>
      </Modal>}
    </div>
  )
}
