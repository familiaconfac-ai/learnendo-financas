/**
 * transactionService.js
 * CRUD real no Firestore para transacoes do usuario.
 * Path: users/{uid}/transactions/{transactionId}
 */
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { NATURE_DEFAULT_BY_TYPE } from '../constants/transactionNatures'
import { normalizePaymentMethodId } from '../constants/transactionPaymentMethods'
import { syncDebtBalancesForTransactionChange } from './debtService'
import { normalizeWorkspaceRole } from './workspaceService'

function normalizeStatus(status) {
  if (status === 'confirmed') return 'confirmed'
  if (status === 'needs_review') return 'pending'
  if (status === 'pending') return 'pending'
  return 'confirmed'
}

function monthKeyFromDate(date) {
  return String(date || '').slice(0, 7)
}

function normalizeOrigin(origin) {
  if (!origin) return 'manual'
  if (origin === 'recurring_auto') return 'recurring_auto'
  return origin
}

function normalizeMonthKey(value) {
  const raw = String(value || '').trim().slice(0, 7)
  return /^\d{4}-\d{2}$/.test(raw) ? raw : null
}

function resolveStoredMonthKey(raw = {}) {
  return (
    normalizeMonthKey(raw.competencyMonth)
    || normalizeMonthKey(raw.recurringInstanceMonth)
    || normalizeMonthKey(raw.salaryReferenceMonth)
    || normalizeMonthKey(monthKeyFromDate(raw.date))
    || null
  )
}

function normalizeReceiptPaymentMethod(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'account' || normalized === 'card' || normalized === 'cash') return normalized
  return null
}

function normalizeReceiptDocumentType(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized || null
}

function normalizeCashOriginType(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized || null
}

function txCol(uid, workspaceId = null) {
  if (workspaceId) return collection(db, 'workspaces', workspaceId, 'transactions')
  return collection(db, 'users', uid, 'transactions')
}

function txDoc(uid, txId, workspaceId = null) {
  if (workspaceId) return doc(db, 'workspaces', workspaceId, 'transactions', txId)
  return doc(db, 'users', uid, 'transactions', txId)
}

async function resolveTransactionDocForMutation(uid, txId, preferredWorkspaceId = null) {
  if (preferredWorkspaceId) {
    const workspaceRef = txDoc(uid, txId, preferredWorkspaceId)
    const workspaceSnap = await getDoc(workspaceRef)
    if (workspaceSnap.exists()) {
      return { ref: workspaceRef, snap: workspaceSnap, workspaceId: preferredWorkspaceId }
    }
  }

  const personalRef = txDoc(uid, txId, null)
  const personalSnap = await getDoc(personalRef)
  if (personalSnap.exists()) {
    return { ref: personalRef, snap: personalSnap, workspaceId: null }
  }

  return {
    ref: txDoc(uid, txId, preferredWorkspaceId),
    snap: null,
    workspaceId: preferredWorkspaceId,
  }
}

function normalizeNatureId(type, natureId) {
  if (natureId) return natureId
  return NATURE_DEFAULT_BY_TYPE[type] || NATURE_DEFAULT_BY_TYPE.expense
}

function normalizeNatureKey(natureKey, natureId) {
  if (natureKey) return natureKey
  return String(natureId || '').replace(/^nature_/, '') || 'despesa'
}

function shouldAffectBalance(type, data) {
  if (type === 'transfer_internal') return false
  if (typeof data.balanceImpact === 'boolean') return data.balanceImpact
  if (typeof data.affectsBudget === 'boolean') return data.affectsBudget
  return true
}

function applyViewerScope(docs, options = {}) {
  const viewerRole = normalizeWorkspaceRole(options.viewerRole || 'gestor')
  const viewerUid = options.viewerUid || null
  if (!viewerUid) return docs

  if (viewerRole === 'planejador-blind') {
    return docs.map((tx) => ({
      ...tx,
      amount: 0,
      receiptDetailTotal: 0,
      receiptBatchTotal: 0,
      receiptItems: Array.isArray(tx.receiptItems)
        ? tx.receiptItems.map((item) => ({
            ...item,
            amount: 0,
            total: 0,
            totalAmount: 0,
            unitPrice: 0,
            price: 0,
          }))
        : [],
    }))
  }

  if (viewerRole === 'planejador') return docs
  if (viewerRole === 'gestor' || viewerRole === 'planejador-master') return docs
  if (viewerRole === 'co-gestor' || viewerRole === 'planejador-plus') return docs
  if (viewerRole === 'membro') return docs

  return docs
}

