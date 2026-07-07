import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { normalizePaymentMethodId } from '../constants/transactionPaymentMethods'

function debtsCol(workspaceId) {
  return collection(db, 'workspaces', workspaceId, 'debts')
}

function debtDoc(workspaceId, debtId) {
  return doc(db, 'workspaces', workspaceId, 'debts', debtId)
}

function txCol(workspaceId) {
  return collection(db, 'workspaces', workspaceId, 'transactions')
}

function toAmount(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, numeric)
}

function roundCurrency(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function normalizeOptionalString(value) {
  const text = String(value || '').trim()
  return text || null
}

function normalizeExternalDebtDirection(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_')
  if (normalized === 'contact_owes_me') return 'contact_owes_me'
  return 'i_owe_contact'
}

function invertExternalDebtDirection(value) {
  return normalizeExternalDebtDirection(value) === 'contact_owes_me'
    ? 'i_owe_contact'
    : 'contact_owes_me'
}

const DEFAULT_LOAN_INTEREST_RATE = 1.5
const DAY_IN_MS = 24 * 60 * 60 * 1000

function toMillis(value) {
  if (!value) return 0
  if (typeof value?.toDate === 'function') {
    return value.toDate().getTime()
  }
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeInterestRate(value, debt = null) {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return numeric
  if (String(debt?.reasonType || '').trim().toLowerCase() === 'emprestimo') {
    return DEFAULT_LOAN_INTEREST_RATE
  }
  return 0
}

function normalizeDebtStatus(value) {
  if (value === 'pending_confirmation') return 'pending_confirmation'
  if (value === 'settled') return 'settled'
  return 'open'
}

function isPendingDebtConfirmation(debt) {
  return normalizeDebtStatus(debt?.status) === 'pending_confirmation'
}

function getDebtConfirmedAtSource(debt) {
  return debt?.loanConfirmedAt || debt?.receiptConfirmedAt || debt?.confirmedAt || debt?.createdAt || null
}

function accrueInterestUntil(principalRemainingAmount, accruedInterestAmount, interestRate, lastAccruedAtMs, nextAccrualMs) {
  if (!interestRate || principalRemainingAmount <= 0 || !lastAccruedAtMs || !nextAccrualMs || nextAccrualMs <= lastAccruedAtMs) {
    return {
      accruedInterestAmount: roundCurrency(accruedInterestAmount),
      lastAccruedAtMs,
    }
  }

  const elapsedDays = (nextAccrualMs - lastAccruedAtMs) / DAY_IN_MS
  const nextAccruedInterestAmount = roundCurrency(
    accruedInterestAmount + (principalRemainingAmount * (interestRate / 100) * (elapsedDays / 30)),
  )

  return {
    accruedInterestAmount: nextAccruedInterestAmount,
    lastAccruedAtMs: nextAccrualMs,
  }
}

function buildDebtBalanceSnapshot(debt, payments = [], nowMs = Date.now()) {
  const normalizedStatus = normalizeDebtStatus(debt?.status)
  const interestRate = normalizeInterestRate(debt?.interestRate, debt)
  const originalAmount = roundCurrency(toAmount(debt?.originalAmount || debt?.totalAmount))
  const confirmedAtSource = getDebtConfirmedAtSource(debt)
  const confirmedAtMs = toMillis(confirmedAtSource)

  if (normalizedStatus === 'pending_confirmation') {
    return {
      status: 'pending_confirmation',
      interestRate,
      originalAmount,
      totalAmount: originalAmount,
      paidAmount: 0,
      paidPrincipalAmount: 0,
      principalRemainingAmount: originalAmount,
      accruedInterestAmount: 0,
      remainingAmount: originalAmount,
      confirmedAt: null,
      interestAccruedThrough: null,
    }
  }

  let principalRemainingAmount = originalAmount
  const initialPaidPrincipalAmount = roundCurrency(Math.min(originalAmount, toAmount(debt?.initialPaidAmount || 0)))
  principalRemainingAmount = roundCurrency(Math.max(0, originalAmount - initialPaidPrincipalAmount))
  let accruedInterestAmount = 0
  let lastAccruedAtMs = confirmedAtMs || nowMs

  const sortedPayments = [...payments]
    .filter((payment) => toAmount(payment?.amount) > 0)
    .sort((a, b) => {
      const diff = toMillis(a?.date || a?.confirmedAt || a?.createdAt) - toMillis(b?.date || b?.confirmedAt || b?.createdAt)
      if (diff !== 0) return diff
      return String(a?.id || '').localeCompare(String(b?.id || ''))
    })

  for (const payment of sortedPayments) {
    const paymentMs = toMillis(payment?.date || payment?.confirmedAt || payment?.createdAt) || lastAccruedAtMs
    const accrued = accrueInterestUntil(
      principalRemainingAmount,
      accruedInterestAmount,
      interestRate,
      lastAccruedAtMs,
      paymentMs,
    )
    accruedInterestAmount = accrued.accruedInterestAmount
    lastAccruedAtMs = accrued.lastAccruedAtMs || paymentMs

    let paymentLeft = roundCurrency(toAmount(payment.amount))
    const principalApplied = Math.min(paymentLeft, principalRemainingAmount)
    principalRemainingAmount = roundCurrency(principalRemainingAmount - principalApplied)
    paymentLeft = roundCurrency(paymentLeft - principalApplied)

    const interestApplied = Math.min(paymentLeft, accruedInterestAmount)
    accruedInterestAmount = roundCurrency(accruedInterestAmount - interestApplied)
    paymentLeft = roundCurrency(paymentLeft - interestApplied)
  }

  const accruedToNow = accrueInterestUntil(
    principalRemainingAmount,
    accruedInterestAmount,
    interestRate,
    lastAccruedAtMs,
    nowMs,
  )
  accruedInterestAmount = accruedToNow.accruedInterestAmount
  lastAccruedAtMs = accruedToNow.lastAccruedAtMs || lastAccruedAtMs

  const paidPrincipalAmount = roundCurrency(initialPaidPrincipalAmount + (originalAmount - initialPaidPrincipalAmount - principalRemainingAmount))
  const remainingAmount = roundCurrency(principalRemainingAmount + accruedInterestAmount)

  return {
    status: remainingAmount > 0 ? 'open' : 'settled',
    interestRate,
    originalAmount,
    totalAmount: originalAmount,
    paidAmount: paidPrincipalAmount,
    paidPrincipalAmount,
    principalRemainingAmount,
    accruedInterestAmount,
    remainingAmount,
    confirmedAt: confirmedAtSource,
    interestAccruedThrough: lastAccruedAtMs ? new Date(lastAccruedAtMs).toISOString() : null,
  }
}

function buildDebtInterestSnapshot(debt, nowMs = Date.now()) {
  return buildDebtBalanceSnapshot(debt, buildConfirmedPaymentReplayEntries(debt, []), nowMs)
}

function decorateDebtWithInterest(debt, nowMs = Date.now()) {
  const interestSnapshot = buildDebtBalanceSnapshot(debt, buildConfirmedPaymentReplayEntries(debt, []), nowMs)
  return {
    ...debt,
    status: interestSnapshot.status,
    interestRate: interestSnapshot.interestRate || null,
    originalAmount: interestSnapshot.originalAmount,
    totalAmount: interestSnapshot.totalAmount,
    paidAmount: interestSnapshot.paidPrincipalAmount,
    paidPrincipalAmount: interestSnapshot.paidPrincipalAmount,
    principalRemainingAmount: interestSnapshot.principalRemainingAmount,
    remainingAmount: interestSnapshot.remainingAmount,
    accruedInterestAmount: interestSnapshot.accruedInterestAmount,
    loanConfirmedAt: debt?.loanConfirmedAt || interestSnapshot.confirmedAt,
    interestAccruedThrough: interestSnapshot.interestAccruedThrough,
  }
}

function normalizeFamilyReasonType(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'troca_operacional') return 'troca_operacional'
  if (normalized === 'cartao_familia') return 'cartao_familia'
  if (normalized === 'ajuste') return 'ajuste'
  return 'emprestimo'
}

function createSettlementId() {
  const randomPart = Math.random().toString(36).slice(2, 8)
  return `settlement_${Date.now()}_${randomPart}`
}

function normalizeSettlementStatus(value) {
  if (value === 'confirmed') return 'confirmed'
  if (value === 'cancelled') return 'cancelled'
  return 'pending'
}

function settlementSortValue(entry) {
  const value = entry?.confirmedAt || entry?.cancelledAt || entry?.createdAt || entry?.date || ''
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function normalizeDebtSettlements(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((entry, index) => {
      const amount = toAmount(entry?.amount)
      if (!amount) return null

      return {
        id: String(entry?.id || createSettlementId() || `settlement_${index}`),
        amount,
        status: normalizeSettlementStatus(entry?.status),
        createdAt: entry?.createdAt || entry?.date || new Date().toISOString(),
        createdByUid: normalizeOptionalString(entry?.createdByUid),
        createdByName: normalizeOptionalString(entry?.createdByName),
        confirmedAt: entry?.confirmedAt || null,
        confirmedByUid: normalizeOptionalString(entry?.confirmedByUid),
        cancelledAt: entry?.cancelledAt || null,
        cancelledByUid: normalizeOptionalString(entry?.cancelledByUid),
        paymentMethod: normalizePaymentMethodId(entry?.paymentMethod) || 'pix',
        accountId: normalizeOptionalString(entry?.accountId),
        cardId: normalizeOptionalString(entry?.cardId),
        cardName: normalizeOptionalString(entry?.cardName),
        note: normalizeOptionalString(entry?.note),
        linkedTransactionId: normalizeOptionalString(entry?.linkedTransactionId),
        linkedTransactionCreatedAt: entry?.linkedTransactionCreatedAt || null,
      }
    })
    .filter(Boolean)
    .sort((a, b) => settlementSortValue(b) - settlementSortValue(a))
}

function settlementLinkedTransactionExists(settlement, transactionEntries = []) {
  const linkedTransactionId = normalizeOptionalString(settlement?.linkedTransactionId)
  if (!linkedTransactionId) return false
  return (Array.isArray(transactionEntries) ? transactionEntries : [])
    .some((entry) => String(entry?.id || '') === linkedTransactionId && isConfirmedDebtPayment(entry))
}

function buildSettlementHistoryEntry(settlement) {
  return {
    id: settlement.id,
    amount: settlement.amount,
    date: settlement.confirmedAt || settlement.createdAt,
    description: settlement.note || 'Restituicao confirmada',
    origin: 'debt_settlement',
    status: settlement.status,
    paymentMethod: settlement.paymentMethod || 'pix',
    createdAt: settlement.createdAt,
    createdByName: settlement.createdByName || null,
    linkedTransactionId: settlement.linkedTransactionId || null,
  }
}

function buildConfirmedSettlementEntries(debt, transactionEntries = []) {
  return normalizeDebtSettlements(debt?.settlements)
    .filter((settlement) => settlement.status === 'confirmed')
    .filter((settlement) => !settlementLinkedTransactionExists(settlement, transactionEntries))
    .map(buildSettlementHistoryEntry)
}

function buildConfirmedPaymentReplayEntries(debt, transactionEntries = []) {
  const normalizedTransactions = Array.isArray(transactionEntries) ? transactionEntries : []
  const settlementEntries = normalizeDebtSettlements(debt?.settlements)
    .filter((settlement) => settlement.status === 'confirmed')
    .filter((settlement) => !settlementLinkedTransactionExists(settlement, normalizedTransactions))
    .map((settlement) => ({
      id: settlement.id,
      amount: settlement.amount,
      date: settlement.confirmedAt || settlement.createdAt,
      origin: 'debt_settlement',
    }))

  const transactionReplayEntries = normalizedTransactions
    .filter(isConfirmedDebtPayment)
    .map((entry) => ({
      id: entry.id,
      amount: entry.amount,
      date: entry.date || entry.createdAt,
      origin: 'transaction',
    }))

  return [...settlementEntries, ...transactionReplayEntries]
}

function confirmedSettlementsTotal(debt) {
  return normalizeDebtSettlements(debt?.settlements)
    .filter((settlement) => settlement.status === 'confirmed')
    .reduce((sum, settlement) => sum + toAmount(settlement.amount), 0)
}

const DEBT_SETTLEMENT_NATURE_IDS = new Set([
  'nature_debt_payment',
  'nature_loan_repayment',
  'nature_restitution',
])

function isDebtLinkedTransaction(tx) {
  return !!tx?.debtId
    && (
      DEBT_SETTLEMENT_NATURE_IDS.has(tx?.transactionNatureId)
      || tx?.countsAsDebtSettlement === true
    )
}

function isConfirmedDebtPayment(tx) {
  return tx?.status === 'confirmed'
    && isDebtLinkedTransaction(tx)
}

function externalDebtReceivable(debt) {
  return getExternalDebtDirection(debt) === 'contact_owes_me'
}

function buildDebtSettlementTransactionPayload(workspaceId, debt, settlement, actorUid = null) {
  const confirmedAt = settlement?.confirmedAt || new Date().toISOString()
  const date = String(confirmedAt).slice(0, 10)
  const competencyMonth = date.slice(0, 7)
  const amount = roundCurrency(toAmount(settlement?.amount))
  const paymentMethod = normalizePaymentMethodId(settlement?.paymentMethod) || 'pix'
  const isFamilyDebt = isFamilyInternalDebt(debt)
  const ownerUid = normalizeOptionalString(
    isFamilyDebt
      ? debt?.debtorMemberId
      : (debt?.createdBy || actorUid),
  )
  const contactId = normalizeOptionalString(
    debt?.contactId
      || (isFamilyDebt && debt?.creditorMemberId ? `member:${debt.creditorMemberId}` : null),
  )
  const contactName = normalizeOptionalString(
    debt?.contactName
      || debt?.counterpartyMemberName
      || debt?.creditorMemberName
      || debt?.debtorMemberName
      || debt?.name,
  )
  const receivable = !isFamilyDebt && externalDebtReceivable(debt)

  const transactionNatureId = receivable ? 'nature_loan_repayment' : 'nature_debt_payment'
  const transactionNatureKey = receivable ? 'devolucao_emprestimo' : 'pagamento_divida'
  const transactionNatureLabel = receivable ? 'Devolucao de emprestimo' : 'Pagamento de divida'
  const type = receivable ? 'income' : 'expense'
  const counterpartName = contactName || 'contato'
  const description = receivable
    ? `Recebimento de ${counterpartName} · ${debt?.name || 'Pendencia'}`
    : `Pagamento para ${counterpartName} · ${debt?.name || 'Pendencia'}`

  return {
    type,
    description,
    amount,
    date,
    competencyMonth,
    workspaceId,
    createdBy: actorUid || ownerUid || null,
    userId: ownerUid || actorUid || null,
    categoryId: null,
    categoryName: null,
    subcategoryId: null,
    subcategoryName: null,
    transactionNatureId,
    transactionNatureKey,
    transactionNatureLabel,
    paymentMethod,
    accountId: paymentMethod === 'credit_card' || paymentMethod === 'cash'
      ? null
      : normalizeOptionalString(settlement?.accountId),
    cardId: paymentMethod === 'credit_card'
      ? normalizeOptionalString(settlement?.cardId)
      : null,
    cardName: paymentMethod === 'credit_card'
      ? normalizeOptionalString(settlement?.cardName)
      : null,
    contactId,
    contactName,
    debtId: debt?.id || null,
    debtName: debt?.name || null,
    countsAsDebtSettlement: true,
    notes: normalizeOptionalString(settlement?.note) || 'Lancamento gerado automaticamente pela confirmacao da restituicao.',
    origin: 'manual',
    status: 'confirmed',
    affectsBudget: false,
    balanceImpact: false,
    autoGeneratedByDebtSettlement: true,
    debtSettlementId: settlement?.id || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
}

export function isFamilyInternalDebt(debt) {
  if (!debt) return false
  if (debt.relationshipKind === 'family_member') return true
  if (debt.debtorMemberId || debt.creditorMemberId) return true
  return String(debt.type || '').startsWith('familia_')
}

export function getExternalDebtDirection(debt) {
  if (!debt || isFamilyInternalDebt(debt)) return null
  return normalizeExternalDebtDirection(debt.externalDirection)
}

function entryName(entry) {
  return String(entry?.memberName || 'Membro')
}

export function buildFamilyDebtLedger(debts = [], currentUserId = '', members = []) {
  if (!currentUserId) return []

  const memberNameById = new Map(
    (Array.isArray(members) ? members : []).map((member) => [
      member.uid || member.id,
      member.displayName || member.name || member.email || 'Membro',
    ]),
  )

  const summaryByMemberId = new Map()

  ;(Array.isArray(debts) ? debts : [])
    .filter((debt) => isFamilyInternalDebt(debt) && !isPendingDebtConfirmation(debt) && Number(debt.remainingAmount || 0) > 0)
    .forEach((debt) => {
      const creditorId = debt.creditorMemberId || null
      const debtorId = debt.debtorMemberId || null
      const remainingAmount = Number(debt.remainingAmount || 0)
      if (!creditorId || !debtorId || !remainingAmount) return
      if (creditorId !== currentUserId && debtorId !== currentUserId) return

      const counterpartId = creditorId === currentUserId ? debtorId : creditorId
      const counterpartName = debt.counterpartyMemberName
        || memberNameById.get(counterpartId)
        || debt.debtorMemberName
        || debt.creditorMemberName
        || debt.contactName
        || 'Membro'

      const current = summaryByMemberId.get(counterpartId) || {
        memberId: counterpartId,
        memberName: counterpartName,
        owesToMe: 0,
        iOwe: 0,
        openDebtsCount: 0,
        debts: [],
      }

      if (creditorId === currentUserId) current.owesToMe += remainingAmount
      if (debtorId === currentUserId) current.iOwe += remainingAmount
      current.openDebtsCount += 1
      current.debts.push(debt)
      summaryByMemberId.set(counterpartId, current)
    })

  return [...summaryByMemberId.values()]
    .map((entry) => ({
      ...entry,
      netBalance: Number((entry.owesToMe - entry.iOwe).toFixed(2)),
    }))
    .sort((a, b) => {
      const balanceDiff = Math.abs(b.netBalance) - Math.abs(a.netBalance)
      if (balanceDiff !== 0) return balanceDiff
      return entryName(a).localeCompare(entryName(b))
    })
}

export async function fetchDebts(workspaceId) {
  if (!workspaceId) return []
  const nowMs = Date.now()
  const snap = await getDocs(debtsCol(workspaceId))
  return snap.docs
    .map((d) => decorateDebtWithInterest({
      id: d.id,
      ...d.data(),
      settlements: normalizeDebtSettlements(d.data()?.settlements),
    }, nowMs))
    .sort((a, b) => {
      const aDate = a.createdAt?.toDate?.()?.getTime?.() || 0
      const bDate = b.createdAt?.toDate?.()?.getTime?.() || 0
      return bDate - aDate
    })
}

export async function createDebt(workspaceId, payload = {}, actorUid = null) {
  if (!workspaceId) throw new Error('Workspace nao selecionado')
  const totalAmount = toAmount(payload.totalAmount)
  const initialPaidAmount = toAmount(payload.paidAmount || 0)
  const remainingAmount = Math.max(0, totalAmount - initialPaidAmount)
  const interestRate = normalizeInterestRate(payload.interestRate, payload)
  const reasonType = normalizeFamilyReasonType(payload.reasonType)
  const relationshipKind = normalizeOptionalString(payload.relationshipKind)
    || (
      normalizeOptionalString(payload.contactId) || normalizeOptionalString(payload.contactName)
        ? 'external_contact'
        : null
    )
  const requiresReceiptConfirmation = relationshipKind === 'family_member'
    && reasonType === 'emprestimo'
    && normalizeOptionalString(payload.creditorMemberId)
    && normalizeOptionalString(payload.debtorMemberId)
    && normalizeOptionalString(payload.creditorMemberId) !== normalizeOptionalString(payload.debtorMemberId)
  const confirmedAt = requiresReceiptConfirmation ? null : new Date().toISOString()

  const ref = await addDoc(debtsCol(workspaceId), {
    name: payload.name?.trim() || 'Divida sem nome',
    type: payload.type || 'pessoa',
    originalAmount: totalAmount,
    totalAmount,
    paidAmount: initialPaidAmount,
    initialPaidAmount,
    remainingAmount,
    status: requiresReceiptConfirmation ? 'pending_confirmation' : (remainingAmount > 0 ? 'open' : 'settled'),
    workspaceId,
    createdBy: actorUid || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    relationshipKind,
    reasonType,
    reasonLabel: normalizeOptionalString(payload.reasonLabel),
    creditorMemberId: normalizeOptionalString(payload.creditorMemberId),
    creditorMemberName: normalizeOptionalString(payload.creditorMemberName),
    debtorMemberId: normalizeOptionalString(payload.debtorMemberId),
    debtorMemberName: normalizeOptionalString(payload.debtorMemberName),
    counterpartyMemberId: normalizeOptionalString(payload.counterpartyMemberId),
    counterpartyMemberName: normalizeOptionalString(payload.counterpartyMemberName),
    contactId: normalizeOptionalString(payload.contactId),
    contactName: normalizeOptionalString(payload.contactName),
    externalDirection: relationshipKind === 'external_contact'
      ? normalizeExternalDebtDirection(payload.externalDirection)
      : null,
    notes: normalizeOptionalString(payload.notes),
    settlements: normalizeDebtSettlements(payload.settlements),
    interestRate: interestRate || null,
    loanConfirmedAt: confirmedAt,
    receiptConfirmedAt: confirmedAt,
    confirmationRequestedForUid: requiresReceiptConfirmation ? normalizeOptionalString(payload.debtorMemberId) : null,
    accruedInterestStoredAmount: 0,
    interestLastAccruedAt: confirmedAt,
    dueDate: payload.dueDate || null,
    installmentPlan: payload.installmentPlan || null,
  })

  return ref.id
}

function buildOverflowDebtNote(debt, settlement, overflowAmount) {
  const parts = []
  if (debt?.notes) parts.push(String(debt.notes).trim())
  parts.push(
    `Saldo invertido automaticamente apos confirmacao de envio maior que o devido (${overflowAmount.toFixed(2)}).`,
  )
  if (settlement?.note) {
    parts.push(`Observacao do envio original: ${settlement.note}`)
  }
  return parts.join('\n\n').trim() || null
}

function buildOverflowDebtRecord(workspaceId, debt, settlement, overflowAmount, actorUid = null) {
  return {
    name: debt?.name?.trim() || 'Saldo invertido',
    type: debt?.type || 'pessoa',
    originalAmount: overflowAmount,
    totalAmount: overflowAmount,
    paidAmount: 0,
    initialPaidAmount: 0,
    remainingAmount: overflowAmount,
    status: 'open',
    workspaceId,
    createdBy: actorUid || settlement?.confirmedByUid || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    relationshipKind: normalizeOptionalString(debt?.relationshipKind),
    reasonType: normalizeFamilyReasonType(debt?.reasonType),
    reasonLabel: normalizeOptionalString(debt?.reasonLabel),
    creditorMemberId: normalizeOptionalString(debt?.debtorMemberId),
    creditorMemberName: normalizeOptionalString(debt?.debtorMemberName),
    debtorMemberId: normalizeOptionalString(debt?.creditorMemberId),
    debtorMemberName: normalizeOptionalString(debt?.creditorMemberName),
    counterpartyMemberId: normalizeOptionalString(debt?.creditorMemberId),
    counterpartyMemberName: normalizeOptionalString(debt?.creditorMemberName),
    contactId: normalizeOptionalString(debt?.contactId),
    contactName: normalizeOptionalString(debt?.contactName),
    externalDirection: normalizeOptionalString(debt?.relationshipKind) === 'external_contact'
      ? invertExternalDebtDirection(debt?.externalDirection)
      : null,
    notes: buildOverflowDebtNote(debt, settlement, overflowAmount),
    settlements: [],
    interestRate: debt?.interestRate || null,
    interestLastAccruedAt: settlement?.confirmedAt || new Date().toISOString(),
    dueDate: null,
    installmentPlan: null,
  }
}

export async function fetchDebtById(workspaceId, debtId) {
  if (!workspaceId || !debtId) return null
  const snap = await getDoc(debtDoc(workspaceId, debtId))
  if (!snap.exists()) return null
  return decorateDebtWithInterest({
    id: snap.id,
    ...snap.data(),
    settlements: normalizeDebtSettlements(snap.data()?.settlements),
  })
}

export async function fetchDebtPayments(workspaceId, debtId) {
  if (!workspaceId || !debtId) return []
  const [debt, snap] = await Promise.all([
    fetchDebtById(workspaceId, debtId),
    getDocs(query(txCol(workspaceId), where('debtId', '==', debtId))),
  ])

  const transactionPayments = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(isConfirmedDebtPayment)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))

  const settlementPayments = buildConfirmedSettlementEntries(debt, transactionPayments)

  return [...settlementPayments, ...transactionPayments]
    .sort((a, b) => String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || '')))
}

