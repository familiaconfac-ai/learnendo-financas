import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import {
  ensureFinancialSessionState,
  markFinancialSessionOpened,
  subscribeFinancialSession,
  subscribeFinancialSessionState,
  updateFinancialSessionState,
} from '../services/financialSessionsService'
import {
  markFinancialPresenceOffline,
  subscribeFinancialPresence,
  upsertFinancialPresence,
} from '../services/financialPresenceService'
import { buildDefaultFinancialSessionState } from '../services/financialSessionStage'
import {
  canAccessFinancialPanel,
  canClientEditFinancialSession,
  canEditFinancialSharedDoc,
  canManageFinancialSession,
  canUpdateFinancialSessionState,
  participantAccessLabel,
  resolveFinancialSessionRole,
} from '../services/financialSessionPolicy'
import {
  subscribeFinancialSessionSharedText,
  updateFinancialSessionSharedText,
} from '../services/financialSessionSharedService'
import {
  deleteFinancialSessionMessage,
  sendFinancialSessionMessage,
  subscribeFinancialSessionMessages,
} from '../services/financialSessionChatService'

export function useFinancialSession(sessionId, workspaceIdOverride = '') {
  const { user } = useAuth()
  const { activeWorkspaceId, members, myRole } = useWorkspace()
  const [session, setSession] = useState(null)
  const [state, setState] = useState(buildDefaultFinancialSessionState())
  const [presence, setPresence] = useState([])
  const [messages, setMessages] = useState([])
  const [sharedNotes, setSharedNotes] = useState({ id: 'notes', text: '', updatedAt: null, updatedBy: '', updatedByName: '' })
  const [sharedPlanning, setSharedPlanning] = useState({ id: 'planning', text: '', updatedAt: null, updatedBy: '', updatedByName: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const resolvedWorkspaceId = workspaceIdOverride || activeWorkspaceId || ''

  const sessionRole = useMemo(
    () => resolveFinancialSessionRole(session, user?.uid || '', myRole),
    [myRole, session, user?.uid],
  )

  const currentMember = useMemo(
    () => members.find((member) => (member.uid || member.id) === user?.uid) || null,
    [members, user?.uid],
  )

  const currentDisplayName = currentMember?.displayName
    || currentMember?.name
    || user?.displayName
    || user?.email
    || 'Participante'

  useEffect(() => {
    if (!resolvedWorkspaceId || !sessionId) {
      setSession(null)
      setState(buildDefaultFinancialSessionState())
      setPresence([])
      setMessages([])
      setLoading(false)
      return undefined
    }

    setLoading(true)
    setError('')

    const unsubSession = subscribeFinancialSession(
      resolvedWorkspaceId,
      sessionId,
      (nextSession) => {
        setSession(nextSession)
        setLoading(false)
      },
      (err) => {
        setError(err?.message || 'Nao foi possivel carregar a sessao.')
        setLoading(false)
      },
    )

    const unsubState = subscribeFinancialSessionState(
      resolvedWorkspaceId,
      sessionId,
      (nextState) => setState(nextState),
      (err) => setError(err?.message || 'Nao foi possivel sincronizar o estado da sessao.'),
    )

    const unsubPresence = subscribeFinancialPresence(
      resolvedWorkspaceId,
      sessionId,
      (nextPresence) => setPresence(nextPresence),
      (err) => setError(err?.message || 'Nao foi possivel sincronizar a presenca.'),
    )

    const unsubNotes = subscribeFinancialSessionSharedText(
      resolvedWorkspaceId,
      sessionId,
      'notes',
      (nextNotes) => setSharedNotes(nextNotes),
      (err) => setError(err?.message || 'Nao foi possivel sincronizar as anotacoes da sessao.'),
    )

    const unsubPlanning = subscribeFinancialSessionSharedText(
      resolvedWorkspaceId,
      sessionId,
      'planning',
      (nextPlanning) => setSharedPlanning(nextPlanning),
      (err) => setError(err?.message || 'Nao foi possivel sincronizar o planejamento da sessao.'),
    )

    const unsubMessages = subscribeFinancialSessionMessages(
      resolvedWorkspaceId,
      sessionId,
      (nextMessages) => setMessages(nextMessages),
      (err) => setError(err?.message || 'Nao foi possivel sincronizar o chat da sessao.'),
    )

    return () => {
      unsubSession()
      unsubState()
      unsubPresence()
      unsubNotes()
      unsubPlanning()
      unsubMessages()
    }
  }, [resolvedWorkspaceId, sessionId])

  useEffect(() => {
    if (!resolvedWorkspaceId || !sessionId || !user?.uid || !session) return undefined

    if (sessionRole === 'planner') {
      void ensureFinancialSessionState(resolvedWorkspaceId, sessionId, user.uid, currentDisplayName)
    }
    void markFinancialSessionOpened(resolvedWorkspaceId, sessionId, user.uid)

    const syncPresence = () => upsertFinancialPresence(resolvedWorkspaceId, sessionId, user.uid, {
      name: currentDisplayName,
      email: user.email || '',
      sessionRole,
      workspaceRole: myRole,
      activePanel: state.activePanel,
    })

    void syncPresence()
    const timer = window.setInterval(() => {
      void syncPresence()
    }, 30000)

    return () => {
      window.clearInterval(timer)
      void markFinancialPresenceOffline(resolvedWorkspaceId, sessionId, user.uid)
    }
  }, [currentDisplayName, myRole, resolvedWorkspaceId, session, sessionId, sessionRole, state.activePanel, user?.email, user?.uid])

  const updateState = useCallback(async (patch) => {
    if (!resolvedWorkspaceId || !sessionId || !user?.uid) throw new Error('Sessao indisponivel')

    const nextPanel = patch?.activePanel || state.activePanel
    if (!canUpdateFinancialSessionState(state, sessionRole, nextPanel)) {
      throw new Error('Seu papel nao pode alterar este estado da sessao')
    }

    await updateFinancialSessionState(
      resolvedWorkspaceId,
      sessionId,
      patch,
      user.uid,
      currentDisplayName,
    )
  }, [currentDisplayName, resolvedWorkspaceId, sessionId, sessionRole, state, user?.uid])

  const saveSharedText = useCallback(async (docId, text) => {
    if (!resolvedWorkspaceId || !sessionId || !user?.uid) throw new Error('Sessao indisponivel')
    if (!canEditFinancialSharedDoc(state, sessionRole)) {
      throw new Error('Seu papel nao pode editar este conteudo compartilhado')
    }

    await updateFinancialSessionSharedText(
      resolvedWorkspaceId,
      sessionId,
      docId,
      text,
      user.uid,
      currentDisplayName,
    )
  }, [currentDisplayName, resolvedWorkspaceId, sessionId, sessionRole, state, user?.uid])

  const focusEntity = useCallback(async ({ panel, entityType, entityId, entityLabel = '' }) => {
    await updateState({
      activePanel: panel,
      focusedEntityPanel: panel,
      focusedEntityType: entityType,
      focusedEntityId: entityId,
      focusedEntityLabel: entityLabel,
    })
  }, [updateState])

  const claimEditingLock = useCallback(async ({ panel, entityType, entityId, entityLabel = '' }) => {
    await updateState({
      activePanel: panel,
      focusedEntityPanel: panel,
      focusedEntityType: entityType,
      focusedEntityId: entityId,
      focusedEntityLabel: entityLabel,
      editingOwnerUid: user?.uid || '',
      editingOwnerName: currentDisplayName,
    })
  }, [currentDisplayName, updateState, user?.uid])

  const releaseEditingLock = useCallback(async () => {
    await updateState({
      editingOwnerUid: '',
      editingOwnerName: '',
    })
  }, [updateState])

  const sendMessage = useCallback(async ({ text, attachmentFile }) => {
    if (!resolvedWorkspaceId || !sessionId || !user?.uid) throw new Error('Sessao indisponivel')

    await sendFinancialSessionMessage(resolvedWorkspaceId, sessionId, {
      text,
      attachmentFile,
      senderUid: user.uid,
      senderName: currentDisplayName,
      senderRole: sessionRole,
    })
  }, [currentDisplayName, resolvedWorkspaceId, sessionId, sessionRole, user?.uid])

  const deleteMessage = useCallback(async (message) => {
    if (!resolvedWorkspaceId || !sessionId || !user?.uid) throw new Error('Sessao indisponivel')

    const canDelete = sessionRole === 'planner' || message?.senderUid === user.uid
    if (!canDelete) {
      throw new Error('Voce nao pode excluir esta mensagem.')
    }

    await deleteFinancialSessionMessage(resolvedWorkspaceId, sessionId, message)
  }, [resolvedWorkspaceId, sessionId, sessionRole, user?.uid])

  return {
    session,
    workspaceId: resolvedWorkspaceId,
    state,
    presence,
    messages,
    sharedNotes,
    sharedPlanning,
    loading,
    error,
    sessionRole,
    currentUserId: user?.uid || '',
    currentUserName: currentDisplayName,
    canManageSession: canManageFinancialSession(sessionRole),
    canClientEdit: canClientEditFinancialSession(state, sessionRole),
    canEditSharedDocs: canEditFinancialSharedDoc(state, sessionRole),
    canAccessPanel: (panel) => canAccessFinancialPanel(state, sessionRole, panel),
    participantAccess: participantAccessLabel(sessionRole, state),
    updateState,
    saveSharedNotes: (text) => saveSharedText('notes', text),
    saveSharedPlanning: (text) => saveSharedText('planning', text),
    focusEntity,
    claimEditingLock,
    releaseEditingLock,
    sendMessage,
    deleteMessage,
  }
}
