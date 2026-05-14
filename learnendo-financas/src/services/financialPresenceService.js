import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase/config'

function presenceCol(workspaceId, sessionId) {
  return collection(db, 'workspaces', workspaceId, 'financialSessions', sessionId, 'presence')
}

function presenceDoc(workspaceId, sessionId, uid) {
  return doc(db, 'workspaces', workspaceId, 'financialSessions', sessionId, 'presence', uid)
}

function mapPresence(docSnapshot) {
  const data = docSnapshot.data() || {}
  return {
    uid: docSnapshot.id,
    name: data.name || 'Participante',
    email: data.email || '',
    sessionRole: data.sessionRole || 'viewer',
    workspaceRole: data.workspaceRole || '',
    isOnline: data.isOnline !== false,
    activePanel: data.activePanel || '',
    mediaConnected: data.mediaConnected === true,
    mediaMicEnabled: data.mediaMicEnabled === true,
    mediaCameraEnabled: data.mediaCameraEnabled === true,
    mediaSpeaking: data.mediaSpeaking === true,
    mediaRoomName: data.mediaRoomName || '',
    lastSeenAt: data.lastSeenAt?.toDate?.()?.toISOString?.() ?? data.lastSeenAt ?? null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt ?? null,
  }
}

export function subscribeFinancialPresence(workspaceId, sessionId, onData, onError) {
  if (!workspaceId || !sessionId) {
    onData([])
    return () => {}
  }

  return onSnapshot(
    query(presenceCol(workspaceId, sessionId), orderBy('updatedAt', 'desc')),
    (snapshot) => {
      onData(snapshot.docs.map(mapPresence))
    },
    (error) => {
      if (onError) onError(error)
    },
  )
}

export async function upsertFinancialPresence(workspaceId, sessionId, uid, payload = {}) {
  if (!workspaceId || !sessionId || !uid) return

  const docPayload = {
    uid,
    name: payload.name || 'Participante',
    email: payload.email || '',
    sessionRole: payload.sessionRole || 'viewer',
    workspaceRole: payload.workspaceRole || '',
    activePanel: payload.activePanel || '',
    isOnline: true,
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  if (typeof payload.mediaConnected === 'boolean') {
    docPayload.mediaConnected = payload.mediaConnected
  }

  if (typeof payload.mediaMicEnabled === 'boolean') {
    docPayload.mediaMicEnabled = payload.mediaMicEnabled
  }

  if (typeof payload.mediaCameraEnabled === 'boolean') {
    docPayload.mediaCameraEnabled = payload.mediaCameraEnabled
  }

  if (typeof payload.mediaSpeaking === 'boolean') {
    docPayload.mediaSpeaking = payload.mediaSpeaking
  }

  if (typeof payload.mediaRoomName === 'string') {
    docPayload.mediaRoomName = payload.mediaRoomName
  }

  await setDoc(presenceDoc(workspaceId, sessionId, uid), docPayload, { merge: true })
}

export async function markFinancialPresenceOffline(workspaceId, sessionId, uid) {
  if (!workspaceId || !sessionId || !uid) return

  await updateDoc(presenceDoc(workspaceId, sessionId, uid), {
    isOnline: false,
    mediaConnected: false,
    mediaMicEnabled: false,
    mediaCameraEnabled: false,
    mediaSpeaking: false,
    updatedAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
  })
}
