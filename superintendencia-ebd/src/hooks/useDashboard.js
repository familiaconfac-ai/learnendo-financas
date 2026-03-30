import { useMemo } from 'react'
import { useTransactions } from './useTransactions'
import { useBudget } from './useBudget'
import { calculateMonthlySummary } from '../utils/financeCalculations'

/**
 * Hook que calcula o resumo financeiro do Dashboard a partir de dados reais do Firestore.
 * Campos que ainda não têm backend (orçamento, reconciliação, cartões) usam mock temporariamente.
 *
 * Tipos de transação e como afetam o saldo:
 *   income            → receita  (+saldo)
 *   expense           → despesa  (-saldo)
 *   investment        → investimento (-saldo)
 *   transfer_internal → transferência entre contas próprias (neutro — não afeta saldo)
 *   transfer          → transferência legada/importada (tratada como despesa se balanceImpact=true)
 */
export function useDashboard(year, month) {
  const { transactions, loading, error, reload } = useTransactions(year, month)
  const { budgetItems, loading: budgetLoading } = useBudget(year, month)

  const summary = useMemo(() => {
    const baseSummary = calculateMonthlySummary(transactions, 'dashboard')
    const orcado = budgetItems
      .filter((item) => item.type === 'expense')
      .reduce((sum, item) => sum + Number(item.plannedAmount || 0), 0)

    return {
      scope:               'personal',
      ownerName:           '',              // preenchido em Dashboard.jsx via profile
      receitas:            baseSummary.receitas,
      despesas:            baseSummary.despesas,
      investimentos:       baseSummary.investimentos,
      transferencias:      baseSummary.transferencias,
      saldo:               baseSummary.saldo,
      orcado,
      pendingCount:        baseSummary.pendingCount,
      reconciled:          false,           // TODO: conectar reconciliação
      reconciliationDiff:  0,
      recentTransactions:  baseSummary.recentTransactions,
    }
  }, [transactions, budgetItems])

  return { summary, transactions, loading: loading || budgetLoading, error, reload }
}