function resolveLegacyPersonalSource(tx, workspaceId) {
  if (!workspaceId) {
    return !tx.workspaceId ? 'legacy_personal' : null
  }
  if (!tx.workspaceId) return 'legacy_personal'
  if (tx.workspaceId === workspaceId) return 'legacy_workspace_tagged'
  return 'legacy_other_workspace'
}

function normalizeResolvedDocSource(source) {
  if (source === 'workspace') return 'workspace'
  if (source === 'legacy_personal') return 'legacy_personal'
  if (source === 'legacy_workspace_tagged') return 'legacy_workspace_tagged'
  if (source === 'legacy_other_workspace') return 'legacy_other_workspace'
  return 'personal'
}

function mapTransactionSnapshot(docSnapshot, meta = {}) {
  const raw = docSnapshot.data()
  return {
    id: docSnapshot.id,
    ...raw,
    origin: normalizeOrigin(raw.origin),
    status: normalizeStatus(raw.status),
    transactionNatureId: raw.transactionNatureId || normalizeNatureId(raw.type, null),
    transactionNatureKey: raw.transactionNatureKey || normalizeNatureKey(raw.transactionNatureKey, raw.transactionNatureId),
    affectsBudget: typeof raw.affectsBudget === 'boolean' ? raw.affectsBudget : raw.balanceImpact !== false,
    recurringInstanceMonth: raw.recurringInstanceMonth || monthKeyFromDate(raw.date),
    subcategoryId: raw.subcategoryId || null,
    subcategoryName: raw.subcategoryName || null,
    paymentMethod: normalizePaymentMethodId(raw.paymentMethod),
    cardId: raw.cardId || null,
    cardName: raw.cardName || null,
    debtId: raw.debtId || null,
    debtName: raw.debtName || null,
    countsAsDebtSettlement: !!raw.countsAsDebtSettlement,
    sessionActionId: raw.sessionActionId || null,
    financialSessionId: raw.financialSessionId || null,
    salaryReferenceMonth: normalizeMonthKey(raw.salaryReferenceMonth) || null,
    receiptDetailEnabled: !!raw.receiptDetailEnabled,
    receiptPlaceholderEnabled: !!raw.receiptPlaceholderEnabled,
    receiptDetailStatus: raw.receiptDetailStatus || null,
    receiptDetailTotal: Number(raw.receiptDetailTotal || 0),
    receiptItems: Array.isArray(raw.receiptItems) ? raw.receiptItems : [],
    receiptDocumentType: normalizeReceiptDocumentType(raw.receiptDocumentType),
    receiptPaymentMethod: normalizeReceiptPaymentMethod(raw.receiptPaymentMethod),
    cashOriginType: normalizeCashOriginType(raw.cashOriginType),
    recurrenceType: raw.recurrenceType || null,
    recurringStartDate: raw.recurringStartDate || null,
    recurringEndDate: raw.recurringEndDate || null,
    totalInstallments: Number.isFinite(Number(raw.totalInstallments)) ? Number(raw.totalInstallments) : null,
    currentInstallment: Number.isFinite(Number(raw.currentInstallment)) ? Number(raw.currentInstallment) : null,
    createdAt: raw.createdAt?.toDate?.().toISOString() ?? raw.createdAt ?? null,
    updatedAt: raw.updatedAt?.toDate?.().toISOString() ?? raw.updatedAt ?? null,
    _resolvedDocPath: meta.docPath || docSnapshot.ref?.path || '',
    _resolvedDocSource: normalizeResolvedDocSource(meta.docSource),
  }
}

function preferredResolvedSourceRank(source) {
  if (source === 'workspace') return 4
  if (source === 'legacy_workspace_tagged') return 3
  if (source === 'legacy_personal') return 2
  if (source === 'legacy_other_workspace') return 1
  return 1
}

