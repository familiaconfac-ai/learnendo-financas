function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeRecurringDescription(value) {
  return normalizeText(value)
    .replace(/\bparcela\s+\d{1,2}\s*\/\s*\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function amountClose(a, b, tolerance = 0.01) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance
}

function sameTarget(row, existing, options) {
  if (options.importType === 'invoice') {
    return !!options.cardId && existing.cardId === options.cardId
  }
  if (options.importType === 'bank') {
    return !!options.accountId && existing.accountId === options.accountId
  }
  return false
}

function sameMonth(row, existing, options) {
  const targetMonth = String(options.targetMonth || row?.competencyMonth || row?.date || '').slice(0, 7)
  const existingMonth = String(existing?.competencyMonth || existing?.date || '').slice(0, 7)
  return !!targetMonth && targetMonth === existingMonth
}

function extractInstallmentNumber(value) {
  const match = String(value || '').match(/\bparcela\s+(\d{1,2})\s*\/\s*(\d{1,2})\b/i)
  if (!match) return null
  return {
    current: Number(match[1]),
    total: Number(match[2]),
  }
}

function descriptionsReferToSamePurchase(rowDescription, existingDescription) {
  const rowExact = normalizeText(rowDescription)
  const existingExact = normalizeText(existingDescription)
  if (rowExact && rowExact === existingExact) return true

  const rowInstallment = extractInstallmentNumber(rowDescription)
  const existingInstallment = extractInstallmentNumber(existingDescription)
  const rowBase = normalizeRecurringDescription(rowDescription)
  const existingBase = normalizeRecurringDescription(existingDescription)

  if (!rowBase || rowBase !== existingBase) return false

  if (!rowInstallment && !existingInstallment) return true
  if (!rowInstallment || !existingInstallment) return false

  return rowInstallment.current === existingInstallment.current
    && rowInstallment.total === existingInstallment.total
}

export function findImportedTransactionDuplicateCandidate(row, existingTransactions, options = {}) {
  for (const existing of Array.isArray(existingTransactions) ? existingTransactions : []) {
    if (!existing) continue
    if (String(existing.status || '').toLowerCase() === 'pending') continue
    if (!sameTarget(row, existing, options)) continue
    if (!sameMonth(row, existing, options)) continue
    if (!amountClose(row?.amount, existing.amount)) continue
    if (!descriptionsReferToSamePurchase(row?.description, existing.description)) continue

    return {
      id: existing.id || null,
      description: existing.description || '',
      competencyMonth: String(existing.competencyMonth || existing.date || '').slice(0, 7),
      amount: Number(existing.amount || 0),
      recurringId: existing.recurringId || null,
    }
  }

  return null
}
