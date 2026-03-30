import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
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

const DEBT_SETTLEMENT_NATURE_IDS = new Set([
  'nature_debt_payment',
  'nature_loan_repayment',
  'nature_restitution',
])

function isConfirmedDebtPayment(tx) {
  return tx?.status === 'confirmed'
    && tx?.debtId
    && DEBT_SETTLEMENT_NATURE_IDS.has(tx?.transactionNatureId)
}

export async function fetchDebts(workspaceId) {
  if (!workspaceId) return []
  const snap = await getDocs(debtsCol(workspaceId))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const aDate = a.createdAt?.toDate?.()?.getTime?.() || 0
      const bDate = b.createdAt?.toDate?.()?.getTime?.() || 0
      return bDate - aDate
    })
}

export async function createDebt(workspaceId, payload = {}, actorUid = null) {
  if (!workspaceId) throw new Error('Workspace não selecionado')
  const totalAmount = toAmount(payload.totalAmount)
  const paidAmount = toAmount(payload.paidAmount || 0)
  const remainingAmount = Math.max(0, totalAmount - paidAmount)

  const ref = await addDoc(debtsCol(workspaceId), {
    name: payload.name?.trim() || 'Dívida sem nome',
    type: payload.type || 'pessoa',
    totalAmount,
    paidAmount,
    remainingAmount,
    workspaceId,
    createdBy: actorUid || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    // Campos reservados para evolução futura
    interestRate: payload.interestRate || null,
    dueDate: payload.dueDate || null,
    installmentPlan: payload.installmentPlan || null,
  })

  return ref.id
}

export async function fetchDebtById(workspaceId, debtId) {
  if (!workspaceId || !debtId) return null
  const snap = await getDoc(debtDoc(workspaceId, debtId))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() }
}

export async function fetchDebtPayments(workspaceId, debtId) {
  if (!workspaceId || !debtId) return []
  const snap = await getDocs(query(txCol(workspaceId), where('debtId', '==', debtId)))

  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(isConfirmedDebtPayment)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
}

export async function recalculateDebtBalance(workspaceId, debtId) {
  if (!workspaceId || !debtId) return

  const debt = await fetchDebtById(workspaceId, debtId)
  if (!debt) return

  const payments = await fetchDebtPayments(workspaceId, debtId)
  const paidAmount = payments.reduce((sum, tx) => sum + toAmount(tx.amount), 0)
  const totalAmount = toAmount(debt.totalAmount)
  const remainingAmount = Math.max(0, totalAmount - paidAmount)

  await updateDoc(debtDoc(workspaceId, debtId), {
    paidAmount,
    remainingAmount,
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
