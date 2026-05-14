import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import {
  acceptFinancialSessionInvite,
  cancelFinancialSessionInvite,
  createFinancialSessionInvite,
  subscribeFinancialSessionInvites,
  subscribePendingFinancialSessionInvites,
} from '../../services/financialSessionInvitesService'
import {
  archiveFinancialSession,
  createFinancialSession,
  subscribeFinancialSessions,
  updateFinancialSessionMetadata,
} from '../../services/financialSessionsService'
import { normalizeWorkspaceRole } from '../../services/workspaceService'
import './Reunioes.css'

const STATUS_LABELS = {
  draft: 'Rascunho',
  active: 'Ativa',
  paused: 'Pausada',
  ended: 'Encerrada',
  archived: 'Arquivada',
}

const INVITE_ROLE_LABELS = {
  planner: 'Planejador',
  client: 'Cliente',
  viewer: 'Observador',
}

const PLANNER_ROLES = ['gestor', 'co-gestor', 'planejador-master', 'planejador-plus']

const SESSION_FORM_DEFAULT = {
  name: '',
  description: '',
  plannerMemberIds: [],
  clientMemberIds: [],
  externalInvites: [],
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase()
}

function defaultSessionForm(currentUserId = '') {
  return {
    ...SESSION_FORM_DEFAULT,
    plannerMemberIds: currentUserId ? [currentUserId] : [],
  }
}

function buildSessionRoute(workspaceId, sessionId) {
  if (!workspaceId || !sessionId) return '/reunioes'
  return `/reunioes/sessao/${workspaceId}/${sessionId}`
}

function memberIdOf(member) {
  return member?.uid || member?.id || ''
}

function memberNameOf(member) {
  return member?.displayName || member?.name || member?.email || 'Membro'
}

function formatDateTime(value) {
  if (!value) return 'Ainda nao aberta'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Ainda nao aberta'
  return date.toLocaleString('pt-BR')
}

function peopleNamesForIds(memberIds = [], members = []) {
  const memberNameById = new Map(
    members.map((member) => [memberIdOf(member), memberNameOf(member)]),
  )

  return memberIds
    .map((memberId) => memberNameById.get(memberId))
    .filter(Boolean)
}

