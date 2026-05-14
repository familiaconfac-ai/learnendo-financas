import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Button from '../ui/Button'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useFinancialSession } from '../../hooks/useFinancialSession'
import { useFinancialSessionActions } from '../../hooks/useFinancialSessionActions'
import { useFinancialSessionMedia } from '../../hooks/useFinancialSessionMedia'
import { formatChatFileSize } from '../../services/financialSessionChatService'
import {
  clearActiveFinancialSessionBridge,
  getActiveFinancialSessionBridge,
  subscribeActiveFinancialSessionBridge,
} from '../../services/financialSessionBridgeService'
import './FinancialSessionDock.css'

const ACTION_STATUS_LABELS = {
  pending: 'Pendente',
  applied: 'Aplicado',
  cancelled: 'Cancelado',
}

function formatDateTime(value) {
  if (!value) return 'Agora mesmo'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Agora mesmo'
  return date.toLocaleString('pt-BR')
}

function todayDateKey() {
  return new Date().toISOString().slice(0, 10)
}

function mapPathToPanel(pathname) {
  if (pathname.startsWith('/lancar') || pathname.startsWith('/lancamentos') || pathname.startsWith('/contas')) {
    return 'transactions'
  }
  if (pathname.startsWith('/orcamento')) return 'budget'
  if (pathname.startsWith('/familia')) return 'goals'
  return 'overview'
}

