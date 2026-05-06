function normalizeAmount(value) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0
}

function dayDistance(a, b) {
  const left = new Date(`${String(a || '').slice(0, 10)}T12:00:00`)
  const right = new Date(`${String(b || '').slice(0, 10)}T12:00:00`)
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return Number.POSITIVE_INFINITY
  return Math.abs(Math.round((left.getTime() - right.getTime()) / 86400000))
}

function amountMatches(a, b, tolerance = 0.01) {
  return Math.abs(normalizeAmount(a) - normalizeAmount(b)) <= tolerance
}

export function findReceiptPlaceholderCandidate(receiptMeta, existingTransactions, options = {}) {
  const importPaymentOrigin = options.paymentOrigin || ''
  const cardId = options.cardId || ''
  const accountId = options.accountId || ''
  const receiptTotal = normalizeAmount(receiptMeta?.totalAmount)
  const receiptDate = String(receiptMeta?.purchaseDate || '').slice(0, 10)

  if (!receiptTotal || !receiptDate) return null

  let best = null

  for (const tx of Array.isArray(existingTransactions) ? existingTransactions : []) {
    if (!tx || tx.type !== 'expense') continue
    if (!tx.receiptPlaceholderEnabled) continue
    if (tx.receiptDetailEnabled) continue

    if (importPaymentOrigin === 'card') {
      if (!cardId || tx.cardId !== cardId) continue
    } else if (importPaymentOrigin === 'account') {
      if (!accountId || tx.accountId !== accountId) continue
    } else if (importPaymentOrigin === 'cash') {
      if (tx.paymentMethod !== 'cash') continue
    }

    if (!amountMatches(tx.amount, receiptTotal)) continue

    const distance = dayDistance(tx.date, receiptDate)
    if (distance > 10) continue

    if (!best || distance < best.distance) {
      best = {
        transactionId: tx.id,
        description: tx.description || '',
        amount: normalizeAmount(tx.amount),
        date: tx.date || '',
        distance,
      }
    }
  }

  return best
}
