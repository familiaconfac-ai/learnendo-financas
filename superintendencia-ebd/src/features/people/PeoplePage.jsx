import { useEffect, useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { listPeople, removePerson, savePerson, togglePersonStatus } from '../../services/peopleService'

const PERSON_DEFAULT = {
  fullName: '',
  phone: '',
  churchStatus: 'member',
  notes: '',
  active: true,
}

export default function PeoplePage() {
  const { user, canManageStudents } = useAuth()
  const [people, setPeople] = useState([])
  const [query, setQuery] = useState('')
  const [isModalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(PERSON_DEFAULT)

  async function loadPeople() {
    if (!user?.uid) return
    const data = await listPeople(user.uid)
    setPeople(data)
  }

  useEffect(() => {
    loadPeople()
  }, [user?.uid])

  const filtered = useMemo(() => {
    if (!query.trim()) return people
    const normalized = query.toLowerCase()
    return people.filter((person) => person.fullName?.toLowerCase().includes(normalized))
  }, [people, query])

  function openCreateModal() {
    if (!canManageStudents) {
      window.alert('Somente administradores podem cadastrar alunos.')
      return
    }
    setEditing(null)
    setForm(PERSON_DEFAULT)
    setModalOpen(true)
  }

  function openEditModal(person) {
    if (!canManageStudents) {
      window.alert('Somente administradores podem editar alunos.')
      return
    }
    setEditing(person)
    setForm({
      fullName: person.fullName || '',
      phone: person.phone || '',
      churchStatus: person.churchStatus || 'member',
      notes: person.notes || '',
      active: person.active !== false,
    })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!canManageStudents) {
      window.alert('Ação não permitida para o seu perfil.')
      return
    }
    if (!form.fullName.trim()) return

    await savePerson(
      user.uid,
      {
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        churchStatus: form.churchStatus,
        notes: form.notes.trim(),
        active: form.active,
      },
      editing?.id,
    )
    setModalOpen(false)
    await loadPeople()
  }

  async function handleToggle(person) {
    if (!canManageStudents) {
      window.alert('Ação não permitida para o seu perfil.')
      return
    }
    await togglePersonStatus(user.uid, person.id, person.active === false)
    await loadPeople()
  }

  async function handleRemove(person) {
    if (!canManageStudents) {
      window.alert('Ação não permitida para o seu perfil.')
      return
    }
    const confirmed = window.confirm(`Remover ${person.fullName}?`)
    if (!confirmed) return
    await removePerson(user.uid, person.id)
    await loadPeople()
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Cadastro de Alunos</h2>
          <p className="feature-subtitle">Alunos da Escola Bíblica Dominical</p>
        </div>
        {canManageStudents && <Button onClick={openCreateModal}>Novo Aluno</Button>}
      </div>

      <Card>
        <div className="inline-form">
          <label htmlFor="people-search">Buscar por nome</label>
          <input
            id="people-search"
            placeholder="Digite um nome"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Lista de alunos" subtitle={`${filtered.length} registro(s)`} />
        <div className="entity-list">
          {filtered.length === 0 && <p className="feature-subtitle">Nenhum aluno cadastrado.</p>}
          {filtered.map((person) => (
            <div className="entity-row" key={person.id}>
              <div>
                <div className="entity-title">{person.fullName}</div>
                <div className="entity-meta">
                  {person.phone || 'Sem telefone'} • {person.churchStatus === 'member' ? 'Membro' : person.churchStatus === 'attendee' ? 'Frequentante' : 'Visitante'}
                </div>
                <span className={`entity-status ${person.active === false ? 'inactive' : 'active'}`}>
                  {person.active === false ? 'Inativo' : 'Ativo'}
                </span>
              </div>
              <div className="row-actions">
                {canManageStudents && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => openEditModal(person)}>Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleToggle(person)}>
                      {person.active === false ? 'Ativar' : 'Inativar'}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handleRemove(person)}>Remover</Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {canManageStudents && <Modal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar aluno' : 'Novo aluno'}
        footer={<Button onClick={handleSave}>{editing ? 'Salvar alterações' : 'Cadastrar'}</Button>}
      >
        <div className="inline-form">
          <label htmlFor="person-name">Nome completo</label>
          <input
            id="person-name"
            value={form.fullName}
            onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
          />

          <label htmlFor="person-phone">Telefone</label>
          <input
            id="person-phone"
            value={form.phone}
            onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
          />

          <label htmlFor="person-status">Situação na igreja</label>
          <select
            id="person-status"
            value={form.churchStatus}
            onChange={(event) => setForm((prev) => ({ ...prev, churchStatus: event.target.value }))}
          >
            <option value="member">Membro</option>
            <option value="attendee">Frequentante</option>
            <option value="visitor">Visitante</option>
          </select>

          <label htmlFor="person-notes">Observações</label>
          <textarea
            id="person-notes"
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          />
        </div>
      </Modal>}
    </div>
  )
}
