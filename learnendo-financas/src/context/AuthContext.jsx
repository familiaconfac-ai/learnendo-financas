import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase/config'
import { getUserProfile } from '../firebase/auth'
import { IS_MOCK_MODE, MOCK_USER, MOCK_PROFILE } from '../firebase/mockMode'

const AuthContext = createContext(null)

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL

export function AuthProvider({ children }) {
  // Em mock mode, inicia já autenticado — sem nenhuma chamada ao Firebase
  const [user, setUser] = useState(IS_MOCK_MODE ? MOCK_USER : null)
  const [profile, setProfile] = useState(IS_MOCK_MODE ? MOCK_PROFILE : null)
  const [loading, setLoading] = useState(!IS_MOCK_MODE)

  useEffect(() => {
    if (IS_MOCK_MODE) {
      // Escuta eventos disparados por auth.js para login/logout mock
      function handleLogin()  { setUser(MOCK_USER);  setProfile(MOCK_PROFILE) }
      function handleLogout() { setUser(null);       setProfile(null) }
      window.addEventListener('lf:mock:login',  handleLogin)
      window.addEventListener('lf:mock:logout', handleLogout)
      return () => {
        window.removeEventListener('lf:mock:login',  handleLogin)
        window.removeEventListener('lf:mock:logout', handleLogout)
      }
    }

    // Modo Firebase real
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser)
        try {
          const profileData = await getUserProfile(firebaseUser.uid)
          // Fallback: if Firestore profile wasn't saved (e.g. registration failed mid-way)
          setProfile(profileData ?? {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            role: 'user',
          })
        } catch (e) {
          console.warn('[AuthContext] Could not load profile:', e.message)
          setProfile({ uid: firebaseUser.uid, email: firebaseUser.email, displayName: firebaseUser.displayName, role: 'user' })
        }
      } else {
        setUser(null)
        setProfile(null)
      }
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const refreshProfile = useCallback(async () => {
    if (IS_MOCK_MODE) {
      setProfile(MOCK_PROFILE)
      return
    }
    if (!user?.uid) return
    try {
      const profileData = await getUserProfile(user.uid)
      if (profileData) setProfile((prev) => ({ ...prev, ...profileData }))
    } catch (e) {
      console.warn('[AuthContext] refreshProfile failed:', e.message)
    }
  }, [user?.uid])

  const isAdmin =
    user?.email === ADMIN_EMAIL || profile?.role === 'admin'

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAdmin, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}
