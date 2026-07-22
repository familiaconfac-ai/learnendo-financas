import {
  collection,
  collectionGroup,
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
import { auth, db } from '../firebase/config'
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

function workspaceMeetingRoomsCol(workspaceId) {
  return collection(db, 'workspaces', workspaceId, 'meetingRooms')
}

function workspaceAccountsCol(workspaceId) {
  return collection(db, 'workspaces', workspaceId, 'accounts')
}

function workspaceCardsCol(workspaceId) {
  return collection(db, 'workspaces', workspaceId, 'cards')
}

function workspaceMeetingRoomDoc(workspaceId, roomId) {
  return doc(db, 'workspaces', workspaceId, 'meetingRooms', roomId)
}

function workspaceInviteDoc(workspaceId, inviteId) {
  return doc(db, 'workspaces', workspaceId, 'invitations', inviteId)
}

function familyDoc(familyId) {
  return doc(db, 'families', familyId)
}

function familyMemberDoc(familyId, memberId) {
  return doc(db, 'families', familyId, 'members', memberId)
}

function userFamilyDoc(uid) {
  return doc(db, 'userFamilies', uid)
}

function userMembershipDoc(uid, workspaceId) {
  return doc(db, 'users', uid, 'workspaceMemberships', workspaceId)
}

function workspaceIdFromMemberSnapshot(memberSnapshot) {
  return memberSnapshot?.ref?.parent?.parent?.id || null
}

function userSettingsDoc(uid) {
  return doc(db, 'users', uid, 'settings', 'workspace')
}

function inviteTokenDoc(token) {
  return doc(db, 'workspaceInviteTokens', token)
}

function userProfileDoc(uid) {
  return doc(db, 'users', uid)
}

function randomToken() {
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase()
}

function isManager(role) {
  return role === 'gestor' || role === 'co-gestor'
}

function normalizeMemberDisplayName(payload = {}) {
  return String(
    payload.displayName
    || payload.name
    || payload.email
    || 'Membro',
  ).trim()
}

async function getUserProfileData(uid) {
  if (!uid) return null
  try {
    const snap = await getDoc(userProfileDoc(uid))
    return snap.exists() ? snap.data() : null
  } catch (_) {
    return null
  }
}

function buildMemberIdentity(uid, profile = null) {
  const displayName = String(
    profile?.displayName
    || profile?.name
    || profile?.fullName
    || profile?.email
    || 'Membro',
  ).trim()
  const email = normalizeEmail(profile?.email)
  return {
    uid,
    displayName,
    name: displayName,
    email,
    avatarInitial: displayName.charAt(0).toUpperCase() || 'M',
  }
}

function resolveInviteActorEmail(uid, profile = null) {
  const profileEmail = normalizeEmail(profile?.email)
  if (profileEmail) return profileEmail

  if (auth?.currentUser?.uid === uid) {
    return normalizeEmail(auth.currentUser.email)
  }

  return ''
}

async function syncLegacyFamilyMirror(workspaceId, member, workspaceData = {}) {
  if (!workspaceId || !member?.uid) return
  const workspaceType = workspaceData?.type || 'family'
  if (workspaceType !== 'family') return

  await setDoc(familyDoc(workspaceId), {
    name: workspaceData?.name || 'Familia',
    plan: workspaceData?.plan || 'family',
    ownerUid: workspaceData?.createdBy || member.uid,
    workspaceId,
    updatedAt: serverTimestamp(),
    createdAt: workspaceData?.createdAt || serverTimestamp(),
  }, { merge: true })

  await setDoc(familyMemberDoc(workspaceId, member.uid), {
    uid: member.uid,
    email: member.email || '',
    displayName: member.displayName || member.name || member.email || 'Membro',
    name: member.name || member.displayName || member.email || 'Membro',
    avatarInitial: member.avatarInitial || 'M',
    role: member.role || 'membro',
    status: member.status || 'active',
    joinedAt: member.joinedAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })

  await setDoc(userFamilyDoc(member.uid), {
    familyId: workspaceId,
    updatedAt: serverTimestamp(),
  }, { merge: true })
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
  if (normalized === 'planner-master' || normalized === 'planejador-master') return 'planejador-master'
  if (normalized === 'planner-plus' || normalized === 'planejador-plus') return 'planejador-plus'
  if (
    normalized === 'planner-blind'
    || normalized === 'planejador-blind'
    || normalized === 'planejador-cego'
    || normalized === 'blind'
  ) return 'planejador-blind'
  if (
    normalized === 'gestor'
    || normalized === 'planejador'
    || normalized === 'planejador-master'
    || normalized === 'planejador-plus'
    || normalized === 'planejador-blind'
  ) return normalized

  return 'membro'
}

export function getPermissionsByRole(role, memberStatus = 'active') {
  const normalizedRole = normalizeWorkspaceRole(role)
  const isFullManager = normalizedRole === 'gestor' || normalizedRole === 'planejador-master'
  const isCoManager = normalizedRole === 'co-gestor' || normalizedRole === 'planejador-plus' || normalizedRole === 'planejador-blind'
  const isContributor = normalizedRole === 'membro'
  const isReadonlyPlanner = normalizedRole === 'planejador'
  const canViewAmounts = normalizedRole !== 'planejador-blind'
  const basePermissions = {
    canInvite: isFullManager,
    canRemoveMember: isFullManager,
    canChangeRoles: isFullManager,
    canEditBudget: isFullManager || isCoManager,
    canCreateGlobalCategories: isFullManager || isCoManager,
    canImport: isFullManager || isCoManager || isContributor,
    canConfirm: isFullManager || isCoManager || isContributor,
    canLaunch: isFullManager || isCoManager || isContributor,
    readOnly: isReadonlyPlanner,
    canViewAmounts,
    viewPrivateOthers: isFullManager || isCoManager,
  }

  if (memberStatus && memberStatus !== 'active') {
    return {
      ...basePermissions,
      canInvite: false,
      canRemoveMember: false,
      canChangeRoles: false,
      canEditBudget: false,
      canCreateGlobalCategories: false,
      canImport: false,
      canConfirm: false,
      canLaunch: false,
      readOnly: true,
      viewPrivateOthers: false,
    }
  }

  return basePermissions
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

  const ownerProfile = await getUserProfileData(ownerUid)
  await syncLegacyFamilyMirror(ref.id, {
    ...buildMemberIdentity(ownerUid, ownerProfile),
    role,
    status: 'active',
    joinedAt: serverTimestamp(),
  }, {
    name: payload.name || 'Meu Workspace',
    type: payload.type || 'family',
    plan: payload.plan || 'family',
    createdBy: ownerUid,
  })

  await ensureDefaultNatures(ref.id)
  return ref.id
}

export async function fetchUserWorkspaces(uid) {
  const membershipSnap = await getDocs(collection(db, 'users', uid, 'workspaceMemberships'))
  const membershipMap = new Map(
    membershipSnap.docs.map((d) => {
      const data = { id: d.id, ...d.data() }
      return [data.workspaceId || d.id, data]
    }),
  )

  try {
    const legacyMemberSnap = await getDocs(query(
      collectionGroup(db, 'members'),
      where('uid', '==', uid),
    ))

    legacyMemberSnap.docs.forEach((memberDoc) => {
      const memberData = memberDoc.data()
      if (memberData?.status && memberData.status !== 'active') return

      const workspaceId = workspaceIdFromMemberSnapshot(memberDoc)
      if (!workspaceId || membershipMap.has(workspaceId)) return
      membershipMap.set(workspaceId, {
        id: workspaceId,
        workspaceId,
        ...memberData,
      })
    })
  } catch (error) {
    console.warn('[workspaceService] Legacy workspace fallback skipped:', error?.message || error)
  }

  const memberships = [...membershipMap.values()]
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

  return workspaceDocs
    .filter(Boolean)
    .filter((workspace) => workspace.active !== false)
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
  let legacyDocs = []
  try {
    const legacySnap = await getDocs(collection(db, 'families', workspaceId, 'members'))
    legacyDocs = legacySnap.docs
  } catch (error) {
    console.warn('[workspaceService] Legacy family members fallback skipped:', error?.message || error)
  }

  const byMemberId = new Map()
  legacyDocs.forEach((d) => {
    const data = d.data() || {}
    const memberId = data.uid || data.memberId || data.userId || data.familyMemberId || d.id
    if (memberId) byMemberId.set(String(memberId), d)
  })
  snap.docs.forEach((d) => {
    const data = d.data() || {}
    const memberId = data.uid || data.memberId || data.userId || data.familyMemberId || d.id
    if (memberId) byMemberId.set(String(memberId), d)
  })

  const members = await Promise.all(
    [...byMemberId.values()].map(async (d) => {
      const data = d.data() || {}
      const stableId = data.uid || data.memberId || data.userId || data.familyMemberId || d.id
      const raw = { id: stableId, ...data }
      if (raw.displayName || !raw.uid) return raw
      const profile = await getUserProfileData(raw.uid)
      if (!profile) return raw
      return {
        ...raw,
        ...buildMemberIdentity(raw.uid, profile),
      }
    }),
  )
  return members
}

export async function updateWorkspaceDetails(workspaceId, payload = {}) {
  if (!workspaceId) throw new Error('Workspace nao selecionado')

  const patch = {
    updatedAt: serverTimestamp(),
  }

  if (payload.name !== undefined) {
    patch.name = String(payload.name || '').trim() || 'Meu Workspace'
  }
  if (payload.active !== undefined) {
    patch.active = !!payload.active
  }
  if (payload.archivedAt !== undefined) {
    patch.archivedAt = payload.archivedAt
  }
  if (payload.archivedBy !== undefined) {
    patch.archivedBy = payload.archivedBy || null
  }

  await updateDoc(workspaceDoc(workspaceId), patch)
}

export async function archiveWorkspace(workspaceId, actorUid = null) {
  if (!workspaceId) throw new Error('Workspace nao selecionado')

  await updateDoc(workspaceDoc(workspaceId), {
    active: false,
    archivedAt: serverTimestamp(),
    archivedBy: actorUid || null,
    updatedAt: serverTimestamp(),
  })
}

export async function createWorkspaceMember(workspaceId, actor, payload = {}) {
  if (!workspaceId) throw new Error('Workspace nao selecionado')

  const actorPermissions = getPermissionsByRole(actor?.role)
  if (!actorPermissions.canInvite) {
    throw new Error('Seu papel nao permite adicionar membros')
  }

  const normalizedRole = normalizeWorkspaceRole(payload.role || 'membro')
  const displayName = normalizeMemberDisplayName(payload)
  const normalizedEmail = normalizeEmail(payload.email)
  const basePayload = {
    uid: payload.uid || null,
    email: normalizedEmail || '',
    displayName,
    name: displayName,
    avatarInitial: String(payload.avatarInitial || displayName.charAt(0) || 'M').charAt(0).toUpperCase(),
    role: normalizedRole,
    note: String(payload.note || '').trim() || '',
    status: payload.status || 'active',
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  if (!payload.uid) {
    const ref = await addDoc(workspaceMembersCol(workspaceId), basePayload)
    try {
      const workspaceSnapshot = await getDoc(workspaceDoc(workspaceId))
      if (workspaceSnapshot.exists() && workspaceSnapshot.data()?.type === 'family') {
        await setDoc(familyMemberDoc(workspaceId, ref.id), {
          ...basePayload,
          updatedAt: serverTimestamp(),
        }, { merge: true })
      }
    } catch (_) {
      // Compatibilidade legada: nao interrompe o cadastro canonico.
    }
    return ref.id
  }

  await setDoc(workspaceMemberDoc(workspaceId, payload.uid), basePayload, { merge: true })
  await setDoc(userMembershipDoc(payload.uid, workspaceId), {
    workspaceId,
    role: normalizedRole,
    status: payload.status || 'active',
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })

  try {
    const workspaceSnapshot = await getDoc(workspaceDoc(workspaceId))
    const workspaceData = workspaceSnapshot.exists() ? workspaceSnapshot.data() : {}
    await syncLegacyFamilyMirror(workspaceId, {
      ...buildMemberIdentity(payload.uid, {
        displayName,
        name: displayName,
        email: normalizedEmail,
      }),
      role: normalizedRole,
      status: payload.status || 'active',
      joinedAt: serverTimestamp(),
    }, {
      ...workspaceData,
      workspaceId,
    })
  } catch (_) {
    // Compatibilidade legada: nao interrompe o cadastro canonico.
  }

  return payload.uid
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

export async function fetchWorkspaceInvites(workspaceId) {
  if (!workspaceId) return []
  const snap = await getDocs(workspaceInvitesCol(workspaceId))
  return snap.docs
    .map((d) => ({ id: d.id, workspaceId, ...d.data() }))
    .sort((a, b) => {
      const aDate = a.createdAt?.toDate?.()?.getTime?.() || 0
      const bDate = b.createdAt?.toDate?.()?.getTime?.() || 0
      return bDate - aDate
    })
}

export async function cancelWorkspaceInvite(workspaceId, inviteId) {
  if (!workspaceId || !inviteId) throw new Error('Convite nao selecionado')

  const inviteRef = workspaceInviteDoc(workspaceId, inviteId)
  const inviteSnap = await getDoc(inviteRef)
  if (!inviteSnap.exists()) throw new Error('Convite nao encontrado')

  const inviteData = inviteSnap.data() || {}

  await updateDoc(inviteRef, {
    status: 'cancelled',
    updatedAt: serverTimestamp(),
  })

  if (inviteData.token) {
    await updateDoc(inviteTokenDoc(inviteData.token), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    })
  }
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

function normalizeMeetingParticipantIds(value = []) {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean),
  ))
}

