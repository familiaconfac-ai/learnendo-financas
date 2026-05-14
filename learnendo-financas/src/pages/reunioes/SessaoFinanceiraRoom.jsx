import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useFinancialSession } from '../../hooks/useFinancialSession'
import { useFinancialSessionActions } from '../../hooks/useFinancialSessionActions'
import { useFinancialSessionMedia } from '../../hooks/useFinancialSessionMedia'
import { useFinancialSessionWorkspaceData } from '../../hooks/useFinancialSessionWorkspaceData'
import { formatChatFileSize } from '../../services/financialSessionChatService'
import { FINANCIAL_SESSION_PANELS } from '../../services/financialSessionStage'
import './SessaoFinanceiraRoom.css'

const PANEL_LABELS = {
  overview: 'Visao geral',
  transactions: 'Receitas e despesas',
  budget: 'Orcamento',
  goals: 'Metas',
  notes: 'Anotacoes',
  planning: 'Planejamento',
}

const ACCESS_LABELS = {
  view_only: 'Somente visualizacao',
  guided_edit: 'Edicao guiada',
  full_edit: 'Edicao liberada',
}

const STATUS_LABELS = {
  draft: 'Rascunho',
  active: 'Ativa',
  paused: 'Pausada',
  ended: 'Encerrada',
  archived: 'Arquivada',
}

const ACTION_TYPE_LABELS = {
  expense: 'Despesa',
  income: 'Receita',
}

const ACTION_STATUS_LABELS = {
  pending: 'Pendente',
  applied: 'Aplicado',
  cancelled: 'Cancelado',
}

const CAMERA_MODE_LABELS = {
  off: 'Camera do cliente desligada',
  follow_mic: 'Camera acompanha o microfone',
  free: 'Cliente pode ligar a camera',
  required: 'Camera do cliente obrigatoria',
}