export default function Reunioes() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { activeWorkspace, activeWorkspaceId, members, myRole } = useWorkspace()
  const [sessions, setSessions] = useState([])
  const [sessionInvites, setSessionInvites] = useState([])
  const [incomingInvites, setIncomingInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSession, setEditingSession] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(defaultSessionForm(user?.uid || ''))
  const [draftInviteEmail, setDraftInviteEmail] = useState('')
  const [draftInviteRole, setDraftInviteRole] = useState('planner')

  const normalizedRole = normalizeWorkspaceRole(myRole)
  const canManageSessions = PLANNER_ROLES.includes(normalizedRole)
  const currentEmail = normalizeEmail(user?.email)

  const activeSessions = useMemo(
    () => sessions.filter((session) => session.status !== 'archived'),
    [sessions],
  )
  const archivedSessions = useMemo(
    () => sessions.filter((session) => session.status === 'archived'),
    [sessions],
  )
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId)
      || activeSessions[0]
      || archivedSessions[0]
      || null,
    [activeSessions, archivedSessions, selectedSessionId, sessions],
  )

  useEffect(() => {
    if (!activeWorkspaceId) {
      setSessions([])
      setLoading(false)
      return undefined
    }

    setLoading(true)
    setError('')

    return subscribeFinancialSessions(
      activeWorkspaceId,
      (nextSessions) => {
        setSessions(nextSessions)
        setLoading(false)
      },
      (err) => {
        setError(err?.message || 'Nao foi possivel carregar as sessoes financeiras.')
        setLoading(false)
      },
    )
  }, [activeWorkspaceId])

  useEffect(() => {
    if (!selectedSessionId && activeSessions[0]?.id) {
      setSelectedSessionId(activeSessions[0].id)
      return
    }

    if (selectedSessionId && !sessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(activeSessions[0]?.id || archivedSessions[0]?.id || '')
    }
  }, [activeSessions, archivedSessions, selectedSessionId, sessions])

  useEffect(() => {
    if (!feedback) return undefined
    const timeoutId = window.setTimeout(() => setFeedback(''), 2600)
    return () => window.clearTimeout(timeoutId)
  }, [feedback])

  useEffect(() => {
    if (!selectedSession?.workspaceId || !selectedSession?.id) {
      setSessionInvites([])
      return undefined
    }

    return subscribeFinancialSessionInvites(
      selectedSession.workspaceId,
      selectedSession.id,
      (nextInvites) => setSessionInvites(nextInvites),
      () => setSessionInvites([]),
    )
  }, [selectedSession?.id, selectedSession?.workspaceId])

  useEffect(() => {
    return subscribePendingFinancialSessionInvites(
      currentEmail,
      (nextInvites) => setIncomingInvites(nextInvites),
      () => setIncomingInvites([]),
    )
  }, [currentEmail])

  function resetModalState() {
    setEditingSession(null)
    setForm(defaultSessionForm(user?.uid || ''))
    setDraftInviteEmail('')
    setDraftInviteRole('planner')
  }

  function openCreateModal() {
    resetModalState()
    setModalOpen(true)
  }

  function openEditModal(session) {
    setEditingSession(session)
    setForm({
      name: session?.name || '',
      description: session?.description || '',
      plannerMemberIds: Array.isArray(session?.plannerMemberIds) ? session.plannerMemberIds : [],
      clientMemberIds: Array.isArray(session?.clientMemberIds) ? session.clientMemberIds : [],
      externalInvites: [],
    })
    setDraftInviteEmail('')
    setDraftInviteRole('planner')
    setModalOpen(true)
  }

  function togglePlanner(memberId) {
    setForm((current) => {
      const included = current.plannerMemberIds.includes(memberId)
      const plannerMemberIds = included
        ? current.plannerMemberIds.filter((entry) => entry !== memberId)
        : [...current.plannerMemberIds, memberId]

      return {
        ...current,
        plannerMemberIds,
        clientMemberIds: current.clientMemberIds.filter((entry) => entry !== memberId),
      }
    })
  }

  function toggleClient(memberId) {
    setForm((current) => {
      const included = current.clientMemberIds.includes(memberId)
      const clientMemberIds = included
        ? current.clientMemberIds.filter((entry) => entry !== memberId)
        : [...current.clientMemberIds, memberId]

      return {
        ...current,
        clientMemberIds,
        plannerMemberIds: current.plannerMemberIds.filter((entry) => entry !== memberId),
      }
    })
  }

  function addExternalInviteDraft() {
    const inviteeEmail = normalizeEmail(draftInviteEmail)
    if (!inviteeEmail) {
      window.alert('Informe o e-mail da pessoa convidada.')
      return
    }

    if (inviteeEmail === currentEmail) {
      window.alert('Voce ja participa da sessao com sua propria conta.')
      return
    }

    setForm((current) => {
      if (current.externalInvites.some((invite) => invite.email === inviteeEmail)) {
        return current
      }

      return {
        ...current,
        externalInvites: [...current.externalInvites, { email: inviteeEmail, role: draftInviteRole }],
      }
    })
    setDraftInviteEmail('')
    setDraftInviteRole('planner')
  }

  function removeExternalInviteDraft(email) {
    setForm((current) => ({
      ...current,
      externalInvites: current.externalInvites.filter((invite) => invite.email !== email),
    }))
  }

  async function handleSave() {
    if (!activeWorkspaceId) {
      window.alert('Workspace nao selecionado.')
      return
    }

    const trimmedName = String(form.name || '').trim()
    if (!trimmedName) {
      window.alert('Informe o nome da sessao.')
      return
    }

    if (form.plannerMemberIds.length === 0) {
      window.alert('Selecione pelo menos um planejador.')
      return
    }

    if (form.clientMemberIds.length === 0) {
      window.alert('Selecione pelo menos um cliente para esta sessao.')
      return
    }

    const plannerMemberNames = peopleNamesForIds(form.plannerMemberIds, members)
    const clientMemberNames = peopleNamesForIds(form.clientMemberIds, members)
    const pendingInviteEmails = form.externalInvites.map((invite) => invite.email)

    setSaving(true)
    try {
      const payload = {
        name: trimmedName,
        description: String(form.description || '').trim(),
        plannerMemberIds: form.plannerMemberIds,
        plannerMemberNames,
        clientMemberIds: form.clientMemberIds,
        clientMemberNames,
        participantMemberIds: [...form.plannerMemberIds, ...form.clientMemberIds],
        pendingInviteEmails,
        createdByName: user?.displayName || user?.email || 'Planejador',
      }

      let targetSessionId = editingSession?.id || ''
      if (editingSession?.id) {
        await updateFinancialSessionMetadata(activeWorkspaceId, editingSession.id, {
          ...payload,
          status: editingSession.status,
        })
        targetSessionId = editingSession.id
        setSelectedSessionId(editingSession.id)
        setFeedback('Sessao atualizada')
      } else {
        const createdId = await createFinancialSession(activeWorkspaceId, payload, user?.uid || '')
        targetSessionId = createdId
        setSelectedSessionId(createdId)
        setFeedback('Sessao criada')
      }

      if (targetSessionId && form.externalInvites.length > 0) {
        await Promise.all(
          form.externalInvites.map((invite) => createFinancialSessionInvite(activeWorkspaceId, targetSessionId, {
            inviteeEmail: invite.email,
            inviteRole: invite.role,
            inviterUid: user?.uid || '',
            inviterName: user?.displayName || user?.email || 'Planejador',
            sessionName: trimmedName,
            workspaceName: activeWorkspace?.name || '',
          })),
        )
      }

      setModalOpen(false)
      resetModalState()
    } catch (err) {
      window.alert(`Erro ao salvar sessao: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive(session) {
    const confirmed = window.confirm(`Arquivar a sessao "${session.name}"?`)
    if (!confirmed) return

    try {
      await archiveFinancialSession(activeWorkspaceId, session.id)
      setFeedback('Sessao arquivada')
    } catch (err) {
      window.alert(`Erro ao arquivar sessao: ${err.message}`)
    }
  }

  async function handleAcceptInvite(invite) {
    try {
      await acceptFinancialSessionInvite(invite, {
        uid: user?.uid,
        email: user?.email,
        displayName: user?.displayName,
      })
      setFeedback('Convite aceito')
      navigate(buildSessionRoute(invite.workspaceId, invite.sessionId))
    } catch (err) {
      window.alert(`Erro ao aceitar convite: ${err.message}`)
    }
  }

  async function handleCancelSessionInvite(invite) {
    try {
      await cancelFinancialSessionInvite(invite.workspaceId, invite.sessionId, invite.id)
      setFeedback('Convite cancelado')
    } catch (err) {
      window.alert(`Erro ao cancelar convite: ${err.message}`)
    }
  }

  const plannerNames = peopleNamesForIds(selectedSession?.plannerMemberIds || [], members)
  const clientNames = peopleNamesForIds(selectedSession?.clientMemberIds || [], members)

  return (
    <div className="reunioes-page">
      <div className="reunioes-hero">
        <div>
          <p className="reunioes-eyebrow">Sessao financeira persistente</p>
          <h2>Colaboracao dentro do app, com convite interno</h2>
          <p>
            A sala continua funcionando para a familia, mas agora tambem pode convidar outro usuario do app por e-mail,
            sem colocar a pessoa dentro de todo o workspace financeiro.
          </p>
        </div>
        <div className="reunioes-hero-actions">
          {canManageSessions && <Button onClick={openCreateModal}>Nova sessao</Button>}
          {selectedSession && (
            <Button variant="secondary" onClick={() => navigate(buildSessionRoute(selectedSession.workspaceId, selectedSession.id))}>
              Entrar na sessao
            </Button>
          )}
        </div>
      </div>

      {feedback && <div className="reunioes-feedback">{feedback}</div>}
      {error && <div className="reunioes-alert">{error}</div>}

      {incomingInvites.length > 0 && (
        <Card>
          <CardHeader
            title="Convites para voce"
            subtitle="Estas sessoes apareceram para sua conta. Depois de aceitar uma vez, a sala fica fixa para os proximos encontros."
          />
          <div className="reunioes-incoming-list">
            {incomingInvites.map((invite) => (
              <div key={`${invite.workspaceId}-${invite.sessionId}-${invite.id}`} className="reunioes-incoming-card">
                <div>
                  <strong>{invite.sessionName}</strong>
                  <span>{invite.workspaceName || 'Workspace'} · {INVITE_ROLE_LABELS[invite.inviteRole] || invite.inviteRole}</span>
                  <span>Convite enviado por {invite.inviterName || 'Participante'}</span>
                </div>
                <div className="reunioes-card-actions">
                  <Button size="sm" onClick={() => handleAcceptInvite(invite)}>
                    Aceitar e entrar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="reunioes-grid">
        <Card className="reunioes-sidebar">
          <CardHeader
            title="Sessoes"
            subtitle={`${activeSessions.length} ativa(s) em ${activeWorkspace?.name || 'Workspace atual'}`}
            action={canManageSessions ? <Button size="sm" onClick={openCreateModal}>Criar</Button> : null}
          />

          <div className="reunioes-room-list">
            {loading && (
              <div className="reunioes-empty">
                <strong>Carregando sessoes...</strong>
                <p>Sincronizando o hub financeiro do workspace.</p>
              </div>
            )}

            {!loading && activeSessions.length === 0 && (
              <div className="reunioes-empty">
                <strong>Nenhuma sessao criada ainda.</strong>
                <p>Crie uma sala persistente para acompanhar o painel financeiro junto com cliente, familia ou planejador convidado.</p>
              </div>
            )}

            {activeSessions.map((session) => {
              const isSelected = selectedSession?.id === session.id
              return (
                <button
                  key={session.id}
                  type="button"
                  className={`reunioes-room-card${isSelected ? ' active' : ''}`}
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  <div className="reunioes-room-card-top">
                    <strong>{session.name}</strong>
                    <span className={`reunioes-room-status status-${session.status}`}>
                      {STATUS_LABELS[session.status] || session.status}
                    </span>
                  </div>
                  <span>{session.description || 'Sessao pronta para acompanhamento financeiro colaborativo.'}</span>
                  <span className="reunioes-room-meta">
                    {session.clientMemberNames?.join(' · ') || 'Sem cliente definido'}
                  </span>
                  <span className="reunioes-room-meta">
                    Ultima abertura: {formatDateTime(session.lastOpenedAt)}
                  </span>
                </button>
              )
            })}

            {archivedSessions.length > 0 && (
              <div className="reunioes-archived-block">
                <p className="reunioes-archived-title">Arquivadas</p>
                {archivedSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className={`reunioes-room-card archived${selectedSession?.id === session.id ? ' active' : ''}`}
                    onClick={() => setSelectedSessionId(session.id)}
                  >
                    <div className="reunioes-room-card-top">
                      <strong>{session.name}</strong>
                      <span className="reunioes-room-status status-archived">Arquivada</span>
                    </div>
                    <span>{session.description || 'Sessao arquivada.'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>

        <div className="reunioes-main">
          <Card>
            <CardHeader
              title={selectedSession?.name || 'Selecione uma sessao'}
              subtitle={selectedSession?.description || 'Abra uma sessao financeira para conversar, compartilhar tela e acompanhar o mesmo painel no app.'}
              action={selectedSession && canManageSessions ? (
                <div className="reunioes-card-actions">
                  <Button size="sm" variant="secondary" onClick={() => navigate(buildSessionRoute(selectedSession.workspaceId, selectedSession.id))}>
                    Abrir
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => openEditModal(selectedSession)}>
                    Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleArchive(selectedSession)}>
                    Arquivar
                  </Button>
                </div>
              ) : null}
            />

            {selectedSession ? (
              <div className="reunioes-room-detail">
                <div className="reunioes-detail-grid">
                  <div>
                    <span className="reunioes-detail-label">Planejadores</span>
                    <div className="reunioes-chip-row">
                      {plannerNames.length > 0
                        ? plannerNames.map((name) => <span key={name} className="reunioes-chip">{name}</span>)
                        : <span className="reunioes-chip empty">Sem planejador</span>}
                    </div>
                  </div>
                  <div>
                    <span className="reunioes-detail-label">Clientes</span>
                    <div className="reunioes-chip-row">
                      {clientNames.length > 0
                        ? clientNames.map((name) => <span key={name} className="reunioes-chip client">{name}</span>)
                        : <span className="reunioes-chip empty">Sem cliente</span>}
                    </div>
                  </div>
                  <div>
                    <span className="reunioes-detail-label">Estado atual</span>
                    <strong>{STATUS_LABELS[selectedSession.status] || selectedSession.status}</strong>
                  </div>
                  <div>
                    <span className="reunioes-detail-label">Ultima abertura</span>
                    <strong>{formatDateTime(selectedSession.lastOpenedAt)}</strong>
                  </div>
                </div>

                <div className="reunioes-stage-preview">
                  <div>
                    <span className="reunioes-detail-label">Sala persistente</span>
                    <ul>
                      <li>Fica salva no app ate alguem arquivar</li>
                      <li>Quem entrar primeiro pode esperar o outro na mesma sala</li>
                      <li>Funciona tanto para familia quanto para convidado externo do app</li>
                    </ul>
                  </div>
                  <div>
                    <span className="reunioes-detail-label">Convite externo</span>
                    <ul>
                      <li>Envie para o e-mail da conta da pessoa no app</li>
                      <li>Ela ve o convite ao entrar em Reunioes</li>
                      <li>Depois de aceitar uma vez, nao precisa novo convite para cada encontro</li>
                    </ul>
                  </div>
                </div>

                <div className="reunioes-stage-preview">
                  <div>
                    <span className="reunioes-detail-label">Convites externos desta sala</span>
                    <div className="reunioes-invite-list">
                      {sessionInvites.length === 0 && <p>Nenhum convite externo criado ainda.</p>}
                      {sessionInvites.map((invite) => (
                        <div key={invite.id} className="reunioes-invite-item">
                          <div>
                            <strong>{invite.inviteeEmail}</strong>
                            <span>{INVITE_ROLE_LABELS[invite.inviteRole] || invite.inviteRole}</span>
                            <span>Status: {invite.status}</span>
                          </div>
                          {canManageSessions && invite.status === 'pending' && (
                            <Button size="sm" variant="ghost" onClick={() => handleCancelSessionInvite(invite)}>
                              Cancelar
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="reunioes-detail-label">Rota da sala</span>
                    <p>{buildSessionRoute(selectedSession.workspaceId, selectedSession.id)}</p>
                  </div>
                </div>

                <div className="reunioes-join-actions">
                  <Button onClick={() => navigate(buildSessionRoute(selectedSession.workspaceId, selectedSession.id))}>
                    Entrar na sessao
                  </Button>
                </div>
              </div>
            ) : (
              <div className="reunioes-empty">
                <strong>Escolha uma sessao para continuar.</strong>
                <p>Quando voce abrir uma sessao, ela sincroniza presenca, chat, midia e o espelho financeiro compartilhado.</p>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editingSession ? 'Editar sessao financeira' : 'Nova sessao financeira'}
        footer={(
          <Button onClick={handleSave} loading={saving}>
            {editingSession ? 'Salvar sessao' : 'Criar sessao'}
          </Button>
        )}
      >
        <div className="reunioes-form">
          <label htmlFor="session-name">Nome da sessao</label>
          <input
            id="session-name"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Ex.: Planejamento com cliente"
          />

          <label htmlFor="session-description">Descricao</label>
          <textarea
            id="session-description"
            rows={3}
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            placeholder="Opcional: foco deste atendimento"
          />

          <div className="reunioes-picker-grid">
            <div className="reunioes-member-picker">
              <p className="reunioes-detail-label">Planejadores do workspace</p>
              {members.length === 0 && <p>Nenhum membro encontrado neste workspace.</p>}
              {members.map((member) => {
                const id = memberIdOf(member)
                const checked = form.plannerMemberIds.includes(id)
                return (
                  <label key={`planner-${id}`} className="reunioes-member-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePlanner(id)}
                    />
                    <span>{memberNameOf(member)}{id === user?.uid ? ' (voce)' : ''}</span>
                  </label>
                )
              })}
            </div>

            <div className="reunioes-member-picker">
              <p className="reunioes-detail-label">Clientes do workspace</p>
              {members.length === 0 && <p>Nenhum membro encontrado neste workspace.</p>}
              {members.map((member) => {
                const id = memberIdOf(member)
                const checked = form.clientMemberIds.includes(id)
                return (
                  <label key={`client-${id}`} className="reunioes-member-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleClient(id)}
                    />
                    <span>{memberNameOf(member)}{id === user?.uid ? ' (voce)' : ''}</span>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="reunioes-member-picker">
            <p className="reunioes-detail-label">Convidar alguem de fora do workspace</p>
            <div className="reunioes-external-invite-row">
              <input
                type="email"
                value={draftInviteEmail}
                onChange={(event) => setDraftInviteEmail(event.target.value)}
                placeholder="email@exemplo.com"
              />
              <select value={draftInviteRole} onChange={(event) => setDraftInviteRole(event.target.value)}>
                <option value="planner">Planejador</option>
                <option value="client">Cliente</option>
                <option value="viewer">Observador</option>
              </select>
              <Button type="button" variant="secondary" onClick={addExternalInviteDraft}>
                Adicionar
              </Button>
            </div>

            <div className="reunioes-invite-list">
              {form.externalInvites.length === 0 && (
                <p>Se a pessoa ja tem conta no app, ela vera esta sala em Reunioes depois do convite.</p>
              )}
              {form.externalInvites.map((invite) => (
                <div key={`${invite.email}-${invite.role}`} className="reunioes-invite-item">
                  <div>
                    <strong>{invite.email}</strong>
                    <span>{INVITE_ROLE_LABELS[invite.role] || invite.role}</span>
                  </div>
                  <Button size="sm" type="button" variant="ghost" onClick={() => removeExternalInviteDraft(invite.email)}>
                    Remover
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <p className="reunioes-form-help">
            A sessao pode nascer com membros da familia e tambem com convidados externos do app. Depois que eles aceitarem, a sala continua fixa.
          </p>
        </div>
      </Modal>
    </div>
  )
}
