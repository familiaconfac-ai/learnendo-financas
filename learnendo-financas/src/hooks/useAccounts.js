import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { fetchAccounts, addAccount, updateAccount, deleteAccount } from '../services/accountService'

/**
 * Hook para contas bancarias do workspace ativo.
 * Usa workspaces/{workspaceId}/accounts como fonte canonica, com fallback legado.
 */
export function useAccounts() {
  const { user } = useAuth()
  const { activeWorkspaceId } = useWorkspace()
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    if (!user?.uid) {
      setAccounts([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const data = await fetchAccounts(user.uid, { workspaceId: activeWorkspaceId })
      setAccounts(data)
    } catch (err) {
      console.error('[useAccounts] Error:', err.message)
      setError(err.message)
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId, user?.uid])

  useEffect(() => { reload() }, [reload])

  async function add(data) {
    if (!user?.uid) throw new Error('Usuario nao autenticado')
    const id = await addAccount(user.uid, data, { workspaceId: activeWorkspaceId })
    await reload()
    return id
  }

  async function update(accId, data) {
    if (!user?.uid) throw new Error('Usuario nao autenticado')
    await updateAccount(user.uid, accId, data, { workspaceId: activeWorkspaceId })
    await reload()
  }

  async function remove(accId) {
    if (!user?.uid) throw new Error('Usuario nao autenticado')
    await deleteAccount(user.uid, accId, { workspaceId: activeWorkspaceId })
    await reload()
  }

  return { accounts, loading, error, reload, add, update, remove }
}