function formatDateTime(value) {
  if (!value) return 'Agora mesmo'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Agora mesmo'
  return date.toLocaleString('pt-BR')
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function monthLabel(value) {
  if (!value) return 'Mes atual'
  const [year, month] = String(value).split('-')
  if (!year || !month) return value
  return `${month}/${year}`
}

function progressPercent(project) {
  return Math.max(0, Math.min(100, Number(project?.progress || 0)))
}

function todayDateKey() {
  return new Date().toISOString().slice(0, 10)
}

export default function SessaoFinanceiraRoom() {
  const navigate = useNavigate()
  const { workspaceId: routeWorkspaceId = '', sessionId = '' } = useParams()
  const { user } = useAuth()
  const { activeWorkspace, activeWorkspaceId, myRole, members, permissions } = useWorkspace()
  const {
    session,
    workspaceId,
    state,
    presence,
    messages,
    sharedNotes,
    sharedPlanning,
    loading,
    error,
    sessionRole,
    currentUserId,
    currentUserName,
    canManageSession,
    canEditSharedDocs,
    participantAccess,
    updateState,
    saveSharedNotes,
    saveSharedPlanning,
    focusEntity,
    claimEditingLock,
    releaseEditingLock,
    sendMessage,
    deleteMessage,
  } = useFinancialSession(sessionId, routeWorkspaceId)
  const canReadWorkspaceDirectly = activeWorkspaceId === workspaceId
    && members.some((member) => (member.uid || member.id) === currentUserId)
  const {
    actions,
    loading: actionsLoading,
    error: actionsError,
    canCreateActionRequests,
    canApplyActionRequests,
    createActionRequest,
    cancelActionRequest,
    applyActionRequest,
  } = useFinancialSessionActions({
    workspaceId,
    sessionId,
    state,
    sessionRole,
    currentUserId,
    currentUserName,
  })
  const {
    incomeTransactions,
    expenseTransactions,
    currentBudgets,
    projects,
    summary,
    loading: workspaceDataLoading,
    error: workspaceDataError,
  } = useFinancialSessionWorkspaceData({
    workspaceId,
    sessionId,
    canReadWorkspaceDirectly,
    actorUid: currentUserId,
    actorName: currentUserName,
  })

  const activePanel = state.activePanel || 'overview'
  const currentStatus = state.sessionStatus && state.sessionStatus !== 'draft'
    ? state.sessionStatus
    : (session?.status || 'draft')

  const [notesDraft, setNotesDraft] = useState('')
  const [planningDraft, setPlanningDraft] = useState('')
  const [savingSharedDoc, setSavingSharedDoc] = useState('')
  const [chatText, setChatText] = useState('')
  const [chatFile, setChatFile] = useState(null)
  const [sendingChat, setSendingChat] = useState(false)
  const [deletingMessageId, setDeletingMessageId] = useState('')
  const [actionForm, setActionForm] = useState({
    type: 'expense',
    description: '',
    amount: '',
    date: todayDateKey(),
    notes: '',
  })
  const [creatingAction, setCreatingAction] = useState(false)
  const [actingActionId, setActingActionId] = useState('')
  const fileInputRef = useRef(null)

  const participantsOnline = useMemo(
    () => presence.filter((entry) => entry.isOnline),
    [presence],
  )

  const currentLockOwner = state.editingOwnerUid
    ? (state.editingOwnerName || 'Participante')
    : ''
  const hasFocusedEntity = !!state.focusedEntityId
  const canClaimFocusedLock = canManageSession && hasFocusedEntity
  const canReleaseFocusedLock = canManageSession && !!state.editingOwnerUid
  const canApplyIntoWorkspace = canApplyActionRequests && canReadWorkspaceDirectly && permissions.canLaunch
  const {
    audioHostRef,
    setVideoHostRef,
    setScreenShareHostRef,
    transportLabel,
    transportError,
    joining,
    connected,
    audioPlaybackReady,
    localMicEnabled,
    localCameraEnabled,
    localScreenShareEnabled,
    participantMedia,
    visibleCameraParticipants,
    screenSharePresenter,
    allowClientMicrophone,
    clientCameraMode,
    joinMedia,
    leaveMedia,
    resumeAudioPlayback,
    toggleMicrophone,
    toggleCamera,
    toggleScreenShare,
  } = useFinancialSessionMedia({
    workspaceId,
    sessionId,
    sessionRole,
    currentUserId,
    currentUserName,
    activePanel,
    state,
    updateState,
  })

  useEffect(() => {
    setNotesDraft(sharedNotes.text || '')
  }, [sharedNotes.text])

  useEffect(() => {
    setPlanningDraft(sharedPlanning.text || '')
  }, [sharedPlanning.text])

  async function handlePlannerUpdate(patch) {
    try {
      await updateState(patch)
    } catch (err) {
      window.alert(err.message)
    }
  }

  async function handleSaveSharedDoc(kind) {
    try {
      setSavingSharedDoc(kind)
      if (kind === 'notes') {
        await saveSharedNotes(notesDraft)
      } else {
        await saveSharedPlanning(planningDraft)
      }
    } catch (err) {
      window.alert(err.message)
    } finally {
      setSavingSharedDoc('')
    }
  }

  async function handleFocus(panel, entityType, entityId, entityLabel) {
    try {
      await focusEntity({ panel, entityType, entityId, entityLabel })
    } catch (err) {
      window.alert(err.message)
    }
  }

  async function handleClaimLock(panel, entityType, entityId, entityLabel) {
    try {
      await claimEditingLock({ panel, entityType, entityId, entityLabel })
    } catch (err) {
      window.alert(err.message)
    }
  }

  async function handleReleaseLock() {
    try {
      await releaseEditingLock()
    } catch (err) {
      window.alert(err.message)
    }
  }

  async function handleSendChatMessage() {
    try {
      setSendingChat(true)
      await sendMessage({
        text: chatText,
        attachmentFile: chatFile,
      })
      setChatText('')
      setChatFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (err) {
      window.alert(err.message)
    } finally {
      setSendingChat(false)
    }
  }

  async function handleDeleteChatMessage(message) {
    try {
      setDeletingMessageId(message.id)
      await deleteMessage(message)
    } catch (err) {
      window.alert(err.message)
    } finally {
      setDeletingMessageId('')
    }
  }

  function updateActionForm(field, value) {
    setActionForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  async function handleCreateActionRequest() {
    try {
      setCreatingAction(true)
      await createActionRequest(actionForm)
      setActionForm({
        type: actionForm.type,
        description: '',
        amount: '',
        date: todayDateKey(),
        notes: '',
      })
    } catch (err) {
      window.alert(err.message)
    } finally {
      setCreatingAction(false)
    }
  }

  async function handleCancelActionRequest(action) {
    try {
      setActingActionId(action.id)
      await cancelActionRequest(action)
    } catch (err) {
      window.alert(err.message)
    } finally {
      setActingActionId('')
    }
  }

  async function handleApplyActionRequest(action) {
    try {
      setActingActionId(action.id)
      await applyActionRequest(action)
    } catch (err) {
      window.alert(err.message)
    } finally {
      setActingActionId('')
    }
  }

  if (loading) {
    return (
      <div className="sessao-room-page">
        <Card>
          <CardHeader title="Carregando sessao" subtitle="Montando estado compartilhado da sessao financeira." />
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="sessao-room-page">
        <Card>
          <CardHeader title="Nao foi possivel abrir a sessao" subtitle={error} />
          <Button onClick={() => navigate('/reunioes')}>Voltar</Button>
        </Card>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="sessao-room-page">
        <Card>
          <CardHeader title="Sessao nao encontrada" subtitle="Ela pode ter sido arquivada ou removida do workspace atual." />
          <Button onClick={() => navigate('/reunioes')}>Voltar</Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="sessao-room-page">
      <div className="sessao-room-hero">
        <div>
          <p className="sessao-room-eyebrow">Sessao financeira colaborativa</p>
          <h2>{session.name}</h2>
          <p>{session.description || 'Planejador e cliente dentro do mesmo ambiente, acompanhando a mesma sessao em tempo real.'}</p>
          <div className="sessao-room-chip-row">
            <span className="sessao-room-chip">{STATUS_LABELS[currentStatus] || currentStatus}</span>
            <span className="sessao-room-chip">{sessionRole === 'planner' ? 'Planejador' : sessionRole === 'client' ? 'Cliente' : 'Observador'}</span>
            <span className="sessao-room-chip">{participantAccess}</span>
            <span className="sessao-room-chip">{activeWorkspaceId === workspaceId ? (activeWorkspace?.name || 'Workspace atual') : 'Workspace compartilhado'}</span>
          </div>
        </div>
        <div className="sessao-room-hero-actions">
          <Button variant="secondary" onClick={() => navigate('/reunioes')}>Voltar para sessoes</Button>
          {canManageSession && (
            <Button onClick={() => handlePlannerUpdate({
              sessionStatus: currentStatus === 'active' ? 'paused' : 'active',
            })}
            >
              {currentStatus === 'active' ? 'Pausar sessao' : 'Ativar sessao'}
            </Button>
          )}
        </div>
      </div>

      <div className="sessao-room-grid">
        <div className="sessao-room-main">
          <Card>
            <CardHeader
              title="Painel compartilhado"
              subtitle="O painel escolhido pelo planejador fica sincronizado para todo mundo nesta fase inicial."
            />
            <div className="sessao-room-panel-grid">
              {FINANCIAL_SESSION_PANELS.map((panel) => {
                const isActive = activePanel === panel
                return (
                  <button
                    key={panel}
                    type="button"
                    className={`sessao-panel-card${isActive ? ' active' : ''}`}
                    onClick={() => handlePlannerUpdate({ activePanel: panel })}
                    disabled={!canManageSession}
                  >
                    <strong>{PANEL_LABELS[panel] || panel}</strong>
                    <span>{isActive ? 'Painel atual da sessao' : 'Disponivel para abrir na sessao'}</span>
                  </button>
                )
              })}
            </div>
          </Card>

          <Card>
            <CardHeader
              title={PANEL_LABELS[activePanel] || 'Painel ativo'}
              subtitle="Agora a sala acompanha o workspace em tempo real e usa foco compartilhado para evitar desencontro."
            />
            <div className="sessao-room-stage">
              <div className="sessao-room-stage-banner">
                <strong>{PANEL_LABELS[activePanel] || activePanel}</strong>
                <span>{canReadWorkspaceDirectly ? `Workspace role: ${myRole}` : 'Espelho financeiro da sessao'}</span>
              </div>

              {(workspaceDataError || workspaceDataLoading) && (
                <div className="sessao-room-live-banner">
                  <span>{workspaceDataLoading ? 'Sincronizando dados financeiros ao vivo...' : workspaceDataError}</span>
                </div>
              )}

              {hasFocusedEntity && (
                <div className="sessao-room-focus-card">
                  <div>
                    <span className="sessao-room-label">Item em foco</span>
                    <strong>{state.focusedEntityLabel || `${state.focusedEntityType} ${state.focusedEntityId}`}</strong>
                    <span>{PANEL_LABELS[state.focusedEntityPanel] || state.focusedEntityPanel}</span>
                  </div>
                  <div>
                    <span className="sessao-room-label">Trava de edicao</span>
                    <strong>{currentLockOwner || 'Livre'}</strong>
                    <span>{currentLockOwner ? 'Outras alteracoes devem esperar confirmacao.' : 'Sem bloqueio ativo neste momento.'}</span>
                  </div>
                </div>
              )}

              <div className="sessao-room-stage-body">
                <div ref={audioHostRef} className="sessao-room-hidden-media" aria-hidden="true" />

                {screenSharePresenter && (
                  <div className="sessao-room-screen-card">
                    <div className="sessao-room-screen-header">
                      <strong>Compartilhamento de tela</strong>
                      <span>{screenSharePresenter.name}{screenSharePresenter.isLocal ? ' (voce)' : ''}</span>
                    </div>
                    <div className="sessao-room-screen-frame">
                      <div ref={setScreenShareHostRef} className="sessao-room-camera-host" />
                    </div>
                  </div>
                )}

                {activePanel === 'overview' && (
                  <div className="sessao-room-data-stack">
                    <div className="sessao-room-summary-grid">
                      <div className="sessao-room-summary-card positive">
                        <span>Receitas confirmadas</span>
                        <strong>{formatCurrency(summary.receitas)}</strong>
                      </div>
                      <div className="sessao-room-summary-card negative">
                        <span>Despesas confirmadas</span>
                        <strong>{formatCurrency(summary.despesas)}</strong>
                      </div>
                      <div className="sessao-room-summary-card neutral">
                        <span>Investimentos</span>
                        <strong>{formatCurrency(summary.investimentos)}</strong>
                      </div>
                      <div className="sessao-room-summary-card emphasis">
                        <span>Saldo consolidado</span>
                        <strong>{formatCurrency(summary.saldo)}</strong>
                      </div>
                    </div>
                    <p>
                      Este painel mostra o consolidado atual do workspace enquanto o planejador conduz a sessao.
                      Quando receitas, despesas, orcamentos ou metas mudarem em outras partes do app, este resumo atualiza junto.
                    </p>
                  </div>
                )}

                {activePanel === 'transactions' && (
                  <div className="sessao-room-data-stack">
                    <div className="sessao-room-action-summary">
                      <div>
                        <span className="sessao-room-label">Pedidos da sessao</span>
                        <strong>{actions.filter((action) => action.status === 'pending').length} pendente(s)</strong>
                        <p>
                          Use este fluxo quando alguem de fora do workspace precisar registrar uma receita ou despesa
                          durante o atendimento sem ganhar acesso direto ao financeiro real.
                        </p>
                      </div>
                      {!canApplyIntoWorkspace && canManageSession && (
                        <div className="sessao-room-live-banner">
                          <span>
                            Este perfil consegue conduzir a sessao, mas precisa de um membro com acesso ao workspace para aplicar pedidos no financeiro.
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="sessao-room-two-column">
                      <div>
                        <h3>Receitas recentes</h3>
                        <div className="sessao-room-entity-list">
                          {incomeTransactions.length === 0 && <p>Nenhuma receita recente encontrada.</p>}
                          {incomeTransactions.map((tx) => (
                            <div key={tx.id} className="sessao-room-entity-card">
                              <div>
                                <strong>{tx.description || 'Receita'}</strong>
                                <span>{tx.date || 'Sem data'} · {formatCurrency(tx.amount)}</span>
                              </div>
                              <div className="sessao-room-entity-actions">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => handleFocus('transactions', 'transaction', tx.id, tx.description || 'Receita')}
                                  disabled={!canManageSession}
                                >
                                  Focar
                                </Button>
                                {canManageSession && (
                                  <Button size="sm" onClick={() => handleClaimLock('transactions', 'transaction', tx.id, tx.description || 'Receita')}>
                                    Travar
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h3>Despesas recentes</h3>
                        <div className="sessao-room-entity-list">
                          {expenseTransactions.length === 0 && <p>Nenhuma despesa recente encontrada.</p>}
                          {expenseTransactions.map((tx) => (
                            <div key={tx.id} className="sessao-room-entity-card">
                              <div>
                                <strong>{tx.description || 'Despesa'}</strong>
                                <span>{tx.date || 'Sem data'} · {formatCurrency(tx.amount)}</span>
                              </div>
                              <div className="sessao-room-entity-actions">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => handleFocus('transactions', 'transaction', tx.id, tx.description || 'Despesa')}
                                  disabled={!canManageSession}
                                >
                                  Focar
                                </Button>
                                {canManageSession && (
                                  <Button size="sm" onClick={() => handleClaimLock('transactions', 'transaction', tx.id, tx.description || 'Despesa')}>
                                    Travar
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <p>
                      As transacoes aqui sao espelhadas em tempo real do workspace. O foco compartilhado ajuda a dizer exatamente
                      qual lancamento esta sendo discutido antes de editar em outra tela do sistema.
                    </p>
                  </div>
                )}

                {activePanel === 'budget' && (
                  <div className="sessao-room-data-stack">
                    <div className="sessao-room-entity-list">
                      {currentBudgets.length === 0 && <p>Nenhum orcamento encontrado para o mes atual.</p>}
                      {currentBudgets.map((budget) => (
                        <div key={budget.id} className="sessao-room-entity-card">
                          <div>
                            <strong>{budget.categoryName || budget.itemName || 'Orcamento'}</strong>
                            <span>{monthLabel(budget.competencyMonth)} · {formatCurrency(budget.plannedAmount)}</span>
                          </div>
                          <div className="sessao-room-entity-actions">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleFocus('budget', 'budget', budget.id, budget.categoryName || budget.itemName || 'Orcamento')}
                              disabled={!canManageSession}
                            >
                              Focar
                            </Button>
                            {canManageSession && (
                              <Button size="sm" onClick={() => handleClaimLock('budget', 'budget', budget.id, budget.categoryName || budget.itemName || 'Orcamento')}>
                                Travar
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p>
                      O painel de orcamento acompanha o mes atual e ajuda o atendimento a marcar qual verba esta em analise no momento.
                    </p>
                  </div>
                )}

                {activePanel === 'goals' && (
                  <div className="sessao-room-data-stack">
                    <div className="sessao-room-entity-list">
                      {projects.length === 0 && <p>Nenhuma meta ou projeto ativo encontrado.</p>}
                      {projects.map((project) => (
                        <div key={project.id} className="sessao-room-entity-card project">
                          <div>
                            <strong>{project.name || 'Meta'}</strong>
                            <span>{formatCurrency(project.effectiveCurrentAmount || project.currentAmount)} de {formatCurrency(project.targetAmount)}</span>
                            <div className="sessao-room-progress-track">
                              <div className="sessao-room-progress-fill" style={{ width: `${progressPercent(project)}%` }} />
                            </div>
                          </div>
                          <div className="sessao-room-entity-actions">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleFocus('goals', 'project', project.id, project.name || 'Meta')}
                              disabled={!canManageSession}
                            >
                              Focar
                            </Button>
                            {canManageSession && (
                              <Button size="sm" onClick={() => handleClaimLock('goals', 'project', project.id, project.name || 'Meta')}>
                                Travar
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p>
                      As metas usam os projetos atuais do workspace e refletem o progresso em tempo real conforme o restante do app vai sendo atualizado.
                    </p>
                  </div>
                )}

                {activePanel === 'notes' && (
                  <div className="sessao-room-data-stack">
                    <textarea
                      className="sessao-room-textarea"
                      value={notesDraft}
                      onChange={(event) => setNotesDraft(event.target.value)}
                      disabled={!canEditSharedDocs}
                      rows={9}
                      placeholder="Escreva aqui as anotacoes do atendimento financeiro."
                    />
                    <div className="sessao-room-editor-footer">
                      <span>
                        Ultima atualizacao: {sharedNotes.updatedByName || 'Sem registro'} · {formatDateTime(sharedNotes.updatedAt)}
                      </span>
                      <Button
                        onClick={() => handleSaveSharedDoc('notes')}
                        disabled={!canEditSharedDocs}
                        loading={savingSharedDoc === 'notes'}
                      >
                        Salvar anotacoes
                      </Button>
                    </div>
                  </div>
                )}

                {activePanel === 'planning' && (
                  <div className="sessao-room-data-stack">
                    <textarea
                      className="sessao-room-textarea"
                      value={planningDraft}
                      onChange={(event) => setPlanningDraft(event.target.value)}
                      disabled={!canEditSharedDocs}
                      rows={9}
                      placeholder="Registre aqui o plano financeiro, proximos passos e combinados."
                    />
                    <div className="sessao-room-editor-footer">
                      <span>
                        Ultima atualizacao: {sharedPlanning.updatedByName || 'Sem registro'} · {formatDateTime(sharedPlanning.updatedAt)}
                      </span>
                      <Button
                        onClick={() => handleSaveSharedDoc('planning')}
                        disabled={!canEditSharedDocs}
                        loading={savingSharedDoc === 'planning'}
                      >
                        Salvar planejamento
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>

        <div className="sessao-room-sidebar">
          <Card>
            <CardHeader
              title="Lancamentos da sessao"
              subtitle="Pedidos controlados para registrar receitas e despesas durante o atendimento colaborativo."
            />
            <div className="sessao-room-actions-stack">
              {(actionsError || actionsLoading) && (
                <div className="sessao-room-live-banner">
                  <span>{actionsLoading ? 'Sincronizando pedidos da sessao...' : actionsError}</span>
                </div>
              )}

              {canCreateActionRequests ? (
                <div className="sessao-room-action-form">
                  <div className="sessao-room-form-grid compact">
                    <label className="sessao-room-field">
                      <span>Tipo</span>
                      <select
                        className="sessao-room-input"
                        value={actionForm.type}
                        onChange={(event) => updateActionForm('type', event.target.value)}
                      >
                        {Object.entries(ACTION_TYPE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>

                    <label className="sessao-room-field">
                      <span>Data</span>
                      <input
                        className="sessao-room-input"
                        type="date"
                        value={actionForm.date}
                        onChange={(event) => updateActionForm('date', event.target.value)}
                      />
                    </label>
                  </div>

                  <label className="sessao-room-field">
                    <span>Descricao</span>
                    <input
                      className="sessao-room-input"
                      type="text"
                      value={actionForm.description}
                      onChange={(event) => updateActionForm('description', event.target.value)}
                      placeholder="Ex.: Parcela do monitor, salario extra, consulta medica"
                    />
                  </label>

                  <div className="sessao-room-form-grid compact">
                    <label className="sessao-room-field">
                      <span>Valor</span>
                      <input
                        className="sessao-room-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={actionForm.amount}
                        onChange={(event) => updateActionForm('amount', event.target.value)}
                        placeholder="0,00"
                      />
                    </label>

                    <label className="sessao-room-field">
                      <span>Observacao</span>
                      <input
                        className="sessao-room-input"
                        type="text"
                        value={actionForm.notes}
                        onChange={(event) => updateActionForm('notes', event.target.value)}
                        placeholder="Pix, cartao, reembolso, comprovante"
                      />
                    </label>
                  </div>

                  <div className="sessao-room-editor-footer">
                    <span>O pedido entra na fila da sessao e so vira lancamento real quando alguem com permissao aplicar.</span>
                    <Button onClick={handleCreateActionRequest} loading={creatingAction}>
                      Pedir lancamento
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="sessao-room-info-text">
                  Seu modo atual nesta sessao esta em somente visualizacao. O planejador pode liberar edicao guiada para voce pedir lancamentos.
                </p>
              )}

              <div className="sessao-room-action-list">
                {actions.length === 0 && (
                  <p className="sessao-room-info-text">
                    Nenhum pedido financeiro foi registrado nesta sessao ainda.
                  </p>
                )}

                {actions.map((action) => {
                  const isOwner = action.createdBy === currentUserId
                  const canCancel = action.status === 'pending' && (isOwner || canManageSession)
                  const canApply = action.status === 'pending' && canApplyIntoWorkspace
                  const isBusy = actingActionId === action.id

                  return (
                    <div key={action.id} className="sessao-room-action-card">
                      <div className="sessao-room-action-card-top">
                        <div>
                          <span className={`sessao-room-status-pill ${action.status}`}>
                            {ACTION_STATUS_LABELS[action.status] || action.status}
                          </span>
                          <strong>{action.description || 'Lancamento da sessao'}</strong>
                          <span>
                            {ACTION_TYPE_LABELS[action.type] || action.type} · {action.date} · {formatCurrency(action.amount)}
                          </span>
                        </div>
                        <div className="sessao-room-action-meta">
                          <strong>{action.createdByName || 'Participante'}</strong>
                          <span>{formatDateTime(action.createdAt)}</span>
                        </div>
                      </div>

                      {action.notes ? <p>{action.notes}</p> : null}

                      {action.status === 'applied' && (
                        <p className="sessao-room-info-text">
                          Aplicado por {action.appliedByName || 'Planejador'} em {formatDateTime(action.appliedAt)}.
                        </p>
                      )}

                      {action.status === 'cancelled' && (
                        <p className="sessao-room-info-text">
                          Cancelado por {action.cancelledByName || 'Participante'} em {formatDateTime(action.cancelledAt)}.
                        </p>
                      )}

                      {(canApply || canCancel) && (
                        <div className="sessao-room-inline-buttons">
                          {canApply && (
                            <Button size="sm" onClick={() => handleApplyActionRequest(action)} loading={isBusy}>
                              Aplicar no financeiro
                            </Button>
                          )}
                          {canCancel && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleCancelActionRequest(action)}
                              disabled={isBusy}
                            >
                              {isBusy && !canApply ? 'Atualizando...' : 'Cancelar pedido'}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Audio e camera"
              subtitle="A conversa acontece dentro da propria sessao financeira, sem depender de reuniao externa."
            />
            <div className="sessao-room-media-stack">
              <div className="sessao-room-media-summary-grid">
                <div className="sessao-room-media-stat">
                  <span>Transporte</span>
                  <strong>{transportLabel}</strong>
                </div>
                <div className="sessao-room-media-stat">
                  <span>Seu microfone</span>
                  <strong>{localMicEnabled ? 'Ligado' : connected ? 'Mutado' : 'Fora da sala'}</strong>
                </div>
                <div className="sessao-room-media-stat">
                  <span>Sua camera</span>
                  <strong>{localCameraEnabled ? 'Ligada' : connected ? 'Desligada' : 'Fora da sala'}</strong>
                </div>
                <div className="sessao-room-media-stat">
                  <span>Cliente</span>
                  <strong>{allowClientMicrophone ? 'Mic liberado' : 'Mic travado'}</strong>
                </div>
              </div>

              {transportError ? (
                <p className="sessao-room-media-error">{transportError}</p>
              ) : null}

              {!audioPlaybackReady && connected ? (
                <button
                  type="button"
                  className="sessao-room-audio-resume"
                  onClick={() => {
                    void resumeAudioPlayback().catch((err) => window.alert(err.message))
                  }}
                >
                  Ativar audio desta sessao
                </button>
              ) : null}

              <div className="sessao-room-inline-buttons">
                {!connected ? (
                  <Button onClick={() => joinMedia().catch((err) => window.alert(err.message))} loading={joining}>
                    Entrar na conversa
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => leaveMedia().catch((err) => window.alert(err.message))}>
                    Sair do audio e camera
                  </Button>
                )}
                <Button
                  variant={localMicEnabled ? 'primary' : 'secondary'}
                  onClick={() => toggleMicrophone().catch((err) => window.alert(err.message))}
                  disabled={!connected && joining}
                >
                  {localMicEnabled ? 'Mutar microfone' : 'Abrir microfone'}
                </Button>
                <Button
                  variant={localCameraEnabled ? 'primary' : 'secondary'}
                  onClick={() => toggleCamera().catch((err) => window.alert(err.message))}
                  disabled={!connected && joining}
                >
                  {localCameraEnabled ? 'Desligar camera' : 'Ligar camera'}
                </Button>
                <Button
                  variant={localScreenShareEnabled ? 'primary' : 'secondary'}
                  onClick={() => toggleScreenShare().catch((err) => window.alert(err.message))}
                  disabled={!connected && joining}
                >
                  {localScreenShareEnabled ? 'Parar de compartilhar' : 'Compartilhar tela'}
                </Button>
              </div>

              {canManageSession && (
                <>
                  <div className="sessao-room-control-group">
                    <span className="sessao-room-label">Microfone do cliente</span>
                    <div className="sessao-room-inline-buttons">
                      <button
                        type="button"
                        className={`sessao-inline-toggle${allowClientMicrophone ? ' active' : ''}`}
                        onClick={() => handlePlannerUpdate({ allowClientMicrophone: true })}
                      >
                        Liberado
                      </button>
                      <button
                        type="button"
                        className={`sessao-inline-toggle${!allowClientMicrophone ? ' active' : ''}`}
                        onClick={() => handlePlannerUpdate({ allowClientMicrophone: false })}
                      >
                        Travado
                      </button>
                    </div>
                  </div>

                  <div className="sessao-room-control-group">
                    <span className="sessao-room-label">Camera do cliente</span>
                    <div className="sessao-room-inline-buttons">
                      {Object.entries(CAMERA_MODE_LABELS).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className={`sessao-inline-toggle${clientCameraMode === value ? ' active' : ''}`}
                          onClick={() => handlePlannerUpdate({ clientCameraMode: value })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="sessao-room-camera-grid">
                {participantMedia.length === 0 && (
                  <p className="sessao-room-camera-empty">
                    Quando alguem entrar no audio e camera, as miniaturas da sessao aparecem aqui.
                  </p>
                )}

                {participantMedia.map((participant) => (
                  <div key={participant.identity} className="sessao-room-camera-tile">
                    <div className="sessao-room-camera-frame">
                      <div
                        ref={(node) => setVideoHostRef(participant.identity, node)}
                        className="sessao-room-camera-host"
                      >
                        {!participant.cameraEnabled ? (
                          <div className="sessao-room-camera-placeholder">
                            Camera desligada
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="sessao-room-camera-meta">
                      <div>
                        <strong>{participant.name}{participant.isLocal ? ' (voce)' : ''}</strong>
                        <span>{participant.sessionRole === 'planner' ? 'Planejador' : participant.sessionRole === 'client' ? 'Cliente' : 'Observador'}</span>
                      </div>
                      <div className="sessao-room-camera-status">
                        <span>{participant.micEnabled ? 'Mic ligado' : 'Mic mutado'}</span>
                        <span>{participant.isSpeaking ? 'Falando' : 'Silencioso'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {visibleCameraParticipants.length > 0 && (
                <p className="sessao-room-media-hint">
                  {visibleCameraParticipants.length} camera(s) ativa(s) nesta sessao agora.
                </p>
              )}
              {screenSharePresenter && (
                <p className="sessao-room-media-hint">
                  {screenSharePresenter.name}{screenSharePresenter.isLocal ? ' (voce)' : ''} esta compartilhando a tela nesta sessao.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Controles da sessao"
              subtitle={canManageSession ? 'Planejador define o modo de acesso do cliente.' : 'Somente o planejador altera estes controles.'}
            />
            <div className="sessao-room-control-stack">
              <div className="sessao-room-control-group">
                <span className="sessao-room-label">Acesso do cliente</span>
                <div className="sessao-room-inline-buttons">
                  {Object.entries(ACCESS_LABELS).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`sessao-inline-toggle${state.clientAccessMode === value ? ' active' : ''}`}
                      onClick={() => handlePlannerUpdate({
                        clientAccessMode: value,
                        clientEditLocked: value === 'view_only',
                      })}
                      disabled={!canManageSession}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sessao-room-control-group">
                <span className="sessao-room-label">Trava imediata</span>
                <button
                  type="button"
                  className={`sessao-lock-toggle${state.clientEditLocked ? ' locked' : ' unlocked'}`}
                  onClick={() => handlePlannerUpdate({ clientEditLocked: !state.clientEditLocked })}
                  disabled={!canManageSession}
                >
                  {state.clientEditLocked ? 'Cliente travado' : 'Cliente pode editar conforme o modo'}
                </button>
              </div>

              <div className="sessao-room-control-group">
                <span className="sessao-room-label">Ultima mudanca</span>
                <p>{state.lastUpdatedByName || 'Sem registro'} · {formatDateTime(state.updatedAt)}</p>
              </div>

              {(canClaimFocusedLock || canReleaseFocusedLock) && (
                <div className="sessao-room-control-group">
                  <span className="sessao-room-label">Trava do item em foco</span>
                  <div className="sessao-room-inline-buttons">
                    {canClaimFocusedLock && (
                      <Button size="sm" onClick={() => handleClaimLock(
                        state.focusedEntityPanel || activePanel,
                        state.focusedEntityType,
                        state.focusedEntityId,
                        state.focusedEntityLabel,
                      )}
                      >
                        Reservar para mim
                      </Button>
                    )}
                    {canReleaseFocusedLock && (
                      <Button size="sm" variant="secondary" onClick={handleReleaseLock}>
                        Liberar item
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Presenca online"
              subtitle={`${participantsOnline.length} online agora`}
            />
            <div className="sessao-room-presence-list">
              {presence.length === 0 && <p>Ninguem conectado ainda.</p>}
              {presence.map((entry) => (
                <div key={entry.uid} className={`sessao-room-presence-item${entry.isOnline ? ' online' : ''}`}>
                  <div>
                    <strong>{entry.name}</strong>
                    <span>{entry.sessionRole === 'planner' ? 'Planejador' : entry.sessionRole === 'client' ? 'Cliente' : 'Observador'}</span>
                  </div>
                  <div>
                    <strong>{entry.isOnline ? 'Online' : 'Saiu'}</strong>
                    <span>
                      {entry.mediaConnected
                        ? `${entry.mediaMicEnabled ? 'Mic on' : 'Mic off'} · ${entry.mediaCameraEnabled ? 'Cam on' : 'Cam off'}`
                        : entry.activePanel
                          ? `Painel: ${PANEL_LABELS[entry.activePanel] || entry.activePanel}`
                          : 'Sem painel informado'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Chat da sessao"
              subtitle="Conversem aqui e compartilhem PDF, imagem, CSV, OFX, QFX, XLSX ou TXT do atendimento."
            />
            <div className="sessao-room-chat">
              <div className="sessao-room-chat-list">
                {messages.length === 0 && (
                  <p className="sessao-room-chat-empty">
                    Nenhuma mensagem ainda. Use o chat para mandar observacoes, extratos, cupons e arquivos de apoio.
                  </p>
                )}

                {messages.map((message) => {
                  const mine = message.senderUid === currentUserId
                  const canDelete = canManageSession || message.senderUid === user?.uid
                  return (
                    <div key={message.id} className={`sessao-room-chat-item${mine ? ' mine' : ''}`}>
                      <div className="sessao-room-chat-meta">
                        <strong>{message.senderName}</strong>
                        <span>{formatDateTime(message.createdAt)}</span>
                      </div>

                      {message.text ? (
                        <p className="sessao-room-chat-text">{message.text}</p>
                      ) : null}

                      {message.attachment ? (
                        <div className="sessao-room-chat-attachment">
                          {message.attachment.kind === 'image' ? (
                            <a href={message.attachment.url} target="_blank" rel="noreferrer" className="sessao-room-chat-image-link">
                              <img
                                src={message.attachment.url}
                                alt={message.attachment.name}
                                className="sessao-room-chat-image"
                              />
                            </a>
                          ) : (
                            <div className="sessao-room-chat-file">
                              <strong>{message.attachment.name}</strong>
                              <span>{formatChatFileSize(message.attachment.size)}</span>
                            </div>
                          )}

                          <div className="sessao-room-chat-attachment-actions">
                            <a
                              href={message.attachment.url}
                              target="_blank"
                              rel="noreferrer"
                              download={message.attachment.name}
                              className="sessao-room-chat-link"
                            >
                              Baixar arquivo
                            </a>
                          </div>
                        </div>
                      ) : null}

                      {canDelete && (
                        <div className="sessao-room-chat-actions">
                          <button
                            type="button"
                            className="sessao-room-chat-delete"
                            onClick={() => handleDeleteChatMessage(message)}
                            disabled={deletingMessageId === message.id}
                          >
                            {deletingMessageId === message.id ? 'Excluindo...' : 'Excluir'}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="sessao-room-chat-composer">
                <textarea
                  className="sessao-room-chat-textarea"
                  value={chatText}
                  onChange={(event) => setChatText(event.target.value)}
                  rows={4}
                  placeholder="Escreva uma mensagem para a sessao."
                />

                <div className="sessao-room-chat-upload-row">
                  <label className="sessao-room-chat-upload">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.csv,.xls,.xlsx,.txt,.ofx,.qfx"
                      onChange={(event) => setChatFile(event.target.files?.[0] || null)}
                    />
                    <span>Anexar arquivo</span>
                  </label>

                  {chatFile && (
                    <div className="sessao-room-chat-selected-file">
                      <strong>{chatFile.name}</strong>
                      <span>{formatChatFileSize(chatFile.size)}</span>
                    </div>
                  )}
                </div>

                <div className="sessao-room-editor-footer">
                  <span>O anexo fica disponivel no chat para abrir ou baixar depois.</span>
                  <Button
                    onClick={handleSendChatMessage}
                    loading={sendingChat}
                    disabled={!chatText.trim() && !chatFile}
                  >
                    Enviar no chat
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
