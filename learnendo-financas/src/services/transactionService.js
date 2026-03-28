/**
 * transactionService.js
 * CRUD real no Firestore para transações do usuário.
 * Path: users/{uid}/transactions/{transactionId}
 */
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { NATURE_DEFAULT_BY_TYPE } from '../constants/transactionNatures'

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

function txCol(uid, workspaceId = null) {
  if (workspaceId) return collection(db, 'workspaces', workspaceId, 'transactions')
  return collection(db, 'users', uid, 'transactions')
}

function txDoc(uid, txId, workspaceId = null) {
  if (workspaceId) return doc(db, 'workspaces', workspaceId, 'transactions', txId)
  return doc(db, 'users', uid, 'transactions', txId)
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
  const viewerRole = options.viewerRole || 'gestor'
  const viewerUid = options.viewerUid || null
  if (!viewerUid) return docs

  if (viewerRole === 'planejador') return docs
  if (viewerRole === 'gestor' || viewerRole === 'co-gestor') return docs

  if (viewerRole === 'membro') {
    return docs.filter((tx) => tx.createdBy === viewerUid || tx.userId === viewerUid || tx.origin === 'recurring_auto')
  }

  return docs
}

/** Adiciona uma nova transação no Firestore */
export async function addTransaction(uid, data, options = {}) {
  const workspaceId = options.workspaceId || data.workspaceId || null
  const path = workspaceId
    ? `workspaces/${workspaceId}/transactions`
    : `users/${uid}/transactions`
  const isInternalTransfer = data.type === 'transfer_internal'
  console.log('[TransactionService] ➕ Writing to:', path)
  console.log('[TransactionService] Payload:', {
    ...data,
    amount: Number(data.amount),
    isInternalTransfer,
  })
  try {
    const normalizedCategoryName = typeof data.categoryName === 'string' ? data.categoryName.trim() : ''
    const normalizedStatus = normalizeStatus(data.status)
    const natureId = normalizeNatureId(data.type, data.transactionNatureId)
    const natureKey = normalizeNatureKey(data.transactionNatureKey, natureId)
    const ref = await addDoc(txCol(uid, workspaceId), {
      type:            data.type,
      description:     data.description,
      amount:          Number(data.amount),
      date:            data.date,
      competencyMonth: data.date.slice(0, 7),   // ex: "2026-03"
      workspaceId:     workspaceId,
      createdBy:       data.createdBy || uid,
      userId:          data.userId || uid,
      categoryId:      isInternalTransfer ? null : (data.categoryId || null),
      categoryName:    isInternalTransfer ? null : (normalizedCategoryName || null),
      transactionNatureId: natureId,
      transactionNatureKey: natureKey,
      transactionNatureLabel: data.transactionNatureLabel || null,
      contactId:       data.contactId || null,
      contactName:     data.contactName || null,
      accountId:       data.accountId   || null,
      toAccountId:     isInternalTransfer ? (data.toAccountId || null) : null,
      notes:           data.notes       || '',
      origin:          normalizeOrigin(data.origin),
      status:          normalizedStatus,
      affectsBudget:   typeof data.affectsBudget === 'boolean' ? data.affectsBudget : shouldAffectBalance(data.type, data),
      ...(data.recurringId          ? { recurringId:          data.recurringId } : {}),
      ...(data.recurringType        ? { recurringType:        data.recurringType } : {}),
      ...(data.recurringInstanceMonth ? { recurringInstanceMonth: data.recurringInstanceMonth } : {}),
      ...(Number.isFinite(Number(data.installmentNumber))
        ? { installmentNumber: Number(data.installmentNumber) }
        : {}),
      // Internal transfers don't affect expense totals — they are neutral moves
      balanceImpact:   shouldAffectBalance(data.type, data),
      // Import metadata (only present when origin === 'bank_import')
      ...(data.importBatchId            ? { importBatchId:             data.importBatchId }            : {}),
      ...(data.classificationConfidence ? { classificationConfidence:  data.classificationConfidence } : {}),
      createdAt:       serverTimestamp(),
      updatedAt:       serverTimestamp(),
    })
    if (isInternalTransfer) {
      console.log('[TransactionService] 🔄 Internal transfer saved — balanceImpact: false, toAccountId:', data.toAccountId ?? '(none)')
    }
    console.log('[TransactionService] ✅ Write succeeded — Firestore id:', ref.id)
    return ref.id
  } catch (err) {
    console.error('[TransactionService] ❌ Write failed:', err.code, err.message)
    throw err
  }
}