export async function recalculateDebtBalance(workspaceId, debtId) {
  if (!workspaceId || !debtId) return

  const ref = debtDoc(workspaceId, debtId)
  const [debtSnap, linkedTransactionsSnap] = await Promise.all([
    getDoc(ref),
    getDocs(query(txCol(workspaceId), where('debtId', '==', debtId))),
  ])
  if (!debtSnap.exists()) return

  const rawDebt = {
    id: debtSnap.id,
    ...debtSnap.data(),
    settlements: normalizeDebtSettlements(debtSnap.data()?.settlements),
  }

  const replayEntries = buildConfirmedPaymentReplayEntries(
    rawDebt,
    linkedTransactionsSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
  )
  const snapshot = buildDebtBalanceSnapshot(rawDebt, replayEntries)

  await updateDoc(ref, {
    originalAmount: snapshot.originalAmount,
    totalAmount: snapshot.originalAmount,
    paidAmount: snapshot.paidPrincipalAmount,
    remainingAmount: snapshot.remainingAmount,
    accruedInterestStoredAmount: snapshot.accruedInterestAmount,
    interestRate: snapshot.interestRate || null,
    loanConfirmedAt: rawDebt.loanConfirmedAt || snapshot.confirmedAt || null,
    receiptConfirmedAt: rawDebt.receiptConfirmedAt || snapshot.confirmedAt || null,
    interestLastAccruedAt: snapshot.interestAccruedThrough || rawDebt.interestLastAccruedAt || null,
    status: snapshot.status,
    updatedAt: serverTimestamp(),
  })
}

