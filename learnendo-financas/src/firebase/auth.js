import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from './config'
import { IS_MOCK_MODE, MOCK_USER } from './mockMode'
import { ensureUserRegistryProfile, normalizeUserEmail } from '../services/userRegistryService'

// Comunica mudancas de sessao mock para o AuthContext via eventos de window
function dispatchMock(event) {
  window.dispatchEvent(new CustomEvent(event))
}

export async function registerUser(email, password, displayName) {
  if (IS_MOCK_MODE) {
    dispatchMock('lf:mock:login')
    return { ...MOCK_USER, email, displayName }
  }

  const credential = await createUserWithEmailAndPassword(auth, email, password)

  try {
    await updateProfile(credential.user, { displayName })
    await ensureUserRegistryProfile(credential.user, displayName)
  } catch (e) {
    console.warn('[registerUser] Profile save failed - user authenticated, Firestore record pending:', e.message)
  }

  return credential.user
}

export async function loginUser(email, password) {
  if (IS_MOCK_MODE) {
    dispatchMock('lf:mock:login')
    return MOCK_USER
  }

  const credential = await signInWithEmailAndPassword(auth, email, password)
  try {
    await ensureUserRegistryProfile(credential.user)
  } catch (e) {
    console.warn('[loginUser] Profile sync failed:', e.message)
  }
  return credential.user
}

export async function logoutUser() {
  if (IS_MOCK_MODE) {
    dispatchMock('lf:mock:logout')
    try {
      localStorage.removeItem('activeWorkspaceId')
      localStorage.removeItem('activeFamilyId')
      sessionStorage.removeItem('activeWorkspaceId')
      sessionStorage.removeItem('activeFamilyId')
    } catch {}
    return
  }

  try {
    localStorage.removeItem('activeWorkspaceId')
    localStorage.removeItem('activeFamilyId')
    sessionStorage.removeItem('activeWorkspaceId')
    sessionStorage.removeItem('activeFamilyId')
  } catch {}

  await signOut(auth)
}

export async function getUserProfile(uid) {
  if (IS_MOCK_MODE) return null
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? snap.data() : null
}

export async function resetPassword(email) {
  if (IS_MOCK_MODE) return
  await sendPasswordResetEmail(auth, email)
}

export async function updateUserProfileData(uid, data) {
  if (IS_MOCK_MODE) {
    dispatchMock('lf:mock:login')
    return
  }

  const safe = {
    displayName: data.displayName || '',
    photoURL: data.photoURL || '',
    preferredCurrency: data.preferredCurrency || 'BRL',
    preferredExpenseCategoryId: data.preferredExpenseCategoryId || null,
    email: normalizeUserEmail(data.email || auth.currentUser?.email || ''),
    updatedAt: serverTimestamp(),
  }

  if (auth.currentUser && auth.currentUser.uid === uid) {
    await updateProfile(auth.currentUser, {
      displayName: safe.displayName || auth.currentUser.displayName || '',
      photoURL: safe.photoURL || auth.currentUser.photoURL || '',
    })
  }

  await setDoc(doc(db, 'users', uid), safe, { merge: true })
}
