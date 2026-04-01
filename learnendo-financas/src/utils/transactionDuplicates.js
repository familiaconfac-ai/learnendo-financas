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

function normalizeType(type) {
  return type === 'transfer_internal' ? 'transfer' : type
}

function normalizeDuplicateOptions(accountIdOverrideOrOptions = null) {
  if (accountIdOverrideOrOptions && typeof accountIdOverrideOrOptions === 'object' && !Array.isArray(accountIdOverrideOrOptions)) {
    return {
      accountIdOverride: accountIdOverrideOrOptions.accountIdOverride ?? null,
      cardIdOverride: accountIdOverrideOrOptions.cardIdOverride ?? null,
    }
  }

  return {
    accountIdOverride: accountIdOverrideOrOptions,
    cardIdOverride: null,
  }
}

function resolveDuplicateTarget(tx, overrides = {}) {
  if (overrides.cardIdOverride) return `card:${overrides.cardIdOverride}`
  if (overrides.accountIdOverride) return `account:${overrides.accountIdOverride}`
  if (tx?.cardId) return `card:${tx.cardId}`
  if (tx?.accountId) return `account:${tx.accountId}`
  return ''
}

function sharedTokenCount(a, b) {
  const tokensA = new Set(normalizeText(a).split(' ').filter((t) => t.length >= 3))
  const tokensB = new Set(normalizeText(b).split(' ').filter((t) => t.length >= 3))
  let count = 0
  tokensA.forEach((token) => {
    if (tokensB.has(token)) count++
  })
  return count
}

export function buildDuplicateSignature(tx, accountIdOverrideOrOptions = null) {
  const overrides = normalizeDuplicateOptions(accountIdOverrideOrOptions)
  const targetKey = resolveDuplicateTarget(tx, overrides)
  return [
    tx.date ?? '',
    normalizeType(tx.type) ?? '',
    toNumber(tx.amount).toFixed(2),
    normalizeText(tx.description),
    targetKey,
  ].join('::')
}

export function isPossibleDuplicate(candidate, existing, accountIdOverrideOrOptions = null) {
  const overrides = normalizeDuplicateOptions(accountIdOverrideOrOptions)
  const candidateTarget = resolveDuplicateTarget(candidate, overrides)
  const existingTarget = resolveDuplicateTarget(existing)
  if (candidateTarget && existingTarget && candidateTarget !== existingTarget) return false

  if ((candidate.date ?? '') !== (existing.date ?? '')) return false
  if (normalizeType(candidate.type) !== normalizeType(existing.type)) return false
  if (Math.abs(toNumber(candidate.amount) - toNumber(existing.amount)) > 0.009) return false

  const candDesc = normalizeText(candidate.description)
  const exDesc = normalizeText(existing.description)
  if (!candDesc || !exDesc) return true
  if (candDesc === exDesc) return true
  if (candDesc.includes(exDesc) || exDesc.includes(candDesc)) return true
  return sharedTokenCount(candDesc, exDesc) >= 2
}

export function findDuplicateMatches(candidate, existingTransactions, options = {}) {
  const list = Array.isArray(existingTransactions) ? existingTransactions : []
  const ignoreId = options.ignoreId ?? null
  const overrides = {
    accountIdOverride: options.accountIdOverride ?? null,
    cardIdOverride: options.cardIdOverride ?? null,
  }

  const candidateSignature = buildDuplicateSignature(candidate, overrides)
  const exact = []
  const possible = []

  list.forEach((tx) => {
    if (ignoreId && tx.id === ignoreId) return
    const txSignature = buildDuplicateSignature(tx)
    if (txSignature === candidateSignature) {
      exact.push(tx)
      return
    }
    if (isPossibleDuplicate(candidate, tx, overrides)) {
      possible.push(tx)
    }
  })

  return {
    exact,
    possible,
    isExactDuplicate: exact.length > 0,
    hasPossibleDuplicate: possible.length > 0,
  }
}