export async function syncDebtBalancesForTransactionChange(workspaceId, beforeTx = null, afterTx = null) {
  if (!workspaceId) return
  const affected = new Set()

  if (beforeTx?.debtId) affected.add(beforeTx.debtId)
  if (afterTx?.debtId) affected.add(afterTx.debtId)

  await Promise.all(Array.from(affected).map((debtId) => recalculateDebtBalance(workspaceId, debtId)))
}

export async function confirmDebtReceipt(workspaceId, debtId, actorUid = null) {
  if (!workspaceId || !debtId) throw new Error('Divida nao encontrada')

  await runTransaction(db, async (transaction) => {
    const ref = debtDoc(workspaceId, debtId)
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('Divida nao encontrada')

    const debt = {
      id: snap.id,
      ...snap.data(),
    }

    if (!isPendingDebtConfirmation(debt)) {
      throw new Error('Este emprestimo ja foi confirmado.')
    }
    if (debt.debtorMemberId && actorUid && debt.debtorMemberId !== actorUid) {
      throw new Error('Somente quem recebeu o emprestimo pode confirmar.')
    }

    const confirmedAt = new Date().toISOString()
    const remainingAmount = roundCurrency(Math.max(0, toAmount(debt.totalAmount) - toAmount(debt.initialPaidAmount || 0)))

    transaction.update(ref, {
      status: remainingAmount > 0 ? 'open' : 'settled',
      loanConfirmedAt: confirmedAt,
      receiptConfirmedAt: confirmedAt,
      interestLastAccruedAt: confirmedAt,
      confirmationRequestedForUid: null,
      accruedInterestStoredAmount: 0,
      remainingAmount,
      updatedAt: serverTimestamp(),
    })
  })
}

