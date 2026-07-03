import { doc, getDoc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

const ADMIN_EMAIL = normalizeUserEmail(import.meta.env.VITE_ADMIN_EMAIL)

function registrationStatsDoc() {
  return doc(db, 'appStats', 'registration')
}

function userProfileDoc(uid) {
  return doc(db, 'users', uid)
}

export function normalizeUserEmail(value = '') {
  return String(value || '').trim().toLowerCase()
}

export function isAdminEmail(email = '') {
  return !!ADMIN_EMAIL && normalizeUserEmail(email) === ADMIN_EMAIL
}

export function formatUserCode(userNumber) {
  const numeric = Number(userNumber || 0)
  if (!Number.isFinite(numeric) || numeric <= 0) return ''
  return String(Math.trunc(numeric)).padStart(4, '0')
}

export async function claimNextUserNumber(actorUid = '') {
  return runTransaction(db, async (transaction) => {
    const statsRef = registrationStatsDoc()
    const statsSnap = await transaction.get(statsRef)
    const current = Number(statsSnap.exists() ? statsSnap.data()?.lastUserNumber : 0) || 0
    const next = current + 1

    transaction.set(statsRef, {
      lastUserNumber: next,
      lastAssignedUid: actorUid || null,
      updatedAt: serverTimestamp(),
    }, { merge: true })

    return next
  })
}

export async function ensureUserRegistryProfile(firebaseUser, preferredDisplayName = '') {
  if (!firebaseUser?.uid) return null

  const profileRef = userProfileDoc(firebaseUser.uid)
  const profileSnap = await getDoc(profileRef)
  const existing = profileSnap.exists() ? profileSnap.data() : {}
  const email = normalizeUserEmail(firebaseUser.email || existing.email || '')
  const admin = isAdminEmail(email) || existing.role === 'admin'

  let userNumber = Number(existing.userNumber || 0) || 0
  let memberCode = String(existing.memberCode || '').trim()

  if (admin) {
    userNumber = 0
    memberCode = 'ADMIN'
  } else if (!userNumber) {
    userNumber = await claimNextUserNumber(firebaseUser.uid)
    memberCode = formatUserCode(userNumber)
  }

  const resolvedDisplayName = String(
    preferredDisplayName
    || firebaseUser.displayName
    || existing.displayName
    || email
    || 'Usuario',
  ).trim()

  const payload = {
    uid: firebaseUser.uid,
    email,
    displayName: resolvedDisplayName,
    role: admin ? 'admin' : (existing.role || 'user'),
    memberCode: memberCode || null,
    userNumber: admin ? null : userNumber,
    lastLoginAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  if (!profileSnap.exists()) {
    payload.createdAt = serverTimestamp()
  }

  await setDoc(profileRef, payload, { merge: true })
  return {
    ...existing,
    ...payload,
    memberCode: memberCode || null,
    userNumber: admin ? null : userNumber,
  }
}

export async function assignUserCodeToExistingUser(user) {
  if (!user?.uid) return null

  const email = normalizeUserEmail(user.email)
  const admin = isAdminEmail(email) || user.role === 'admin'
  const profileRef = userProfileDoc(user.uid)

  if (admin) {
    await setDoc(profileRef, {
      role: 'admin',
      memberCode: 'ADMIN',
      userNumber: null,
      updatedAt: serverTimestamp(),
    }, { merge: true })

    return { ...user, role: 'admin', memberCode: 'ADMIN', userNumber: null }
  }

  if (Number(user.userNumber || 0) > 0) {
    return {
      ...user,
      memberCode: user.memberCode || formatUserCode(user.userNumber),
    }
  }

  const userNumber = await claimNextUserNumber(user.uid)
  const memberCode = formatUserCode(userNumber)

  await setDoc(profileRef, {
    userNumber,
    memberCode,
    updatedAt: serverTimestamp(),
  }, { merge: true })

  return {
    ...user,
    userNumber,
    memberCode,
  }
}
