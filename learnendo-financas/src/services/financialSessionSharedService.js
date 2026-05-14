import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { db } from '../firebase/config'

function sharedDoc(workspaceId, sessionId, docId) {
  return doc(db, 'workspaces', workspaceId, 'financialSessions', sessionId, 'shared', docId)
}

function mapSharedTextDoc(snapshot) {
  if (!snapshot.exists()) {
    return {
      id: snapshot.id,
      text: '',
      updatedAt: null,
      updatedBy: '',
      updatedByName: '',
    }
  }

  const data = snapshot.data() || {}
  return {
    id: snapshot.id,
    text: String(data.text || ''),
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt ?? null,
    updatedBy: String(data.updatedBy || ''),
    updatedByName: String(data.updatedByName || ''),
  }
}

export function subscribeFinancialSessionSharedText(workspaceId, sessionId, docId, onData, onError) {
  if (!workspaceId || !sessionId || !docId) {
    onData({
      id: docId || '',
      text: '',
      updatedAt: null,
      updatedBy: '',
      updatedByName: '',
    })
    return () => {}
  }

  return onSnapshot(
    sharedDoc(workspaceId, sessionId, docId),
    (snapshot) => onData(mapSharedTextDoc(snapshot)),
    (error) => {
      if (onError) onError(error)
    },
  )
}

export async function updateFinancialSessionSharedText(
  workspaceId,
  sessionId,
  docId,
  text,
  actorUid = '',
  actorName = '',
) {
  if (!workspaceId || !sessionId || !docId) {
    throw new Error('Sessao compartilhada indisponivel')
  }

  await setDoc(sharedDoc(workspaceId, sessionId, docId), {
    text: String(text || ''),
    updatedBy: actorUid || '',
    updatedByName: actorName || '',
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

function defaultWorkspaceSnapshot(docId = 'workspaceSnapshot') {
  return {
    id: docId,
    summary: { receitas: 0, despesas: 0, investimentos: 0, saldo: 0 },
    incomeTransactions: [],
    expenseTransactions: [],
    currentBudgets: [],
    projects: [],
    updatedAt: null,
    updatedBy: '',
    updatedByName: '',
  }
}

function mapWorkspaceSnapshot(snapshot) {
  if (!snapshot.exists()) {
    return defaultWorkspaceSnapshot(snapshot.id)
  }

  const data = snapshot.data() || {}
  return {
    id: snapshot.id,
    summary: {
      receitas: Number(data.summary?.receitas || 0),
      despesas: Number(data.summary?.despesas || 0),
      investimentos: Number(data.summary?.investimentos || 0),
      saldo: Number(data.summary?.saldo || 0),
    },
    incomeTransactions: Array.isArray(data.incomeTransactions) ? data.incomeTransactions : [],
    expenseTransactions: Array.isArray(data.expenseTransactions) ? data.expenseTransactions : [],
    currentBudgets: Array.isArray(data.currentBudgets) ? data.currentBudgets : [],
    projects: Array.isArray(data.projects) ? data.projects : [],
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt ?? null,
    updatedBy: String(data.updatedBy || ''),
    updatedByName: String(data.updatedByName || ''),
  }
}

export function subscribeFinancialSessionWorkspaceSnapshot(workspaceId, sessionId, onData, onError) {
  if (!workspaceId || !sessionId) {
    onData(defaultWorkspaceSnapshot())
    return () => {}
  }

  return onSnapshot(
    sharedDoc(workspaceId, sessionId, 'workspaceSnapshot'),
    (snapshot) => onData(mapWorkspaceSnapshot(snapshot)),
    (error) => {
      if (onError) onError(error)
    },
  )
}

export async function syncFinancialSessionWorkspaceSnapshot(
  workspaceId,
  sessionId,
  payload = {},
  actorUid = '',
  actorName = '',
) {
  if (!workspaceId || !sessionId) {
    throw new Error('Sessao compartilhada indisponivel')
  }

  await setDoc(sharedDoc(workspaceId, sessionId, 'workspaceSnapshot'), {
    summary: payload.summary || { receitas: 0, despesas: 0, investimentos: 0, saldo: 0 },
    incomeTransactions: Array.isArray(payload.incomeTransactions) ? payload.incomeTransactions : [],
    expenseTransactions: Array.isArray(payload.expenseTransactions) ? payload.expenseTransactions : [],
    currentBudgets: Array.isArray(payload.currentBudgets) ? payload.currentBudgets : [],
    projects: Array.isArray(payload.projects) ? payload.projects : [],
    updatedBy: actorUid || '',
    updatedByName: actorName || '',
    updatedAt: serverTimestamp(),
  }, { merge: true })
}
