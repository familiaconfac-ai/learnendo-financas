function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function amountMatches(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= 0.009
}

function dayDistance(a, b) {
  const left = new Date(`${String(a || '').slice(0, 10)}T12:00:00`)
  const right = new Date(`${String(b || '').slice(0, 10)}T12:00:00`)
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return Number.POSITIVE_INFINITY
  return Math.abs(Math.round((left.getTime() - right.getTime()) / 86400000))
}

function buildReceiptBatchGroups(existingTransactions = []) {
  const groups = new Map()

  for (const tx of Array.isArray(existingTransactions) ? existingTransactions : []) {
    if (!tx || tx.type !== 'expense') continue
    if (!tx.receiptBatchId) continue

    const group = groups.get(tx.receiptBatchId) || {
      receiptBatchId: tx.receiptBatchId,
      transactions: [],
      totalAmount: Number(tx.receiptBatchTotal || 0),
      itemCount: Number(tx.receiptBatchItemCount || 0),
      cardId: tx.cardId || null,
      accountId: tx.accountId || null,
      paymentMethod: tx.paymentMethod || '',
      receiptPaymentMethod: tx.receiptPaymentMethod || '',
      merchantName: tx.receiptBatchMerchantName || '',
      firstDate: tx.receiptBatchDate || tx.date || '',
      lastDate: tx.date || tx.receiptBatchDate || '',
    }

    group.transactions.push(tx)
    if (!(group.totalAmount > 0)) {
      group.totalAmount += Math.abs(Number(tx.amount || 0))
    }
    if (!(group.itemCount > 0)) {
      group.itemCount = group.transactions.length
    }
    if (!group.firstDate || String(tx.date || '') < group.firstDate) group.firstDate = tx.date || group.firstDate
    if (!group.lastDate || String(tx.date || '') > group.lastDate) group.lastDate = tx.date || group.lastDate
    if (!group.cardId && tx.cardId) group.cardId = tx.cardId
    if (!group.accountId && tx.accountId) group.accountId = tx.accountId
    if (!group.paymentMethod && tx.paymentMethod) group.paymentMethod = tx.paymentMethod
    if (!group.receiptPaymentMethod && tx.receiptPaymentMethod) group.receiptPaymentMethod = tx.receiptPaymentMethod
    if (!group.merchantName && tx.receiptBatchMerchantName) group.merchantName = tx.receiptBatchMerchantName

    groups.set(tx.receiptBatchId, group)
  }

  return [...groups.values()]
}

function scoreMatch(row, group, importType) {
  let score = 0
  if (amountMatches(row?.amount, group.totalAmount)) score += 8

  const rowDate = String(row?.date || '').slice(0, 10)
  const firstDays = dayDistance(rowDate, group.firstDate)
  const lastDays = dayDistance(rowDate, group.lastDate)
  const minDays = Math.min(firstDays, lastDays)
  if (minDays <= 3) score += 3
  else if (minDays <= 10) score += 2
  else if (minDays <= 35) score += 1

  const rowDesc = normalizeText(row?.description)
  const merchant = normalizeText(group.merchantName)
  if (rowDesc && merchant && (rowDesc.includes(merchant) || merchant.includes(rowDesc))) score += 2

  if (importType === 'invoice' && group.receiptPaymentMethod === 'card') score += 2
  if (importType === 'bank' && group.receiptPaymentMethod === 'account') score += 2

  return { score, minDays }
}

export function findReceiptPaymentReconciliationCandidate(row, existingTransactions, options = {}) {
  const importType = options.importType || 'invoice'
  const cardId = options.cardId || ''
  const accountId = options.accountId || ''
  const groups = buildReceiptBatchGroups(existingTransactions)

  let best = null

  for (const group of groups) {
    if (importType === 'invoice') {
      if (!cardId || group.cardId !== cardId) continue
    } else if (importType === 'bank') {
      if (!accountId || group.accountId !== accountId) continue
    } else {
      continue
    }

    if (!amountMatches(row?.amount, group.totalAmount)) continue

    const scored = scoreMatch(row, group, importType)
    const minScore = importType === 'invoice' ? 9 : 10
    if (scored.score < minScore) continue

    if (!best || scored.score > best.score || (scored.score === best.score && scored.minDays < best.minDays)) {
      best = {
        receiptBatchId: group.receiptBatchId,
        merchantName: group.merchantName || 'Cupom detalhado',
        totalAmount: group.totalAmount,
        itemCount: group.itemCount,
        score: scored.score,
        minDays: scored.minDays,
        transactions: group.transactions,
      }
    }
  }

  return best
}
