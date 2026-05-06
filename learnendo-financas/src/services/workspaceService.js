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

function workspaceProjectsCol(workspaceId) {
  return collection(db, 'workspaces', workspaceId, 'projects')
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

export function normalizeWorkspaceRole(role) {
  const normalized = String(role || 'membro')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')

  if (normalized === 'owner') return 'gestor'
  if (normalized === 'admin') return 'co-gestor'
  if (normalized === 'co-gestor' || normalized === 'cogestor') return 'co-gestor'
  if (normalized === 'editor' || normalized === 'member' || normalized === 'membro') return 'membro'
  if (normalized === 'viewer' || normalized === 'read-only' || normalized === 'readonly') return 'planejador'
  if (normalized === 'gestor' || normalized === 'planejador') return normalized

  return 'membro'
}

export function getPermissionsByRole(role) {
  const normalizedRole = normalizeWorkspaceRole(role)
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

export async function fetchWorkspaceProjects(workspaceId) {
  if (!workspaceId) return []
  const snap = await getDocs(workspaceProjectsCol(workspaceId))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const aDate = a.createdAt?.toDate?.()?.getTime?.() || 0
      const bDate = b.createdAt?.toDate?.()?.getTime?.() || 0
      return bDate - aDate
    })
}

export async function createWorkspaceProject(workspaceId, payload = {}, actorUid = null) {
  if (!workspaceId) throw new Error('Workspace nao selecionado')

  const targetAmount = Number(payload.targetAmount || 0)
  const currentAmount = Number(payload.currentAmount || 0)
  const progress = targetAmount > 0
    ? Math.max(0, Math.min(100, (currentAmount / targetAmount) * 100))
    : 0

  const ref = await addDoc(workspaceProjectsCol(workspaceId), {
    name: String(payload.name || '').trim() || 'Projeto familiar',
    kind: payload.kind || 'caixinha',
    targetAmount: Number.isFinite(targetAmount) ? targetAmount : 0,
    currentAmount: Number.isFinite(currentAmount) ? currentAmount : 0,
    progress,
    ownerMemberId: payload.ownerMemberId || '',
    ownerMemberName: payload.ownerMemberName || '',
    linkedAccountId: payload.linkedAccountId || '',
    linkedAccountLabel: payload.linkedAccountLabel || '',
    matchText: String(payload.matchText || '').trim(),
    notes: payload.notes || '',
    status: payload.status || 'active',
    createdBy: actorUid || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return ref.id
}

export async function updateWorkspaceProject(workspaceId, projectId, payload = {}) {
  if (!workspaceId || !projectId) throw new Error('Projeto nao selecionado')

  const targetAmount = Number(payload.targetAmount || 0)
  const currentAmount = Number(payload.currentAmount || 0)
  const progress = targetAmount > 0
    ? Math.max(0, Math.min(100, (currentAmount / targetAmount) * 100))
    : 0

  await updateDoc(doc(db, 'workspaces', workspaceId, 'projects', projectId), {
    name: String(payload.name || '').trim() || 'Projeto familiar',
    kind: payload.kind || 'caixinha',
    targetAmount: Number.isFinite(targetAmount) ? targetAmount : 0,
    currentAmount: Number.isFinite(currentAmount) ? currentAmount : 0,
    progress,
    ownerMemberId: payload.ownerMemberId || '',
    ownerMemberName: payload.ownerMemberName || '',
    linkedAccountId: payload.linkedAccountId || '',
    linkedAccountLabel: payload.linkedAccountLabel || '',
    matchText: String(payload.matchText || '').trim(),
    notes: payload.notes || '',
    status: payload.status || 'active',
    updatedAt: serverTimestamp(),
  })
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function transactionSignedAmountForProject(tx, accountId) {
  const amount = Math.abs(Number(tx?.amount || 0))
  if (!amount || !accountId) return 0

  if (tx?.type === 'transfer_internal') {
    if (tx?.accountId === accountId) return -amount
    if (tx?.toAccountId === accountId) return amount
    return 0
  }

  if (tx?.accountId !== accountId || tx?.balanceImpact === false) return 0
  if (tx?.type === 'income') return amount
  return -amount
}

function transactionMatchesProject(project, tx) {
  if (!project || !tx || tx?.status !== 'confirmed') return false

  const linkedAccountId = project.linkedAccountId || ''
  if (linkedAccountId) {
    const touchesAccount = tx?.accountId === linkedAccountId || tx?.toAccountId === linkedAccountId
    if (!touchesAccount) return false
  }

  const matchText = normalizeSearchText(project.matchText)
  if (!matchText) return !!linkedAccountId

  const haystack = [
    tx?.description,
    tx?.notes,
    tx?.categoryName,
    tx?.subcategoryName,
    tx?.transactionNatureLabel,
    ...(Array.isArray(tx?.receiptItems)
      ? tx.receiptItems.flatMap((item) => [item?.name, item?.budgetCategoryName])
      : []),
  ]
    .map(normalizeSearchText)
    .filter(Boolean)
    .join(' ')

  return haystack.includes(matchText)
}

export function buildWorkspaceProjectSnapshots(projects = [], transactions = []) {
  const sourceProjects = Array.isArray(projects) ? projects : []
  const sourceTransactions = Array.isArray(transactions) ? transactions : []

  return sourceProjects.map((project) => {
    const matchedTransactions = sourceTransactions.filter((tx) => transactionMatchesProject(project, tx))
    const trackedAmount = matchedTransactions.reduce((sum, tx) => (
      sum + transactionSignedAmountForProject(tx, project.linkedAccountId)
    ), 0)
    const baseAmount = Number(project.currentAmount || 0)
    const effectiveCurrentAmount = Number((baseAmount + trackedAmount).toFixed(2))
    const targetAmount = Number(project.targetAmount || 0)
    const progress = targetAmount > 0
      ? Math.max(0, Math.min(100, (effectiveCurrentAmount / targetAmount) * 100))
      : 0

    return {
      ...project,
      trackedAmount,
      trackedTransactionsCount: matchedTransactions.length,
      effectiveCurrentAmount,
      progress,
      isAutoTracked: !!(project.linkedAccountId || project.matchText),
    }
  })
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

function contactDebtDelta(tx) {
  const amount = Math.abs(Number(tx?.amount || 0))
  if (!amount) return 0

  switch (tx?.transactionNatureId) {
    case 'nature_loan_given':
      return amount
    case 'nature_loan_received':
      return -amount
    case 'nature_loan_repayment':
      return -amount
    case 'nature_debt_payment':
      return amount
    case 'nature_restitution':
      return -amount
    default:
      return 0
  }
}

export function buildWorkspaceFinancialSummary(transactions = []) {
  return (Array.isArray(transactions) ? transactions : [])
    .filter((tx) => tx.status === 'confirmed')
    .reduce((acc, tx) => {
      const amount = Math.abs(Number(tx.amount || 0))
      if (!amount) return acc
      if (tx.type === 'income') acc.receitas += amount
      if (tx.type === 'expense') acc.despesas += amount
      if (tx.type === 'investment') acc.investimentos += amount
      acc.saldo = acc.receitas - acc.despesas - acc.investimentos
      return acc
    }, { receitas: 0, despesas: 0, investimentos: 0, saldo: 0 })
}

export function buildContactDebtLedger(transactions = [], contacts = []) {
  const contactMap = new Map(contacts.map((c) => [c.id, c]))
  const balanceByContactId = {}
  const txNameByContactId = {}

  transactions
    .filter((tx) => tx.status === 'confirmed' && tx.contactId)
    .forEach((tx) => {
      const delta = contactDebtDelta(tx)
      if (delta === 0) return
      balanceByContactId[tx.contactId] = (balanceByContactId[tx.contactId] || 0) + delta
      if (!txNameByContactId[tx.contactId] && tx.contactName) {
        txNameByContactId[tx.contactId] = tx.contactName
      }
    })

  return Object.entries(balanceByContactId).map(([contactId, balance]) => {
    const contact = contactMap.get(contactId)
    return {
      contactId,
      contactName: contact?.name || txNameByContactId[contactId] || 'Contato',
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
