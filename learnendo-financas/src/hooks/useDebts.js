import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import {
  cancelDebtSettlement,
  confirmDebtReceipt,
  confirmDebtSettlement,
  createDebt,
  deleteDebt,
  deleteDebtSettlement,
  fetchDebtPayments,
  fetchDebts,
  requestDebtSettlement,
} from '../services/debtService'

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
    if (!user?.uid) throw new Error('Usuario nao autenticado')
    if (!activeWorkspaceId) throw new Error('Workspace nao selecionado')
    if (!permissions.canLaunch) throw new Error('Seu papel nao permite criar dividas neste workspace')

    const id = await createDebt(activeWorkspaceId, data, user.uid)
    await reload()
    return id
  }

  async function addSettlement(debtId, data) {
    if (!user?.uid) throw new Error('Usuario nao autenticado')
    if (!activeWorkspaceId) throw new Error('Workspace nao selecionado')
    if (!permissions.canLaunch) throw new Error('Seu papel nao permite registrar restituicoes neste workspace')

    await requestDebtSettlement(activeWorkspaceId, debtId, data, user.uid)
    await reload()
  }

  async function confirmSettlement(debtId, settlementId) {
    if (!user?.uid) throw new Error('Usuario nao autenticado')
    if (!activeWorkspaceId) throw new Error('Workspace nao selecionado')
    if (!permissions.canConfirm) throw new Error('Seu papel nao permite confirmar restituicoes neste workspace')

    await confirmDebtSettlement(activeWorkspaceId, debtId, settlementId, user.uid)
    await reload()
  }

  async function confirmReceipt(debtId) {
    if (!user?.uid) throw new Error('Usuario nao autenticado')
    if (!activeWorkspaceId) throw new Error('Workspace nao selecionado')
    if (!permissions.canConfirm) throw new Error('Seu papel nao permite confirmar emprestimos neste workspace')

    await confirmDebtReceipt(activeWorkspaceId, debtId, user.uid)
    await reload()
  }

  async function cancelSettlement(debtId, settlementId) {
    if (!user?.uid) throw new Error('Usuario nao autenticado')
    if (!activeWorkspaceId) throw new Error('Workspace nao selecionado')
    if (!permissions.canLaunch) throw new Error('Seu papel nao permite cancelar restituicoes neste workspace')

    await cancelDebtSettlement(activeWorkspaceId, debtId, settlementId, user.uid)
    await reload()
  }

  async function removeDebt(debtId, reason) {
    if (!user?.uid) throw new Error('Usuario nao autenticado')
    if (!activeWorkspaceId) throw new Error('Workspace nao selecionado')
    if (!permissions.canLaunch) throw new Error('Seu papel nao permite excluir dividas neste workspace')

    await deleteDebt(activeWorkspaceId, debtId, user.uid, reason)
    await reload()
  }

  async function removeSettlement(debtId, settlementId, reason) {
    if (!user?.uid) throw new Error('Usuario nao autenticado')
    if (!activeWorkspaceId) throw new Error('Workspace nao selecionado')
    if (!permissions.canLaunch) throw new Error('Seu papel nao permite excluir restituicoes neste workspace')

    await deleteDebtSettlement(activeWorkspaceId, debtId, settlementId, user.uid, reason)
    await reload()
  }

  return {
    debts,
    paymentsByDebtId,
    loading,
    error,
    reload,
    addDebt,
    addSettlement,
    confirmReceipt,
    confirmSettlement,
    cancelSettlement,
    removeDebt,
    removeSettlement,
  }
}
