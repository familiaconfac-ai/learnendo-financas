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

// Comunica mudanças de sessão mock para o AuthContext via eventos de window
function dispatchMock(event) {
  window.dispatchEvent(new CustomEvent(event))
}

export async function registerUser(email, password, displayName) {
  if (IS_MOCK_MODE) {
    dispatchMock('lf:mock:login')
    return { ...MOCK_USER, email, displayName }
  }
  // createUserWithEmailAndPassword throws Firebase errors — let them propagate to the UI
  const credential = await createUserWithEmailAndPassword(auth, email, password)
  // updateProfile + Firestore write are best-effort: if they fail the user is still authenticated
  try {
    await updateProfile(credential.user, { displayName })
    await setDoc(doc(db, 'users', credential.user.uid), {
      uid: credential.user.uid,
      email,
      displayName,
      role: 'user',
      createdAt: serverTimestamp(),
    })
  } catch (e) {
    console.warn('[registerUser] Profile save failed — user authenticated, Firestore record pending:', e.message)
  }
  return credential.user
}

export async function loginUser(email, password) {
  if (IS_MOCK_MODE) {
    dispatchMock('lf:mock:login')
    return MOCK_USER
  }
  const credential = await signInWithEmailAndPassword(auth, email, password)
  return credential.user
}

export async function logoutUser() {
  if (IS_MOCK_MODE) {
    dispatchMock('lf:mock:logout')
    // Limpa contexto local
    try {
      localStorage.removeItem('activeWorkspaceId');
      localStorage.removeItem('activeFamilyId');
      sessionStorage.removeItem('activeWorkspaceId');
      sessionStorage.removeItem('activeFamilyId');
    } catch {}
    return
  }
  // Limpa contexto local
  try {
    localStorage.removeItem('activeWorkspaceId');
    localStorage.removeItem('activeFamilyId');
    sessionStorage.removeItem('activeWorkspaceId');
    sessionStorage.removeItem('activeFamilyId');
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
