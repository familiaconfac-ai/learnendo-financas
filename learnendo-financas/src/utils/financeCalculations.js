function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const FINANCE_DEBUG_ENABLED = import.meta.env.DEV && import.meta.env.VITE_ENABLE_FINANCE_DEBUG === 'true'

function logFinanceDebug(tag, payload) {
  if (!FINANCE_DEBUG_ENABLED || !tag) return
  console.log(tag, payload)
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function canonicalType(type) {
  return type === 'transfer_internal' ? 'transfer' : type
}

function impactsBudget(tx) {
  if (typeof tx.affectsBudget === 'boolean') return tx.affectsBudget
  return tx.balanceImpact !== false
}

function receiptItemsForBudget(tx) {
  if (!tx?.receiptDetailEnabled || !Array.isArray(tx.receiptItems) || tx.receiptItems.length === 0) {
    return []
  }
  return tx.receiptItems.filter((item) => Number(item.amount || 0) > 0)
}

function monthKey(value) {
  return String(value || '').slice(0, 7)
}

function addMonthsToMonthKey(monthKeyValue, offset) {
  const [year, month] = String(monthKeyValue || '').split('-').map(Number)
  if (!year || !month) return ''
  const target = new Date(year, month - 1 + offset, 1)
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`
}

function isSalaryNature(tx) {
  return tx?.transactionNatureId === 'nature_salary'
}

function isSalaryAdvanceNature(tx) {
  return tx?.transactionNatureId === 'nature_salary_advance'
}

export function calculateMonthlySummary(transactions, debugTag = '') {
  const source = Array.isArray(transactions) ? transactions : []
  const confirmedTransactions = source.filter((t) => t.status === 'confirmed')

  const receitas = confirmedTransactions
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + toNumber(t.amount), 0)

  const despesas = confirmedTransactions
    .filter((t) => t.type === 'expense' && impactsBudget(t))
    .reduce((sum, t) => sum + toNumber(t.amount), 0)

  const investimentos = confirmedTransactions
    .filter((t) => t.type === 'investment' && impactsBudget(t))
    .reduce((sum, t) => sum + toNumber(t.amount), 0)

  const transferencias = confirmedTransactions
    .filter((t) => canonicalType(t.type) === 'transfer')
    .reduce((sum, t) => sum + toNumber(t.amount), 0)

  const saldo = receitas - despesas - investimentos
  const pendingCount = source.filter((t) => t.status === 'pending').length

  const recentTransactions = [...confirmedTransactions].slice(0, 6)
  const salaryActual = confirmedTransactions
    .filter((t) => t.type === 'income' && isSalaryNature(t))
    .reduce((sum, t) => sum + toNumber(t.amount), 0)
  const salaryAdvancesReceived = confirmedTransactions
    .filter((t) => t.type === 'income' && isSalaryAdvanceNature(t))
    .reduce((sum, t) => sum + toNumber(t.amount), 0)

  if (debugTag) {
    logFinanceDebug(`[FinanceSummary:${debugTag}]`, {
      count: source.length,
      receitas,
      despesas,
      investimentos,
      transferencias,
      saldo,
      pendingCount,
      salaryActual,
      salaryAdvancesReceived,
    })
  }

  return {
    receitas,
    despesas,
    investimentos,
    transferencias,
    saldo,
    pendingCount,
    recentTransactions,
    salaryActual,
    salaryAdvancesReceived,
  }
}

export function buildSalaryInsight(currentMonthTransactions, linkedAdvanceTransactions = [], selectedMonthKey = '') {
  const currentList = Array.isArray(currentMonthTransactions) ? currentMonthTransactions : []
  const linkedList = Array.isArray(linkedAdvanceTransactions) ? linkedAdvanceTransactions : []
  const referenceMonthKey = monthKey(selectedMonthKey)

  const salaryReceived = currentList
    .filter((tx) => tx.status === 'confirmed' && tx.type === 'income' && isSalaryNature(tx))
    .filter((tx) => !referenceMonthKey || monthKey(tx.salaryReferenceMonth || tx.competencyMonth || tx.date) === referenceMonthKey)
    .reduce((sum, tx) => sum + toNumber(tx.amount), 0)

  const linkedAdvances = linkedList
    .filter((tx) => tx.status === 'confirmed' && tx.type === 'income' && isSalaryAdvanceNature(tx))
    .filter((tx) => !referenceMonthKey || monthKey(tx.salaryReferenceMonth) === referenceMonthKey)

  const advanceAmount = linkedAdvances.reduce((sum, tx) => sum + toNumber(tx.amount), 0)
  const grossSalary = salaryReceived + advanceAmount

  return {
    referenceMonth: referenceMonthKey,
    salaryReceived,
    advanceAmount,
    grossSalary,
    hasLinkedAdvance: linkedAdvances.length > 0,
    linkedAdvanceCount: linkedAdvances.length,
  }
}

export function buildBudgetSpentMap(transactions, debugTag = '') {
  const source = Array.isArray(transactions) ? transactions.filter((tx) => tx.status === 'confirmed') : []
  const spentByCategoryId = {}
  const spentByCategoryName = {}

  source.forEach((tx) => {
    if (!['income', 'expense', 'investment'].includes(tx.type)) return
    if (!impactsBudget(tx)) return

    const detailedItems = receiptItemsForBudget(tx)
    if (detailedItems.length > 0) {
      detailedItems.forEach((item) => {
        const type = tx.type
        const amount = Math.abs(toNumber(item.amount))
        if (!amount) return

        const byIdKey = `${type}::${item.budgetCategoryId || '__none__'}`
        spentByCategoryId[byIdKey] = (spentByCategoryId[byIdKey] || 0) + amount

        const normalizedBudgetCategoryName = normalizeText(item.budgetCategoryName)
        if (normalizedBudgetCategoryName) {
          const byNameKey = `${type}::${normalizedBudgetCategoryName}`
          spentByCategoryName[byNameKey] = (spentByCategoryName[byNameKey] || 0) + amount
        }
      })
      return
    }

    const type = tx.type
    const amount = Math.abs(toNumber(tx.amount))
    if (!amount) return

    const byIdKey = `${type}::${tx.categoryId || '__none__'}`
    spentByCategoryId[byIdKey] = (spentByCategoryId[byIdKey] || 0) + amount

    const normalizedCategoryName = normalizeText(tx.categoryName)
    if (normalizedCategoryName) {
      const byNameKey = `${type}::${normalizedCategoryName}`
      spentByCategoryName[byNameKey] = (spentByCategoryName[byNameKey] || 0) + amount
    }
  })

  if (debugTag) {
    logFinanceDebug(`[BudgetSpentMap:${debugTag}]`, {
      txCount: source.length,
      byIdKeys: Object.keys(spentByCategoryId).length,
      byNameKeys: Object.keys(spentByCategoryName).length,
    })
  }

  return { spentByCategoryId, spentByCategoryName }
}

export function buildReceiptDetailAnalysis(transactions, debugTag = '') {
  const source = Array.isArray(transactions) ? transactions.filter((tx) => tx.status === 'confirmed') : []
  const byDetailCategory = {}
  const byImportance = {}

  source.forEach((tx) => {
    receiptItemsForBudget(tx).forEach((item) => {
      const amount = Math.abs(toNumber(item.amount))
      if (!amount) return
      const categoryKey = item.detailCategoryKey || 'outros'
      const importanceKey = item.importance || 'essential'
      byDetailCategory[categoryKey] = (byDetailCategory[categoryKey] || 0) + amount
      byImportance[importanceKey] = (byImportance[importanceKey] || 0) + amount
    })
  })

  if (debugTag) {
    logFinanceDebug(`[ReceiptDetailAnalysis:${debugTag}]`, {
      txCount: source.length,
      detailCategories: Object.keys(byDetailCategory).length,
      importanceBuckets: Object.keys(byImportance).length,
    })
  }

  return { byDetailCategory, byImportance }
}

export function buildReceiptBudgetImportanceBreakdown(transactions, debugTag = '') {
  const source = Array.isArray(transactions) ? transactions.filter((tx) => tx.status === 'confirmed') : []
  const totalsByImportance = {
    essential: 0,
    necessary: 0,
    superfluous: 0,
  }
  const categories = new Map()

  source.forEach((tx) => {
    receiptItemsForBudget(tx).forEach((item) => {
      const amount = Math.abs(toNumber(item.amount))
      if (!amount) return

      const importance = item.importance === 'superfluous'
        ? 'superfluous'
        : item.importance === 'necessary'
          ? 'necessary'
          : 'essential'
      const name = item.budgetCategoryName || tx.categoryName || 'Sem categoria'
      const key = normalizeText(item.budgetCategoryId || name) || 'sem_categoria'
      const current = categories.get(key) || {
        key,
        name,
        total: 0,
        essential: 0,
        necessary: 0,
        superfluous: 0,
      }

      current.total += amount
      current[importance] += amount
      categories.set(key, current)
      totalsByImportance[importance] += amount
    })
  })

  const sortedCategories = [...categories.values()].sort((a, b) => b.total - a.total)
  const totalDetailed = sortedCategories.reduce((sum, item) => sum + item.total, 0)

  if (debugTag) {
    logFinanceDebug(`[ReceiptBudgetImportance:${debugTag}]`, {
      txCount: source.length,
      categories: sortedCategories.length,
      totalDetailed,
    })
  }

  return {
    categories: sortedCategories,
    totalsByImportance,
    totalDetailed,
  }
}

export function normalizedCategoryName(value) {
  return normalizeText(value)
}

function getAccountMonthOpeningBalance(account, selectedMonthKey) {
  const monthlyOpeningBalance = account?.monthlyOpeningBalances?.[selectedMonthKey]
  if (Number.isFinite(Number(monthlyOpeningBalance))) return Number(monthlyOpeningBalance)
  if (Number.isFinite(Number(account?.lastStatementOpeningBalance))) return Number(account.lastStatementOpeningBalance)
  if (Number.isFinite(Number(account?.initialBalance))) return Number(account.initialBalance)
  if (Number.isFinite(Number(account?.balance))) return Number(account.balance)
  return 0
}

function getAccountMonthActualClosingBalance(account, selectedMonthKey) {
  const nextMonthKey = addMonthsToMonthKey(selectedMonthKey, 1)
  const nextMonthOpening = account?.monthlyOpeningBalances?.[nextMonthKey]
  if (Number.isFinite(Number(nextMonthOpening))) return Number(nextMonthOpening)
  if (Number.isFinite(Number(account?.lastStatementClosingBalance))) return Number(account.lastStatementClosingBalance)
  if (Number.isFinite(Number(account?.current_balance))) return Number(account.current_balance)
  if (Number.isFinite(Number(account?.balance))) return Number(account.balance)
  return null
}

function transactionImpactsAccountBalance(tx) {
  if (tx?.type === 'transfer_internal') return true
  return tx?.balanceImpact !== false
}

function transactionSignedAmountForAccount(tx, accountId) {
  const amount = Math.abs(toNumber(tx?.amount))
  if (!amount) return 0

  if (tx?.type === 'transfer_internal') {
    if (tx?.accountId === accountId) return -amount
    if (tx?.toAccountId === accountId) return amount
    return 0
  }

  if (tx?.accountId !== accountId) return 0
  if (!transactionImpactsAccountBalance(tx)) return 0
  if (tx?.type === 'income') return amount
  return -amount
}

export function buildAccountReconciliation(account, transactions = [], selectedMonthKey = '') {
  if (!account) return null

  const source = Array.isArray(transactions) ? transactions : []
  const confirmedTransactions = source.filter((tx) => tx?.status === 'confirmed')
  const pendingTransactions = source.filter((tx) => tx?.status === 'pending')
  const openingBalance = getAccountMonthOpeningBalance(account, selectedMonthKey)
  const actualClosingBalance = getAccountMonthActualClosingBalance(account, selectedMonthKey)
  const signedMovements = confirmedTransactions.map((tx) => transactionSignedAmountForAccount(tx, account.id))

  const netMovement = signedMovements.reduce((sum, amount) => sum + amount, 0)
  const expectedClosingBalance = openingBalance + netMovement
  const difference = actualClosingBalance === null
    ? null
    : Number((actualClosingBalance - expectedClosingBalance).toFixed(2))

  const incomeTotal = confirmedTransactions
    .filter((tx) => transactionSignedAmountForAccount(tx, account.id) > 0)
    .reduce((sum, tx) => sum + transactionSignedAmountForAccount(tx, account.id), 0)
  const outgoingTransactions = confirmedTransactions
    .map((tx) => ({ tx, signedAmount: transactionSignedAmountForAccount(tx, account.id) }))
    .filter(({ signedAmount }) => signedAmount < 0)
  const expenseAndInvestmentTotal = outgoingTransactions
    .filter(({ tx }) => tx.type === 'expense' || tx.type === 'investment')
    .reduce((sum, { signedAmount }) => sum + Math.abs(signedAmount), 0)
  const transferTotal = outgoingTransactions
    .filter(({ tx }) => canonicalType(tx.type) === 'transfer')
    .reduce((sum, { signedAmount }) => sum + Math.abs(signedAmount), 0)

  const relatedPendingTransactions = pendingTransactions.filter((tx) => {
    if (tx?.type === 'transfer_internal') return tx?.accountId === account.id || tx?.toAccountId === account.id
    return tx?.accountId === account.id
  })

  return {
    accountId: account.id,
    accountName: account.name || 'Conta',
    monthKey: selectedMonthKey,
    openingBalance,
    expectedClosingBalance,
    actualClosingBalance,
    difference,
    reconciled: difference !== null ? Math.abs(difference) < 0.01 : false,
    hasSnapshot: actualClosingBalance !== null,
    totalIncome: incomeTotal,
    totalExpenses: expenseAndInvestmentTotal,
    totalTransfers: transferTotal,
    netMovement,
    pendingTransactions: relatedPendingTransactions,
    pendingCount: relatedPendingTransactions.length,
  }
}

export function buildAccountsReconciliation(accounts = [], transactions = [], selectedMonthKey = '') {
  return (Array.isArray(accounts) ? accounts : [])
    .map((account) => buildAccountReconciliation(account, transactions, selectedMonthKey))
    .filter(Boolean)
}
