import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { createDebt, fetchDebtPayments, fetchDebts } from '../services/debtService'

export function useDebts() {
  const { user } = useAuth()
  const { activeWorkspaceId, permissions } = useWorkspace()

  const [debts, setDebts] = useState([])
  const [paymentsByDebtId, setPaymentsByDebtId] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    if (!user?.uid || !activeWorkspaceId) {
      setDebts([])
      setPaymentsByDebtId({})
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const debtList = await fetchDebts(activeWorkspaceId)
      setDebts(debtList)

      const paymentEntries = await Promise.all(
        debtList.map(async (debt) => [debt.id, await fetchDebtPayments(activeWorkspaceId, debt.id)]),
      )

      setPaymentsByDebtId(Object.fromEntries(paymentEntries))
    } catch (err) {
      setError(err.message)
      setDebts([])
      setPaymentsByDebtId({})
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId, user?.uid])

  useEffect(() => {
    reload()
  }, [reload])

  async function addDebt(data) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    if (!activeWorkspaceId) throw new Error('Workspace não selecionado')
    if (!permissions.canLaunch) throw new Error('Seu papel não permite criar dívidas neste workspace')

    const id = await createDebt(activeWorkspaceId, data, user.uid)
    await reload()
    return id
  }

  return {
    debts,
    paymentsByDebtId,
    loading,
    error,
    reload,
    addDebt,
  }
}