function normalizeMeetingParticipantNames(value = []) {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean),
  ))
}

function slugifyMeetingText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildMeetingRoomSlug(workspaceId, name) {
  const base = slugifyMeetingText(name) || 'sala'
  const workspaceKey = String(workspaceId || '').slice(0, 8) || 'workspace'
  const randomKey = Math.random().toString(36).slice(2, 6)
  return `learnendo-${workspaceKey}-${base}-${randomKey}`
}

function timeValue(entry) {
  const source = entry?.toDate?.() instanceof Date ? entry.toDate() : entry
  const timestamp = Date.parse(source || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

function sortMeetingRooms(rooms = []) {
  return [...rooms].sort((a, b) => {
    const aActive = a.status === 'active' ? 1 : 0
    const bActive = b.status === 'active' ? 1 : 0
    if (aActive !== bActive) return bActive - aActive

    const aTime = timeValue(a.updatedAt || a.lastOpenedAt || a.createdAt || '')
    const bTime = timeValue(b.updatedAt || b.lastOpenedAt || b.createdAt || '')
    if (aTime !== bTime) return bTime - aTime

    return String(a.name || '').localeCompare(String(b.name || ''))
  })
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

export async function fetchWorkspaceMeetingRooms(workspaceId) {
  if (!workspaceId) return []
  const snap = await getDocs(workspaceMeetingRoomsCol(workspaceId))
  return sortMeetingRooms(
    snap.docs.map((d) => ({
      id: d.id,
      workspaceId,
      ...d.data(),
      participantMemberIds: normalizeMeetingParticipantIds(d.data()?.participantMemberIds),
      participantMemberNames: normalizeMeetingParticipantNames(d.data()?.participantMemberNames),
    })),
  )
}

export async function createWorkspaceMeetingRoom(workspaceId, payload = {}, actorUid = null) {
  if (!workspaceId) throw new Error('Workspace nao selecionado')

  const name = String(payload.name || '').trim() || 'Sala da familia'
  const participantMemberIds = normalizeMeetingParticipantIds(payload.participantMemberIds)
  const participantMemberNames = normalizeMeetingParticipantNames(payload.participantMemberNames)
  const roomSlug = String(payload.roomSlug || '').trim() || buildMeetingRoomSlug(workspaceId, name)

  const ref = await addDoc(workspaceMeetingRoomsCol(workspaceId), {
    name,
    description: String(payload.description || '').trim(),
    status: payload.status || 'active',
    provider: payload.provider || 'jitsi',
    roomSlug,
    participantMemberIds,
    participantMemberNames,
    createdBy: actorUid || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastOpenedAt: null,
    lastOpenedBy: null,
  })

  return ref.id
}

export async function updateWorkspaceMeetingRoom(workspaceId, roomId, payload = {}) {
  if (!workspaceId || !roomId) throw new Error('Sala nao selecionada')

  const name = String(payload.name || '').trim() || 'Sala da familia'
  const participantMemberIds = normalizeMeetingParticipantIds(payload.participantMemberIds)
  const participantMemberNames = normalizeMeetingParticipantNames(payload.participantMemberNames)

  await updateDoc(workspaceMeetingRoomDoc(workspaceId, roomId), {
    name,
    description: String(payload.description || '').trim(),
    status: payload.status || 'active',
    provider: payload.provider || 'jitsi',
    roomSlug: String(payload.roomSlug || '').trim() || buildMeetingRoomSlug(workspaceId, name),
    participantMemberIds,
    participantMemberNames,
    updatedAt: serverTimestamp(),
  })
}

export async function archiveWorkspaceMeetingRoom(workspaceId, roomId) {
  if (!workspaceId || !roomId) throw new Error('Sala nao selecionada')
  await updateDoc(workspaceMeetingRoomDoc(workspaceId, roomId), {
    status: 'archived',
    updatedAt: serverTimestamp(),
  })
}

export async function touchWorkspaceMeetingRoom(workspaceId, roomId, actorUid = null) {
  if (!workspaceId || !roomId) return
  await updateDoc(workspaceMeetingRoomDoc(workspaceId, roomId), {
    lastOpenedAt: serverTimestamp(),
    lastOpenedBy: actorUid || null,
    updatedAt: serverTimestamp(),
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
  const normalizedEmail = normalizeEmail(target.email)
  const normalizedPhone = String(target.phone || '').replace(/\D/g, '')

  const invitePayload = {
    workspaceId,
    role,
    inviterUid,
    status: 'pending',
    email: normalizedEmail || null,
    phone: normalizedPhone || null,
    method: target.method || 'link',
    token,
    expiresAt,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  const inviteRef = await addDoc(workspaceInvitesCol(workspaceId), invitePayload)
  await setDoc(inviteTokenDoc(token), {
    ...invitePayload,
    inviteId: inviteRef.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return {
    token,
    link: `${window.location.origin}/convite/${token}`,
    expiresAt,
  }
}

export async function inspectWorkspaceMemberInvitation({ workspaceId, targetUid, targetEmail, actorUid }) {
  const expectedWorkspaceId = String(workspaceId || '').trim()
  const expectedUid = String(targetUid || '').trim()
  const expectedEmail = normalizeEmail(targetEmail)
  const expectedActorUid = String(actorUid || '').trim()
  if (!expectedWorkspaceId || !expectedUid || !expectedEmail || !expectedActorUid) {
    throw new Error('Workspace, UID, e-mail e administrador sao obrigatorios para verificar o convite.')
  }

  const [workspaceSnap, profileSnap, memberSnap, actorMemberSnap, invitationsSnap] = await Promise.all([
    getDoc(workspaceDoc(expectedWorkspaceId)),
    getDoc(userProfileDoc(expectedUid)),
    getDoc(workspaceMemberDoc(expectedWorkspaceId, expectedUid)),
    getDoc(workspaceMemberDoc(expectedWorkspaceId, expectedActorUid)),
    getDocs(workspaceInvitesCol(expectedWorkspaceId)),
  ])
  const profile = profileSnap.exists() ? profileSnap.data() : null
  const actorMember = actorMemberSnap.exists() ? actorMemberSnap.data() : null
  const profileEmail = normalizeEmail(profile?.email)
  const profileUid = String(profile?.uid || profileSnap.id || '').trim()
  const pendingInvitations = invitationsSnap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((invite) => ['pending', 'awaiting_confirmation'].includes(String(invite.status || '').trim()))
    .filter((invite) => (
      normalizeEmail(invite.email || invite.inviteeEmail) === expectedEmail
      || String(invite.acceptedBy || invite.uid || invite.userId || '').trim() === expectedUid
    ))
  const actorRole = normalizeWorkspaceRole(actorMember?.role)
  const actorCanInvite = actorMember?.status === 'active' && getPermissionsByRole(actorRole, actorMember.status).canInvite
  const checks = {
    workspaceExists: workspaceSnap.exists(),
    userDocumentExists: profileSnap.exists(),
    uidMatches: profileUid === expectedUid,
    emailMatches: profileEmail === expectedEmail,
    memberAbsent: !memberSnap.exists(),
    pendingInviteAbsent: pendingInvitations.length === 0,
    actorCanInvite,
  }

  return {
    workspaceId: expectedWorkspaceId,
    targetUid: expectedUid,
    targetEmail: expectedEmail,
    profileEmail,
    existingMemberStatus: memberSnap.exists() ? memberSnap.data()?.status || 'sem status' : null,
    pendingInvitations: pendingInvitations.map((invite) => ({ id: invite.id, status: invite.status || '' })),
    actorUid: expectedActorUid,
    actorRole,
    checks,
    eligible: Object.values(checks).every(Boolean),
  }
}

export async function createVerifiedWorkspaceMemberInvite(params) {
  const inspection = await inspectWorkspaceMemberInvitation(params)
  if (!inspection.eligible) {
    const failedChecks = Object.entries(inspection.checks)
      .filter(([, passed]) => !passed)
      .map(([check]) => check)
      .join(', ')
    throw new Error(`Convite bloqueado pela verificacao de seguranca: ${failedChecks || 'condicao nao atendida'}.`)
  }

  const invite = await createWorkspaceInvite(
    inspection.workspaceId,
    inspection.actorUid,
    'membro',
    { email: inspection.targetEmail, method: 'email' },
  )
  return { ...invite, inspection }
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
  const workspaceSnap = await getDoc(workspaceDoc(invite.workspaceId))
  const workspaceData = workspaceSnap.exists() ? workspaceSnap.data() : {}
  const profile = await getUserProfileData(uid)
  const currentEmail = resolveInviteActorEmail(uid, profile)
  const invitedEmail = normalizeEmail(invite.email)

  if (invitedEmail) {
    if (!currentEmail) {
      throw new Error('Entre com o e-mail convidado para aceitar este convite.')
    }
    if (currentEmail !== invitedEmail) {
      throw new Error(`Este convite foi enviado para ${invitedEmail}. Entre com esse e-mail para continuar.`)
    }
  }

  const memberIdentity = buildMemberIdentity(uid, {
    ...profile,
    email: currentEmail || profile?.email || '',
  })

  await setDoc(workspaceMemberDoc(invite.workspaceId, uid), {
    uid,
    email: memberIdentity.email,
    displayName: memberIdentity.displayName,
    name: memberIdentity.name,
    avatarInitial: memberIdentity.avatarInitial,
    role,
    status: 'pending_confirmation',
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })

  await setDoc(userMembershipDoc(uid, invite.workspaceId), {
    workspaceId: invite.workspaceId,
    role,
    status: 'pending_confirmation',
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })

  await updateDoc(inviteTokenDoc(token), {
    status: 'awaiting_confirmation',
    acceptedBy: uid,
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  if (invite.inviteId) {
    await updateDoc(workspaceInviteDoc(invite.workspaceId, invite.inviteId), {
      status: 'awaiting_confirmation',
      acceptedBy: uid,
      acceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  }

  await syncLegacyFamilyMirror(invite.workspaceId, {
    ...memberIdentity,
    role,
    status: 'pending_confirmation',
    joinedAt: serverTimestamp(),
  }, {
    ...workspaceData,
    workspaceId: invite.workspaceId,
  })

  await setActiveWorkspaceId(uid, invite.workspaceId)
  return invite.workspaceId
}

export async function approveWorkspaceInvite(workspaceId, inviteId, actorUid = null) {
  if (!workspaceId || !inviteId) throw new Error('Convite nao selecionado')

  const inviteRef = workspaceInviteDoc(workspaceId, inviteId)
  const inviteSnap = await getDoc(inviteRef)
  if (!inviteSnap.exists()) throw new Error('Convite nao encontrado')

  const invite = { id: inviteSnap.id, ...inviteSnap.data() }
  if (invite.status !== 'awaiting_confirmation') {
    throw new Error('Este convite ainda nao esta aguardando confirmacao')
  }
  if (!invite.acceptedBy) {
    throw new Error('Este convite ainda nao foi aceito pela pessoa convidada')
  }

  const role = invite.role || 'membro'
  const workspaceSnap = await getDoc(workspaceDoc(workspaceId))
  const workspaceData = workspaceSnap.exists() ? workspaceSnap.data() : {}
  const profile = await getUserProfileData(invite.acceptedBy)
  const memberIdentity = buildMemberIdentity(invite.acceptedBy, profile)

  await setDoc(workspaceMemberDoc(workspaceId, invite.acceptedBy), {
    uid: invite.acceptedBy,
    email: memberIdentity.email,
    displayName: memberIdentity.displayName,
    name: memberIdentity.name,
    avatarInitial: memberIdentity.avatarInitial,
    role,
    status: 'active',
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })

  await setDoc(userMembershipDoc(invite.acceptedBy, workspaceId), {
    workspaceId,
    role,
    status: 'active',
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })

  await updateDoc(inviteRef, {
    status: 'accepted',
    approvedBy: actorUid || null,
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  if (invite.token) {
    await updateDoc(inviteTokenDoc(invite.token), {
      status: 'accepted',
      approvedBy: actorUid || null,
      approvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  }

  await syncLegacyFamilyMirror(workspaceId, {
    ...memberIdentity,
    role,
    status: 'active',
    joinedAt: serverTimestamp(),
  }, {
    ...workspaceData,
    workspaceId,
  })
}

export async function removeWorkspaceMember(workspaceId, actor, memberUid) {
  const actorPermissions = getPermissionsByRole(actor?.role)
  if (!actorPermissions.canRemoveMember) {
    throw new Error('Seu papel nao permite remover membros')
  }

  const memberRef = workspaceMemberDoc(workspaceId, memberUid)
  const memberSnap = await getDoc(memberRef)
  const memberData = memberSnap.exists() ? memberSnap.data() : null
  const linkedUid = String(memberData?.uid || '').trim()

  await deleteDoc(memberRef)
  if (linkedUid) {
    await deleteDoc(userMembershipDoc(linkedUid, workspaceId))
  }
  try {
    await deleteDoc(familyMemberDoc(workspaceId, memberUid))
    if (linkedUid) {
      const linkedFamily = await getDoc(userFamilyDoc(linkedUid))
      if (linkedFamily.exists() && linkedFamily.data()?.familyId === workspaceId) {
        await deleteDoc(userFamilyDoc(linkedUid))
      }
    }
  } catch (_) {
    // Compatibilidade legada: nao interrompe remocao principal.
  }
}

export async function updateWorkspaceMemberRole(workspaceId, actor, memberUid, role) {
  const actorPermissions = getPermissionsByRole(actor?.role)
  if (!actorPermissions.canChangeRoles) {
    throw new Error('Somente gestor pode alterar papéis')
  }

  const normalizedRole = normalizeWorkspaceRole(role)

  await updateDoc(workspaceMemberDoc(workspaceId, memberUid), {
    role: normalizedRole,
    updatedAt: serverTimestamp(),
  })

  const memberSnap = await getDoc(workspaceMemberDoc(workspaceId, memberUid))
  const linkedUid = String(memberSnap.exists() ? memberSnap.data()?.uid || '' : '').trim()

  if (linkedUid) {
    await setDoc(userMembershipDoc(linkedUid, workspaceId), {
      role: normalizedRole,
      updatedAt: serverTimestamp(),
    }, { merge: true })
  }

  try {
    await setDoc(familyMemberDoc(workspaceId, memberUid), {
      role: normalizedRole,
      updatedAt: serverTimestamp(),
    }, { merge: true })
  } catch (_) {
    // Compatibilidade legada: nao interrompe alteracao principal.
  }
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