export default function FinancialSessionDock() {
  const [bridge, setBridge] = useState(() => getActiveFinancialSessionBridge())
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState('media')
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
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { activeWorkspaceId, members, permissions } = useWorkspace()

  useEffect(() => subscribeActiveFinancialSessionBridge(setBridge), [])

  const sessionId = bridge?.sessionId || ''
  const workspaceId = bridge?.workspaceId || ''
  const {
    session,
    state,
    presence,
    messages,
    loading,
    error,
    sessionRole,
    currentUserId,
    currentUserName,
    canManageSession,
    participantAccess,
    updateState,
    sendMessage,
    deleteMessage,
  } = useFinancialSession(sessionId, workspaceId)
  const canReadWorkspaceDirectly = activeWorkspaceId === workspaceId
    && members.some((member) => (member.uid || member.id) === currentUserId)
  const {
    actions,
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
  const canApplyIntoWorkspace = canApplyActionRequests && canReadWorkspaceDirectly && permissions.canLaunch
  const activePanel = mapPathToPanel(location.pathname)
  const participantsOnline = useMemo(
    () => presence.filter((entry) => entry.isOnline),
    [presence],
  )

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
    screenSharePresenter,
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
    if (!bridge || !canManageSession || !sessionId) return
    if (location.pathname.startsWith('/reunioes')) return

    void updateState({
      activePanel,
    }).catch(() => {})
  }, [activePanel, bridge, canManageSession, location.pathname, sessionId, updateState])

  if (!bridge) return null

  async function handleCloseSession() {
    try {
      await leaveMedia().catch(() => {})
    } finally {
      clearActiveFinancialSessionBridge()
      setExpanded(false)
      if (location.pathname.startsWith('/reunioes/sessao/')) {
        navigate('/dashboard', { replace: true })
      }
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

  const pendingActionsCount = actions.filter((action) => action.status === 'pending').length

  return (
    <section className={`financial-session-dock${expanded ? ' expanded' : ''}`}>
      <div className="financial-session-dock__bar">
        <div className="financial-session-dock__identity">
          <button
            type="button"
            className="financial-session-dock__camera"
            onClick={() => setExpanded((current) => !current)}
            aria-label={expanded ? 'Fechar barra da sessão' : 'Abrir barra da sessão'}
          >
            📹
          </button>
          <div>
            <strong>{session?.name || 'Sessão financeira'}</strong>
            <span>
              {loading
                ? 'Abrindo atendimento colaborativo...'
                : `${participantsOnline.length} online · ${participantAccess}`}
            </span>
          </div>
        </div>

        <div className="financial-session-dock__quick">
          <span className={`financial-session-dock__status ${connected ? 'live' : 'idle'}`}>
            {transportLabel}
          </span>
          {pendingActionsCount > 0 && (
            <button
              type="button"
              className="financial-session-dock__counter"
              onClick={() => {
                setExpanded(true)
                setActiveTab('actions')
              }}
            >
              {pendingActionsCount} pedido(s)
            </button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setExpanded((current) => !current)}>
            {expanded ? 'Recolher' : 'Abrir'}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCloseSession}>
            Sair da sessão
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="financial-session-dock__body">
          {(error || transportError) && (
            <div className="financial-session-dock__alert">
              {error || transportError}
            </div>
          )}

          <div className="financial-session-dock__tabs">
            <button
              type="button"
              className={`financial-session-dock__tab${activeTab === 'media' ? ' active' : ''}`}
              onClick={() => setActiveTab('media')}
            >
              Áudio e tela
            </button>
            <button
              type="button"
              className={`financial-session-dock__tab${activeTab === 'chat' ? ' active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              Chat
            </button>
            <button
              type="button"
              className={`financial-session-dock__tab${activeTab === 'actions' ? ' active' : ''}`}
              onClick={() => setActiveTab('actions')}
            >
              Pedidos
            </button>
          </div>

          {activeTab === 'media' && (
            <div className="financial-session-dock__panel">
              <div ref={audioHostRef} className="financial-session-dock__hidden" aria-hidden="true" />

              <div className="financial-session-dock__toolbar">
                {!connected ? (
                  <Button onClick={() => joinMedia().catch((err) => window.alert(err.message))} loading={joining}>
                    Entrar na conversa
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => leaveMedia().catch((err) => window.alert(err.message))}>
                    Sair da conversa
                  </Button>
                )}
                <Button
                  variant={localMicEnabled ? 'primary' : 'secondary'}
                  onClick={() => toggleMicrophone().catch((err) => window.alert(err.message))}
                >
                  {localMicEnabled ? 'Mutar microfone' : 'Abrir microfone'}
                </Button>
                <Button
                  variant={localCameraEnabled ? 'primary' : 'secondary'}
                  onClick={() => toggleCamera().catch((err) => window.alert(err.message))}
                >
                  {localCameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}
                </Button>
                <Button
                  variant={localScreenShareEnabled ? 'primary' : 'secondary'}
                  onClick={() => toggleScreenShare().catch((err) => window.alert(err.message))}
                >
                  {localScreenShareEnabled ? 'Parar compartilhamento' : 'Compartilhar tela'}
                </Button>
                {!audioPlaybackReady && connected ? (
                  <Button variant="secondary" onClick={() => resumeAudioPlayback().catch((err) => window.alert(err.message))}>
                    Ativar áudio
                  </Button>
                ) : null}
              </div>

              {screenSharePresenter ? (
                <div className="financial-session-dock__screen">
                  <div className="financial-session-dock__screen-meta">
                    <strong>Compartilhamento de tela</strong>
                    <span>{screenSharePresenter.name}{screenSharePresenter.isLocal ? ' (você)' : ''}</span>
                  </div>
                  <div className="financial-session-dock__screen-frame">
                    <div ref={setScreenShareHostRef} className="financial-session-dock__video-host" />
                  </div>
                </div>
              ) : (
                <p className="financial-session-dock__info">
                  Quando alguém compartilhar a tela, ela aparece aqui enquanto vocês continuam usando as telas reais do app logo abaixo.
                </p>
              )}

              <div className="financial-session-dock__participants">
                {participantMedia.length === 0 && (
                  <p className="financial-session-dock__info">
                    Entre na conversa para ativar microfone, câmera e compartilhamento de tela.
                  </p>
                )}
                {participantMedia.map((participant) => (
                  <div key={participant.identity} className="financial-session-dock__participant">
                    <div className="financial-session-dock__participant-frame">
                      <div
                        ref={(node) => setVideoHostRef(participant.identity, node)}
                        className="financial-session-dock__video-host"
                      >
                        {!participant.cameraEnabled ? (
                          <div className="financial-session-dock__placeholder">Câmera desligada</div>
                        ) : null}
                      </div>
                    </div>
                    <strong>{participant.name}{participant.isLocal ? ' (você)' : ''}</strong>
                    <span>{participant.micEnabled ? 'Mic ligado' : 'Mic mutado'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'chat' && (
            <div className="financial-session-dock__panel">
              <div className="financial-session-dock__chat-list">
                {messages.length === 0 && (
                  <p className="financial-session-dock__info">
                    Nenhuma mensagem ainda. Use o chat para extratos, comprovantes e orientações rápidas.
                  </p>
                )}

                {messages.map((message) => {
                  const mine = message.senderUid === currentUserId
                  const canDelete = canManageSession || message.senderUid === user?.uid
                  return (
                    <div key={message.id} className={`financial-session-dock__chat-item${mine ? ' mine' : ''}`}>
                      <div className="financial-session-dock__chat-meta">
                        <strong>{message.senderName}</strong>
                        <span>{formatDateTime(message.createdAt)}</span>
                      </div>

                      {message.text ? <p>{message.text}</p> : null}

                      {message.attachment ? (
                        <div className="financial-session-dock__attachment">
                          <strong>{message.attachment.name}</strong>
                          <span>{formatChatFileSize(message.attachment.size)}</span>
                          <a href={message.attachment.url} target="_blank" rel="noreferrer">
                            Abrir arquivo
                          </a>
                        </div>
                      ) : null}

                      {canDelete && (
                        <button
                          type="button"
                          className="financial-session-dock__delete"
                          onClick={() => handleDeleteChatMessage(message)}
                          disabled={deletingMessageId === message.id}
                        >
                          {deletingMessageId === message.id ? 'Excluindo...' : 'Excluir'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              <textarea
                className="financial-session-dock__textarea"
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                rows={3}
                placeholder="Escreva uma mensagem para a sessão."
              />

              <div className="financial-session-dock__composer">
                <label className="financial-session-dock__upload">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.csv,.xls,.xlsx,.txt,.ofx,.qfx"
                    onChange={(event) => setChatFile(event.target.files?.[0] || null)}
                  />
                  <span>Anexar arquivo</span>
                </label>

                {chatFile ? (
                  <div className="financial-session-dock__selected-file">
                    <strong>{chatFile.name}</strong>
                    <span>{formatChatFileSize(chatFile.size)}</span>
                  </div>
                ) : null}

                <Button onClick={handleSendChatMessage} loading={sendingChat} disabled={!chatText.trim() && !chatFile}>
                  Enviar
                </Button>
              </div>
            </div>
          )}

          {activeTab === 'actions' && (
            <div className="financial-session-dock__panel">
              {canCreateActionRequests ? (
                <div className="financial-session-dock__request-form">
                  <div className="financial-session-dock__request-grid">
                    <select
                      className="financial-session-dock__input"
                      value={actionForm.type}
                      onChange={(event) => setActionForm((current) => ({ ...current, type: event.target.value }))}
                    >
                      <option value="expense">Despesa</option>
                      <option value="income">Receita</option>
                    </select>
                    <input
                      className="financial-session-dock__input"
                      type="date"
                      value={actionForm.date}
                      onChange={(event) => setActionForm((current) => ({ ...current, date: event.target.value }))}
                    />
                  </div>
                  <input
                    className="financial-session-dock__input"
                    type="text"
                    value={actionForm.description}
                    onChange={(event) => setActionForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Descrição do lançamento"
                  />
                  <div className="financial-session-dock__request-grid">
                    <input
                      className="financial-session-dock__input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={actionForm.amount}
                      onChange={(event) => setActionForm((current) => ({ ...current, amount: event.target.value }))}
                      placeholder="Valor"
                    />
                    <input
                      className="financial-session-dock__input"
                      type="text"
                      value={actionForm.notes}
                      onChange={(event) => setActionForm((current) => ({ ...current, notes: event.target.value }))}
                      placeholder="Observação"
                    />
                  </div>
                  <Button onClick={handleCreateActionRequest} loading={creatingAction}>
                    Pedir lançamento
                  </Button>
                </div>
              ) : (
                <p className="financial-session-dock__info">
                  O seu acesso atual está em modo de visualização. O planejador pode liberar edição guiada para registrar pedidos aqui.
                </p>
              )}

              <div className="financial-session-dock__requests">
                {actions.length === 0 && (
                  <p className="financial-session-dock__info">
                    Nenhum pedido foi lançado nesta sessão ainda.
                  </p>
                )}

                {actions.map((action) => {
                  const isOwner = action.createdBy === currentUserId
                  const canCancel = action.status === 'pending' && (isOwner || canManageSession)
                  const canApply = action.status === 'pending' && canApplyIntoWorkspace
                  const isBusy = actingActionId === action.id

                  return (
                    <div key={action.id} className="financial-session-dock__request-item">
                      <div className="financial-session-dock__chat-meta">
                        <strong>{action.description}</strong>
                        <span>{ACTION_STATUS_LABELS[action.status] || action.status}</span>
                      </div>
                      <p>{action.date} · R$ {Number(action.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      {action.notes ? <p>{action.notes}</p> : null}
                      <span className="financial-session-dock__request-author">
                        {action.createdByName} · {formatDateTime(action.createdAt)}
                      </span>
                      {(canApply || canCancel) && (
                        <div className="financial-session-dock__composer">
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
                              Cancelar
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
