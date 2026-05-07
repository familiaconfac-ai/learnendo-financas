import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { fetchBudgets, addBudget, updateBudget, deleteBudget } from '../services/budgetService'
import { fetchTransactions } from '../services/transactionService'
import { buildBudgetSpentMap, normalizedCategoryName } from '../utils/financeCalculations'

function toAmount(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function impactsBudget(tx) {
  if (typeof tx?.affectsBudget === 'boolean') return tx.affectsBudget
  return tx?.balanceImpact !== false
}

function budgetSemanticKey(item = {}) {
  const typeKey = item.type || 'expense'
  const categoryBaseName = item.parentCategoryName || item.categoryName || ''
  const itemBaseName = item.itemName || item.subcategoryName || item.categoryName || ''
  return `${typeKey}::${normalizedCategoryName(categoryBaseName)}::${normalizedCategoryName(itemBaseName)}`
}

function isImplicitBudgetRow(item = {}) {
  return String(item?.id || '').startsWith('implicit-')
}

function dedupeBudgetRows(rawBudgets = []) {
  const merged = new Map()

  rawBudgets.forEach((row) => {
    const key = budgetSemanticKey(row)
    const current = merged.get(key)
    const nextAmount = Number(row.plannedAmount || 0)

    if (!current) {
      merged.set(key, { ...row, plannedAmount: nextAmount })
      return
    }

    const currentUpdatedAt = Number(new Date(current.updatedAt?.seconds ? current.updatedAt.seconds * 1000 : current.updatedAt || 0))
    const nextUpdatedAt = Number(new Date(row.updatedAt?.seconds ? row.updatedAt.seconds * 1000 : row.updatedAt || 0))
    const preferred = nextUpdatedAt >= currentUpdatedAt ? row : current

    merged.set(key, {
      ...preferred,
      plannedAmount: Math.max(Number(current.plannedAmount || 0), nextAmount),
    })
  })

  return [...merged.values()]
}

function buildImplicitBudgetRowsFromTransactions(transactions = [], competencyMonth = '') {
  const incomeMap = new Map()
  const expenseMap = new Map()

  transactions
    .filter((tx) => tx?.status === 'confirmed' || tx?.status === 'pending')
    .forEach((tx) => {
      if (!['income', 'expense', 'investment'].includes(tx?.type)) return
      if (!impactsBudget(tx)) return

      if (tx?.receiptDetailEnabled && Array.isArray(tx.receiptItems) && tx.receiptItems.length > 0) {
        tx.receiptItems.forEach((item, index) => {
          const amount = Math.abs(toAmount(item.amount))
          if (!amount) return
          const categoryName = item.budgetCategoryName || tx.categoryName || 'Outros'
          const subcategoryName =
            item.detailSubcategoryLabel ||
            item.detailCategoryLabel ||
            tx.subcategoryName ||
            tx.categoryName ||
            'Subcategoria'
          const key = `${tx.type}::${normalizedCategoryName(categoryName)}::${normalizedCategoryName(subcategoryName)}`
          const current = expenseMap.get(key) || {
            id: `implicit-${tx.id}-${index}`,
            type: tx.type,
            categoryId: null,
            categoryName,
            parentCategoryName: categoryName,
            itemName: subcategoryName,
            subcategoryName,
            plannedAmount: 0,
            competencyMonth,
            structureModel: 'hierarchical_v1',
            spent: 0,
          }
          current.spent += amount
          expenseMap.set(key, current)
        })
        return
      }

      const amount = Math.abs(toAmount(tx.amount))
      if (!amount) return

      if (tx.type === 'income') {
        const incomeName = tx.categoryName || tx.subcategoryName || tx.description || 'Receita'
        const key = normalizedCategoryName(incomeName)
        const current = incomeMap.get(key) || {
          id: `implicit-income-${tx.id}`,
          type: 'income',
          categoryId: null,
          categoryName: incomeName,
          itemName: incomeName,
          subcategoryName: null,
          parentCategoryName: null,
          plannedAmount: 0,
          competencyMonth,
          structureModel: 'hierarchical_v1',
          spent: 0,
        }
        current.spent += amount
        incomeMap.set(key, current)
        return
      }

      const categoryName = tx.parentCategoryName || tx.categoryName || 'Outros'
      const itemName = tx.subcategoryName || tx.categoryName || tx.description || 'Subcategoria'
      const key = `${tx.type}::${normalizedCategoryName(categoryName)}::${normalizedCategoryName(itemName)}`
      const current = expenseMap.get(key) || {
        id: `implicit-${tx.id}`,
        type: tx.type,
        categoryId: null,
        categoryName,
        parentCategoryName: categoryName,
        itemName,
        subcategoryName: itemName,
        plannedAmount: 0,
        competencyMonth,
        structureModel: 'hierarchical_v1',
        spent: 0,
      }
      current.spent += amount
      expenseMap.set(key, current)
    })

  return [...incomeMap.values(), ...expenseMap.values()]
}

function buildIncomeActualHints(transactions = []) {
  const confirmedIncomeTransactions = transactions.filter((tx) => {
    return (tx?.status === 'confirmed' || tx?.status === 'pending') && tx?.type === 'income' && impactsBudget(tx)
  })

  return {
    salaryTotal: confirmedIncomeTransactions
      .filter((tx) => tx.transactionNatureId === 'nature_salary')
      .reduce((sum, tx) => sum + Math.abs(toAmount(tx.amount)), 0),
    advanceTotal: confirmedIncomeTransactions
      .filter((tx) => tx.transactionNatureId === 'nature_salary_advance')
      .reduce((sum, tx) => sum + Math.abs(toAmount(tx.amount)), 0),
    genericTransactions: confirmedIncomeTransactions
      .filter((tx) => !['nature_salary', 'nature_salary_advance'].includes(tx.transactionNatureId))
      .map((tx) => ({
        id: tx.id,
        amount: Math.abs(toAmount(tx.amount)),
        label: normalizedCategoryName(tx.subcategoryName || tx.categoryName || tx.description || ''),
      })),
  }
}

/**
 * Hook para orçamento mensal do usuário.
 * Carrega itens de orçamento do Firestore e cruza com as transações do mês
 * para calcular o `spent` real de cada categoria.
 */
export function useBudget(year, month, options = {}) {
  const { user } = useAuth()
  const { activeWorkspaceId, permissions, myRole } = useWorkspace()
  const forceEdit = Boolean(options?.forceEdit)
  const canEditBudget = forceEdit || Boolean(permissions?.canEditBudget)
  const [budgetItems, setBudgetItems] = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const monthStr = `${year}-${String(month).padStart(2, '0')}`

  const reload = useCallback(async () => {
    if (!user?.uid) { setBudgetItems([]); setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      // Carrega orçamentos e transações do mês em paralelo
      const [rawBudgetsResponse, transactions] = await Promise.all([
        fetchBudgets(user.uid, year, month, { workspaceId: activeWorkspaceId }),
        fetchTransactions(user.uid, year, month, {
          workspaceId: activeWorkspaceId,
          viewerRole: myRole,
          viewerUid: user.uid,
        }),
      ])
      const rawBudgets = dedupeBudgetRows(rawBudgetsResponse)

      const { spentByCategoryId, spentByCategoryName, spentBySubcategoryName } = buildBudgetSpentMap(transactions, 'useBudget', {
        includePending: true,
      })
      const incomeActualHints = buildIncomeActualHints(transactions)

      const hierarchicalGroups = new Set()
      rawBudgets.forEach((row) => {
        if ((row.type || 'expense') !== 'expense') return
        const parentName = row.parentCategoryName || row.categoryName
        if (!parentName) return
        const marker = `${row.type || 'expense'}::${normalizedCategoryName(parentName)}`
        hierarchicalGroups.add(marker)
      })

      const spentAssignedInGroup = new Set()
      const assignedIncomeHintBuckets = new Set()
      const assignedIncomeTransactionIds = new Set()

      const items = rawBudgets.map((b) => {
        const typeKey = b.type || 'expense'
        const byIdKey = `${typeKey}::${b.categoryId || '__none__'}`
        const categoryBaseName = b.parentCategoryName || b.categoryName
        const byNameKey = `${typeKey}::${normalizedCategoryName(categoryBaseName)}`
        const itemBaseName = b.itemName || b.subcategoryName || b.categoryName
        const bySubcategoryKey = `${typeKey}::${normalizedCategoryName(categoryBaseName)}::${normalizedCategoryName(itemBaseName)}`

        let spent = 0

        if (typeKey === 'expense') {
          spent = spentBySubcategoryName[bySubcategoryKey] || 0
          if (!spent && !b.parentCategoryName && !b.itemName && !b.subcategoryName) {
            spent = spentByCategoryId[byIdKey] || spentByCategoryName[byNameKey] || 0
          }
        } else {
          spent = spentByCategoryId[byIdKey] || spentByCategoryName[byNameKey] || 0
          if (!spent) {
            const normalizedIncomeName = normalizedCategoryName(itemBaseName)

            if (normalizedIncomeName.includes('salario') && incomeActualHints.salaryTotal > 0 && !assignedIncomeHintBuckets.has('salary')) {
              spent = incomeActualHints.salaryTotal
              assignedIncomeHintBuckets.add('salary')
            } else if (
              (normalizedIncomeName.includes('adiantamento') || normalizedIncomeName.includes('vale')) &&
              incomeActualHints.advanceTotal > 0 &&
              !assignedIncomeHintBuckets.has('advance')
            ) {
              spent = incomeActualHints.advanceTotal
              assignedIncomeHintBuckets.add('advance')
            } else {
              const plannedAmount = Math.abs(toAmount(b.plannedAmount))
              const exactAmountMatch = incomeActualHints.genericTransactions.find((tx) => {
                return !assignedIncomeTransactionIds.has(tx.id) && Math.abs(tx.amount - plannedAmount) < 0.01
              })

              if (exactAmountMatch) {
                spent = exactAmountMatch.amount
                assignedIncomeTransactionIds.add(exactAmountMatch.id)
              } else {
                const labelMatch = incomeActualHints.genericTransactions.find((tx) => {
                  return !assignedIncomeTransactionIds.has(tx.id) &&
                    tx.label &&
                    normalizedIncomeName &&
                    (tx.label.includes(normalizedIncomeName) || normalizedIncomeName.includes(tx.label))
                })

                if (labelMatch) {
                  spent = labelMatch.amount
                  assignedIncomeTransactionIds.add(labelMatch.id)
                }
              }
            }
          }
        }

        // In hierarchical expense mode, multiple rows can share the same category.
        // Assign spent once per category group to avoid inflating totals.
        if (typeKey === 'expense' && hierarchicalGroups.has(byNameKey) && !spentBySubcategoryName[bySubcategoryKey]) {
          if (spentAssignedInGroup.has(byNameKey)) spent = 0
          else spentAssignedInGroup.add(byNameKey)
        }

        return {
          ...b,
          spent,
        }
      })

      const existingKeys = new Set(items.map((item) => budgetSemanticKey(item)))

      const implicitRows = buildImplicitBudgetRowsFromTransactions(transactions, monthStr)
        .filter((row) => {
          const key = budgetSemanticKey(row)
          if (existingKeys.has(key)) return false
          existingKeys.add(key)
          return true
        })

      setBudgetItems([...items, ...implicitRows])
    } catch (err) {
      console.error('[useBudget] Error:', err.message)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user?.uid, year, month, activeWorkspaceId, myRole])

  useEffect(() => { reload() }, [reload])

  async function add(data) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    if (!canEditBudget) throw new Error('Seu papel não permite alterar orçamento neste workspace')
    const candidateKey = budgetSemanticKey(data)
    const existing = budgetItems.find((item) => !isImplicitBudgetRow(item) && budgetSemanticKey(item) === candidateKey)
    if (existing?.id) {
      await updateBudget(user.uid, existing.id, { ...data, workspaceId: activeWorkspaceId }, { workspaceId: activeWorkspaceId })
      await reload()
      return existing.id
    }
    const id = await addBudget(user.uid, { ...data, workspaceId: activeWorkspaceId }, { workspaceId: activeWorkspaceId })
    await reload()
    return id
  }

  async function update(budgetId, data) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    if (!canEditBudget) throw new Error('Seu papel não permite alterar orçamento neste workspace')
    await updateBudget(user.uid, budgetId, { ...data, workspaceId: activeWorkspaceId }, { workspaceId: activeWorkspaceId })
    await reload()
  }

  async function remove(budgetId) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    if (!canEditBudget) throw new Error('Seu papel não permite alterar orçamento neste workspace')
    await deleteBudget(user.uid, budgetId, { workspaceId: activeWorkspaceId })
    await reload()
  }

  const totalBudgeted = budgetItems.reduce((s, b) => s + (b.plannedAmount || 0), 0)
  const totalSpent    = budgetItems.reduce((s, b) => s + (b.spent        || 0), 0)
  const actualIncome = budgetItems
    .filter((item) => item.type === 'income')
    .reduce((sum, item) => sum + Number(item.spent || 0), 0)
  const actualExpenses = budgetItems
    .filter((item) => item.type === 'expense')
    .reduce((sum, item) => sum + Number(item.spent || 0), 0)
  const actualInvestments = budgetItems
    .filter((item) => item.type === 'investment')
    .reduce((sum, item) => sum + Number(item.spent || 0), 0)
  const actualBalance = actualIncome - actualExpenses - actualInvestments

  return {
    budgetItems,
    loading,
    error,
    reload,
    add,
    update,
    remove,
    totalBudgeted,
    totalSpent,
    actualIncome,
    actualExpenses,
    actualInvestments,
    actualBalance,
    permissions: { ...permissions, canEditBudget },
  }
}
