/**
 * useFamilia.js
 *
 * React hook for the Family module.
 * Reads from Firestore in real mode, uses mock data in IS_MOCK_MODE.
 *
 * Returns:
 *   family       – family document { id, name, plan, ownerUid, ... }
 *   members      – array of member objects
 *   invitations  – array of invitation objects
 *   loading      – boolean
 *   error        – string | null
 *   myRole       – 'gestor' | 'co-gestor' | 'membro' | 'planejador'
 *   canManage    – boolean (gestor or co-gestor)
 *   create(name)
 *   editName(name)
 *   deleteFamily()
 *   removeMember(memberId)
 *   changeRole(memberId, newRole)
 *   inviteMember(data)
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { IS_MOCK_MODE } from '../firebase/mockMode'
import {
  fetchUserFamily,
  fetchAllUserFamilies,
  createFamily,
  updateFamily,
  deleteFamily as deleteFamilyDoc,
  fetchMembers,
  updateMemberRole,
  removeMember,
  fetchInvitations,
  addInvitation,
  addMember,
} from '../services/familyService'
import {
  MOCK_FAMILY,
  MOCK_FAMILY_MEMBERS,
  MOCK_FAMILY_INVITATIONS,
} from '../utils/mockData'

// Normalise legacy role values to new canonical names
function normaliseRole(role) {
  const map = {
    owner:  'gestor',
    admin:  'co-gestor',
    member: 'membro',
    viewer: 'planejador',
  }
  return map[role] ?? role
}

export function useFamilia() {
  const { user } = useAuth()

  const [families,    setFamilies]    = useState([])
  const [family,      setFamily]      = useState(null)
  const [members,     setMembers]     = useState([])
  const [invitations, setInvitations] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    if (!user?.uid) { setLoading(false); return }

    setLoading(true)
    setError(null)

    try {
      if (IS_MOCK_MODE) {
        // Normalise mock member roles
        const normMembers = MOCK_FAMILY_MEMBERS.map((m) => ({
          ...m,
          id:   m.uid,                    // use uid as id in mock
          role: normaliseRole(m.role),
        }))
        setFamilies([MOCK_FAMILY])
        setFamily(MOCK_FAMILY)
        setMembers(normMembers)
        setInvitations(MOCK_FAMILY_INVITATIONS)
        setLoading(false)
        return
      }

      // Busca todas as famílias do usuário (owner ou membro)
      const fams = await fetchAllUserFamilies(user.uid)
      setFamilies(fams)
      // Seleciona a primeira família (ou nenhuma)
      const fam = fams[0] || null
      setFamily(fam)

      if (fam?.id) {
        const [rawMembers, rawInvites] = await Promise.all([
          fetchMembers(fam._owner ? user.uid : fam.ownerUid, fam.id),
          fetchInvitations(fam._owner ? user.uid : fam.ownerUid, fam.id),
        ])
        setMembers(rawMembers.map((m) => ({ ...m, role: normaliseRole(m.role) })))
        setInvitations(rawInvites)
      } else {
        setMembers([])
        setInvitations([])
      }
    } catch (err) {
      console.error('[useFamilia] Load error:', err.message)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user?.uid])

  useEffect(() => { loadAll() }, [loadAll])

  // ── Derived values ────────────────────────────────────────────────────────

  const myMember  = members.find((m) => m.uid === user?.uid || m.id === user?.uid) ?? null
  const myRole    = myMember?.role ?? (family?.ownerUid === user?.uid ? 'gestor' : 'planejador')
  const canManage = myRole === 'gestor' || myRole === 'co-gestor'

  // ── Mutations ─────────────────────────────────────────────────────────────

  async function create(name) {
    if (!user?.uid) throw new Error('Não autenticado')
    if (IS_MOCK_MODE) {
      setFamily({ ...MOCK_FAMILY, name, id: 'mock-new' })
      setMembers([
        {
          id: user.uid,
          uid: user.uid,
          displayName: user.displayName || user.email || 'Você',
          email: user.email || '',
          role: 'gestor',
          status: 'active',
        },
      ])
      return
    }
    const famId = await createFamily(user.uid, { name })
    await addMember(user.uid, famId, {
      uid: user.uid,
      displayName: user.displayName || user.email || 'Você',
      email: user.email || '',
      role: 'gestor',
      status: 'active',
      avatarInitial: (user.displayName || user.email || 'V').trim().charAt(0).toUpperCase(),
    })
    await loadAll()
    return famId
  }

  async function editName(name) {
    if (!user?.uid || !family?.id) throw new Error('Família não encontrada')
    if (IS_MOCK_MODE) {
      setFamily((f) => ({ ...f, name }))
      return
    }
    await updateFamily(user.uid, family.id, { name })
    setFamily((f) => ({ ...f, name }))
  }

  async function deleteFamily() {
    if (!user?.uid || !family?.id) throw new Error('Família não encontrada')
    if (IS_MOCK_MODE) {
      setFamily(null)
      setMembers([])
      setInvitations([])
      return
    }
    await deleteFamilyDoc(user.uid, family.id)
    setFamily(null)
    setMembers([])
    setInvitations([])
  }

  async function removeMemberById(memberId) {
    if (!user?.uid || !family?.id) return
    if (IS_MOCK_MODE) {
      setMembers((ms) => ms.filter((m) => m.id !== memberId && m.uid !== memberId))
      return
    }
    await removeMember(user.uid, family.id, memberId)
    setMembers((ms) => ms.filter((m) => m.id !== memberId))
  }

  async function changeRole(memberId, role) {
    if (!user?.uid || !family?.id) return
    if (IS_MOCK_MODE) {
      setMembers((ms) =>
        ms.map((m) => (m.id === memberId || m.uid === memberId ? { ...m, role } : m)),
      )
      return
    }
    await updateMemberRole(user.uid, family.id, memberId, role)
    setMembers((ms) => ms.map((m) => (m.id === memberId ? { ...m, role } : m)))
  }

  async function inviteMember(data) {
    if (!user?.uid || !family?.id) throw new Error('Família não encontrada')
    if (IS_MOCK_MODE) {
      const newInv = {
        id:      Date.now().toString(),
        ...data,
        status:  'pending',
        sentAt:  new Date().toISOString(),
        sentBy:  user.uid,
      }
      setInvitations((inv) => [...inv, newInv])
      return
    }
    await addInvitation(user.uid, family.id, data)
    await loadAll()
  }

  return {
    families,
    family,
    members,
    invitations,
    loading,
    error,
    myRole,
    canManage,
    reload: loadAll,
    create,
    editName,
    deleteFamily,
    removeMember: removeMemberById,
    changeRole,
    inviteMember,
    setFamily, // permite selecionar família ativa se necessário
  }
}