/** Atualiza campos de uma transação existente */
export async function updateTransaction(uid, txId, data, options = {}) {
  const workspaceId = options.workspaceId || data.workspaceId || null
  const path = workspaceId
    ? `workspaces/${workspaceId}/transactions/${txId}`
    : `users/${uid}/transactions/${txId}`
  console.log('[TransactionService] ✏️ Updating:', path)
  try {
    const payload = { ...data, updatedAt: serverTimestamp() }
    const isInternalTransfer = payload.type === 'transfer_internal'
    if (payload.amount !== undefined) payload.amount = Number(payload.amount)
    if (payload.date)                 payload.competencyMonth = payload.date.slice(0, 7)
    if (payload.categoryName !== undefined) {
      payload.categoryName = typeof payload.categoryName === 'string'
        ? (payload.categoryName.trim() || null)
        : null
    }
    if (payload.status !== undefined) {
      payload.status = normalizeStatus(payload.status)
    }
    if (payload.transactionNatureId !== undefined) {
      payload.transactionNatureId = normalizeNatureId(payload.type || data.type || 'expense', payload.transactionNatureId)
      payload.transactionNatureKey = normalizeNatureKey(payload.transactionNatureKey, payload.transactionNatureId)
    }
    if (payload.affectsBudget !== undefined) {
      payload.balanceImpact = !!payload.affectsBudget
    }
    if (isInternalTransfer) {
      payload.categoryId = null
      payload.categoryName = null
      payload.balanceImpact = false
    }
    await updateDoc(txDoc(uid, txId, workspaceId), payload)
    console.log('[TransactionService] ✅ Update succeeded')
  } catch (err) {
    console.error('[TransactionService] ❌ Update failed:', err.code, err.message)
    throw err
  }
}

/** Remove uma transação do Firestore */
export async function deleteTransaction(uid, txId, options = {}) {
  const workspaceId = options.workspaceId || null
  const path = workspaceId
    ? `workspaces/${workspaceId}/transactions/${txId}`
    : `users/${uid}/transactions/${txId}`
  console.log('[TransactionService] 🗑️ Deleting:', path)
  try {
    await deleteDoc(txDoc(uid, txId, workspaceId))
    console.log('[TransactionService] ✅ Delete succeeded')
  } catch (err) {
    console.error('[TransactionService] ❌ Delete failed:', err.code, err.message)
    throw err
  }
}

/**
 * Busca todas as transações de um mês/ano para o usuário.
 * Filtra pelo campo `competencyMonth` (ex: "2026-03").
 * Ordenação feita no cliente para evitar índice composto no Firestore.
 */
export async function fetchTransactions(uid, year, month) {
  return fetchTransactionsWithOptions(uid, year, month)
}

export async function fetchTransactionsWithOptions(uid, year, month, options = {}) {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`
  const workspaceId = options.workspaceId || null
  const path = workspaceId
    ? `workspaces/${workspaceId}/transactions`
    : `users/${uid}/transactions`
  console.log(`[TransactionService] 📥 Fetching ${path} where competencyMonth == ${monthStr}`)
  try {
    const q = query(txCol(uid, workspaceId), where('competencyMonth', '==', monthStr))
    const snap = await getDocs(q)
    let docs = snap.docs.map((d) => {
      const raw = d.data()
      return {
        id: d.id,
        ...raw,
        origin: normalizeOrigin(raw.origin),
        status: normalizeStatus(raw.status),
        transactionNatureId: raw.transactionNatureId || normalizeNatureId(raw.type, null),
        transactionNatureKey: raw.transactionNatureKey || normalizeNatureKey(raw.transactionNatureKey, raw.transactionNatureId),
        affectsBudget: typeof raw.affectsBudget === 'boolean' ? raw.affectsBudget : raw.balanceImpact !== false,
        recurringInstanceMonth: raw.recurringInstanceMonth || monthKeyFromDate(raw.date),
        // Normaliza Timestamps do Firestore para strings ISO
        createdAt: raw.createdAt?.toDate?.().toISOString() ?? raw.createdAt ?? null,
        updatedAt: raw.updatedAt?.toDate?.().toISOString() ?? raw.updatedAt ?? null,
      }
    })

    if (!workspaceId && options.includeLegacyPersonal !== false) {
      // legacy already covered by user path
    }

    docs = applyViewerScope(docs, options)

    const includeRecurringAuto = options.includeRecurringAuto !== false
    const filtered = includeRecurringAuto
      ? docs
      : docs.filter((tx) => tx.origin !== 'recurring_auto')
    console.log(`[TransactionService] ✅ Fetched ${filtered.length} transactions from Firestore`)
    return filtered
  } catch (err) {
    console.error('[TransactionService] ❌ Fetch failed:', err.code, err.message)
    throw err
  }
}
