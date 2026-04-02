import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { fetchTransactionsBySalaryReferenceMonth } from '../services/transactionService'
import { buildSalaryInsight, calculateMonthlySummary } from '../utils/financeCalculations'
import { useBudget } from './useBudget'
import { useTransactions } from './useTransactions'

/**
 * Hook que calcula o resumo financeiro do Dashboard a partir de dados reais do Firestore.
 * Campos que ainda não têm backend (orçamento, reconciliação, cartões) usam mock temporariamente.
 *
 * Tipos de transação e como afetam o saldo:
 *   income            -> receita  (+saldo)
 *   expense           -> despesa  (-saldo)
 *   investment        -> investimento (-saldo)
 *   transfer_internal -> transferência entre contas próprias (neutro - não afeta saldo)
 *   transfer          -> transferência legada/importada (tratada como despesa se balanceImpact=true)
 */
export function useDashboard(year, month) {
  const { user } = useAuth()
  const { activeWorkspaceId, myRole } = useWorkspace()
  const { transactions, loading, error, reload } = useTransactions(year, month)
  const { budgetItems, loading: budgetLoading } = useBudget(year, month)
  const [linkedAdvanceTransactions, setLinkedAdvanceTransactions] = useState([])
  const [linkedAdvanceLoading, setLinkedAdvanceLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadLinkedAdvances() {
      if (!user?.uid) {
        setLinkedAdvanceTransactions([])
        return
      }

      setLinkedAdvanceLoading(true)
      try {
        const selectedMonthKey = `${year}-${String(month).padStart(2, '0')}`
        const data = await fetchTransactionsBySalaryReferenceMonth(user.uid, selectedMonthKey, {
          workspaceId: activeWorkspaceId,
          viewerRole: myRole,
          viewerUid: user.uid,
        })
        if (!cancelled) setLinkedAdvanceTransactions(data)
      } catch (fetchError) {
        console.error('[useDashboard] Error loading linked salary advances:', fetchError.message)
        if (!cancelled) setLinkedAdvanceTransactions([])
      } finally {
        if (!cancelled) setLinkedAdvanceLoading(false)
      }
    }

    loadLinkedAdvances()
    return () => { cancelled = true }
  }, [user?.uid, year, month, activeWorkspaceId, myRole])

  const summary = useMemo(() => {
    const baseSummary = calculateMonthlySummary(transactions, 'dashboard')
    const selectedMonthKey = `${year}-${String(month).padStart(2, '0')}`
    const salaryInsight = buildSalaryInsight(transactions, linkedAdvanceTransactions, selectedMonthKey)
    const orcado = budgetItems
      .filter((item) => item.type === 'expense')
      .reduce((sum, item) => sum + Number(item.plannedAmount || 0), 0)

    return {
      scope: 'personal',
      ownerName: '',
      receitas: baseSummary.receitas,
      despesas: baseSummary.despesas,
      investimentos: baseSummary.investimentos,
      transferencias: baseSummary.transferencias,
      saldo: baseSummary.saldo,
      salarioRecebido: salaryInsight.salaryReceived,
      salarioBruto: salaryInsight.grossSalary,
      valesVinculados: salaryInsight.advanceAmount,
      possuiVinculoVale: salaryInsight.hasLinkedAdvance,
      orcado,
      pendingCount: baseSummary.pendingCount,
      reconciled: false,
      reconciliationDiff: 0,
      recentTransactions: baseSummary.recentTransactions,
    }
  }, [transactions, budgetItems, linkedAdvanceTransactions, year, month])

  return {
    summary,
    transactions,
    loading: loading || budgetLoading || linkedAdvanceLoading,
    error,
    reload,
  }
}
