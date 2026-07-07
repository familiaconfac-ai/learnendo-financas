import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { IS_MOCK_MODE } from '../firebase/mockMode'
import {
  archiveWorkspace,
  cancelWorkspaceInvite,
  createWorkspaceMember,
  fetchWorkspaceInvites,
  fetchWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceDetails,
  updateWorkspaceMemberRole,
} from '../services/workspaceService'
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
  const {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    createNewWorkspace,
    myRole: workspaceRole,
    reload: reloadWorkspaces,
  } = useWorkspace()

  const familyWorkspace = useMemo(() => {
    if (activeWorkspace?.type === 'family') return activeWorkspace
    return (workspaces || []).find((workspace) => workspace.type === 'family') || null
  }, [activeWorkspace, workspaces])

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

      if (!familyWorkspace?.id) {
        setFamilies([])
        setFamily(null)
        setMembers([])
        setInvitations([])
        return
      }

      const [rawMembers, rawInvites] = await Promise.all([
        fetchWorkspaceMembers(familyWorkspace.id),
        fetchWorkspaceInvites(familyWorkspace.id),
      ])

      setFamilies([familyWorkspace])
      setFamily(familyWorkspace)
      setMembers(rawMembers.map((member) => ({ ...member, role: normaliseRole(member.role) })))
      setInvitations(rawInvites)
    } catch (err) {
      console.error('[useFamilia] Load error:', err.message)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [familyWorkspace, user?.uid])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const myMember = members.find((m) => m.uid === user?.uid || m.id === user?.uid) ?? null
  const myRole = myMember?.role ?? workspaceRole ?? (family?.ownerUid === user?.uid ? 'gestor' : 'planejador')
  const canManage = myRole === 'gestor' || myRole === 'co-gestor'
  const actor = { uid: user?.uid || null, role: myRole }

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

    const familyId = await createNewWorkspace(name, 'family')
    await loadAll()
    return familyId
  }

  async function editName(name) {
    if (!user?.uid || !family?.id) throw new Error('Familia nao encontrada')
    if (IS_MOCK_MODE) {
      setFamily((f) => ({ ...f, name }))
      return
    }
    await updateWorkspaceDetails(family.id, { name })
    await reloadWorkspaces()
    await loadAll()
  }

  async function deleteFamily() {
    if (!user?.uid || !family?.id) throw new Error('Familia nao encontrada')
    if (IS_MOCK_MODE) {
      setFamily(null)
      setMembers([])
      setInvitations([])
      return
    }
    await archiveWorkspace(family.id, user.uid)
    await reloadWorkspaces()
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
    await removeWorkspaceMember(family.id, actor, memberId)
    await loadAll()
  }

  async function changeRole(memberId, role) {
    if (!user?.uid || !family?.id) return
    if (IS_MOCK_MODE) {
      setMembers((ms) =>
        ms.map((m) => (m.id === memberId || m.uid === memberId ? { ...m, role } : m)),
      )
      return
    }
    await updateWorkspaceMemberRole(family.id, actor, memberId, role)
    await loadAll()
  }

  async function addMember(data) {
    if (!user?.uid || !family?.id) throw new Error('Familia nao encontrada')
    if (IS_MOCK_MODE) {
      setMembers((current) => [
        ...current,
        {
          id: Date.now().toString(),
          ...data,
          role: normaliseRole(data.role),
        },
      ])
      return
    }
    await createWorkspaceMember(family.id, actor, data)
    await loadAll()
  }

  async function inviteMember() {
    throw new Error('Use o fluxo de convite do workspace para adicionar membros')
  }

  async function cancelInvite(inviteId) {
    if (!user?.uid || !family?.id || !inviteId) return
    if (IS_MOCK_MODE) {
      setInvitations((current) => current.map((invite) => (
        invite.id === inviteId ? { ...invite, status: 'cancelled' } : invite
      )))
      return
    }
    await cancelWorkspaceInvite(family.id, inviteId)
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
    addMember,
    inviteMember,
    cancelInvite,
    setFamily,
  }
}
