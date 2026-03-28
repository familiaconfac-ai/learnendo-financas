import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { DEFAULT_TRANSACTION_NATURES } from '../constants/transactionNatures'

function workspaceCol() {
  return collection(db, 'workspaces')
}

function workspaceDoc(workspaceId) {
  return doc(db, 'workspaces', workspaceId)
}

function workspaceMembersCol(workspaceId) {
  return collection(db, 'workspaces', workspaceId, 'members')
}

function workspaceMemberDoc(workspaceId, uid) {
  return doc(db, 'workspaces', workspaceId, 'members', uid)
}

function workspaceInvitesCol(workspaceId) {
  return collection(db, 'workspaces', workspaceId, 'invitations')
}

function workspaceContactsCol(workspaceId) {
  return collection(db, 'workspaces', workspaceId, 'contacts')
}

function workspaceNaturesCol(workspaceId) {
  return collection(db, 'workspaces', workspaceId, 'transactionNatures')
}

function userMembershipDoc(uid, workspaceId) {
  return doc(db, 'users', uid, 'workspaceMemberships', workspaceId)
}

function userSettingsDoc(uid) {
  return doc(db, 'users', uid, 'settings', 'workspace')
}

function inviteTokenDoc(token) {
  return doc(db, 'workspaceInviteTokens', token)
}

