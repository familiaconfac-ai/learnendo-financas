import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import { useAuth } from './AuthContext'
import {
  ensureWorkspaceBootstrap,
  fetchUserWorkspaces,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  createWorkspace,
  createWorkspaceInvite,
  fetchWorkspaceMembers,
  fetchWorkspaceContacts,
  fetchWorkspaceNatures,
  fetchWorkspaceProjects,
  getPermissionsByRole,
  normalizeWorkspaceRole,
  upsertWorkspaceNature,
  createWorkspaceContact,
  createWorkspaceProject,
  buildContactDebtLedger,
  buildWorkspaceFinancialSummary,
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
  const [projects, setProjects] = useState([])
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
  const permissions = useMemo(() => getPermissionsByRole(myRole), [myRole])

  const reloadWorkspaceData = useCallback(async () => {
    if (!user?.uid || !activeWorkspaceId) return

    const [projectList, memberList, contactList, naturesList] = await Promise.all([
      fetchWorkspaceProjects(activeWorkspaceId),
      fetchWorkspaceMembers(activeWorkspaceId),
      fetchWorkspaceContacts(activeWorkspaceId),
      fetchWorkspaceNatures(activeWorkspaceId),
    ])
    setProjects(projectList)
    setMembers(memberList)
    setContacts(contactList)
    setTransactionNatures(naturesList)

    const tx = await fetchAllTransactionsForWorkspace(user.uid, {
      workspaceId: activeWorkspaceId,
      viewerRole: myRole,
      viewerUid: user.uid,
      includeRecurringAuto: true,
      includeLegacyPersonal: false,
    })
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
      setProjects([])
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
      const preferredExists = list.some((ws) => ws.id === preferred)
      const chosenId = preferredExists ? preferred : (list[0]?.id || null)
      setActiveWorkspace(chosenId)

      if (chosenId && chosenId !== preferred) {
        await setActiveWorkspaceId(user.uid, chosenId)
      }

      if (chosenId) {
        const selected = list.find((ws) => ws.id === chosenId)
        const role = normalizeWorkspaceRole(selected?.memberRole)
        const [projectList, memberList, contactList, naturesList] = await Promise.all([
          fetchWorkspaceProjects(chosenId),
          fetchWorkspaceMembers(chosenId),
          fetchWorkspaceContacts(chosenId),
          fetchWorkspaceNatures(chosenId),
        ])

        setProjects(projectList)
        setMembers(memberList)
        setContacts(contactList)
        setTransactionNatures(naturesList)

        const tx = await fetchAllTransactionsForWorkspace(user.uid, {
          workspaceId: chosenId,
          viewerRole: role,
          viewerUid: user.uid,
          includeRecurringAuto: true,
          includeLegacyPersonal: false,
        })
        setDebtLedger(buildContactDebtLedger(tx, contactList))
        setWorkspaceSummary(buildWorkspaceFinancialSummary(tx))
      }
    } catch (err) {
      console.error('[WorkspaceContext] load error:', err.message)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [profile, user?.uid])

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

    const [projectList, memberList, contactList, naturesList] = await Promise.all([
      fetchWorkspaceProjects(nextWorkspaceId),
      fetchWorkspaceMembers(nextWorkspaceId),
      fetchWorkspaceContacts(nextWorkspaceId),
      fetchWorkspaceNatures(nextWorkspaceId),
    ])

    setProjects(projectList)
    setMembers(memberList)
    setContacts(contactList)
    setTransactionNatures(naturesList)

    const tx = await fetchAllTransactionsForWorkspace(user.uid, {
      workspaceId: nextWorkspaceId,
      viewerRole: role,
      viewerUid: user.uid,
      includeRecurringAuto: true,
      includeLegacyPersonal: false,
    })
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

  async function createNewWorkspace(name, type = 'family') {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    const workspaceId = await createWorkspace(user.uid, { name, type, role: 'gestor' })
    await reload()
    await changeWorkspace(workspaceId)
    return workspaceId
  }

  async function createInviteLink(role = 'membro', target = {}) {
    if (!user?.uid || !activeWorkspaceId) throw new Error('Workspace não selecionado')
    if (!permissions.canInvite) throw new Error('Seu papel não pode convidar membros')
    return createWorkspaceInvite(activeWorkspaceId, user.uid, role, target)
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
        projects,
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
        createNewWorkspace,
        createInviteLink,
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
