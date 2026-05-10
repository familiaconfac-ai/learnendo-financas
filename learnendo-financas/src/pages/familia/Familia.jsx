import { useState, useEffect, useMemo } from 'react'
import Card, { CardHeader } from '../../components/ui/Card'
import { formatCurrency } from '../../utils/formatCurrency'
import { useFamilia } from '../../hooks/useFamilia'
import { useAccounts } from '../../hooks/useAccounts'
import { useAuth } from '../../context/AuthContext'
import { useFinance } from '../../context/FinanceContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { db } from '../../firebase/config'
import { addMember } from '../../services/familyService'
import { fetchAllTransactionsForWorkspace } from '../../services/transactionService'
import { calculateMonthlySummary } from '../../utils/financeCalculations'
import './Familia.css'

// ── Role metadata (new canonical names) ────────────────────────────────────

const ROLE_META = {
  'gestor':     { label: 'Gestor',     cls: 'role-gestor',     icon: '👑' },
  'co-gestor':  { label: 'Co-gestor',  cls: 'role-cogestor',   icon: '🛡️' },
  'membro':     { label: 'Membro',     cls: 'role-membro',     icon: '👤' },
  'planejador': { label: 'Planejador', cls: 'role-planejador',  icon: '👁️' },
}

const ROLE_DESC = {
  'gestor':     'Controle total. Pode editar a família, adicionar/remover membros e transferir liderança.',
  'co-gestor':  'Quase controle total. Pode gerenciar membros e editar dados de todos.',
  'membro':     'Pode criar e editar as próprias transações. Não gerencia membros.',
  'planejador': 'Apenas visualiza o consolidado familiar. Não pode editar nada.',
}

const INV_STATUS_META = {
  pending:   { label: 'Aguardando', cls: 'inv-pending'  },
  accepted:  { label: 'Aceito',     cls: 'inv-accepted' },
  declined:  { label: 'Recusado',   cls: 'inv-declined' },
  expired:   { label: 'Expirado',   cls: 'inv-expired'  },
  cancelled: { label: 'Cancelado',  cls: 'inv-expired'  },
}

const MANAGEABLE_ROLES = [
  { value: 'co-gestor',  label: 'Co-gestor'  },
  { value: 'membro',     label: 'Membro'     },
  { value: 'planejador', label: 'Planejador' },
]

