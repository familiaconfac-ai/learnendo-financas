import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { fetchTransactionsBySalaryReferenceMonth } from '../services/transactionService'
import { buildAccountsReconciliation, buildSalaryInsight, calculateMonthlySummary } from '../utils/financeCalculations'
import { useBudget } from './useBudget'
import { useAccounts } from './useAccounts'
import { useTransactions } from './useTransactions'

/**
 * Hook que calcula o resumo financeiro do Dashboard a partir de dados reais do Firestore.
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
  const { activeWorkspaceId, activeWorkspace, myRole } = useWorkspace()
  const { transactions, loading, error, reload } = useTransactions(year, month)
  const { accounts, loading: accountsLoading } = useAccounts()
  const {
    budgetItems,
    loading: budgetLoading,
  } = useBudget(year, month)
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
    const reconciliations = buildAccountsReconciliation(accounts, transactions, selectedMonthKey)
    const reconcilableAccounts = reconciliations.filter((item) => item.hasSnapshot)
    const reconciliationDiff = reconcilableAccounts.reduce((sum, item) => sum + Math.abs(Number(item.difference || 0)), 0)
    const reconciled = reconcilableAccounts.length > 0 && reconcilableAccounts.every((item) => item.reconciled)
    const orcado = budgetItems
      .filter((item) => item.type === 'expense')
      .reduce((sum, item) => sum + Number(item.plannedAmount || 0), 0)

    return {
      scope: activeWorkspace?.type === 'family'
        ? 'family'
        : activeWorkspace?.type === 'shared'
          ? 'shared'
          : 'personal',
      ownerName: activeWorkspace?.name || '',
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
      reconciled,
      reconciliationDiff,
      reconciliationAccountsCount: reconcilableAccounts.length,
      recentTransactions: baseSummary.recentTransactions,
    }
  }, [
    transactions,
    budgetItems,
    linkedAdvanceTransactions,
    year,
    month,
    accounts,
    activeWorkspace?.name,
    activeWorkspace?.type,
  ])

  return {
    summary,
    transactions,
    loading: loading || budgetLoading || linkedAdvanceLoading || accountsLoading,
    error,
    reload,
  }
}
