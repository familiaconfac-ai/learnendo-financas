import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { addTransaction } from './transactionService'

function actionsCol(workspaceId, sessionId) {
  return collection(db, 'workspaces', workspaceId, 'financialSessions', sessionId, 'actions')
}

function actionDoc(workspaceId, sessionId, actionId) {
  return doc(db, 'workspaces', workspaceId, 'financialSessions', sessionId, 'actions', actionId)
}

function workspaceTransactionsCol(workspaceId) {
  return collection(db, 'workspaces', workspaceId, 'transactions')
}

function normalizeActionType(value = '') {
  return String(value || '').trim().toLowerCase() === 'income' ? 'income' : 'expense'
}

function normalizeActionStatus(value = '') {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'applied') return 'applied'
  if (normalized === 'cancelled') return 'cancelled'
  return 'pending'
}

function normalizeDate(value = '') {
  const normalized = String(value || '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : new Date().toISOString().slice(0, 10)
}

function mapAction(snapshot) {
  const data = snapshot.data() || {}
  return {
    id: snapshot.id,
    workspaceId: data.workspaceId || snapshot.ref?.parent?.parent?.parent?.parent?.id || '',
    sessionId: data.sessionId || snapshot.ref?.parent?.parent?.id || '',
    type: normalizeActionType(data.type),
    description: String(data.description || ''),
    amount: Number(data.amount || 0),
    date: normalizeDate(data.date),
    notes: String(data.notes || ''),
    status: normalizeActionStatus(data.status),
    createdBy: String(data.createdBy || ''),
    createdByName: String(data.createdByName || ''),
    createdByRole: String(data.createdByRole || ''),
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt ?? null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt ?? null,
    appliedAt: data.appliedAt?.toDate?.()?.toISOString?.() ?? data.appliedAt ?? null,
    appliedBy: String(data.appliedBy || ''),
    appliedByName: String(data.appliedByName || ''),
    createdTransactionId: String(data.createdTransactionId || ''),
    cancelledAt: data.cancelledAt?.toDate?.()?.toISOString?.() ?? data.cancelledAt ?? null,
    cancelledBy: String(data.cancelledBy || ''),
    cancelledByName: String(data.cancelledByName || ''),
  }
}

function sortActions(actions = []) {
  return [...actions].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt || a.createdAt || '') || 0
    const bTime = Date.parse(b.updatedAt || b.createdAt || '') || 0
    if (aTime !== bTime) return bTime - aTime
    return String(a.description || '').localeCompare(String(b.description || ''))
  })
}

async function findExistingAppliedTransactionId(workspaceId, actionId) {
  const snapshot = await getDocs(
    query(
      workspaceTransactionsCol(workspaceId),
      where('sessionActionId', '==', actionId),
      limit(1),
    ),
  )

  return snapshot.docs[0]?.id || ''
}

export function subscribeFinancialSessionActions(workspaceId, sessionId, onData, onError) {
  if (!workspaceId || !sessionId) {
    onData([])
    return () => {}
  }

  return onSnapshot(
    query(actionsCol(workspaceId, sessionId), orderBy('updatedAt', 'desc')),
    (snapshot) => onData(sortActions(snapshot.docs.map(mapAction))),
    (error) => {
      if (onError) onError(error)
    },
  )
}

export async function createFinancialSessionActionRequest(workspaceId, sessionId, payload = {}, actor = {}) {
  if (!workspaceId || !sessionId) throw new Error('Sessao nao selecionada.')

  const description = String(payload.description || '').trim()
  const amount = Number(payload.amount || 0)

  if (!description) throw new Error('Informe a descricao do lancamento.')
  if (!(amount > 0)) throw new Error('Informe um valor maior que zero.')
  if (!actor.uid) throw new Error('Usuario autenticado invalido.')

  await addDoc(actionsCol(workspaceId, sessionId), {
    workspaceId,
    sessionId,
    type: normalizeActionType(payload.type),
    description,
    amount,
    date: normalizeDate(payload.date),
    notes: String(payload.notes || '').trim(),
    status: 'pending',
    createdBy: String(actor.uid || ''),
    createdByName: String(actor.name || 'Participante').trim(),
    createdByRole: String(actor.sessionRole || 'client').trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    appliedAt: null,
    appliedBy: '',
    appliedByName: '',
    createdTransactionId: '',
    cancelledAt: null,
    cancelledBy: '',
    cancelledByName: '',
  })
}

export async function cancelFinancialSessionActionRequest(workspaceId, sessionId, actionId, actor = {}) {
  if (!workspaceId || !sessionId || !actionId) throw new Error('Pedido nao selecionado.')

  await updateDoc(actionDoc(workspaceId, sessionId, actionId), {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
    cancelledBy: String(actor.uid || ''),
    cancelledByName: String(actor.name || 'Participante').trim(),
    updatedAt: serverTimestamp(),
  })
}

export async function applyFinancialSessionActionRequest(workspaceId, sessionId, action, actor = {}) {
  if (!workspaceId || !sessionId || !action?.id) throw new Error('Pedido nao selecionado.')
  if (!actor.uid) throw new Error('Usuario autenticado invalido.')

  if (normalizeActionStatus(action.status) === 'applied' && action.createdTransactionId) {
    return action.createdTransactionId
  }

  const existingTransactionId = action.createdTransactionId || await findExistingAppliedTransactionId(workspaceId, action.id)
  const transactionId = existingTransactionId || await addTransaction(actor.uid, {
    type: normalizeActionType(action.type),
    description: String(action.description || '').trim(),
    amount: Number(action.amount || 0),
    date: normalizeDate(action.date),
    competencyMonth: normalizeDate(action.date).slice(0, 7),
    notes: String(action.notes || '').trim(),
    createdBy: actor.uid,
    userId: actor.uid,
    sessionActionId: action.id,
    financialSessionId: sessionId,
  }, { workspaceId })

  await updateDoc(actionDoc(workspaceId, sessionId, action.id), {
    status: 'applied',
    appliedAt: serverTimestamp(),
    appliedBy: String(actor.uid || ''),
    appliedByName: String(actor.name || 'Participante').trim(),
    createdTransactionId: transactionId,
    updatedAt: serverTimestamp(),
  })

  return transactionId
}
