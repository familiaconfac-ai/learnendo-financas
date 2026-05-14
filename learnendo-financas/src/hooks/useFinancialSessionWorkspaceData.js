import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  buildWorkspaceFinancialSummary,
  buildWorkspaceProjectSnapshots,
} from '../services/workspaceService'
import {
  subscribeFinancialSessionWorkspaceSnapshot,
  syncFinancialSessionWorkspaceSnapshot,
} from '../services/financialSessionSharedService'

function collectionRef(workspaceId, name) {
  return collection(db, 'workspaces', workspaceId, name)
}

function mapDoc(docSnapshot) {
  const data = docSnapshot.data() || {}
  return {
    id: docSnapshot.id,
    ...data,
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt ?? null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt ?? null,
  }
}

function sortByDateDesc(items = [], field = 'date') {
  return [...items].sort((a, b) => String(b?.[field] || '').localeCompare(String(a?.[field] || '')))
}

export function useFinancialSessionWorkspaceData({
  workspaceId,
  sessionId = '',
  canReadWorkspaceDirectly = false,
  actorUid = '',
  actorName = '',
}) {
  const [transactions, setTransactions] = useState([])
  const [budgets, setBudgets] = useState([])
  const [projects, setProjects] = useState([])
  const [workspaceSnapshot, setWorkspaceSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!workspaceId) {
      setTransactions([])
      setBudgets([])
      setProjects([])
      setWorkspaceSnapshot(null)
      setLoading(false)
      return undefined
    }

    if (!canReadWorkspaceDirectly) {
      setLoading(true)
      setError('')
      return subscribeFinancialSessionWorkspaceSnapshot(
        workspaceId,
        sessionId,
        (snapshot) => {
          setWorkspaceSnapshot(snapshot)
          setLoading(false)
        },
        (err) => {
          setError(err?.message || 'Nao foi possivel abrir o espelho financeiro desta sessao.')
          setLoading(false)
        },
      )
    }

    setLoading(true)
    setError('')

    let loadedStreams = 0
    const markLoaded = () => {
      loadedStreams += 1
      if (loadedStreams >= 3) {
        setLoading(false)
      }
    }

    const unsubTransactions = onSnapshot(
      query(collectionRef(workspaceId, 'transactions'), orderBy('date', 'desc'), limit(40)),
      (snapshot) => {
        setTransactions(snapshot.docs.map(mapDoc))
        markLoaded()
      },
      (err) => {
        setError(err?.message || 'Nao foi possivel sincronizar transacoes.')
        setLoading(false)
      },
    )

    const unsubBudgets = onSnapshot(
      query(collectionRef(workspaceId, 'budgets'), orderBy('competencyMonth', 'desc'), limit(24)),
      (snapshot) => {
        setBudgets(snapshot.docs.map(mapDoc))
        markLoaded()
      },
      (err) => {
        setError(err?.message || 'Nao foi possivel sincronizar orcamentos.')
        setLoading(false)
      },
    )

    const unsubProjects = onSnapshot(
      query(collectionRef(workspaceId, 'projects'), orderBy('updatedAt', 'desc'), limit(20)),
      (snapshot) => {
        setProjects(snapshot.docs.map(mapDoc))
        markLoaded()
      },
      (err) => {
        setError(err?.message || 'Nao foi possivel sincronizar metas.')
        setLoading(false)
      },
    )

    return () => {
      unsubTransactions()
      unsubBudgets()
      unsubProjects()
    }
  }, [canReadWorkspaceDirectly, sessionId, workspaceId])

  const confirmedTransactions = useMemo(
    () => transactions.filter((tx) => tx.status === 'confirmed'),
    [transactions],
  )

  const summary = useMemo(
    () => buildWorkspaceFinancialSummary(confirmedTransactions),
    [confirmedTransactions],
  )

  const projectSnapshots = useMemo(
    () => buildWorkspaceProjectSnapshots(projects, confirmedTransactions),
    [confirmedTransactions, projects],
  )

  const incomeTransactions = useMemo(
    () => sortByDateDesc(
      transactions.filter((tx) => tx.type === 'income').slice(0, 12),
    ),
    [transactions],
  )

  const expenseTransactions = useMemo(
    () => sortByDateDesc(
      transactions.filter((tx) => tx.type === 'expense').slice(0, 12),
    ),
    [transactions],
  )

  const currentMonth = new Date().toISOString().slice(0, 7)
  const currentBudgets = useMemo(
    () => budgets.filter((budget) => String(budget.competencyMonth || '') === currentMonth),
    [budgets, currentMonth],
  )

  useEffect(() => {
    if (!canReadWorkspaceDirectly || !workspaceId || !sessionId || !actorUid) return
    if (loading || error) return

    void syncFinancialSessionWorkspaceSnapshot(
      workspaceId,
      sessionId,
      {
        summary,
        incomeTransactions,
        expenseTransactions,
        currentBudgets,
        projects: projectSnapshots,
      },
      actorUid,
      actorName,
    ).catch(() => {})
  }, [
    actorName,
    actorUid,
    canReadWorkspaceDirectly,
    currentBudgets,
    error,
    expenseTransactions,
    incomeTransactions,
    loading,
    projectSnapshots,
    sessionId,
    summary,
    workspaceId,
  ])

  if (!canReadWorkspaceDirectly) {
    return {
      transactions: [],
      incomeTransactions: workspaceSnapshot?.incomeTransactions || [],
      expenseTransactions: workspaceSnapshot?.expenseTransactions || [],
      budgets: [],
      currentBudgets: workspaceSnapshot?.currentBudgets || [],
      projects: workspaceSnapshot?.projects || [],
      summary: workspaceSnapshot?.summary || { receitas: 0, despesas: 0, investimentos: 0, saldo: 0 },
      loading,
      error,
    }
  }

  return {
    transactions,
    incomeTransactions,
    expenseTransactions,
    budgets,
    currentBudgets,
    projects: projectSnapshots,
    summary,
    loading,
    error,
  }
}