function membersLabel(count) {
  if (count === 1) return '1 pessoa'
  return `${count} pessoas`
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function useToast() {
  const [toast, setToast] = useState(null)
  function show(msg, type = 'ok') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }
  return { toast, show }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Familia() {
  const { user } = useAuth()
  const { selectedMonth, selectedYear } = useFinance()
  const { accounts } = useAccounts()
  const {
    createInviteLink,
    cancelInvite: cancelWorkspaceInvite,
    activeWorkspace,
    activeWorkspaceId,
    permissions,
    debtLedger,
    projects,
    members: workspaceMembers,
    invitations: workspaceInvitations,
    myRole: workspaceRole,
    addProject,
    editProject,
  } = useWorkspace()
  const {
    family, members, invitations, loading, error,
    myRole, canManage, reload,
    create, editName, deleteFamily,
    removeMember, changeRole, cancelInvite: cancelLegacyInvite,
  } = useFamilia()
  const { toast, show: showToast } = useToast()

  // ── Modal state ────────────────────────────────────────────────────────────

  const [editFamilyOpen,     setEditFamilyOpen]     = useState(false)
  const [editName_value,     setEditNameValue]       = useState('')
  const [deleteFamilyOpen,   setDeleteFamilyOpen]    = useState(false)
  const [deleteConfirmText,  setDeleteConfirmText]   = useState('')
  const [removeMemberTarget, setRemoveMemberTarget]  = useState(null)
  const [inviteOpen,         setInviteOpen]          = useState(false)
  const [inviteTab,          setInviteTab]           = useState('whatsapp')  // 'whatsapp' | 'email'
  const [invitePhone,        setInvitePhone]         = useState('')
  const [inviteEmail,        setInviteEmail]         = useState('')
  const [inviteRole,         setInviteRole]          = useState('membro')
  const [createFamilyOpen,   setCreateFamilyOpen]    = useState(false)
  const [createName,         setCreateName]          = useState('')
  const [saving,             setSaving]              = useState(false)
  const [addMemberOpen,      setAddMemberOpen]       = useState(false)
  const [addMemberName,      setAddMemberName]       = useState('')
  const [addMemberEmail,     setAddMemberEmail]      = useState('')
  const [addMemberNote,      setAddMemberNote]       = useState('')
  const [addMemberRole,      setAddMemberRole]       = useState('membro')
  const [projectOpen,        setProjectOpen]         = useState(false)
  const [editingProjectId,   setEditingProjectId]    = useState(null)
  const [projectName,        setProjectName]         = useState('')
  const [projectTarget,      setProjectTarget]       = useState('')
  const [projectCurrent,     setProjectCurrent]      = useState('')
  const [projectOwnerId,     setProjectOwnerId]      = useState('')
  const [projectOwnerName,   setProjectOwnerName]    = useState('')
  const [projectAccount,     setProjectAccount]      = useState('')
  const [projectAccountId,   setProjectAccountId]    = useState('')
  const [projectMatchText,   setProjectMatchText]    = useState('')
  const [projectNotes,       setProjectNotes]        = useState('')
  const [workspaceTransactions, setWorkspaceTransactions] = useState([])
  const [summaryLoading,     setSummaryLoading]      = useState(false)
  const [summaryMode,        setSummaryMode]         = useState('month')

  // ── Load consolidated workspace transactions for summary ───────────────────

  useEffect(() => {
    if (!user?.uid || !activeWorkspaceId) {
      setWorkspaceTransactions([])
      return
    }
    let cancelled = false
    setSummaryLoading(true)
    ;(async () => {
      try {
        const tx = await fetchAllTransactionsForWorkspace(user.uid, {
          workspaceId: activeWorkspaceId,
          viewerRole: workspaceRole,
          viewerUid: user.uid,
          includeRecurringAuto: true,
          includeLegacyPersonal: false,
        })
        if (!cancelled) setWorkspaceTransactions(tx)
      } catch (err) {
        console.error('[Familia] Resumo financeiro:', err.message)
        if (!cancelled) setWorkspaceTransactions([])
      } finally {
        if (!cancelled) setSummaryLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [user?.uid, activeWorkspaceId, workspaceRole])

  // ── Derived ────────────────────────────────────────────────────────────────

  const myMember   = members.find((m) => m.uid === user?.uid || m.id === user?.uid)
  const familyName = activeWorkspace?.name || family?.name || 'Familia'
  const familyMembers = workspaceMembers?.length > 0 ? workspaceMembers : members
  const effectiveRole = workspaceRole || myRole
  const visibleInvitations = useMemo(() => {
    const modern = (workspaceInvitations || []).map((item) => ({ ...item, _source: 'workspace' }))
    const legacy = (invitations || []).map((item) => ({ ...item, _source: 'legacy-family' }))
    const merged = modern.length > 0 ? [...modern, ...legacy] : legacy
    return merged.filter((item) => item.status === 'pending')
  }, [workspaceInvitations, invitations])
  const activeProjects = Array.isArray(projects) ? projects.filter((project) => project.status !== 'archived') : []
  const leadProject = activeProjects[0] || null
  const projectLabel = leadProject ? leadProject.name : 'Projetos'
  const projectHighlight = leadProject ? formatCurrency(Number(leadProject.effectiveCurrentAmount || 0)) : String(activeProjects.length)
  const selectedMonthKey = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`

  const summaryTransactions = useMemo(() => {
    const source = Array.isArray(workspaceTransactions) ? workspaceTransactions : []
    if (summaryMode === 'year') {
      return source.filter((tx) => String(tx.competencyMonth || tx.recurringInstanceMonth || tx.salaryReferenceMonth || tx.date || '').startsWith(String(selectedYear)))
    }
    return source.filter((tx) => String(tx.competencyMonth || tx.recurringInstanceMonth || tx.salaryReferenceMonth || tx.date || '').startsWith(selectedMonthKey))
  }, [workspaceTransactions, summaryMode, selectedYear, selectedMonthKey])

  const summarySnapshot = useMemo(
    () => calculateMonthlySummary(summaryTransactions),
    [summaryTransactions],
  )
  const totalReceitas = Number(summarySnapshot?.receitas || 0)
  const totalDespesas = Number((summarySnapshot?.despesas || 0) + (summarySnapshot?.investimentos || 0))
  const totalSaldo = Number(summarySnapshot?.saldo || 0)
  const summarySubtitle = summaryLoading
    ? 'Carregando…'
    : summaryMode === 'year'
      ? `Visão anual de ${selectedYear}`
      : `Visão mensal de ${selectedMonthKey}`

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleEditFamilyOpen() {
    setEditNameValue(family?.name ?? '')
    setEditFamilyOpen(true)
  }

  async function handleEditFamilySave() {
    if (!editName_value.trim()) return
    setSaving(true)
    try {
      await editName(editName_value.trim())
      setEditFamilyOpen(false)
      showToast('Nome da família atualizado ✅')
    } catch (err) {
      showToast('Erro ao atualizar: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteFamily() {
    if (deleteConfirmText.toLowerCase() !== 'excluir') return
    setSaving(true)
    try {
      await deleteFamily()
      setDeleteFamilyOpen(false)
      setDeleteConfirmText('')
      showToast('Família excluída.')
    } catch (err) {
      showToast('Erro ao excluir: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemoveMember() {
    if (!removeMemberTarget) return
    setSaving(true)
    try {
      await removeMember(removeMemberTarget.id ?? removeMemberTarget.uid)
      setRemoveMemberTarget(null)
      showToast(`${removeMemberTarget.displayName} removido(a) ✅`)
    } catch (err) {
      showToast('Erro ao remover: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleRoleChange(member, newRole) {
    try {
      await changeRole(member.id ?? member.uid, newRole)
      showToast(`Papel de ${member.displayName} alterado ✅`)
    } catch (err) {
      showToast('Erro ao alterar papel: ' + err.message, 'err')
    }
  }

  async function handleInviteWhatsApp(e) {
    e.preventDefault()
    const phone    = invitePhone.replace(/\D/g, '')
    const famName  = familyName || 'nossa família'
    const invite = await createInviteLink(inviteRole || 'membro', { phone, method: 'whatsapp' })
    const message  = `Olá! Você foi convidado(a) para participar de "${famName}" no Learnendo Finanças.\n\nAceite por este link: ${invite.link}`
    const waUrl    = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`

    window.open(waUrl, '_blank', 'noopener,noreferrer')
    setInviteOpen(false)
    setInvitePhone('')
    showToast('WhatsApp aberto com o convite 📲')
  }

  async function handleInviteEmail(e) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setSaving(true)
    try {
      const invite = await createInviteLink(inviteRole || 'membro', {
        email: inviteEmail.trim(),
        method: 'email',
      })
      const subject = encodeURIComponent(`Convite para ${familyName}`)
      const body = encodeURIComponent(
        `Olá!\n\nVocê foi convidado(a) para participar de "${familyName}" no Learnendo Finanças.\n\nAceite por este link:\n${invite.link}`,
      )
      window.open(`mailto:${inviteEmail.trim()}?subject=${subject}&body=${body}`, '_blank', 'noopener,noreferrer')
      setInviteOpen(false)
      setInviteEmail('')
      showToast('Convite preparado ✅')
    } catch (err) {
      showToast('Erro ao convidar: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleAddMember(e) {
    e.preventDefault()
    const name = addMemberName.trim()
    if (!name) {
      showToast('Informe o nome do membro.', 'err')
      return
    }

    const email = addMemberEmail.trim().toLowerCase()
    const duplicateByName = members.some((m) => (m.displayName || '').trim().toLowerCase() === name.toLowerCase())
    const duplicateByEmail = email && members.some((m) => (m.email || '').trim().toLowerCase() === email)
    if (duplicateByName || duplicateByEmail) {
      showToast('Já existe um membro com estes dados.', 'err')
      return
    }

    setSaving(true)
    try {
      await addMember(user.uid, family.id, {
        uid: null,
        displayName: name,
        name,
        email: email || '',
        role: addMemberRole,
        note: addMemberNote.trim() || '',
        status: 'active',
        avatarInitial: name.charAt(0).toUpperCase(),
      })
      setAddMemberOpen(false)
      setAddMemberName('')
      setAddMemberEmail('')
      setAddMemberNote('')
      setAddMemberRole('membro')
      await reload()
      showToast('Membro adicionado ✅')
    } catch (err) {
      showToast('Erro ao adicionar membro: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateFamily(e) {
    e.preventDefault()
    if (!createName.trim()) return
    setSaving(true)
    try {
      await create(createName.trim())
      setCreateFamilyOpen(false)
      setCreateName('')
      showToast('Família criada ✅')
    } catch (err) {
      showToast('Erro ao criar: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateProject(e) {
    e.preventDefault()
    if (!projectName.trim()) {
      showToast('Informe o nome do projeto.', 'err')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: projectName.trim(),
        targetAmount: projectTarget,
        currentAmount: projectCurrent,
        ownerMemberId: projectOwnerId,
        ownerMemberName: projectOwnerName.trim(),
        linkedAccountId: projectAccountId,
        linkedAccountLabel: projectAccount.trim(),
        matchText: projectMatchText.trim(),
        notes: projectNotes.trim(),
      }

      if (editingProjectId) {
        await editProject(editingProjectId, payload)
      } else {
        await addProject(payload)
      }
      setProjectOpen(false)
      setEditingProjectId(null)
      setProjectName('')
      setProjectTarget('')
      setProjectCurrent('')
      setProjectOwnerId('')
      setProjectOwnerName('')
      setProjectAccount('')
      setProjectAccountId('')
      setProjectMatchText('')
      setProjectNotes('')
      showToast(editingProjectId ? 'Projeto familiar atualizado ✅' : 'Projeto familiar criado ✅')
    } catch (err) {
      showToast('Erro ao salvar projeto: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  function handleProjectModalClose() {
    setProjectOpen(false)
    setEditingProjectId(null)
    setProjectName('')
    setProjectTarget('')
    setProjectCurrent('')
    setProjectOwnerId('')
    setProjectOwnerName('')
    setProjectAccount('')
    setProjectAccountId('')
    setProjectMatchText('')
    setProjectNotes('')
  }

  function handleProjectEditOpen(project) {
    setEditingProjectId(project.id)
    setProjectName(project.name || '')
    setProjectTarget(String(project.targetAmount || ''))
    setProjectCurrent(String(project.currentAmount || ''))
    setProjectOwnerId(project.ownerMemberId || '')
    setProjectOwnerName(project.ownerMemberName || '')
    setProjectAccount(project.linkedAccountLabel || '')
    setProjectAccountId(project.linkedAccountId || '')
    setProjectMatchText(project.matchText || '')
    setProjectNotes(project.notes || '')
    setProjectOpen(true)
  }

  function handleProjectCreateOpen() {
    handleProjectModalClose()
    setProjectOpen(true)
  }

  async function handleShareApp() {
    if (!permissions.canInvite) {
      showToast('Apenas gestor pode convidar novos membros.', 'err')
      return
    }

    const invite = await createInviteLink(inviteRole || 'membro', { method: 'link' })
    const shareData = {
      title: 'Convite de workspace',
      text:  `Convite para o workspace ${family?.name || ''} (${inviteRole || 'membro'})`,
      url:   invite.link,
    }
    if (navigator.share) {
      try {
        await navigator.share(shareData)
      } catch (_) { /* user cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(invite.link)
        showToast('Link de convite copiado 📋')
      } catch (_) {
        showToast('Link: ' + invite.link)
      }
    }
  }

  async function handleCancelInvite(invite) {
    if (!invite?.id) return
    setSaving(true)
    try {
      if (invite._source === 'legacy-family') {
        await cancelLegacyInvite(invite.id)
      } else {
        await cancelWorkspaceInvite(invite.id)
      }
      await reload()
      showToast('Convite cancelado ✅')
    } catch (err) {
      showToast('Erro ao cancelar convite: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  // ── Loading / error / no-family states ───────────────────────────────────

  // Renderização condicional robusta
  if (loading) {
    return (
      <div className="familia-page">
        <div className="familia-loading">
          <div className="familia-spinner" />
          <p>Carregando família…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="familia-page">
        <div className="familia-error-box">
          <strong>Erro ao carregar dados da família</strong>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  // Só renderiza dados se family válido
  if (!family && !activeWorkspace) {
    return (
      <div className="familia-page">
        <div className="familia-empty">
          <span className="familia-empty-icon">🏡</span>
          <p className="familia-empty-title">Você ainda não tem uma família</p>
          <p className="familia-empty-sub">Crie um grupo familiar para compartilhar dados financeiros com sua família.</p>
          <button className="btn-invite" onClick={() => setCreateFamilyOpen(true)}>
            Criar família
          </button>
        </div>

        {createFamilyOpen && (
          <div className="modal-overlay" onClick={() => setCreateFamilyOpen(false)}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <h3 className="modal-title">Criar família</h3>
              <form onSubmit={handleCreateFamily} className="invite-form">
                <div className="form-group">
                  <label>Nome da família</label>
                  <input
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="Ex: Família Silva"
                    required
                    autoFocus
                    maxLength={60}
                  />
                </div>
                <div className="invite-form-actions">
                  <button type="button" className="btn-cancel" onClick={() => setCreateFamilyOpen(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-send" disabled={saving}>
                    {saving ? 'Criando…' : 'Criar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {toast && <div className={`familia-toast ${toast.type === 'err' ? 'toast-err' : ''}`}>{toast.msg}</div>}
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="familia-page">

      {/* Cabeçalho */}
      <div className="familia-header">
        <div className="familia-icon">🏡</div>
        <div className="familia-header-info">
          <h1 className="familia-name">{familyName}</h1>
          <span className="familia-plan">Plano Familiar · {membersLabel(familyMembers.length)}</span>
        </div>
        {canManage && (
          <div className="familia-header-actions">
            <button
              className="fh-btn"
              title="Editar nome da família"
              onClick={handleEditFamilyOpen}
            >
              ✏️
            </button>
            <button
              className="fh-btn fh-btn--danger"
              title="Excluir família"
              onClick={() => { setDeleteConfirmText(''); setDeleteFamilyOpen(true) }}
            >
              🗑️
            </button>
          </div>
        )}
      </div>

      {/* Resumo financeiro */}
      <Card>
        <CardHeader
          title="Resumo consolidado"
          subtitle={summarySubtitle}
        />
        <div className="familia-summary-toolbar">
          <button
            type="button"
            className={`familia-summary-toggle${summaryMode === 'month' ? ' active' : ''}`}
            onClick={() => setSummaryMode('month')}
          >
            Mensal
          </button>
          <button
            type="button"
            className={`familia-summary-toggle${summaryMode === 'year' ? ' active' : ''}`}
            onClick={() => setSummaryMode('year')}
          >
            Anual
          </button>
        </div>
        <div className="familia-summary-grid">
          <div className="familia-stat">
            <span className="familia-stat-label">Receitas</span>
            <span className="familia-stat-value green">
              {summaryLoading ? '…' : formatCurrency(totalReceitas)}
            </span>
          </div>
          <div className="familia-stat">
            <span className="familia-stat-label">Despesas</span>
            <span className="familia-stat-value red">
              {summaryLoading ? '…' : formatCurrency(totalDespesas)}
            </span>
          </div>
          <div className="familia-stat">
            <span className="familia-stat-label">Saldo líquido</span>
            <span className={`familia-stat-value ${totalSaldo >= 0 ? 'green' : 'red'}`}>
              {summaryLoading ? '…' : formatCurrency(totalSaldo)}
            </span>
          </div>
          <div className="familia-stat">
            <span className="familia-stat-label">{projectLabel}</span>
            <span className="familia-stat-value blue">{projectHighlight}</span>
          </div>
        </div>
      </Card>

      <Card>
        <div className="familia-members-header">
          <CardHeader
            title="Projetos familiares"
            subtitle={leadProject ? 'Caixinhas e objetivos compartilhados da familia' : 'Crie a primeira caixinha da familia'}
          />
          {canManage && (
            <div className="members-header-btns">
              <button className="btn-add-member" onClick={handleProjectCreateOpen}>
                + Projeto
              </button>
            </div>
          )}
        </div>

        {activeProjects.length === 0 ? (
          <div className="familia-empty" style={{ marginTop: '0.5rem' }}>
            <p className="familia-empty-title">Nenhum projeto criado ainda</p>
            <p className="familia-empty-sub">Use projetos para acompanhar viagem, reserva, reforma ou outra caixinha da familia.</p>
            {canManage && (
              <button className="btn-add-member" onClick={handleProjectCreateOpen}>
                + Criar primeiro projeto
              </button>
            )}
          </div>
        ) : (
          <ul className="projects-list">
            {activeProjects.map((project) => {
              const targetAmount = Number(project.targetAmount || 0)
              const currentAmount = Number(project.effectiveCurrentAmount || project.currentAmount || 0)
              const progress = targetAmount > 0
                ? Math.max(0, Math.min(100, Number(project.progress || (currentAmount / targetAmount) * 100)))
                : 0

              return (
                <li key={project.id} className="project-item">
                  <div className="project-main">
                    <div className="project-head">
                      <strong>{project.name}</strong>
                      <div className="project-head-actions">
                        <span className="project-kind">{project.kind === 'caixinha' ? 'Caixinha' : project.kind}</span>
                        {canManage && (
                          <button className="project-edit-btn" onClick={() => handleProjectEditOpen(project)}>
                            Editar
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="project-values">
                      <span>{formatCurrency(currentAmount)}</span>
                      <span className="project-target">meta {formatCurrency(targetAmount)}</span>
                    </div>
                    <div className="project-progress-track">
                      <span className="project-progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="project-meta">
                      <span>{progress.toFixed(0)}% concluido</span>
                      {project.ownerMemberName && <span>Responsavel: {project.ownerMemberName}</span>}
                      {project.linkedAccountLabel && <span>Conta: {project.linkedAccountLabel}</span>}
                      {project.matchText && <span>Filtro: {project.matchText}</span>}
                      {project.isAutoTracked && <span>Auto: {project.trackedTransactionsCount} lancamentos</span>}
                    </div>
                    {project.isAutoTracked && (
                      <div className="project-meta">
                        <span>Base manual: {formatCurrency(Number(project.currentAmount || 0))}</span>
                        <span>Movimento automatico: {formatCurrency(Number(project.trackedAmount || 0))}</span>
                      </div>
                    )}
                    {project.notes && <p className="project-notes">{project.notes}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* Membros */}
      <Card>
        <div className="familia-members-header">
          <CardHeader title="Membros" subtitle={membersLabel(familyMembers.length)} />
          {canManage && (
            <div className="members-header-btns">
              <button className="btn-add-member" onClick={() => setAddMemberOpen(true)}>
                + Adicionar
              </button>
              <button className="btn-invite" onClick={() => setInviteOpen(true)}>
                + Convidar
              </button>
            </div>
          )}
        </div>

        {familyMembers.length === 0 ? (
          <div className="familia-empty" style={{ marginTop: '0.5rem' }}>
            <p className="familia-empty-title">Nenhum membro cadastrado</p>
            <p className="familia-empty-sub">Adicione pessoas da casa para começar o acompanhamento familiar.</p>
            {canManage && (
              <button className="btn-add-member" onClick={() => setAddMemberOpen(true)}>
                + Adicionar primeiro membro
              </button>
            )}
          </div>
        ) : (
        <ul className="members-list">
          {familyMembers.map((m) => {
            const roleMeta  = ROLE_META[m.role] ?? { label: m.role, cls: '', icon: '👤' }
            const isMe      = m.uid === user?.uid || m.id === user?.uid
            const isGestor  = m.role === 'gestor'
            const canEdit   = m.role === 'gestor' || m.role === 'co-gestor' || m.role === 'membro'
            return (
              <li key={m.id ?? m.uid} className="member-item">
                <div className="member-avatar" data-role={m.role}>
                  {m.avatarInitial ?? (m.displayName?.[0] ?? '?')}
                </div>
                <div className="member-info">
                  <span className="member-name">
                    {m.displayName}
                    {isMe && <span className="member-you">você</span>}
                    {m.status === 'pending' && <span className="member-status-pending">Pendente</span>}
                  </span>
                  <span className="member-email">{m.email}</span>
                  {m.note && <span className="member-email">Obs: {m.note}</span>}
                  <div className="member-meta">
                    {canManage && !isGestor ? (
                      <select
                        className="role-select"
                        value={m.role}
                        onChange={(e) => handleRoleChange(m, e.target.value)}
                      >
                        {MANAGEABLE_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`role-badge ${roleMeta.cls}`}>
                        {roleMeta.icon} {roleMeta.label}
                      </span>
                    )}
                    <span className="member-perm">
                      {canEdit ? '✏️ Pode editar' : '👁️ Só visualiza'}
                    </span>
                  </div>
                </div>
                <div className="member-values">
                  {m.monthlyReceitas != null && (
                    <span className="mv-income">{formatCurrency(m.monthlyReceitas)}</span>
                  )}
                  {m.monthlyDespesas != null && (
                    <span className="mv-expense">{formatCurrency(m.monthlyDespesas)}</span>
                  )}
                </div>
                {canManage && !isGestor && !isMe && (
                  <button
                    className="btn-remove"
                    title="Remover membro"
                    onClick={() => setRemoveMemberTarget(m)}
                  >
                    ✕
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        )}
      </Card>

      {/* Convites pendentes */}
      {visibleInvitations.length > 0 && (
        <Card>
          <CardHeader title="Convites enviados" subtitle="Aguardando resposta" />
          <ul className="invites-list">
            {visibleInvitations.map((inv) => {
                const meta = INV_STATUS_META[inv.status] ?? { label: inv.status, cls: '' }
                const dest = inv.email ?? inv.phone ?? '—'
                const method = inv.method === 'whatsapp' ? '📲' : '📧'
                return (
                  <li key={inv.id} className="invite-item">
                    <span className="invite-method">{method}</span>
                    <span className="invite-email">{dest}</span>
                    <span className={`invite-status ${meta.cls}`}>{meta.label}</span>
                    <span className="invite-role">{ROLE_META[inv.role]?.label ?? inv.role}</span>
                    <button
                      type="button"
                      className="invite-cancel-btn"
                      onClick={() => handleCancelInvite(inv)}
                      disabled={saving}
                    >
                      Excluir
                    </button>
                  </li>
                )
              })}
          </ul>
        </Card>
      )}

      {/* Papéis e permissões */}
      <Card>
        <CardHeader title="Papéis e permissões" />
        <ul className="roles-legend">
          {Object.entries(ROLE_META).map(([key, meta]) => (
            <li key={key} className="role-legend-item">
              <span className={`role-badge ${meta.cls}`}>{meta.icon} {meta.label}</span>
              <span className="role-legend-desc">{ROLE_DESC[key]}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Saldo entre pessoas" subtitle="Ledger automático por contato" />
        {debtLedger.length === 0 ? (
          <p className="ledger-empty">Nenhum saldo pendente entre pessoas no momento.</p>
        ) : (
          <ul className="ledger-list">
            {debtLedger.map((item) => (
              <li key={item.contactId} className="ledger-item">
                <span className="ledger-name">{item.contactName}</span>
                <span className={`ledger-value ${item.pendingBalance >= 0 ? 'green' : 'red'}`}>
                  {formatCurrency(Math.abs(item.pendingBalance))} {item.pendingBalance >= 0 ? 'a receber' : 'a pagar'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Compartilhar app */}
      <Card>
        <div className="share-app-row">
          <div className="share-app-info">
            <strong>Convidar para o workspace</strong>
            <p>Gera link com workspaceId e papel ({inviteRole || 'membro'}).</p>
          </div>
          <button className="btn-share-app" onClick={handleShareApp}>
            🔗 Convidar
          </button>
        </div>
        {activeWorkspaceId && <p className="workspace-id-hint">Workspace atual: {activeWorkspaceId}</p>}
      </Card>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {/* Edit family name */}
      {editFamilyOpen && (
        <div className="modal-overlay" onClick={() => setEditFamilyOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Editar família</h3>
            <div className="invite-form">
              <div className="form-group">
                <label>Nome da família</label>
                <input
                  type="text"
                  value={editName_value}
                  onChange={(e) => setEditNameValue(e.target.value)}
                  placeholder="Ex: Família Silva"
                  autoFocus
                  maxLength={60}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleEditFamilySave() }}
                />
              </div>
              <div className="invite-form-actions">
                <button className="btn-cancel" onClick={() => setEditFamilyOpen(false)}>
                  Cancelar
                </button>
                <button
                  className="btn-send"
                  onClick={handleEditFamilySave}
                  disabled={saving || !editName_value.trim()}
                >
                  {saving ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete family confirm */}
      {deleteFamilyOpen && (
        <div className="modal-overlay" onClick={() => setDeleteFamilyOpen(false)}>
          <div className="modal-box modal-danger" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">⚠️ Excluir família</h3>
            <p className="modal-danger-text">
              Esta ação é <strong>irreversível</strong>. Todos os dados da família (membros e convites) serão deletados.
            </p>
            <p className="modal-danger-text">
              Digite <strong>excluir</strong> para confirmar:
            </p>
            <div className="invite-form">
              <div className="form-group">
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="excluir"
                  autoFocus
                />
              </div>
              <div className="invite-form-actions">
                <button className="btn-cancel" onClick={() => setDeleteFamilyOpen(false)}>
                  Cancelar
                </button>
                <button
                  className="btn-delete-confirm"
                  onClick={handleDeleteFamily}
                  disabled={saving || deleteConfirmText.toLowerCase() !== 'excluir'}
                >
                  {saving ? 'Excluindo…' : 'Excluir definitivamente'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Remove member confirm */}
      {removeMemberTarget && (
        <div className="modal-overlay" onClick={() => setRemoveMemberTarget(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Remover membro</h3>
            <p className="modal-danger-text">
              Remover <strong>{removeMemberTarget.displayName}</strong> da família?
              Ele(a) perderá o acesso ao consolidado familiar.
            </p>
            <div className="invite-form-actions" style={{ marginTop: '1rem' }}>
              <button className="btn-cancel" onClick={() => setRemoveMemberTarget(null)}>
                Cancelar
              </button>
              <button className="btn-delete-confirm" onClick={handleRemoveMember} disabled={saving}>
                {saving ? 'Removendo…' : 'Remover'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add member modal */}
      {addMemberOpen && (
        <div className="modal-overlay" onClick={() => setAddMemberOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Adicionar membro</h3>
            <form onSubmit={handleAddMember} className="invite-form">
              <div className="form-group">
                <label>Nome do membro</label>
                <input
                  type="text"
                  value={addMemberName}
                  onChange={(e) => setAddMemberName(e.target.value)}
                  placeholder="Ex: Ana Silva"
                  required
                  autoFocus
                  maxLength={60}
                />
              </div>
              <div className="form-group">
                <label>E-mail (opcional)</label>
                <input
                  type="email"
                  value={addMemberEmail}
                  onChange={(e) => setAddMemberEmail(e.target.value)}
                  placeholder="email@exemplo.com"
                />
              </div>
              <div className="form-group">
                <label>Papel</label>
                <select value={addMemberRole} onChange={(e) => setAddMemberRole(e.target.value)}>
                  {MANAGEABLE_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Observação (opcional)</label>
                <textarea
                  rows={2}
                  value={addMemberNote}
                  onChange={(e) => setAddMemberNote(e.target.value)}
                  placeholder="Ex: responsável pelo mercado"
                  maxLength={160}
                />
              </div>
              <div className="invite-form-actions">
                <button type="button" className="btn-cancel" onClick={() => setAddMemberOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-send" disabled={saving}>
                  {saving ? 'Adicionando…' : 'Adicionar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {inviteOpen && (
        <div className="modal-overlay" onClick={() => setInviteOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Convidar membro</h3>

            {/* Tabs */}
            <div className="invite-tabs">
              <button
                className={`invite-tab ${inviteTab === 'whatsapp' ? 'active' : ''}`}
                onClick={() => setInviteTab('whatsapp')}
              >
                📲 WhatsApp
              </button>
              <button
                className={`invite-tab ${inviteTab === 'email' ? 'active' : ''}`}
                onClick={() => setInviteTab('email')}
              >
                📧 E-mail
              </button>
            </div>

            {/* Role selector (shared) */}
            <div className="form-group" style={{ marginTop: '0.75rem' }}>
              <label>Papel</label>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                {MANAGEABLE_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            {/* WhatsApp tab */}
            {inviteTab === 'whatsapp' && (
              <form onSubmit={handleInviteWhatsApp} className="invite-form" style={{ marginTop: '0.25rem' }}>
                <div className="form-group">
                  <label>Número do WhatsApp</label>
                  <input
                    type="tel"
                    value={invitePhone}
                    onChange={(e) => setInvitePhone(e.target.value)}
                    placeholder="+55 11 99999-9999"
                    required
                    autoFocus
                  />
                  <span className="form-hint">Inclua o código do país. Ex: 5511999999999</span>
                </div>
                <div className="invite-form-actions">
                  <button type="button" className="btn-cancel" onClick={() => setInviteOpen(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-whatsapp">
                    📲 Abrir WhatsApp
                  </button>
                </div>
              </form>
            )}

            {/* Email tab */}
            {inviteTab === 'email' && (
              <form onSubmit={handleInviteEmail} className="invite-form" style={{ marginTop: '0.25rem' }}>
                <div className="form-group">
                  <label>E-mail</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="email@exemplo.com"
                    required
                  />
                </div>
                <div className="invite-form-actions">
                  <button type="button" className="btn-cancel" onClick={() => setInviteOpen(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-send" disabled={saving}>
                    {saving ? 'Enviando…' : 'Registrar convite'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {projectOpen && (
        <div className="modal-overlay" onClick={handleProjectModalClose}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">{editingProjectId ? 'Editar projeto familiar' : 'Novo projeto familiar'}</h3>
            <form onSubmit={handleCreateProject} className="invite-form">
              <div className="form-group">
                <label>Nome do projeto</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Ex: Viagem de ferias"
                  required
                  autoFocus
                  maxLength={80}
                />
              </div>
              <div className="form-group">
                <label>Membro responsavel</label>
                <select
                  value={projectOwnerId}
                  onChange={(e) => {
                    const nextId = e.target.value
                    const selectedMember = familyMembers.find((member) => (member.id ?? member.uid) === nextId)
                    setProjectOwnerId(nextId)
                    setProjectOwnerName(selectedMember?.displayName || '')
                  }}
                >
                  <option value="">Selecione um membro</option>
                  {familyMembers.map((member) => (
                    <option key={member.id ?? member.uid} value={member.id ?? member.uid}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Meta total</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={projectTarget}
                  onChange={(e) => setProjectTarget(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="form-group">
                <label>Saldo inicial manual</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={projectCurrent}
                  onChange={(e) => setProjectCurrent(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="form-group">
                <label>Conta real para acompanhar</label>
                <select
                  value={projectAccountId}
                  onChange={(e) => {
                    const nextId = e.target.value
                    const selectedAccount = accounts.find((account) => account.id === nextId)
                    setProjectAccountId(nextId)
                    setProjectAccount(selectedAccount ? `${selectedAccount.name}${selectedAccount.bank ? ` - ${selectedAccount.bank}` : ''}` : '')
                  }}
                >
                  <option value="">Selecione uma conta</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}{account.bank ? ` - ${account.bank}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Texto ou categoria para identificar</label>
                <input
                  type="text"
                  value={projectMatchText}
                  onChange={(e) => setProjectMatchText(e.target.value)}
                  placeholder="Ex: viagem, caixinha viagem, reserva"
                  maxLength={80}
                />
              </div>
              <div className="form-group">
                <label>Nome livre da conta</label>
                <input
                  type="text"
                  value={projectAccount}
                  onChange={(e) => setProjectAccount(e.target.value)}
                  placeholder="Ex: Nubank - caixinha viagem"
                  maxLength={80}
                />
              </div>
              <div className="form-group">
                <label>Observacoes</label>
                <textarea
                  rows={3}
                  value={projectNotes}
                  onChange={(e) => setProjectNotes(e.target.value)}
                  placeholder="Como esse projeto sera usado pela familia"
                  maxLength={240}
                />
              </div>
              <div className="invite-form-actions">
                <button type="button" className="btn-cancel" onClick={handleProjectModalClose}>
                  Cancelar
                </button>
                <button type="submit" className="btn-send" disabled={saving}>
                  {saving ? 'Salvando...' : (editingProjectId ? 'Salvar projeto' : 'Criar projeto')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`familia-toast ${toast.type === 'err' ? 'toast-err' : ''}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

