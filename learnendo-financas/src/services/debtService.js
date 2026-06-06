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

function normalizeOptionalString(value) {
  const text = String(value || '').trim()
  return text || null
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
        paymentMethod: normalizeOptionalString(entry?.paymentMethod) || 'pix',
        note: normalizeOptionalString(entry?.note),
      }
    })
    .filter(Boolean)
    .sort((a, b) => settlementSortValue(b) - settlementSortValue(a))
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
  }
}

function buildConfirmedSettlementEntries(debt) {
  return normalizeDebtSettlements(debt?.settlements)
    .filter((settlement) => settlement.status === 'confirmed')
    .map(buildSettlementHistoryEntry)
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

export function isFamilyInternalDebt(debt) {
  if (!debt) return false
  if (debt.relationshipKind === 'family_member') return true
  if (debt.debtorMemberId || debt.creditorMemberId) return true
  return String(debt.type || '').startsWith('familia_')
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
    .filter((debt) => isFamilyInternalDebt(debt) && Number(debt.remainingAmount || 0) > 0)
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
  const snap = await getDocs(debtsCol(workspaceId))
  return snap.docs
    .map((d) => ({
      id: d.id,
      ...d.data(),
      settlements: normalizeDebtSettlements(d.data()?.settlements),
    }))
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

  const ref = await addDoc(debtsCol(workspaceId), {
    name: payload.name?.trim() || 'Divida sem nome',
    type: payload.type || 'pessoa',
    totalAmount,
    paidAmount: initialPaidAmount,
    initialPaidAmount,
    remainingAmount,
    status: remainingAmount > 0 ? 'open' : 'settled',
    workspaceId,
    createdBy: actorUid || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    relationshipKind: normalizeOptionalString(payload.relationshipKind),
    reasonType: normalizeFamilyReasonType(payload.reasonType),
    reasonLabel: normalizeOptionalString(payload.reasonLabel),
    creditorMemberId: normalizeOptionalString(payload.creditorMemberId),
    creditorMemberName: normalizeOptionalString(payload.creditorMemberName),
    debtorMemberId: normalizeOptionalString(payload.debtorMemberId),
    debtorMemberName: normalizeOptionalString(payload.debtorMemberName),
    counterpartyMemberId: normalizeOptionalString(payload.counterpartyMemberId),
    counterpartyMemberName: normalizeOptionalString(payload.counterpartyMemberName),
    contactId: normalizeOptionalString(payload.contactId),
    contactName: normalizeOptionalString(payload.contactName),
    notes: normalizeOptionalString(payload.notes),
    settlements: normalizeDebtSettlements(payload.settlements),
    interestRate: payload.interestRate || null,
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
    notes: buildOverflowDebtNote(debt, settlement, overflowAmount),
    settlements: [],
    interestRate: debt?.interestRate || null,
    dueDate: null,
    installmentPlan: null,
  }
}

export async function fetchDebtById(workspaceId, debtId) {
  if (!workspaceId || !debtId) return null
  const snap = await getDoc(debtDoc(workspaceId, debtId))
  if (!snap.exists()) return null
  return {
    id: snap.id,
    ...snap.data(),
    settlements: normalizeDebtSettlements(snap.data()?.settlements),
  }
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

  const settlementPayments = buildConfirmedSettlementEntries(debt)

  return [...settlementPayments, ...transactionPayments]
    .sort((a, b) => String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || '')))
}

export async function recalculateDebtBalance(workspaceId, debtId) {
  if (!workspaceId || !debtId) return

  const debt = await fetchDebtById(workspaceId, debtId)
  if (!debt) return

  const payments = await fetchDebtPayments(workspaceId, debtId)
  const transactionPaidAmount = payments
    .filter((payment) => payment.origin !== 'debt_settlement')
    .reduce((sum, tx) => sum + toAmount(tx.amount), 0)
  const settlementPaidAmount = confirmedSettlementsTotal(debt)
  const paidAmount = toAmount(debt.initialPaidAmount || 0) + transactionPaidAmount + settlementPaidAmount
  const totalAmount = toAmount(debt.totalAmount)
  const remainingAmount = Math.max(0, totalAmount - paidAmount)

  await updateDoc(debtDoc(workspaceId, debtId), {
    paidAmount,
    remainingAmount,
    status: remainingAmount > 0 ? 'open' : 'settled',
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
      paymentMethod: normalizeOptionalString(payload.paymentMethod) || 'pix',
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

    if (debt.creditorMemberId && actorUid && debt.creditorMemberId !== actorUid) {
      throw new Error('Somente quem vai receber pode confirmar esta restituição')
    }

    const remainingAmount = toAmount(debt.remainingAmount)
    let confirmedSettlement = null
    const nextSettlements = debt.settlements.map((settlement) => {
      if (settlement.id !== settlementId) return settlement
      if (settlement.status !== 'pending') {
        throw new Error('Esta restituição ja foi processada')
      }
      confirmedSettlement = {
        ...settlement,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
        confirmedByUid: actorUid || null,
      }
      return confirmedSettlement
    })

    const exists = nextSettlements.some((settlement) => settlement.id === settlementId)
    if (!exists || !confirmedSettlement) throw new Error('Restituicao nao encontrada')

    transaction.update(ref, {
      settlements: nextSettlements,
      updatedAt: serverTimestamp(),
    })

    const overflowAmount = Math.max(0, toAmount(confirmedSettlement.amount) - remainingAmount)
    if (overflowAmount > 0) {
      const overflowRef = doc(debtsCol(workspaceId))
      transaction.set(
        overflowRef,
        buildOverflowDebtRecord(workspaceId, debt, confirmedSettlement, overflowAmount, actorUid),
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

    const exists = debt.settlements.some((settlement) => settlement.id === settlementId)
    if (!exists) throw new Error('Restituicao nao encontrada')

    const nextSettlements = debt.settlements.filter((settlement) => settlement.id !== settlementId)

    transaction.update(ref, {
      settlements: nextSettlements,
      updatedAt: serverTimestamp(),
    })
  })

  await recalculateDebtBalance(workspaceId, debtId)
}