export async function requestDebtSettlement(workspaceId, debtId, payload = {}, actorUid = null) {
  if (!workspaceId || !debtId) throw new Error('Divida nao encontrada')
  const amount = toAmount(payload.amount)
  if (!amount) throw new Error('Informe o valor da restituição')

  await runTransaction(db, async (transaction) => {
    const ref = debtDoc(workspaceId, debtId)
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('Divida nao encontrada')

    const debt = {
      id: snap.id,
      ...snap.data(),
      settlements: normalizeDebtSettlements(snap.data()?.settlements),
    }

    if (isPendingDebtConfirmation(debt)) {
      throw new Error('Este emprestimo ainda precisa ser confirmado por quem recebeu.')
    }

    if (debt.debtorMemberId && actorUid && debt.debtorMemberId !== actorUid) {
      throw new Error('Somente quem deve pode informar uma restituição')
    }

    const nextSettlement = {
      id: createSettlementId(),
      amount,
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdByUid: actorUid || null,
      createdByName: normalizeOptionalString(payload.createdByName),
      paymentMethod: normalizePaymentMethodId(payload.paymentMethod) || 'pix',
      accountId: normalizeOptionalString(payload.accountId),
      cardId: normalizeOptionalString(payload.cardId),
      cardName: normalizeOptionalString(payload.cardName),
      note: normalizeOptionalString(payload.note),
      confirmedAt: null,
      confirmedByUid: null,
      cancelledAt: null,
      cancelledByUid: null,
    }

    transaction.update(ref, {
      settlements: [...debt.settlements, nextSettlement],
      updatedAt: serverTimestamp(),
    })
  })
}

