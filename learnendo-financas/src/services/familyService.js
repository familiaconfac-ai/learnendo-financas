import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'

function familyDoc(familyId) {
  const db = getFirestore()
  return doc(db, 'families', familyId)
}

function memberCol(familyId) {
  const db = getFirestore()
  return collection(db, 'families', familyId, 'members')
}

function memberDoc(familyId, memberId) {
  const db = getFirestore()
  return doc(db, 'families', familyId, 'members', memberId)
}

function inviteCol(familyId) {
  const db = getFirestore()
  return collection(db, 'families', familyId, 'invitations')
}

function inviteDoc(familyId, inviteId) {
  const db = getFirestore()
  return doc(db, 'families', familyId, 'invitations', inviteId)
}

function userFamilyDoc(uid) {
  const db = getFirestore()
  return doc(db, 'userFamilies', uid)
}

export async function updateFamily(_actorUid, familyId, data) {
  await updateDoc(familyDoc(familyId), {
    ...data,
    updatedAt: serverTimestamp(),
  })
}

export async function createFamily(uid, { name, plan = 'family' }) {
  const db = getFirestore()
  const famRef = await addDoc(collection(db, 'families'), {
    name,
    plan,
    ownerUid: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  await setDoc(memberDoc(famRef.id, uid), {
    uid,
    email: null,
    displayName: null,
    role: 'gestor',
    joinedAt: serverTimestamp(),
    status: 'active',
    updatedAt: serverTimestamp(),
  })

  await setDoc(userFamilyDoc(uid), {
    familyId: famRef.id,
    updatedAt: serverTimestamp(),
  })

  return famRef.id
}

export async function fetchUserFamily(uid) {
  try {
    const membershipSnap = await getDoc(userFamilyDoc(uid))
    if (!membershipSnap.exists()) return null

    const familyId = membershipSnap.data()?.familyId
    if (!familyId) return null

    const [familySnap, memberSnap] = await Promise.all([
      getDoc(familyDoc(familyId)),
      getDoc(memberDoc(familyId, uid)),
    ])

    if (!familySnap.exists() || !memberSnap.exists()) {
      await deleteDoc(userFamilyDoc(uid))
      return null
    }

    return { id: familySnap.id, ...familySnap.data() }
  } catch (error) {
    if (error?.code === 'permission-denied') {
      console.warn('[FamilyService] stale or unauthorized family link for uid:', uid)
      return null
    }
    throw error
  }
}

export async function deleteFamily(_actorUid, familyId) {
  console.log('[FamilyService] deleting family', familyId)

  const [membersSnap, invitesSnap] = await Promise.all([
    getDocs(memberCol(familyId)),
    getDocs(inviteCol(familyId)),
  ])

  const userFamilyDeletes = membersSnap.docs
    .map((member) => member.data()?.uid)
    .filter(Boolean)
    .map((uid) => deleteDoc(userFamilyDoc(uid)))

  const subDeletes = [
    ...membersSnap.docs.map((member) => deleteDoc(member.ref)),
    ...invitesSnap.docs.map((invite) => deleteDoc(invite.ref)),
    ...userFamilyDeletes,
  ]

  await Promise.all(subDeletes)
  await deleteDoc(familyDoc(familyId))
}

export async function fetchMembers(_actorUid, familyId) {
  try {
    const snap = await getDocs(query(memberCol(familyId), orderBy('joinedAt', 'asc')))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.warn('[FamilyService] fetchMembers fallback:', err.message)
    const snap = await getDocs(memberCol(familyId))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  }
}

export async function addMember(_actorUid, familyId, memberData) {
  const normalizedEmail = typeof memberData.email === 'string'
    ? memberData.email.trim().toLowerCase()
    : ''

  const payload = {
    ...memberData,
    email: normalizedEmail || '',
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  if (memberData.uid) {
    await setDoc(memberDoc(familyId, memberData.uid), payload, { merge: true })
    await setDoc(userFamilyDoc(memberData.uid), {
      familyId,
      updatedAt: serverTimestamp(),
    })
    return memberData.uid
  }

  const ref = await addDoc(memberCol(familyId), payload)
  return ref.id
}

export async function updateMemberRole(_actorUid, familyId, memberId, role) {
  await updateDoc(memberDoc(familyId, memberId), {
    role,
    updatedAt: serverTimestamp(),
  })
}

export async function removeMember(_actorUid, familyId, memberId) {
  const targetRef = memberDoc(familyId, memberId)
  const targetSnap = await getDoc(targetRef)
  if (!targetSnap.exists()) return

  const memberUid = targetSnap.data()?.uid
  await deleteDoc(targetRef)

  if (memberUid) {
    const membershipSnap = await getDoc(userFamilyDoc(memberUid))
    if (membershipSnap.exists() && membershipSnap.data()?.familyId === familyId) {
      await deleteDoc(userFamilyDoc(memberUid))
    }
  }
}

export async function fetchInvitations(_actorUid, familyId) {
  const snap = await getDocs(inviteCol(familyId))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function addInvitation(actorUid, familyId, data) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const ref = await addDoc(inviteCol(familyId), {
    ...data,
    status: 'pending',
    sentAt: serverTimestamp(),
    expiresAt,
    sentBy: actorUid,
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function cancelInvitation(_actorUid, familyId, inviteId) {
  await updateDoc(inviteDoc(familyId, inviteId), {
    status: 'cancelled',
    updatedAt: serverTimestamp(),
  })
}

export async function addPendingMember(actorUid, familyId, email, role = 'membro') {
  const normalizedEmail = email.trim().toLowerCase()
  const ref = await addDoc(memberCol(familyId), {
    email: normalizedEmail,
    uid: null,
    displayName: normalizedEmail,
    name: normalizedEmail,
    role,
    status: 'pending',
    invitedBy: actorUid,
    joinedAt: serverTimestamp(),
    invitedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return {
    id: ref.id,
    email: normalizedEmail,
    displayName: normalizedEmail,
    name: normalizedEmail,
    role,
    status: 'pending',
    uid: null,
  }
}
