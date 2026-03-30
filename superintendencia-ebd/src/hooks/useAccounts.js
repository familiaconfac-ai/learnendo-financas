import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { fetchAccounts, addAccount, updateAccount, deleteAccount } from '../services/accountService'

/**
 * Hook para contas bancárias do usuário.
 * Lê/escreve em users/{uid}/accounts no Firestore.
 */
export function useAccounts() {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const reload = useCallback(async () => {
    if (!user?.uid) { setAccounts([]); setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAccounts(user.uid)
      setAccounts(data)
    } catch (err) {
      console.error('[useAccounts] Error:', err.message)
      setError(err.message)
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }, [user?.uid])

  useEffect(() => { reload() }, [reload])

  async function add(data) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    const id = await addAccount(user.uid, data)
    await reload()
    return id
  }

  async function update(accId, data) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    await updateAccount(user.uid, accId, data)
    await reload()
  }

  async function remove(accId) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    await deleteAccount(user.uid, accId)
    await reload()
  }

  return { accounts, loading, error, reload, add, update, remove }
}