export async function confirmDebtSettlement(workspaceId, debtId, settlementId, actorUid = null) {
  if (!workspaceId || !debtId || !settlementId) throw new Error('Restituicao nao encontrada')

  await runTransaction(db, async (transaction) => {
    const ref = debtDoc(workspaceId, debtId)
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('Divida nao encontrada')

    const debt = {
      id: snap.id,
      ...snap.data(),
      settlements: normalizeDebtSettlements(snap.data()?.settlements),
    }
    if (isPendingDebtConfirmation(debt)) {
      throw new Error('Este emprestimo ainda precisa ser confirmado por quem recebeu.')
    }

    const interestSnapshot = buildDebtBalanceSnapshot(
      debt,
      buildConfirmedPaymentReplayEntries(debt, []),
    )
    const debtWithInterest = {
      ...debt,
      interestRate: interestSnapshot.interestRate || null,
      originalAmount: interestSnapshot.originalAmount,
      totalAmount: interestSnapshot.totalAmount,
      paidAmount: interestSnapshot.paidAmount,
      remainingAmount: interestSnapshot.remainingAmount,
      accruedInterestAmount: interestSnapshot.accruedInterestAmount,
      confirmedAt: interestSnapshot.confirmedAt,
      interestAccruedThrough: interestSnapshot.interestAccruedThrough,
    }

    if (debtWithInterest.creditorMemberId && actorUid && debtWithInterest.creditorMemberId !== actorUid) {
      throw new Error('Somente quem vai receber pode confirmar esta restituição')
    }

    const remainingAmount = toAmount(debtWithInterest.remainingAmount)
    let confirmedSettlement = null
    const nextSettlements = debtWithInterest.settlements.map((settlement) => {
      if (settlement.id !== settlementId) return settlement
      if (settlement.status !== 'pending') {
        throw new Error('Esta restituição ja foi processada')
      }
      const linkedTransactionRef = doc(txCol(workspaceId))
      confirmedSettlement = {
        ...settlement,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
        confirmedByUid: actorUid || null,
        linkedTransactionId: linkedTransactionRef.id,
        linkedTransactionCreatedAt: new Date().toISOString(),
      }
      transaction.set(
        linkedTransactionRef,
        buildDebtSettlementTransactionPayload(workspaceId, debtWithInterest, confirmedSettlement, actorUid),
      )
      return confirmedSettlement
    })

    const exists = nextSettlements.some((settlement) => settlement.id === settlementId)
    if (!exists || !confirmedSettlement) throw new Error('Restituicao nao encontrada')

    transaction.update(ref, {
      originalAmount: roundCurrency(debtWithInterest.originalAmount),
      totalAmount: roundCurrency(debtWithInterest.originalAmount),
      paidAmount: roundCurrency(debtWithInterest.paidAmount),
      remainingAmount,
      accruedInterestStoredAmount: roundCurrency(debtWithInterest.accruedInterestAmount),
      interestRate: debtWithInterest.interestRate || null,
      loanConfirmedAt: debt.loanConfirmedAt || debtWithInterest.confirmedAt || null,
      receiptConfirmedAt: debt.receiptConfirmedAt || debtWithInterest.confirmedAt || null,
      interestLastAccruedAt: debtWithInterest.interestAccruedThrough || new Date().toISOString(),
      settlements: nextSettlements,
      updatedAt: serverTimestamp(),
    })

    const overflowAmount = Math.max(0, toAmount(confirmedSettlement.amount) - remainingAmount)
    if (overflowAmount > 0) {
      const overflowRef = doc(debtsCol(workspaceId))
      transaction.set(
        overflowRef,
        buildOverflowDebtRecord(workspaceId, debtWithInterest, confirmedSettlement, overflowAmount, actorUid),
      )
    }
  })

  await recalculateDebtBalance(workspaceId, debtId)
}

