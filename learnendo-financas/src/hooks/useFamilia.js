import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { IS_MOCK_MODE } from '../firebase/mockMode'
import {
  fetchUserFamily,
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

function normaliseRole(role) {
  const map = {
    owner: 'gestor',
    admin: 'co-gestor',
    member: 'membro',
    viewer: 'planejador',
  }
  return map[role] ?? role
}

export function useFamilia() {
  const { user } = useAuth()

  const [families, setFamilies] = useState([])
  const [family, setFamily] = useState(null)
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setFamilies([])
    setFamily(null)
    setMembers([])
    setInvitations([])
    setLoading(!!user?.uid)
    setError(null)
  }, [user?.uid])

  const loadAll = useCallback(async () => {
    if (!user?.uid) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      if (IS_MOCK_MODE) {
        const normMembers = MOCK_FAMILY_MEMBERS.map((m) => ({
          ...m,
          id: m.uid,
          role: normaliseRole(m.role),
        }))
        setFamilies([MOCK_FAMILY])
        setFamily(MOCK_FAMILY)
        setMembers(normMembers)
        setInvitations(MOCK_FAMILY_INVITATIONS)
        setLoading(false)
        return
      }

      const fam = await fetchUserFamily(user.uid)
      setFamilies(fam ? [fam] : [])
      setFamily(fam)

      if (!fam?.id) {
        setMembers([])
        setInvitations([])
        return
      }

      const [rawMembers, rawInvites] = await Promise.all([
        fetchMembers(user.uid, fam.id),
        fetchInvitations(user.uid, fam.id),
      ])

      setMembers(rawMembers.map((m) => ({ ...m, role: normaliseRole(m.role) })))
      setInvitations(rawInvites)
    } catch (err) {
      console.error('[useFamilia] Load error:', err.message)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user?.uid])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const myMember = members.find((m) => m.uid === user?.uid || m.id === user?.uid) ?? null
  const myRole = myMember?.role ?? (family?.ownerUid === user?.uid ? 'gestor' : 'planejador')
  const canManage = myRole === 'gestor' || myRole === 'co-gestor'

  async function create(name) {
    if (!user?.uid) throw new Error('Nao autenticado')
    if (IS_MOCK_MODE) {
      setFamily({ ...MOCK_FAMILY, name, id: 'mock-new' })
      setMembers([
        {
          id: user.uid,
          uid: user.uid,
          displayName: user.displayName || user.email || 'Voce',
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
      displayName: user.displayName || user.email || 'Voce',
      email: user.email || '',
      role: 'gestor',
      status: 'active',
      avatarInitial: (user.displayName || user.email || 'V').trim().charAt(0).toUpperCase(),
    })
    await loadAll()
    return famId
  }

  async function editName(name) {
    if (!user?.uid || !family?.id) throw new Error('Familia nao encontrada')
    if (IS_MOCK_MODE) {
      setFamily((f) => ({ ...f, name }))
      return
    }
    await updateFamily(user.uid, family.id, { name })
    setFamily((f) => ({ ...f, name }))
  }

  async function deleteFamily() {
    if (!user?.uid || !family?.id) throw new Error('Familia nao encontrada')
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
    setMembers((ms) => ms.filter((m) => m.id !== memberId && m.uid !== memberId))
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
    setMembers((ms) =>
      ms.map((m) => (m.id === memberId || m.uid === memberId ? { ...m, role } : m)),
    )
  }

  async function inviteMember(data) {
    if (!user?.uid || !family?.id) throw new Error('Familia nao encontrada')
    if (IS_MOCK_MODE) {
      const newInv = {
        id: Date.now().toString(),
        ...data,
        status: 'pending',
        sentAt: new Date().toISOString(),
        sentBy: user.uid,
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
    setFamily,
  }
}
