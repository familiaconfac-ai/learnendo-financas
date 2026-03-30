function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
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

  if (debugTag) {
    console.log(`[FinanceSummary:${debugTag}]`, {
      count: source.length,
      receitas,
      despesas,
      investimentos,
      transferencias,
      saldo,
      pendingCount,
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
    console.log(`[BudgetSpentMap:${debugTag}]`, {
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
    console.log(`[ReceiptDetailAnalysis:${debugTag}]`, {
      txCount: source.length,
      detailCategories: Object.keys(byDetailCategory).length,
      importanceBuckets: Object.keys(byImportance).length,
    })
  }

  return { byDetailCategory, byImportance }
}

export function normalizedCategoryName(value) {
  return normalizeText(value)
}