export async function cancelDebtSettlement(workspaceId, debtId, settlementId, actorUid = null) {
  if (!workspaceId || !debtId || !settlementId) throw new Error('Restituicao nao encontrada')

  await runTransaction(db, async (transaction) => {
    const ref = debtDoc(workspaceId, debtId)
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('Divida nao encontrada')

    const debt = {
      id: snap.id,
      ...snap.data(),
      settlements: normalizeDebtSettlements(snap.data()?.settlements),
    }

    const target = debt.settlements.find((settlement) => settlement.id === settlementId)
    if (!target) throw new Error('Restituicao nao encontrada')
    if (target.status !== 'pending') throw new Error('Apenas restituições pendentes podem ser canceladas')
    if (actorUid && target.createdByUid && target.createdByUid !== actorUid) {
      throw new Error('Somente quem informou a restituição pode cancelar')
    }

    const nextSettlements = debt.settlements.map((settlement) => (
      settlement.id === settlementId
        ? {
            ...settlement,
            status: 'cancelled',
            cancelledAt: new Date().toISOString(),
            cancelledByUid: actorUid || null,
          }
        : settlement
    ))

    transaction.update(ref, {
      settlements: nextSettlements,
      updatedAt: serverTimestamp(),
    })
  })
}

export async function deleteDebt(workspaceId, debtId) {
  if (!workspaceId || !debtId) throw new Error('Divida nao encontrada')

  const linkedPaymentsSnap = await getDocs(query(txCol(workspaceId), where('debtId', '==', debtId)))
  const hasLinkedTransactions = linkedPaymentsSnap.docs.some((docSnapshot) => (
    isDebtLinkedTransaction(docSnapshot.data())
  ))

  if (hasLinkedTransactions) {
    throw new Error('Esta divida possui pagamentos lancados em movimentacoes. Remova os lancamentos vinculados antes de excluir a divida.')
  }

  await deleteDoc(debtDoc(workspaceId, debtId))
}

