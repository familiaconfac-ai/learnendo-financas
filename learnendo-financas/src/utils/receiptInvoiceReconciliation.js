function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bcupom\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sharedTokenCount(a, b) {
  const tokensA = new Set(normalizeText(a).split(' ').filter((token) => token.length >= 3))
  const tokensB = new Set(normalizeText(b).split(' ').filter((token) => token.length >= 3))
  let count = 0
  tokensA.forEach((token) => {
    if (tokensB.has(token)) count += 1
  })
  return count
}

function sameCalendarDate(a, b) {
  return String(a || '').slice(0, 10) === String(b || '').slice(0, 10)
}

function dayDistance(a, b) {
  const left = new Date(String(a || '').slice(0, 10))
  const right = new Date(String(b || '').slice(0, 10))
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return Number.POSITIVE_INFINITY
  return Math.abs(Math.round((left.getTime() - right.getTime()) / 86400000))
}

function amountMatches(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= 0.009
}

function resolveCardId(tx, cardIdOverride) {
  return cardIdOverride || tx?.cardId || ''
}

function scoreReceiptMatch(invoiceRow, existingTx) {
  const invoiceDesc = normalizeText(invoiceRow?.description)
  const existingDesc = normalizeText(existingTx?.description)
  const tokensInCommon = sharedTokenCount(invoiceDesc, existingDesc)
  const days = dayDistance(invoiceRow?.date, existingTx?.date)

  let score = 0
  if (invoiceDesc && existingDesc && invoiceDesc === existingDesc) score += 5
  else if (invoiceDesc && existingDesc && (invoiceDesc.includes(existingDesc) || existingDesc.includes(invoiceDesc))) score += 4
  else if (tokensInCommon >= 2) score += 3
  else if (tokensInCommon >= 1) score += 1

  if (sameCalendarDate(invoiceRow?.date, existingTx?.date)) score += 3
  else if (days <= 3) score += 2
  else if (days <= 7) score += 1

  if (existingTx?.receiptDetailEnabled) score += 2
  if (existingTx?.reconciledWithInvoice) score -= 4

  return { score, days, tokensInCommon }
}

export function findReceiptInvoiceReconciliationCandidate(invoiceRow, existingTransactions, options = {}) {
  const list = Array.isArray(existingTransactions) ? existingTransactions : []
  const cardIdOverride = options.cardIdOverride || ''
  const maxDays = Number(options.maxDays || 7)
  const minScore = Number(options.minScore || 4)

  let best = null

  list.forEach((tx) => {
    if (!tx) return
    if (tx.type !== 'expense') return
    if (!amountMatches(invoiceRow?.amount, tx.amount)) return

    const candidateCardId = resolveCardId(invoiceRow, cardIdOverride)
    const existingCardId = resolveCardId(tx, '')
    if (!candidateCardId || !existingCardId || candidateCardId !== existingCardId) return

    const days = dayDistance(invoiceRow?.date, tx.date)
    if (days > maxDays) return

    const looksLikeReceiptLaunch = tx.receiptDetailEnabled || tx.origin === 'manual'
    if (!looksLikeReceiptLaunch) return

    const scored = scoreReceiptMatch(invoiceRow, tx)
    if (scored.score < minScore) return

    if (!best || scored.score > best.score || (scored.score === best.score && scored.days < best.days)) {
      best = {
        transaction: tx,
        score: scored.score,
        days: scored.days,
        tokensInCommon: scored.tokensInCommon,
      }
    }
  })

  return best
}
