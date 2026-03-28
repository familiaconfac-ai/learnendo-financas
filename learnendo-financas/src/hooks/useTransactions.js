import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  fetchTransactionsWithOptions,
  addTransaction,
  updateTransaction,
  deleteTransaction,
} from '../services/transactionService'
import { ensureMonthlyRecurringTransactions } from '../services/recurrenceService'
import { useWorkspace } from '../context/WorkspaceContext'

/**
 * Hook central para leitura/escrita de transações no Firestore.
 * Filtra automaticamente pelo mês/ano informado.
 *
 * @param {number} year
 * @param {number} month  1–12
 */
export function useTransactions(year, month) {
  const { user } = useAuth()
  const { activeWorkspaceId, myRole, permissions } = useWorkspace()
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)

  const reload = useCallback(async () => {
    if (!user?.uid) {
      setTransactions([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      await ensureMonthlyRecurringTransactions(user.uid, year, month, { workspaceId: activeWorkspaceId })
      const data = await fetchTransactionsWithOptions(user.uid, year, month, {
        workspaceId: activeWorkspaceId,
        viewerRole: myRole,
        viewerUid: user.uid,
      })
      // Ordem crescente por data (mais recente primeiro)
      setTransactions(data.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')))
    } catch (err) {
      console.error('[useTransactions] Error loading transactions:', err.message)
      setError(err.message)
      setTransactions([])
    } finally {
      setLoading(false)
    }
  }, [user?.uid, year, month, activeWorkspaceId, myRole])

  useEffect(() => { reload() }, [reload])

  /** Cria uma nova transação e recarrega a lista */
  async function add(data) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    if (!permissions.canLaunch) throw new Error('Seu papel não permite criar lançamentos neste workspace')
    const id = await addTransaction(user.uid, {
      ...data,
      workspaceId: activeWorkspaceId,
      createdBy: user.uid,
      userId: user.uid,
    }, { workspaceId: activeWorkspaceId })
    await reload()
    return id
  }

  /** Atualiza uma transação existente e recarrega a lista */
  async function update(txId, data) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    if (!permissions.canConfirm && !permissions.canLaunch) {
      throw new Error('Seu papel não permite alterar lançamentos neste workspace')
    }
    await updateTransaction(user.uid, txId, { ...data, workspaceId: activeWorkspaceId }, { workspaceId: activeWorkspaceId })
    await reload()
  }

  /** Remove uma transação e recarrega a lista */
  async function remove(txId) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    if (!permissions.canLaunch) throw new Error('Seu papel não permite excluir lançamentos neste workspace')
    await deleteTransaction(user.uid, txId, { workspaceId: activeWorkspaceId })
    await reload()
  }

  return { transactions, loading, error, reload, add, update, remove }
}