export async function deleteDebtSettlement(workspaceId, debtId, settlementId) {
  if (!workspaceId || !debtId || !settlementId) throw new Error('Restituicao nao encontrada')

  await runTransaction(db, async (transaction) => {
    const ref = debtDoc(workspaceId, debtId)
    const snap = await transaction.get(ref)
    if (!snap.exists()) throw new Error('Divida nao encontrada')

    const debt = {
      id: snap.id,
      ...snap.data(),
      settlements: normalizeDebtSettlements(snap.data()?.settlements),
    }

    const targetSettlement = debt.settlements.find((settlement) => settlement.id === settlementId)
    if (!targetSettlement) throw new Error('Restituicao nao encontrada')
    const linkedTransactionId = normalizeOptionalString(targetSettlement.linkedTransactionId)
    if (linkedTransactionId) {
      const linkedTransactionSnap = await transaction.get(doc(txCol(workspaceId), linkedTransactionId))
      if (linkedTransactionSnap.exists()) {
        throw new Error('Esta restituicao ja esta refletida em Lancamentos. Exclua primeiro o lancamento vinculado.')
      }
    }

    const nextSettlements = debt.settlements.filter((settlement) => settlement.id !== settlementId)

    transaction.update(ref, {
      settlements: nextSettlements,
      updatedAt: serverTimestamp(),
    })
  })

  await recalculateDebtBalance(workspaceId, debtId)
}