function resolvedExplicitIdentityKeys(tx) {
  const keys = []

  if (tx?.id) keys.push(`doc:${tx.id}`)
  if (tx?.legacySourceId) keys.push(`legacySourceId:${tx.legacySourceId}`)
  if (tx?.mirrorOf) keys.push(`mirrorOf:${tx.mirrorOf}`)
  if (tx?.originalTransactionId) keys.push(`originalTransactionId:${tx.originalTransactionId}`)
  if (tx?.sourceTransactionId) keys.push(`sourceTransactionId:${tx.sourceTransactionId}`)
  if (tx?.resolvedTransactionKey) keys.push(`resolvedTransactionKey:${tx.resolvedTransactionKey}`)

  return keys.filter(Boolean)
}

function dedupeResolvedTransactions(transactions = []) {
  const byPath = new Map()
  const byExplicitIdentity = new Map()
  const preserved = []

  transactions.forEach((tx) => {
    const pathKey = tx?._resolvedDocPath || null
    if (pathKey && byPath.has(pathKey)) return

    const identityKeys = resolvedExplicitIdentityKeys(tx)
    if (identityKeys.length === 0) {
      if (pathKey) byPath.set(pathKey, tx)
      preserved.push(tx)
      return
    }

    let current = null
    for (const identityKey of identityKeys) {
      if (byExplicitIdentity.has(identityKey)) {
        current = byExplicitIdentity.get(identityKey)
        break
      }
    }

    if (!current) {
      if (pathKey) byPath.set(pathKey, tx)
      identityKeys.forEach((identityKey) => byExplicitIdentity.set(identityKey, tx))
      preserved.push(tx)
      return
    }

    const currentRank = preferredResolvedSourceRank(current._resolvedDocSource)
    const nextRank = preferredResolvedSourceRank(tx._resolvedDocSource)
    const preferred = nextRank > currentRank ? tx : current
    const discarded = preferred === tx ? current : tx

    if (preferred !== current) {
      const preservedIndex = preserved.findIndex((item) => item === current)
      if (preservedIndex >= 0) preserved[preservedIndex] = tx
    }

    if (pathKey && preferred === tx) byPath.set(pathKey, tx)
    identityKeys.forEach((identityKey) => byExplicitIdentity.set(identityKey, preferred))

    if (discarded?._resolvedDocPath && byPath.get(discarded._resolvedDocPath) === discarded) {
      byPath.delete(discarded._resolvedDocPath)
    }
  })

  return preserved
}

async function fetchMonthAwareDocs(collectionRef, monthStr = null) {
  if (!monthStr) {
    const fullSnap = await getDocs(collectionRef)
    return {
      docs: fullSnap.docs,
      exactCompetencyMatchDocs: fullSnap.docs.length,
      fallbackMonthDocs: 0,
    }
  }

  const exactSnap = await getDocs(query(collectionRef, where('competencyMonth', '==', monthStr)))
  const exactIds = new Set(exactSnap.docs.map((docSnapshot) => docSnapshot.id))
  const fullSnap = await getDocs(collectionRef)
  const fallbackDocs = fullSnap.docs.filter((docSnapshot) => {
    if (exactIds.has(docSnapshot.id)) return false
    return resolveStoredMonthKey(docSnapshot.data?.() || {}) === monthStr
  })

  return {
    docs: [...exactSnap.docs, ...fallbackDocs],
    exactCompetencyMatchDocs: exactSnap.docs.length,
    fallbackMonthDocs: fallbackDocs.length,
  }
}