function randomToken() {
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function isManager(role) {
  return role === 'gestor' || role === 'co-gestor'
}

export function getPermissionsByRole(role) {
  const normalizedRole = role || 'membro'
  return {
    canInvite: normalizedRole === 'gestor',
    canRemoveMember: normalizedRole === 'gestor',
    canChangeRoles: normalizedRole === 'gestor',
    canEditBudget: normalizedRole === 'gestor' || normalizedRole === 'co-gestor',
    canCreateGlobalCategories: normalizedRole === 'gestor' || normalizedRole === 'co-gestor',
    canImport: normalizedRole === 'gestor' || normalizedRole === 'co-gestor' || normalizedRole === 'membro',
    canConfirm: normalizedRole === 'gestor' || normalizedRole === 'co-gestor' || normalizedRole === 'membro',
    canLaunch: normalizedRole === 'gestor' || normalizedRole === 'co-gestor' || normalizedRole === 'membro',
    readOnly: normalizedRole === 'planejador',
    viewPrivateOthers: normalizedRole === 'gestor' || normalizedRole === 'co-gestor',
  }
}

async function ensureDefaultNatures(workspaceId) {
  const snap = await getDocs(workspaceNaturesCol(workspaceId))
  if (!snap.empty) return
  await Promise.all(
    DEFAULT_TRANSACTION_NATURES.map((nature) => setDoc(doc(db, 'workspaces', workspaceId, 'transactionNatures', nature.id), {
      ...nature,
      isDefault: true,
      workspaceId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })),
  )
}

export async function createWorkspace(ownerUid, payload = {}) {
  const role = payload.role || 'gestor'
  const ref = await addDoc(workspaceCol(), {
    name: payload.name || 'Meu Workspace',
    type: payload.type || 'family',
    createdBy: ownerUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    active: true,
  })

  await setDoc(workspaceMemberDoc(ref.id, ownerUid), {
    uid: ownerUid,
    role,
    status: 'active',
    joinedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  await setDoc(userMembershipDoc(ownerUid, ref.id), {
    workspaceId: ref.id,
    role,
    status: 'active',
    joinedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  await ensureDefaultNatures(ref.id)
  return ref.id
}

export async function fetchUserWorkspaces(uid) {
  const membershipSnap = await getDocs(collection(db, 'users', uid, 'workspaceMemberships'))
  const memberships = membershipSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  if (memberships.length === 0) return []

  const workspaceDocs = await Promise.all(
    memberships.map(async (m) => {
      const wsSnap = await getDoc(workspaceDoc(m.workspaceId || m.id))
      if (!wsSnap.exists()) return null
      return {
        id: wsSnap.id,
        ...wsSnap.data(),
        memberRole: m.role,
        memberStatus: m.status,
      }
    }),
  )

  return workspaceDocs.filter(Boolean)
}

export async function ensureWorkspaceBootstrap(uid, profile = null) {
  const workspaces = await fetchUserWorkspaces(uid)
  if (workspaces.length > 0) return workspaces

  const personalWorkspaceId = await createWorkspace(uid, {
    name: profile?.displayName ? `Workspace de ${profile.displayName}` : 'Meu Workspace',
    type: 'personal',
    role: 'gestor',
  })

  const list = await fetchUserWorkspaces(uid)
  return list.filter(Boolean)
}

export async function getActiveWorkspaceId(uid, fallbackWorkspaceId = null) {
  const snap = await getDoc(userSettingsDoc(uid))
  if (snap.exists() && snap.data()?.activeWorkspaceId) {
    return snap.data().activeWorkspaceId
  }
  if (fallbackWorkspaceId) return fallbackWorkspaceId
  const memberships = await fetchUserWorkspaces(uid)
  return memberships[0]?.id || null
}

export async function setActiveWorkspaceId(uid, workspaceId) {
  await setDoc(userSettingsDoc(uid), {
    activeWorkspaceId: workspaceId,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export async function fetchWorkspaceMembers(workspaceId) {
  const snap = await getDocs(workspaceMembersCol(workspaceId))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function fetchWorkspaceContacts(workspaceId) {
  const snap = await getDocs(workspaceContactsCol(workspaceId))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function createWorkspaceContact(workspaceId, payload) {
  const ref = await addDoc(workspaceContactsCol(workspaceId), {
    name: payload.name,
    type: payload.type || 'external',
    linkedUserId: payload.linkedUserId || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateWorkspaceContact(workspaceId, contactId, payload) {
  await updateDoc(doc(db, 'workspaces', workspaceId, 'contacts', contactId), {
    ...payload,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteWorkspaceContact(workspaceId, contactId) {
  await deleteDoc(doc(db, 'workspaces', workspaceId, 'contacts', contactId))
}

export async function fetchWorkspaceNatures(workspaceId) {
  await ensureDefaultNatures(workspaceId)
  const snap = await getDocs(workspaceNaturesCol(workspaceId))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function upsertWorkspaceNature(workspaceId, natureId, patch) {
  await setDoc(doc(db, 'workspaces', workspaceId, 'transactionNatures', natureId), {
    ...patch,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export async function createWorkspaceInvite(workspaceId, inviterUid, role = 'membro', target = {}) {
  const token = randomToken()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const invitePayload = {
    workspaceId,
    role,
    inviterUid,
    status: 'pending',
    email: target.email || null,
    phone: target.phone || null,
    method: target.method || 'link',
    token,
    expiresAt,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  await addDoc(workspaceInvitesCol(workspaceId), invitePayload)
  await setDoc(inviteTokenDoc(token), {
    ...invitePayload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return {
    token,
    link: `${window.location.origin}/convite/${token}`,
    expiresAt,
  }
}

export async function getWorkspaceInviteByToken(token) {
  const snap = await getDoc(inviteTokenDoc(token))
  if (!snap.exists()) return null
  const data = snap.data()
  const expired = new Date(data.expiresAt).getTime() < Date.now()
  return {
    id: snap.id,
    ...data,
    expired,
  }
}

export async function acceptWorkspaceInvite(uid, token) {
  const invite = await getWorkspaceInviteByToken(token)
  if (!invite) throw new Error('Convite inválido')
  if (invite.status !== 'pending') throw new Error('Convite já utilizado')
  if (invite.expired) throw new Error('Convite expirado')

  const role = invite.role || 'membro'

  await setDoc(workspaceMemberDoc(invite.workspaceId, uid), {
    uid,
    role,
    status: 'active',
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })

  await setDoc(userMembershipDoc(uid, invite.workspaceId), {
    workspaceId: invite.workspaceId,
    role,
    status: 'active',
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })

  await updateDoc(inviteTokenDoc(token), {
    status: 'accepted',
    acceptedBy: uid,
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  await setActiveWorkspaceId(uid, invite.workspaceId)
  return invite.workspaceId
}

export async function removeWorkspaceMember(workspaceId, actor, memberUid) {
  if (!actor?.role || actor.role !== 'gestor') {
    throw new Error('Somente gestor pode remover membros')
  }

  await deleteDoc(workspaceMemberDoc(workspaceId, memberUid))
  await deleteDoc(userMembershipDoc(memberUid, workspaceId))
}

export async function updateWorkspaceMemberRole(workspaceId, actor, memberUid, role) {
  if (!actor?.role || actor.role !== 'gestor') {
    throw new Error('Somente gestor pode alterar papéis')
  }

  await updateDoc(workspaceMemberDoc(workspaceId, memberUid), {
    role,
    updatedAt: serverTimestamp(),
  })

  await setDoc(userMembershipDoc(memberUid, workspaceId), {
    role,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

function directionSign(nature) {
  if (nature === 'emprestimo_concedido' || nature === 'ajuda_custo_enviada' || nature === 'doacao_enviada' || nature === 'mesada') {
    return -1
  }
  if (nature === 'emprestimo_recebido' || nature === 'devolucao_emprestimo' || nature === 'ajuda_custo_recebida' || nature === 'doacao_recebida' || nature === 'reembolso') {
    return 1
  }
  return 0
}

export function buildContactDebtLedger(transactions = [], contacts = []) {
  const contactMap = new Map(contacts.map((c) => [c.id, c]))
  const balanceByContactId = {}

  transactions
    .filter((tx) => tx.status === 'confirmed' && tx.contactId)
    .forEach((tx) => {
      const sign = directionSign(tx.transactionNatureKey)
      if (sign === 0) return
      const amount = Math.abs(Number(tx.amount || 0))
      if (!amount) return
      balanceByContactId[tx.contactId] = (balanceByContactId[tx.contactId] || 0) + amount * sign
    })

  return Object.entries(balanceByContactId).map(([contactId, balance]) => {
    const contact = contactMap.get(contactId)
    return {
      contactId,
      contactName: contact?.name || 'Contato',
      pendingBalance: balance,
      status: balance > 0 ? 'a_receber' : (balance < 0 ? 'a_pagar' : 'quitado'),
    }
  })
}

export function canRolePerform(role, action) {
  const permissions = getPermissionsByRole(role)
  switch (action) {
    case 'invite': return permissions.canInvite
    case 'remove-member': return permissions.canRemoveMember
    case 'change-role': return permissions.canChangeRoles
    case 'create-category': return permissions.canCreateGlobalCategories
    case 'edit-budget': return permissions.canEditBudget
    case 'import': return permissions.canImport
    case 'launch': return permissions.canLaunch
    case 'confirm': return permissions.canConfirm
    default: return false
  }
}
