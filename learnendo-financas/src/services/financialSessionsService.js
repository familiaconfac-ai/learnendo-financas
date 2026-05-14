import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  buildDefaultFinancialSessionState,
  mapFinancialSessionState,
  normalizeFinancialSessionStatus,
} from './financialSessionStage'

function sessionsCol(workspaceId) {
  return collection(db, 'workspaces', workspaceId, 'financialSessions')
}

function sessionDoc(workspaceId, sessionId) {
  return doc(db, 'workspaces', workspaceId, 'financialSessions', sessionId)
}

function sessionStateDoc(workspaceId, sessionId) {
  return doc(db, 'workspaces', workspaceId, 'financialSessions', sessionId, 'session', 'state')
}

function normalizeMemberIds(value = []) {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean),
  ))
}

function normalizeMemberNames(value = []) {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean),
  ))
}

function normalizeInviteEmails(value = []) {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean),
  ))
}

function mapSession(docSnapshot) {
  const data = docSnapshot.data() || {}
  return {
    id: docSnapshot.id,
    workspaceId: data.workspaceId || docSnapshot.ref?.parent?.parent?.id || '',
    name: data.name || 'Sessao financeira',
    description: data.description || '',
    status: normalizeFinancialSessionStatus(data.status),
    plannerMemberIds: normalizeMemberIds(data.plannerMemberIds),
    plannerMemberNames: normalizeMemberNames(data.plannerMemberNames),
    clientMemberIds: normalizeMemberIds(data.clientMemberIds),
    clientMemberNames: normalizeMemberNames(data.clientMemberNames),
    participantMemberIds: normalizeMemberIds(data.participantMemberIds),
    pendingInviteEmails: normalizeInviteEmails(data.pendingInviteEmails),
    createdBy: data.createdBy || '',
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt ?? null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt ?? null,
    lastOpenedAt: data.lastOpenedAt?.toDate?.()?.toISOString?.() ?? data.lastOpenedAt ?? null,
    lastOpenedBy: data.lastOpenedBy || '',
  }
}

function sortSessions(sessions = []) {
  return [...sessions].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt || a.lastOpenedAt || a.createdAt || '') || 0
    const bTime = Date.parse(b.updatedAt || b.lastOpenedAt || b.createdAt || '') || 0
    if (aTime !== bTime) return bTime - aTime
    return String(a.name || '').localeCompare(String(b.name || ''))
  })
}

export function subscribeFinancialSessions(workspaceId, onData, onError) {
  if (!workspaceId) {
    onData([])
    return () => {}
  }

  return onSnapshot(
    query(sessionsCol(workspaceId), orderBy('updatedAt', 'desc')),
    (snapshot) => {
      onData(sortSessions(snapshot.docs.map(mapSession)))
    },
    (error) => {
      if (onError) onError(error)
    },
  )
}

export function subscribeFinancialSession(workspaceId, sessionId, onData, onError) {
  if (!workspaceId || !sessionId) {
    onData(null)
    return () => {}
  }

  return onSnapshot(
    sessionDoc(workspaceId, sessionId),
    (snapshot) => {
      onData(snapshot.exists() ? mapSession(snapshot) : null)
    },
    (error) => {
      if (onError) onError(error)
    },
  )
}

export function subscribeFinancialSessionState(workspaceId, sessionId, onData, onError) {
  if (!workspaceId || !sessionId) {
    onData(buildDefaultFinancialSessionState())
    return () => {}
  }

  return onSnapshot(
    sessionStateDoc(workspaceId, sessionId),
    (snapshot) => {
      onData(snapshot.exists() ? mapFinancialSessionState(snapshot.data()) : buildDefaultFinancialSessionState())
    },
    (error) => {
      if (onError) onError(error)
    },
  )
}