async function fetchResolvedTransactionCandidates(uid, options = {}) {
  const workspaceId = options.workspaceId || null
  const monthStr = options.monthKey || null

  const workspaceDocs = []
  const personalDocs = []

  if (workspaceId) {
    const workspaceResult = await fetchMonthAwareDocs(txCol(uid, workspaceId), monthStr)

    workspaceResult.docs.forEach((docSnapshot) => {
      workspaceDocs.push(mapTransactionSnapshot(docSnapshot, {
        docSource: 'workspace',
        docPath: docSnapshot.ref?.path,
      }))
    })
  }

  const shouldReadPersonal = !workspaceId || options.includeLegacyPersonal !== false
  if (shouldReadPersonal) {
    const personalResult = await fetchMonthAwareDocs(txCol(uid, null), monthStr)

    const rawPersonalDocs = personalResult.docs

    rawPersonalDocs.forEach((docSnapshot) => {
      const mapped = mapTransactionSnapshot(docSnapshot, {
        docSource: 'personal',
        docPath: docSnapshot.ref?.path,
      })

      if (workspaceId) {
        const legacySource = resolveLegacyPersonalSource(mapped, workspaceId)
        if (!legacySource) return
        mapped._resolvedDocSource = legacySource
      }

      personalDocs.push(mapped)
    })
  }

  return [...workspaceDocs, ...personalDocs]
}

export async function getResolvedTransactions(uid, options = {}) {
  const workspaceId = options.workspaceId || null
  const monthKey = options.monthKey || (
    Number.isFinite(Number(options.year)) && Number.isFinite(Number(options.month))
      ? `${options.year}-${String(options.month).padStart(2, '0')}`
      : null
  )

  try {
    const rawDocs = await fetchResolvedTransactionCandidates(uid, {
      workspaceId,
      monthKey,
      includeLegacyPersonal: options.includeLegacyPersonal,
    })

    let docs = dedupeResolvedTransactions(rawDocs)
    docs = applyViewerScope(docs, options)

    if (options.includeRecurringAuto === false) {
      docs = docs.filter((tx) => tx.origin !== 'recurring_auto')
    }

    if (options.salaryReferenceMonth) {
      const salaryReferenceMonth = normalizeMonthKey(options.salaryReferenceMonth)
      docs = docs.filter((tx) => tx.salaryReferenceMonth === salaryReferenceMonth)
    }

    return docs
  } catch (err) {
    console.error('[TransactionService] Resolved fetch failed:', err.code, err.message)
    throw err
  }
}

