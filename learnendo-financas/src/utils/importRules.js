function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasCurrencyValue(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string' && value.trim() === '') return false
  return Number.isFinite(Number(value))
}

function uniqueHints(values) {
  return [...new Set(values.filter(Boolean))]
}

function mergeCategoryHints(currentHints = [], nextHints = []) {
  return uniqueHints([...(Array.isArray(currentHints) ? currentHints : []), ...nextHints])
}

function hasAnyKeyword(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword))
}

function hasHolderNameMatch(description, holderName) {
  const normalizedDescription = normalize(description)
  const holderTokens = normalize(holderName)
    .split(' ')
    .filter((token) => token.length >= 3)

  if (!normalizedDescription || holderTokens.length === 0) return false

  const matchedTokens = holderTokens.filter((token) => normalizedDescription.includes(token))
  return matchedTokens.length >= Math.min(2, holderTokens.length)
}

function resolveBalanceAdjustmentValue(row) {
  if (hasCurrencyValue(row?.balance)) return Number(row.balance)
  if (hasCurrencyValue(row?.amount)) return Number(row.amount)
  return null
}

function resolveBalanceAdjustmentReason(row, holderName) {
  const normalizedDescription = normalize(row?.description)
  if (hasHolderNameMatch(row?.description, holderName)) return 'holder_name_match'
  if (hasAnyKeyword(normalizedDescription, BALANCE_ADJUSTMENT_KEYWORDS)) return 'financial_balance_line'
  return 'manual_balance_adjustment'
}

const BALANCE_ADJUSTMENT_KEYWORDS = [
  'rendimento liquido',
  'rend liquido',
]

const INVOICE_PAYMENT_KEYWORDS = [
  'pagamento de fatura',
  'pagamento fatura',
  'pagt fatura',
  'pgto fatura',
]

const FINANCIAL_INCOME_KEYWORDS = [
  'rendimento',
  'rend liquido',
  'rendimentos',
]

export function handleImport(data, options = {}) {
  const rows = Array.isArray(data) ? data : []
  const baseSummary = options.statementSummary && typeof options.statementSummary === 'object'
    ? options.statementSummary
    : null
  const holderName = options.holderName || baseSummary?.holderName || ''
  const balanceAdjustments = []
  const importedRows = []

  let currentBalance = hasCurrencyValue(baseSummary?.closingBalance)
    ? Number(baseSummary.closingBalance)
    : null

  rows.forEach((row) => {
    const normalizedDescription = normalize(row?.description)

    const isBalanceAdjustment = hasHolderNameMatch(row?.description, holderName)
      || hasAnyKeyword(normalizedDescription, BALANCE_ADJUSTMENT_KEYWORDS)

    if (isBalanceAdjustment) {
      const balanceValue = resolveBalanceAdjustmentValue(row)
      const reason = resolveBalanceAdjustmentReason(row, holderName)
      if (hasCurrencyValue(balanceValue)) currentBalance = Number(balanceValue)
      balanceAdjustments.push({
        ...row,
        importRule: 'balance_adjustment',
        adjustmentReason: reason,
        convertedBalance: hasCurrencyValue(balanceValue) ? Number(balanceValue) : null,
      })
      return
    }

    const nextRow = { ...row }

    if (hasAnyKeyword(normalizedDescription, INVOICE_PAYMENT_KEYWORDS)) {
      nextRow.type = 'expense'
      nextRow.direction = 'debit'
      nextRow.transactionNatureId = 'nature_invoice_payment'
      nextRow.affectsBudget = false
      nextRow.balanceImpact = true
      nextRow.categoryName = 'Cartão de Crédito'
      nextRow.categoryHints = mergeCategoryHints(nextRow.categoryHints, [
        'Cartão de Crédito',
        'Cartao de Credito',
        'Cartão',
        'Cartao',
        'Fatura',
      ])
      nextRow.classification = {
        confidence: 'high',
        reason: 'invoice_payment_rule',
      }
      nextRow.status = 'confirmed'
      nextRow.importRule = 'invoice_payment'
    } else if (hasAnyKeyword(normalizedDescription, FINANCIAL_INCOME_KEYWORDS)) {
      nextRow.type = 'income'
      nextRow.direction = nextRow.direction === 'debit' ? 'debit' : 'credit'
      nextRow.transactionNatureId = 'nature_income'
      nextRow.affectsBudget = true
      nextRow.balanceImpact = true
      nextRow.categoryName = 'Receitas Financeiras'
      nextRow.categoryHints = mergeCategoryHints(nextRow.categoryHints, [
        'Receitas Financeiras',
        'Receitas diversas',
        'Investimentos',
      ])
      nextRow.classification = {
        confidence: 'high',
        reason: 'financial_income_rule',
      }
      nextRow.status = 'confirmed'
      nextRow.importRule = 'financial_income'
    }

    importedRows.push(nextRow)
  })

  const summary = baseSummary
    ? {
        ...baseSummary,
        ...(hasCurrencyValue(currentBalance)
          ? {
              closingBalance: Number(currentBalance),
              hasBalanceInfo: true,
            }
          : {}),
      }
    : null

  return {
    rows: importedRows,
    summary,
    currentBalance,
    balanceAdjustments,
    auditEntries: balanceAdjustments.map((row) => ({
      type: 'auto_balance_adjustment',
      label: 'Ajuste Automático',
      source: row.source || 'bank_import',
      importRule: row.importRule || 'balance_adjustment',
      adjustmentReason: row.adjustmentReason || 'manual_balance_adjustment',
      description: row.description || 'Ajuste de saldo',
      date: row.date || null,
      amount: hasCurrencyValue(row.convertedBalance) ? Number(row.convertedBalance) : Number(row.amount || 0),
      rawAmount: Number(row.amount || 0),
      rawBalance: hasCurrencyValue(row.balance) ? Number(row.balance) : null,
    })),
  }
}
