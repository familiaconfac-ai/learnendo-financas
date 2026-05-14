import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyFinancialSessionActionRequest,
  cancelFinancialSessionActionRequest,
  createFinancialSessionActionRequest,
  subscribeFinancialSessionActions,
} from '../services/financialSessionActionsService'
import {
  canApplyFinancialActionRequest,
  canCreateFinancialActionRequest,
} from '../services/financialSessionPolicy'

export function useFinancialSessionActions({
  workspaceId,
  sessionId,
  state,
  sessionRole,
  currentUserId,
  currentUserName,
}) {
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!workspaceId || !sessionId) {
      setActions([])
      setLoading(false)
      return undefined
    }

    setLoading(true)
    setError('')

    return subscribeFinancialSessionActions(
      workspaceId,
      sessionId,
      (nextActions) => {
        setActions(nextActions)
        setLoading(false)
      },
      (err) => {
        setError(err?.message || 'Nao foi possivel sincronizar os pedidos financeiros da sessao.')
        setLoading(false)
      },
    )
  }, [sessionId, workspaceId])

  const createActionRequest = useCallback(async (payload) => {
    if (!canCreateFinancialActionRequest(state, sessionRole, 'transactions')) {
      throw new Error('Seu acesso atual nao permite pedir este lancamento.')
    }

    await createFinancialSessionActionRequest(workspaceId, sessionId, payload, {
      uid: currentUserId,
      name: currentUserName,
      sessionRole,
    })
  }, [currentUserId, currentUserName, sessionId, sessionRole, state, workspaceId])

  const cancelActionRequest = useCallback(async (action) => {
    if (!action?.id) throw new Error('Pedido nao selecionado.')

    const isOwner = action.createdBy === currentUserId
    const isPlanner = canApplyFinancialActionRequest(sessionRole)
    if (!isOwner && !isPlanner) {
      throw new Error('Voce nao pode cancelar este pedido.')
    }

    await cancelFinancialSessionActionRequest(workspaceId, sessionId, action.id, {
      uid: currentUserId,
      name: currentUserName,
    })
  }, [currentUserId, currentUserName, sessionId, sessionRole, workspaceId])

  const applyActionRequest = useCallback(async (action) => {
    if (!canApplyFinancialActionRequest(sessionRole)) {
      throw new Error('Somente o planejador pode aplicar este pedido.')
    }

    return applyFinancialSessionActionRequest(workspaceId, sessionId, action, {
      uid: currentUserId,
      name: currentUserName,
    })
  }, [currentUserId, currentUserName, sessionId, sessionRole, workspaceId])

  const canCreateActionRequests = useMemo(
    () => canCreateFinancialActionRequest(state, sessionRole, 'transactions'),
    [sessionRole, state],
  )

  return {
    actions,
    loading,
    error,
    canCreateActionRequests,
    canApplyActionRequests: canApplyFinancialActionRequest(sessionRole),
    createActionRequest,
    cancelActionRequest,
    applyActionRequest,
  }
}