export async function addTransaction(uid, data, options = {}) {
  const workspaceId = options.workspaceId || data.workspaceId || null
  const isInternalTransfer = data.type === 'transfer_internal'

  try {
    const normalizedCategoryName = typeof data.categoryName === 'string' ? data.categoryName.trim() : ''
    const normalizedStatus = normalizeStatus(data.status)
    const natureId = normalizeNatureId(data.type, data.transactionNatureId)
    const natureKey = normalizeNatureKey(data.transactionNatureKey, natureId)

    const ref = await addDoc(txCol(uid, workspaceId), {
      type: data.type,
      description: data.description,
      amount: Number(data.amount),
      date: data.date,
      competencyMonth: data.competencyMonth || data.date.slice(0, 7),
      workspaceId,
      createdBy: data.createdBy || uid,
      userId: data.userId || uid,
      categoryId: isInternalTransfer ? null : (data.categoryId || null),
      categoryName: isInternalTransfer ? null : (normalizedCategoryName || null),
      subcategoryId: isInternalTransfer ? null : (data.subcategoryId || null),
      subcategoryName: isInternalTransfer ? null : (data.subcategoryName || null),
      transactionNatureId: natureId,
      transactionNatureKey: natureKey,
      transactionNatureLabel: data.transactionNatureLabel || null,
      paymentMethod: normalizePaymentMethodId(data.paymentMethod),
      cardId: data.cardId || null,
      cardName: data.cardName || null,
      contactId: data.contactId || null,
      contactName: data.contactName || null,
      debtId: data.debtId || null,
      debtName: data.debtName || null,
      countsAsDebtSettlement: !!data.countsAsDebtSettlement,
      sessionActionId: data.sessionActionId || null,
      financialSessionId: data.financialSessionId || null,
      salaryReferenceMonth: normalizeMonthKey(data.salaryReferenceMonth) || null,
      receiptDetailEnabled: !!data.receiptDetailEnabled,
      receiptPlaceholderEnabled: !!data.receiptPlaceholderEnabled,
      receiptDetailStatus: data.receiptDetailStatus || null,
      receiptDetailTotal: Number(data.receiptDetailTotal || 0),
      receiptItems: Array.isArray(data.receiptItems) ? data.receiptItems : [],
      receiptBatchId: data.receiptBatchId || null,
      receiptBatchTotal: Number(data.receiptBatchTotal || 0),
      receiptBatchItemCount: Number(data.receiptBatchItemCount || 0),
      receiptBatchDate: data.receiptBatchDate || null,
      receiptBatchMerchantName: data.receiptBatchMerchantName || null,
      receiptDocumentType: normalizeReceiptDocumentType(data.receiptDocumentType),
      receiptPaymentMethod: normalizeReceiptPaymentMethod(data.receiptPaymentMethod),
      cashOriginType: normalizeCashOriginType(data.cashOriginType),
      accountId: data.accountId || null,
      toAccountId: isInternalTransfer ? (data.toAccountId || null) : null,
      notes: data.notes || '',
      origin: normalizeOrigin(data.origin),
      status: normalizedStatus,
      affectsBudget: typeof data.affectsBudget === 'boolean' ? data.affectsBudget : shouldAffectBalance(data.type, data),
      recurrenceType: data.recurrenceType || null,
      recurringStartDate: data.recurringStartDate || null,
      recurringEndDate: data.recurringEndDate || null,
      totalInstallments: Number.isFinite(Number(data.totalInstallments)) ? Number(data.totalInstallments) : null,
      currentInstallment: Number.isFinite(Number(data.currentInstallment)) ? Number(data.currentInstallment) : null,
      ...(data.recurringId ? { recurringId: data.recurringId } : {}),
      ...(data.recurringType ? { recurringType: data.recurringType } : {}),
      ...(data.recurringInstanceMonth ? { recurringInstanceMonth: data.recurringInstanceMonth } : {}),
      ...(Number.isFinite(Number(data.installmentNumber))
        ? { installmentNumber: Number(data.installmentNumber) }
        : {}),
      balanceImpact: shouldAffectBalance(data.type, data),
      ...(data.importBatchId ? { importBatchId: data.importBatchId } : {}),
      ...(data.classificationConfidence ? { classificationConfidence: data.classificationConfidence } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })

    const createdTx = {
      ...data,
      id: ref.id,
      debtId: data.debtId || null,
      countsAsDebtSettlement: !!data.countsAsDebtSettlement,
      transactionNatureId: natureId,
      status: normalizedStatus,
    }
    await syncDebtBalancesForTransactionChange(workspaceId, null, createdTx)
    return ref.id
  } catch (err) {
    console.error('[TransactionService] Write failed:', err.code, err.message)
    throw err
  }
}

export async function updateTransaction(uid, txId, data, options = {}) {
  const workspaceId = options.workspaceId || data.workspaceId || null

  try {
    const resolvedTarget = await resolveTransactionDocForMutation(uid, txId, workspaceId)
    const previousSnap = resolvedTarget.snap
    const previousData = previousSnap?.exists() ? { id: previousSnap.id, ...previousSnap.data() } : null
    const payload = { ...data, updatedAt: serverTimestamp() }
    const isInternalTransfer = payload.type === 'transfer_internal'

    if (payload.amount !== undefined) payload.amount = Number(payload.amount)
    if (!payload.competencyMonth && payload.date) payload.competencyMonth = payload.date.slice(0, 7)
    if (payload.categoryName !== undefined) {
      payload.categoryName = typeof payload.categoryName === 'string'
        ? (payload.categoryName.trim() || null)
        : null
    }
    if (payload.subcategoryName !== undefined) {
      payload.subcategoryName = typeof payload.subcategoryName === 'string'
        ? (payload.subcategoryName.trim() || null)
        : null
    }
    if (payload.status !== undefined) {
      payload.status = normalizeStatus(payload.status)
    }
    if (payload.transactionNatureId !== undefined) {
      payload.transactionNatureId = normalizeNatureId(payload.type || data.type || 'expense', payload.transactionNatureId)
      payload.transactionNatureKey = normalizeNatureKey(payload.transactionNatureKey, payload.transactionNatureId)
    }
    if (payload.debtId !== undefined && !payload.debtId) {
      payload.debtId = null
      payload.debtName = null
    }
    if (payload.countsAsDebtSettlement !== undefined) {
      payload.countsAsDebtSettlement = !!payload.countsAsDebtSettlement
    }
    if (payload.salaryReferenceMonth !== undefined) {
      payload.salaryReferenceMonth = normalizeMonthKey(payload.salaryReferenceMonth)
    }
    if (payload.paymentMethod !== undefined) {
      payload.paymentMethod = normalizePaymentMethodId(payload.paymentMethod)
    }
    if (payload.cardId !== undefined && !payload.cardId) {
      payload.cardId = null
      payload.cardName = null
    }
    if (payload.receiptDetailEnabled !== undefined) {
      payload.receiptDetailEnabled = !!payload.receiptDetailEnabled
    }
    if (payload.receiptPlaceholderEnabled !== undefined) {
      payload.receiptPlaceholderEnabled = !!payload.receiptPlaceholderEnabled
    }
    if (payload.receiptItems !== undefined && !Array.isArray(payload.receiptItems)) {
      payload.receiptItems = []
    }
    if (payload.receiptDetailTotal !== undefined) {
      payload.receiptDetailTotal = Number(payload.receiptDetailTotal || 0)
    }
    if (payload.receiptDocumentType !== undefined) {
      payload.receiptDocumentType = normalizeReceiptDocumentType(payload.receiptDocumentType)
    }
    if (payload.receiptPaymentMethod !== undefined) {
      payload.receiptPaymentMethod = normalizeReceiptPaymentMethod(payload.receiptPaymentMethod)
    }
    if (payload.cashOriginType !== undefined) {
      payload.cashOriginType = normalizeCashOriginType(payload.cashOriginType)
    }
    if (payload.totalInstallments !== undefined) {
      payload.totalInstallments = Number.isFinite(Number(payload.totalInstallments))
        ? Number(payload.totalInstallments)
        : null
    }
    if (payload.currentInstallment !== undefined) {
      payload.currentInstallment = Number.isFinite(Number(payload.currentInstallment))
        ? Number(payload.currentInstallment)
        : null
    }
    if (isInternalTransfer) {
      payload.categoryId = null
      payload.categoryName = null
      payload.subcategoryId = null
      payload.subcategoryName = null
      payload.balanceImpact = false
    }

    await updateDoc(resolvedTarget.ref, payload)

    const afterTx = {
      ...previousData,
      ...data,
      id: txId,
      countsAsDebtSettlement:
        payload.countsAsDebtSettlement ?? data.countsAsDebtSettlement ?? previousData?.countsAsDebtSettlement ?? false,
      transactionNatureId: payload.transactionNatureId || data.transactionNatureId || previousData?.transactionNatureId,
      status: payload.status || data.status || previousData?.status,
    }
    await syncDebtBalancesForTransactionChange(resolvedTarget.workspaceId, previousData, afterTx)
  } catch (err) {
    console.error('[TransactionService] Update failed:', err.code, err.message)
    throw err
  }
}

export async function deleteTransaction(uid, txId, options = {}) {
  const workspaceId = options.workspaceId || null

  try {
    const resolvedTarget = await resolveTransactionDocForMutation(uid, txId, workspaceId)
    const previousSnap = resolvedTarget.snap
    const previousData = previousSnap?.exists() ? { id: previousSnap.id, ...previousSnap.data() } : null
    await deleteDoc(resolvedTarget.ref)
    await syncDebtBalancesForTransactionChange(resolvedTarget.workspaceId, previousData, null)
  } catch (err) {
    console.error('[TransactionService] Delete failed:', err.code, err.message)
    throw err
  }
}

export async function fetchTransactions(uid, year, month, options = {}) {
  return fetchTransactionsWithOptions(uid, year, month, options)
}

export async function fetchAllTransactionsForWorkspace(uid, options = {}) {
  return getResolvedTransactions(uid, options)
}

export async function fetchTransactionsWithOptions(uid, year, month, options = {}) {
  return getResolvedTransactions(uid, { ...options, year, month })
}

export async function fetchTransactionsBySalaryReferenceMonth(uid, salaryReferenceMonth, options = {}) {
  const normalizedReferenceMonth = normalizeMonthKey(salaryReferenceMonth)
  if (!normalizedReferenceMonth) return []
  return getResolvedTransactions(uid, {
    ...options,
    salaryReferenceMonth: normalizedReferenceMonth,
  })
}