export async function createFinancialSession(workspaceId, payload = {}, actorUid = null) {
  if (!workspaceId) throw new Error('Workspace nao selecionado')

  const plannerMemberIds = normalizeMemberIds(payload.plannerMemberIds)
  const clientMemberIds = normalizeMemberIds(payload.clientMemberIds)
  const participantMemberIds = normalizeMemberIds([
    ...plannerMemberIds,
    ...clientMemberIds,
    ...(Array.isArray(payload.participantMemberIds) ? payload.participantMemberIds : []),
  ])
  const pendingInviteEmails = normalizeInviteEmails(payload.pendingInviteEmails)

  const ref = await addDoc(sessionsCol(workspaceId), {
    workspaceId,
    name: String(payload.name || '').trim() || 'Sessao financeira',
    description: String(payload.description || '').trim(),
    status: 'draft',
    plannerMemberIds,
    plannerMemberNames: normalizeMemberNames(payload.plannerMemberNames),
    clientMemberIds,
    clientMemberNames: normalizeMemberNames(payload.clientMemberNames),
    participantMemberIds,
    pendingInviteEmails,
    createdBy: actorUid || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastOpenedAt: null,
    lastOpenedBy: null,
  })

  await setDoc(sessionStateDoc(workspaceId, ref.id), {
    ...buildDefaultFinancialSessionState(),
    lastUpdatedBy: actorUid || '',
    lastUpdatedByName: String(payload.createdByName || ''),
    updatedAt: serverTimestamp(),
  }, { merge: true })

  return ref.id
}

export async function updateFinancialSessionMetadata(workspaceId, sessionId, payload = {}) {
  if (!workspaceId || !sessionId) throw new Error('Sessao nao selecionada')

  const plannerMemberIds = normalizeMemberIds(payload.plannerMemberIds)
  const clientMemberIds = normalizeMemberIds(payload.clientMemberIds)
  const participantMemberIds = normalizeMemberIds([
    ...plannerMemberIds,
    ...clientMemberIds,
    ...(Array.isArray(payload.participantMemberIds) ? payload.participantMemberIds : []),
  ])
  const pendingInviteEmails = normalizeInviteEmails(payload.pendingInviteEmails)

  await updateDoc(sessionDoc(workspaceId, sessionId), {
    name: String(payload.name || '').trim() || 'Sessao financeira',
    description: String(payload.description || '').trim(),
    status: normalizeFinancialSessionStatus(payload.status),
    plannerMemberIds,
    plannerMemberNames: normalizeMemberNames(payload.plannerMemberNames),
    clientMemberIds,
    clientMemberNames: normalizeMemberNames(payload.clientMemberNames),
    participantMemberIds,
    pendingInviteEmails,
    updatedAt: serverTimestamp(),
  })
}

export async function ensureFinancialSessionState(workspaceId, sessionId, actorUid = '', actorName = '') {
  if (!workspaceId || !sessionId) return

  const snap = await getDoc(sessionStateDoc(workspaceId, sessionId))
  if (snap.exists()) return

  await setDoc(sessionStateDoc(workspaceId, sessionId), {
    ...buildDefaultFinancialSessionState(),
    lastUpdatedBy: actorUid || '',
    lastUpdatedByName: actorName || '',
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export async function updateFinancialSessionState(workspaceId, sessionId, patch = {}, actorUid = '', actorName = '') {
  if (!workspaceId || !sessionId) throw new Error('Sessao nao selecionada')

  await setDoc(sessionStateDoc(workspaceId, sessionId), {
    ...patch,
    lastUpdatedBy: actorUid || '',
    lastUpdatedByName: actorName || '',
    updatedAt: serverTimestamp(),
  }, { merge: true })

  const rootPatch = {
    updatedAt: serverTimestamp(),
  }

  if (patch?.sessionStatus) {
    rootPatch.status = normalizeFinancialSessionStatus(patch.sessionStatus)
  }

  await updateDoc(sessionDoc(workspaceId, sessionId), rootPatch)
}

export async function markFinancialSessionOpened(workspaceId, sessionId, actorUid = null) {
  if (!workspaceId || !sessionId) return
  await updateDoc(sessionDoc(workspaceId, sessionId), {
    lastOpenedAt: serverTimestamp(),
    lastOpenedBy: actorUid || null,
    status: 'active',
    updatedAt: serverTimestamp(),
  })
}

export async function archiveFinancialSession(workspaceId, sessionId) {
  if (!workspaceId || !sessionId) throw new Error('Sessao nao selecionada')
  await updateDoc(sessionDoc(workspaceId, sessionId), {
    status: 'archived',
    updatedAt: serverTimestamp(),
  })
}
