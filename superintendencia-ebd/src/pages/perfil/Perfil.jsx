import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useCategories } from '../../hooks/useCategories'
import { logoutUser, updateUserProfileData } from '../../firebase/auth'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import './Perfil.css'

export default function Perfil() {
  const { user, profile, refreshProfile } = useAuth()
  const { workspaces, activeWorkspaceId, activeWorkspace, myRole, changeWorkspace, createNewWorkspace } = useWorkspace()
  const { categories } = useCategories()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [form, setForm] = useState({
    displayName: profile?.displayName || '',
    photoURL: profile?.photoURL || '',
    preferredCurrency: profile?.preferredCurrency || 'BRL',
    preferredExpenseCategoryId: profile?.preferredExpenseCategoryId || '',
  })

  useEffect(() => {
    setForm({
      displayName: profile?.displayName || '',
      photoURL: profile?.photoURL || '',
      preferredCurrency: profile?.preferredCurrency || 'BRL',
      preferredExpenseCategoryId: profile?.preferredExpenseCategoryId || '',
    })
  }, [profile?.displayName, profile?.photoURL, profile?.preferredCurrency, profile?.preferredExpenseCategoryId])

  const expenseCategories = categories.filter((c) => c.type === 'expense')

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!user?.uid) return
    setSaving(true)
    setError('')
    setMessage('')

    try {
      await updateUserProfileData(user.uid, {
        displayName: form.displayName.trim(),
        photoURL: form.photoURL.trim(),
        preferredCurrency: form.preferredCurrency,
        preferredExpenseCategoryId: form.preferredExpenseCategoryId || null,
      })
      await refreshProfile()
      setMessage('Perfil atualizado com sucesso.')
    } catch (err) {
      setError(`Erro ao salvar perfil: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleLogout() {
    setLoading(true)
    await logoutUser()
    navigate('/login')
  }

  async function handleCreateWorkspace(e) {
    e.preventDefault()
    if (!newWorkspaceName.trim()) return
    setSaving(true)
    try {
      await createNewWorkspace(newWorkspaceName.trim(), 'family')
      setNewWorkspaceName('')
      setMessage('Novo workspace criado e selecionado.')
    } catch (err) {
      setError(`Erro ao criar workspace: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="perfil-page">
      {/* Avatar — suporta foto real ou inicial como fallback */}
      <div className="perfil-hero">
        <div className="perfil-avatar">
          {profile?.photoURL || user?.photoURL ? (
            <img
              src={profile?.photoURL ?? user?.photoURL}
              alt={profile?.displayName ?? 'Avatar'}
              className="perfil-avatar-img"
            />
          ) : (
            <span className="perfil-avatar-initial">
              {profile?.displayName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?'}
            </span>
          )}
        </div>
        <h2 className="perfil-name">{profile?.displayName ?? '—'}</h2>
        <p className="perfil-email">{user?.email}</p>
      </div>

      {/* Dados */}
      <div className="perfil-content">
        <Card>
          <CardHeader title="Dados da conta" />
          <div className="perfil-row"><span>E-mail</span><span>{user?.email}</span></div>
          <div className="perfil-row"><span>Papel no workspace</span><span>{myRole || (profile?.role === 'admin' ? 'gestor' : 'membro')}</span></div>
          <div className="perfil-row"><span>Workspace ativo</span><span>{activeWorkspace?.name || '—'}</span></div>
        </Card>

        <Card>
          <CardHeader title="Workspaces" subtitle="1 login, múltiplos workspaces" />
          <div className="form-group">
            <label htmlFor="activeWorkspace">Selecionar workspace</label>
            <select
              id="activeWorkspace"
              value={activeWorkspaceId || ''}
              onChange={(e) => changeWorkspace(e.target.value)}
            >
              <option value="" disabled>Selecione...</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>{ws.name} ({ws.memberRole})</option>
              ))}
            </select>
          </div>
          <form className="workspace-create-row" onSubmit={handleCreateWorkspace}>
            <input
              type="text"
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              placeholder="Novo workspace (família/equipe)"
            />
            <button type="submit" className="workspace-create-btn">Criar</button>
          </form>
        </Card>

        <Card>
          <CardHeader title="Editar perfil" />
          <form className="perfil-form" onSubmit={handleSave}>
            <div className="form-group">
              <label htmlFor="displayName">Nome</label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                value={form.displayName}
                onChange={handleChange}
                placeholder="Seu nome"
              />
            </div>

            <div className="form-group">
              <label htmlFor="photoURL">URL da foto</label>
              <input
                id="photoURL"
                name="photoURL"
                type="url"
                value={form.photoURL}
                onChange={handleChange}
                placeholder="https://..."
              />
            </div>

            <div className="form-group">
              <label htmlFor="preferredCurrency">Moeda preferida</label>
              <select
                id="preferredCurrency"
                name="preferredCurrency"
                value={form.preferredCurrency}
                onChange={handleChange}
              >
                <option value="BRL">BRL – Real</option>
                <option value="USD">USD – Dólar</option>
                <option value="EUR">EUR – Euro</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="preferredExpenseCategoryId">Categoria de despesa preferida</label>
              <select
                id="preferredExpenseCategoryId"
                name="preferredExpenseCategoryId"
                value={form.preferredExpenseCategoryId}
                onChange={handleChange}
              >
                <option value="">Não definida</option>
                {expenseCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                ))}
              </select>
            </div>

            {error && <div className="perfil-feedback perfil-feedback--error">{error}</div>}
            {message && <div className="perfil-feedback perfil-feedback--ok">{message}</div>}

            <Button type="submit" variant="primary" fullWidth loading={saving}>
              Salvar alterações
            </Button>
          </form>
        </Card>

        <Button variant="danger" fullWidth loading={loading} onClick={handleLogout}>
          🚪 Sair da conta
        </Button>
      </div>
    </div>
  )
}
