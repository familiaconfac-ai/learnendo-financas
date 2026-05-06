import { detectCardCommitment } from './creditCardPlanning'

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

function amountClose(a, b, tolerance = 0.5) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance
}

function dayDistance(a, b) {
  const left = new Date(`${String(a || '').slice(0, 10)}T12:00:00`)
  const right = new Date(`${String(b || '').slice(0, 10)}T12:00:00`)
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return Number.POSITIVE_INFINITY
  return Math.abs(Math.round((left.getTime() - right.getTime()) / 86400000))
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

function buildCategoryPayload(existing) {
  return {
    categoryId: existing.categoryId || null,
    categoryName: existing.categoryName || null,
    subcategoryId: existing.subcategoryId || null,
    subcategoryName: existing.subcategoryName || null,
    recurringId: existing.recurringId || null,
    recurrenceType: existing.recurrenceType || existing.recurringType || null,
    recurringStartDate: existing.recurringStartDate || null,
    recurringEndDate: existing.recurringEndDate || null,
    totalInstallments: Number.isFinite(Number(existing.totalInstallments)) ? Number(existing.totalInstallments) : null,
    currentInstallment: Number.isFinite(Number(existing.currentInstallment)) ? Number(existing.currentInstallment) : null,
    installmentNumber: Number.isFinite(Number(existing.installmentNumber)) ? Number(existing.installmentNumber) : null,
    recurringMatchLabel: existing.description || '',
  }
}

export function findRecurringImportMatch(row, existingTransactions, options = {}) {
  const rowBase = normalizeRecurringDescription(row?.description)
  if (!rowBase) return null

  const rowCommitment = detectCardCommitment(row?.description || '')
  let best = null

  for (const existing of Array.isArray(existingTransactions) ? existingTransactions : []) {
    if (!existing) continue
    if (!sameTarget(row, existing, options)) continue

    const existingBase = normalizeRecurringDescription(existing.description)
    if (!existingBase) continue
    if (rowBase !== existingBase) continue

    let score = 0
    score += 8

    if (amountClose(row?.amount, existing.amount)) score += 3

    const days = dayDistance(row?.date, existing.date)
    if (days <= 35) score += 1

    if (existing.recurringId || existing.recurrenceType || existing.currentInstallment || existing.installmentNumber) {
      score += 3
    }

    const existingCommitment = detectCardCommitment(existing.description || '')
    if (rowCommitment?.recurrenceType && existingCommitment?.recurrenceType === rowCommitment.recurrenceType) {
      score += 2
    }
    if (rowCommitment?.totalInstallments && existingCommitment?.totalInstallments === rowCommitment.totalInstallments) {
      score += 2
    }

    if (!best || score > best.score || (score === best.score && days < best.days)) {
      best = {
        ...buildCategoryPayload(existing),
        score,
        days,
      }
    }
  }

  return best
}
