import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import { useAuth } from './AuthContext'
import {
  ensureWorkspaceBootstrap,
  fetchUserWorkspaces,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  fetchWorkspaceMembers,
  fetchWorkspaceContacts,
  fetchWorkspaceNatures,
  getPermissionsByRole,
  upsertWorkspaceNature,
  createWorkspaceContact,
  buildContactDebtLedger,
} from '../services/workspaceService'
import { fetchTransactionsWithOptions } from '../services/transactionService'

const WorkspaceContext = createContext(null)

export function WorkspaceProvider({ children }) {
  const { user, profile } = useAuth()
  const [workspaces, setWorkspaces] = useState([])
  const [activeWorkspaceId, setActiveWorkspace] = useState(null)
  const [members, setMembers] = useState([])
  const [contacts, setContacts] = useState([])
  const [transactionNatures, setTransactionNatures] = useState([])
  const [debtLedger, setDebtLedger] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const activeWorkspace = useMemo(
    () => workspaces.find((ws) => ws.id === activeWorkspaceId) || null,
    [workspaces, activeWorkspaceId],
  )

  const myRole = activeWorkspace?.memberRole || 'membro'
  const permissions = useMemo(() => getPermissionsByRole(myRole), [myRole])

  const reloadWorkspaceData = useCallback(async () => {
    if (!user?.uid || !activeWorkspaceId) return

    const [memberList, contactList, natures] = await Promise.all([
      fetchWorkspaceMembers(activeWorkspaceId),
      fetchWorkspaceContacts(activeWorkspaceId),
      fetchWorkspaceNatures(activeWorkspaceId),
    ])

    setMembers(memberList)
    setContacts(contactList)
    setTransactionNatures(natures)

    const now = new Date()
    const tx = await fetchTransactionsWithOptions(user.uid, now.getFullYear(), now.getMonth() + 1, {
      workspaceId: activeWorkspaceId,
      viewerRole: myRole,
      viewerUid: user.uid,
      includeRecurringAuto: true,
      includeLegacyPersonal: false,
    })
    setDebtLedger(buildContactDebtLedger(tx, contactList))
  }, [activeWorkspaceId, myRole, user?.uid])

  const reload = useCallback(async () => {
    if (!user?.uid) {
      setWorkspaces([])
      setActiveWorkspace(null)
      setMembers([])
      setContacts([])
      setTransactionNatures([])
      setDebtLedger([])
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
      const chosenId = preferred || list[0]?.id || null
      setActiveWorkspace(chosenId)

      if (chosenId) {
        const selected = list.find((ws) => ws.id === chosenId)
        const role = selected?.memberRole || 'membro'
        const [memberList, contactList, natures] = await Promise.all([
          fetchWorkspaceMembers(chosenId),
          fetchWorkspaceContacts(chosenId),
          fetchWorkspaceNatures(chosenId),
        ])

        setMembers(memberList)
        setContacts(contactList)
        setTransactionNatures(natures)

        const now = new Date()
        const tx = await fetchTransactionsWithOptions(user.uid, now.getFullYear(), now.getMonth() + 1, {
          workspaceId: chosenId,
          viewerRole: role,
          viewerUid: user.uid,
          includeRecurringAuto: true,
          includeLegacyPersonal: false,
        })
        setDebtLedger(buildContactDebtLedger(tx, contactList))
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
    await setActiveWorkspaceId(user.uid, nextWorkspaceId)
    setActiveWorkspace(nextWorkspaceId)

    const selected = workspaces.find((ws) => ws.id === nextWorkspaceId)
    const role = selected?.memberRole || 'membro'

    const [memberList, contactList, natures] = await Promise.all([
      fetchWorkspaceMembers(nextWorkspaceId),
      fetchWorkspaceContacts(nextWorkspaceId),
      fetchWorkspaceNatures(nextWorkspaceId),
    ])

    setMembers(memberList)
    setContacts(contactList)
    setTransactionNatures(natures)

    const now = new Date()
    const tx = await fetchTransactionsWithOptions(user.uid, now.getFullYear(), now.getMonth() + 1, {
      workspaceId: nextWorkspaceId,
      viewerRole: role,
      viewerUid: user.uid,
      includeRecurringAuto: true,
      includeLegacyPersonal: false,
    })
    setDebtLedger(buildContactDebtLedger(tx, contactList))
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
        debtLedger,
        transactionNatures,
        loading,
        error,
        reload,
        reloadWorkspaceData,
        changeWorkspace,
        renameNatureInline,
        addExternalContact,
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
