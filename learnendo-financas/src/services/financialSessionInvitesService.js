import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../firebase/config'

function invitesCol(workspaceId, sessionId) {
  return collection(db, 'workspaces', workspaceId, 'financialSessions', sessionId, 'invites')
}

function inviteDoc(workspaceId, sessionId, inviteId) {
  return doc(db, 'workspaces', workspaceId, 'financialSessions', sessionId, 'invites', inviteId)
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase()
}

function normalizeInviteRole(value = '') {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'planner') return 'planner'
  if (normalized === 'client') return 'client'
  return 'viewer'
}

function normalizeInviteStatus(value = '') {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'accepted') return 'accepted'
  if (normalized === 'cancelled') return 'cancelled'
  return 'pending'
}

function mapInvite(snapshot) {
  const data = snapshot.data() || {}
  return {
    id: snapshot.id,
    workspaceId: data.workspaceId || snapshot.ref?.parent?.parent?.parent?.parent?.id || '',
    sessionId: data.sessionId || snapshot.ref?.parent?.parent?.id || '',
    sessionName: String(data.sessionName || 'Sessao financeira'),
    workspaceName: String(data.workspaceName || ''),
    inviteeEmail: String(data.inviteeEmail || ''),
    inviteeName: String(data.inviteeName || ''),
    inviteRole: normalizeInviteRole(data.inviteRole),
    status: normalizeInviteStatus(data.status),
    inviterUid: String(data.inviterUid || ''),
    inviterName: String(data.inviterName || ''),
    acceptedBy: String(data.acceptedBy || ''),
    acceptedByName: String(data.acceptedByName || ''),
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt ?? null,
    acceptedAt: data.acceptedAt?.toDate?.()?.toISOString?.() ?? data.acceptedAt ?? null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt ?? null,
  }
}

function normalizeNames(value = []) {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean),
  ))
}

function normalizeIds(value = []) {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean),
  ))
}

function sortInvites(items = []) {
  return [...items].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt || a.createdAt || '') || 0
    const bTime = Date.parse(b.updatedAt || b.createdAt || '') || 0
    if (aTime !== bTime) return bTime - aTime
    return String(a.inviteeEmail || '').localeCompare(String(b.inviteeEmail || ''))
  })
}

export function subscribeFinancialSessionInvites(workspaceId, sessionId, onData, onError) {
  if (!workspaceId || !sessionId) {
    onData([])
    return () => {}
  }

  return onSnapshot(
    query(invitesCol(workspaceId, sessionId), orderBy('createdAt', 'desc')),
    (snapshot) => onData(sortInvites(snapshot.docs.map(mapInvite))),
    (error) => {
      if (onError) onError(error)
    },
  )
}

export function subscribePendingFinancialSessionInvites(inviteeEmail, onData, onError) {
  const normalizedEmail = normalizeEmail(inviteeEmail)
  if (!normalizedEmail) {
    onData([])
    return () => {}
  }

  return onSnapshot(
    query(
      collectionGroup(db, 'invites'),
      where('inviteeEmail', '==', normalizedEmail),
    ),
    (snapshot) => {
      const mapped = snapshot.docs
        .map(mapInvite)
        .filter((invite) => invite.status === 'pending')
      onData(sortInvites(mapped))
    },
    (error) => {
      if (onError) onError(error)
    },
  )
}

export async function createFinancialSessionInvite(workspaceId, sessionId, payload = {}) {
  if (!workspaceId || !sessionId) throw new Error('Sessao nao selecionada')

  const inviteeEmail = normalizeEmail(payload.inviteeEmail)
  if (!inviteeEmail) {
    throw new Error('Informe o e-mail da pessoa que voce quer convidar.')
  }

  await addDoc(invitesCol(workspaceId, sessionId), {
    workspaceId,
    sessionId,
    sessionName: String(payload.sessionName || 'Sessao financeira').trim(),
    workspaceName: String(payload.workspaceName || '').trim(),
    inviteeEmail,
    inviteeName: String(payload.inviteeName || '').trim(),
    inviteRole: normalizeInviteRole(payload.inviteRole),
    inviterUid: String(payload.inviterUid || ''),
    inviterName: String(payload.inviterName || '').trim(),
    status: 'pending',
    acceptedBy: '',
    acceptedByName: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function cancelFinancialSessionInvite(workspaceId, sessionId, inviteId) {
  if (!workspaceId || !sessionId || !inviteId) throw new Error('Convite nao selecionado')

  await updateDoc(inviteDoc(workspaceId, sessionId, inviteId), {
    status: 'cancelled',
    updatedAt: serverTimestamp(),
  })
}

export async function acceptFinancialSessionInvite(invite, actor = {}) {
  if (!invite?.workspaceId || !invite?.sessionId || !invite?.id) {
    throw new Error('Convite indisponivel.')
  }

  const actorUid = String(actor.uid || '').trim()
  const actorName = String(actor.displayName || actor.email || 'Participante').trim()
  const actorEmail = normalizeEmail(actor.email)

  if (!actorUid || !actorEmail) {
    throw new Error('Usuario autenticado invalido para aceitar o convite.')
  }

  await runTransaction(db, async (transaction) => {
    const sessionRef = doc(db, 'workspaces', invite.workspaceId, 'financialSessions', invite.sessionId)
    const inviteRef = inviteDoc(invite.workspaceId, invite.sessionId, invite.id)
    const [sessionSnap, inviteSnap] = await Promise.all([
      transaction.get(sessionRef),
      transaction.get(inviteRef),
    ])

    if (!inviteSnap.exists()) throw new Error('Convite nao encontrado.')
    if (!sessionSnap.exists()) throw new Error('Sessao financeira nao encontrada.')

    const latestInvite = inviteSnap.data() || {}
    if (normalizeInviteStatus(latestInvite.status) !== 'pending') {
      throw new Error('Este convite nao esta mais pendente.')
    }

    if (normalizeEmail(latestInvite.inviteeEmail) !== actorEmail) {
      throw new Error('Este convite pertence a outro e-mail.')
    }

    const sessionData = sessionSnap.data() || {}
    const plannerMemberIds = normalizeIds(sessionData.plannerMemberIds)
    const plannerMemberNames = normalizeNames(sessionData.plannerMemberNames)
    const clientMemberIds = normalizeIds(sessionData.clientMemberIds)
    const clientMemberNames = normalizeNames(sessionData.clientMemberNames)
    const participantMemberIds = normalizeIds(sessionData.participantMemberIds)

    const inviteRole = normalizeInviteRole(latestInvite.inviteRole)
    if (inviteRole === 'planner') {
      plannerMemberIds.push(actorUid)
      plannerMemberNames.push(actorName)
    } else if (inviteRole === 'client') {
      clientMemberIds.push(actorUid)
      clientMemberNames.push(actorName)
    }
    participantMemberIds.push(actorUid)

    transaction.update(sessionRef, {
      plannerMemberIds: normalizeIds(plannerMemberIds),
      plannerMemberNames: normalizeNames(plannerMemberNames),
      clientMemberIds: normalizeIds(clientMemberIds),
      clientMemberNames: normalizeNames(clientMemberNames),
      participantMemberIds: normalizeIds(participantMemberIds),
      updatedAt: serverTimestamp(),
      lastOpenedAt: serverTimestamp(),
      lastOpenedBy: actorUid,
      status: 'active',
    })

    transaction.update(inviteRef, {
      status: 'accepted',
      acceptedBy: actorUid,
      acceptedByName: actorName,
      acceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  })
}
