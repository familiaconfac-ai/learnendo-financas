import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import { useAuth } from './AuthContext'
import {
  ensureWorkspaceBootstrap,
  fetchUserWorkspaces,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  createWorkspace,
  createWorkspaceInvite,
  cancelWorkspaceInvite,
  approveWorkspaceInvite,
  fetchWorkspaceMembers,
  fetchWorkspaceContacts,
  fetchWorkspaceNatures,
  fetchWorkspaceProjects,
  fetchWorkspaceMeetingRooms,
  fetchWorkspaceInvites,
  getPermissionsByRole,
  normalizeWorkspaceRole,
  upsertWorkspaceNature,
  createWorkspaceContact,
  createWorkspaceProject,
  updateWorkspaceProject,
  createWorkspaceMeetingRoom,
  updateWorkspaceMeetingRoom,
  archiveWorkspaceMeetingRoom,
  touchWorkspaceMeetingRoom,
  buildContactDebtLedger,
  buildWorkspaceFinancialSummary,
  buildWorkspaceProjectSnapshots,
} from '../services/workspaceService'
import { fetchAllTransactionsForWorkspace } from '../services/transactionService'

const WorkspaceContext = createContext(null)

export function WorkspaceProvider({ children }) {
  const { user, profile } = useAuth()
  const [workspaces, setWorkspaces] = useState([])
  const [activeWorkspaceId, setActiveWorkspace] = useState(null)
  const [members, setMembers] = useState([])
  const [contacts, setContacts] = useState([])
  const [transactionNatures, setTransactionNatures] = useState([])
  const [invitations, setInvitations] = useState([])
  const [projects, setProjects] = useState([])
  const [meetingRooms, setMeetingRooms] = useState([])
  const [debtLedger, setDebtLedger] = useState([])
  const [workspaceSummary, setWorkspaceSummary] = useState({ receitas: 0, despesas: 0, investimentos: 0, saldo: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const activeWorkspace = useMemo(
    () => workspaces.find((ws) => ws.id === activeWorkspaceId) || null,
    [workspaces, activeWorkspaceId],
  )

  const myRole = useMemo(
    () => normalizeWorkspaceRole(activeWorkspace?.memberRole),
    [activeWorkspace?.memberRole],
  )
  const permissions = useMemo(
    () => getPermissionsByRole(myRole, activeWorkspace?.memberStatus),
    [activeWorkspace?.memberStatus, myRole],
  )

  const resolveBestWorkspaceId = useCallback(async (workspaceList, preferredId = null) => {
    const preferredExists = workspaceList.some((ws) => ws.id === preferredId)
    const initialId = preferredExists ? preferredId : (workspaceList[0]?.id || null)
    if (!user?.uid || !initialId || workspaceList.length <= 1) return initialId

    const workspaceScores = await Promise.all(
      workspaceList.map(async (ws) => {
        const role = normalizeWorkspaceRole(ws?.memberRole)
        const tx = await fetchAllTransactionsForWorkspace(user.uid, {
          workspaceId: ws.id,
          viewerRole: role,
          viewerUid: user.uid,
          includeRecurringAuto: true,
          includeLegacyPersonal: true,
        })
        return {
          workspaceId: ws.id,
          txCount: tx.length,
        }
      }),
    )

    const preferredScore = workspaceScores.find((item) => item.workspaceId === initialId)?.txCount || 0
    if (preferredScore > 0) return initialId

    const bestWorkspace = workspaceScores
      .filter((item) => item.txCount > 0)
      .sort((a, b) => b.txCount - a.txCount)[0]

    return bestWorkspace?.workspaceId || initialId
  }, [user?.uid])

  const reloadWorkspaceData = useCallback(async () => {
    if (!user?.uid || !activeWorkspaceId) return

    const [projectList, memberList, contactList, naturesList, roomList, inviteList] = await Promise.all([
      fetchWorkspaceProjects(activeWorkspaceId),
      fetchWorkspaceMembers(activeWorkspaceId),
      fetchWorkspaceContacts(activeWorkspaceId),
      fetchWorkspaceNatures(activeWorkspaceId),
      fetchWorkspaceMeetingRooms(activeWorkspaceId),
      fetchWorkspaceInvites(activeWorkspaceId),
    ])
    setProjects(projectList)
    setMembers(memberList)
    setContacts(contactList)
    setTransactionNatures(naturesList)
    setMeetingRooms(roomList)
    setInvitations(inviteList)

    const tx = await fetchAllTransactionsForWorkspace(user.uid, {
      workspaceId: activeWorkspaceId,
      viewerRole: myRole,
      viewerUid: user.uid,
      includeRecurringAuto: true,
      includeLegacyPersonal: false,
    })
    setProjects(buildWorkspaceProjectSnapshots(projectList, tx))
    setDebtLedger(buildContactDebtLedger(tx, contactList))
    setWorkspaceSummary(buildWorkspaceFinancialSummary(tx))
  }, [activeWorkspaceId, myRole, user?.uid])

  const reload = useCallback(async () => {
    if (!user?.uid) {
      setWorkspaces([])
      setActiveWorkspace(null)
      setMembers([])
      setContacts([])
      setTransactionNatures([])
      setInvitations([])
      setProjects([])
      setMeetingRooms([])
      setDebtLedger([])
      setWorkspaceSummary({ receitas: 0, despesas: 0, investimentos: 0, saldo: 0 })
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      await ensureWorkspaceBootstrap(user.uid, profile)
      const list = await fetchUserWorkspaces(user.uid)
      setWorkspaces(list)

      const preferred = await getActiveWorkspaceId(user.uid, list[0]?.id)
      const chosenId = await resolveBestWorkspaceId(list, preferred)
      setActiveWorkspace(chosenId)

      if (chosenId && chosenId !== preferred) {
        await setActiveWorkspaceId(user.uid, chosenId)
      }

      if (chosenId) {
        const selected = list.find((ws) => ws.id === chosenId)
        const role = normalizeWorkspaceRole(selected?.memberRole)
        const [projectList, memberList, contactList, naturesList, roomList, inviteList] = await Promise.all([
          fetchWorkspaceProjects(chosenId),
          fetchWorkspaceMembers(chosenId),
          fetchWorkspaceContacts(chosenId),
          fetchWorkspaceNatures(chosenId),
          fetchWorkspaceMeetingRooms(chosenId),
          fetchWorkspaceInvites(chosenId),
        ])

        setMembers(memberList)
        setContacts(contactList)
        setTransactionNatures(naturesList)
        setMeetingRooms(roomList)
        setInvitations(inviteList)

        const tx = await fetchAllTransactionsForWorkspace(user.uid, {
          workspaceId: chosenId,
          viewerRole: role,
          viewerUid: user.uid,
          includeRecurringAuto: true,
          includeLegacyPersonal: false,
        })
        setProjects(buildWorkspaceProjectSnapshots(projectList, tx))
        setDebtLedger(buildContactDebtLedger(tx, contactList))
        setWorkspaceSummary(buildWorkspaceFinancialSummary(tx))
      }
    } catch (err) {
      console.error('[WorkspaceContext] load error:', err.message)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [profile, resolveBestWorkspaceId, user?.uid])

  useEffect(() => {
    reload()
  }, [reload])

  async function changeWorkspace(nextWorkspaceId) {
    if (!user?.uid || !nextWorkspaceId) return
    if (!workspaces.some((ws) => ws.id === nextWorkspaceId)) return
    await setActiveWorkspaceId(user.uid, nextWorkspaceId)
    setActiveWorkspace(nextWorkspaceId)

    const selected = workspaces.find((ws) => ws.id === nextWorkspaceId)
    const role = normalizeWorkspaceRole(selected?.memberRole)

    const [projectList, memberList, contactList, naturesList, roomList, inviteList] = await Promise.all([
      fetchWorkspaceProjects(nextWorkspaceId),
      fetchWorkspaceMembers(nextWorkspaceId),
      fetchWorkspaceContacts(nextWorkspaceId),
      fetchWorkspaceNatures(nextWorkspaceId),
      fetchWorkspaceMeetingRooms(nextWorkspaceId),
      fetchWorkspaceInvites(nextWorkspaceId),
    ])

    setMembers(memberList)
    setContacts(contactList)
    setTransactionNatures(naturesList)
    setMeetingRooms(roomList)
    setInvitations(inviteList)

    const tx = await fetchAllTransactionsForWorkspace(user.uid, {
      workspaceId: nextWorkspaceId,
      viewerRole: role,
      viewerUid: user.uid,
      includeRecurringAuto: true,
      includeLegacyPersonal: false,
    })
    setProjects(buildWorkspaceProjectSnapshots(projectList, tx))
    setDebtLedger(buildContactDebtLedger(tx, contactList))
    setWorkspaceSummary(buildWorkspaceFinancialSummary(tx))
  }

  async function renameNatureInline(natureId, label) {
    if (!activeWorkspaceId) return
    await upsertWorkspaceNature(activeWorkspaceId, natureId, { label })
    setTransactionNatures((prev) => prev.map((n) => (n.id === natureId ? { ...n, label } : n)))
  }

  async function addExternalContact(name) {
    if (!activeWorkspaceId || !name?.trim()) return null
    const id = await createWorkspaceContact(activeWorkspaceId, {
      name: name.trim(),
      type: 'external',
    })
    const contact = { id, name: name.trim(), type: 'external' }
    setContacts((prev) => [...prev, contact])
    return contact
  }

  async function addProject(data) {
    if (!user?.uid || !activeWorkspaceId) throw new Error('Workspace nao selecionado')
    const projectId = await createWorkspaceProject(activeWorkspaceId, data, user.uid)
    await reloadWorkspaceData()
    return projectId
  }

  async function editProject(projectId, data) {
    if (!user?.uid || !activeWorkspaceId) throw new Error('Workspace nao selecionado')
    await updateWorkspaceProject(activeWorkspaceId, projectId, data)
    await reloadWorkspaceData()
  }

  async function addMeetingRoom(data) {
    if (!user?.uid || !activeWorkspaceId) throw new Error('Workspace nao selecionado')
    const roomId = await createWorkspaceMeetingRoom(activeWorkspaceId, data, user.uid)
    await reloadWorkspaceData()
    return roomId
  }

  async function editMeetingRoom(roomId, data) {
    if (!user?.uid || !activeWorkspaceId) throw new Error('Workspace nao selecionado')
    await updateWorkspaceMeetingRoom(activeWorkspaceId, roomId, data)
    await reloadWorkspaceData()
  }

  async function archiveMeetingRoom(roomId) {
    if (!user?.uid || !activeWorkspaceId) throw new Error('Workspace nao selecionado')
    await archiveWorkspaceMeetingRoom(activeWorkspaceId, roomId)
    await reloadWorkspaceData()
  }

  async function markMeetingRoomOpened(roomId) {
    if (!user?.uid || !activeWorkspaceId || !roomId) return
    await touchWorkspaceMeetingRoom(activeWorkspaceId, roomId, user.uid)
    await reloadWorkspaceData()
  }

  async function createNewWorkspace(name, type = 'family') {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    const workspaceId = await createWorkspace(user.uid, { name, type, role: 'gestor' })
    await reload()
    await changeWorkspace(workspaceId)
    return workspaceId
  }

  async function createInviteLink(role = 'membro', target = {}, workspaceIdOverride = null) {
    const resolvedWorkspaceId = workspaceIdOverride || activeWorkspaceId
    if (!user?.uid || !resolvedWorkspaceId) throw new Error('Workspace não selecionado')
    if (!permissions.canInvite) throw new Error('Seu papel não pode convidar membros')
    const invite = await createWorkspaceInvite(resolvedWorkspaceId, user.uid, role, target)
    await reloadWorkspaceData()
    return invite
  }

  async function cancelInvite(inviteId) {
    if (!user?.uid || !activeWorkspaceId || !inviteId) throw new Error('Convite não selecionado')
    if (!permissions.canInvite) throw new Error('Seu papel não pode cancelar convites')
    await cancelWorkspaceInvite(activeWorkspaceId, inviteId)
    await reloadWorkspaceData()
  }

  async function approveInvite(inviteId) {
    if (!user?.uid || !activeWorkspaceId || !inviteId) throw new Error('Convite nao selecionado')
    if (!permissions.canInvite) throw new Error('Seu papel nao pode confirmar convites')
    await approveWorkspaceInvite(activeWorkspaceId, inviteId, user.uid)
    await reloadWorkspaceData()
  }

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspace,
        activeWorkspaceId,
        myRole,
        permissions,
        members,
        contacts,
        invitations,
        projects,
        meetingRooms,
        debtLedger,
        workspaceSummary,
        transactionNatures,
        loading,
        error,
        reload,
        reloadWorkspaceData,
        changeWorkspace,
        renameNatureInline,
        addExternalContact,
        addProject,
        editProject,
        addMeetingRoom,
        editMeetingRoom,
        archiveMeetingRoom,
        markMeetingRoomOpened,
        createNewWorkspace,
        createInviteLink,
        cancelInvite,
        approveInvite,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace deve ser usado dentro de <WorkspaceProvider>')
  return ctx
}
