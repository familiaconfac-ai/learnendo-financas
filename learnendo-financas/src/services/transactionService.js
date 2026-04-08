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
    return docs
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
      competencyMonth: data.competencyMonth || data.date.slice(0, 7),   // ex: "2026-03"
      workspaceId:     workspaceId,
      createdBy:       data.createdBy || uid,
      userId:          data.userId || uid,
      categoryId:      isInternalTransfer ? null : (data.categoryId || null),
      categoryName:    isInternalTransfer ? null : (normalizedCategoryName || null),
      subcategoryId:   isInternalTransfer ? null : (data.subcategoryId || null),
      subcategoryName: isInternalTransfer ? null : (data.subcategoryName || null),
      transactionNatureId: natureId,
      transactionNatureKey: natureKey,
      transactionNatureLabel: data.transactionNatureLabel || null,
      paymentMethod:   normalizePaymentMethodId(data.paymentMethod),
      cardId:          data.cardId || null,
      cardName:        data.cardName || null,
      contactId:       data.contactId || null,
      contactName:     data.contactName || null,
      debtId:          data.debtId || null,
      debtName:        data.debtName || null,
      salaryReferenceMonth: normalizeMonthKey(data.salaryReferenceMonth) || null,
      receiptDetailEnabled: !!data.receiptDetailEnabled,
      receiptDetailStatus: data.receiptDetailStatus || null,
      receiptDetailTotal: Number(data.receiptDetailTotal || 0),
      receiptItems: Array.isArray(data.receiptItems) ? data.receiptItems : [],
      receiptDocumentType: normalizeReceiptDocumentType(data.receiptDocumentType),
      receiptPaymentMethod: normalizeReceiptPaymentMethod(data.receiptPaymentMethod),
      cashOriginType: normalizeCashOriginType(data.cashOriginType),
      accountId:       data.accountId   || null,
      toAccountId:     isInternalTransfer ? (data.toAccountId || null) : null,
      notes:           data.notes       || '',
      origin:          normalizeOrigin(data.origin),
      status:          normalizedStatus,
      affectsBudget:   typeof data.affectsBudget === 'boolean' ? data.affectsBudget : shouldAffectBalance(data.type, data),
      recurrenceType: data.recurrenceType || null,
      recurringStartDate: data.recurringStartDate || null,
      recurringEndDate: data.recurringEndDate || null,
      totalInstallments: Number.isFinite(Number(data.totalInstallments)) ? Number(data.totalInstallments) : null,
      currentInstallment: Number.isFinite(Number(data.currentInstallment)) ? Number(data.currentInstallment) : null,
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
    const createdTx = {
      ...data,
      id: ref.id,
      debtId: data.debtId || null,
      transactionNatureId: natureId,
      status: normalizedStatus,
    }
    await syncDebtBalancesForTransactionChange(workspaceId, null, createdTx)
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
    const previousSnap = await getDoc(txDoc(uid, txId, workspaceId))
    const previousData = previousSnap.exists() ? { id: previousSnap.id, ...previousSnap.data() } : null
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
    await updateDoc(txDoc(uid, txId, workspaceId), payload)
    const afterTx = {
      ...previousData,
      ...data,
      id: txId,
      transactionNatureId: payload.transactionNatureId || data.transactionNatureId || previousData?.transactionNatureId,
      status: payload.status || data.status || previousData?.status,
    }
    await syncDebtBalancesForTransactionChange(workspaceId, previousData, afterTx)
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
    const previousSnap = await getDoc(txDoc(uid, txId, workspaceId))
    const previousData = previousSnap.exists() ? { id: previousSnap.id, ...previousSnap.data() } : null
    await deleteDoc(txDoc(uid, txId, workspaceId))
    await syncDebtBalancesForTransactionChange(workspaceId, previousData, null)
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
export async function fetchTransactions(uid, year, month, options = {}) {
  return fetchTransactionsWithOptions(uid, year, month, options)
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
        subcategoryId: raw.subcategoryId || null,
        subcategoryName: raw.subcategoryName || null,
        paymentMethod: normalizePaymentMethodId(raw.paymentMethod),
        cardId: raw.cardId || null,
        cardName: raw.cardName || null,
        debtId: raw.debtId || null,
        debtName: raw.debtName || null,
        salaryReferenceMonth: normalizeMonthKey(raw.salaryReferenceMonth) || null,
        receiptDetailEnabled: !!raw.receiptDetailEnabled,
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
        // Normaliza Timestamps do Firestore para strings ISO
        createdAt: raw.createdAt?.toDate?.().toISOString() ?? raw.createdAt ?? null,
        updatedAt: raw.updatedAt?.toDate?.().toISOString() ?? raw.updatedAt ?? null,
      }
    })

    if (workspaceId && options.includeLegacyPersonal !== false) {
      const legacySnap = await getDocs(query(txCol(uid, null), where('competencyMonth', '==', monthStr)))
      const legacyDocs = legacySnap.docs.map((d) => {
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
          subcategoryId: raw.subcategoryId || null,
          subcategoryName: raw.subcategoryName || null,
          paymentMethod: normalizePaymentMethodId(raw.paymentMethod),
          cardId: raw.cardId || null,
          cardName: raw.cardName || null,
          debtId: raw.debtId || null,
          debtName: raw.debtName || null,
          salaryReferenceMonth: normalizeMonthKey(raw.salaryReferenceMonth) || null,
          receiptDetailEnabled: !!raw.receiptDetailEnabled,
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
        }
      }).filter((tx) => !tx.workspaceId)

      docs = [...docs, ...legacyDocs]
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

export async function fetchTransactionsBySalaryReferenceMonth(uid, salaryReferenceMonth, options = {}) {
  const normalizedReferenceMonth = normalizeMonthKey(salaryReferenceMonth)
  if (!normalizedReferenceMonth) return []

  const workspaceId = options.workspaceId || null
  const q = query(txCol(uid, workspaceId), where('salaryReferenceMonth', '==', normalizedReferenceMonth))
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
      subcategoryId: raw.subcategoryId || null,
      subcategoryName: raw.subcategoryName || null,
      paymentMethod: normalizePaymentMethodId(raw.paymentMethod),
      cardId: raw.cardId || null,
      cardName: raw.cardName || null,
      debtId: raw.debtId || null,
      debtName: raw.debtName || null,
      salaryReferenceMonth: normalizeMonthKey(raw.salaryReferenceMonth) || null,
      receiptDetailEnabled: !!raw.receiptDetailEnabled,
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
    }
  })

  if (workspaceId && options.includeLegacyPersonal !== false) {
    const legacySnap = await getDocs(query(txCol(uid, null), where('salaryReferenceMonth', '==', normalizedReferenceMonth)))
    const legacyDocs = legacySnap.docs.map((d) => {
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
        subcategoryId: raw.subcategoryId || null,
        subcategoryName: raw.subcategoryName || null,
        paymentMethod: normalizePaymentMethodId(raw.paymentMethod),
        cardId: raw.cardId || null,
        cardName: raw.cardName || null,
        debtId: raw.debtId || null,
        debtName: raw.debtName || null,
        salaryReferenceMonth: normalizeMonthKey(raw.salaryReferenceMonth) || null,
        receiptDetailEnabled: !!raw.receiptDetailEnabled,
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
      }
    }).filter((tx) => !tx.workspaceId)

    docs = [...docs, ...legacyDocs]
  }

  return applyViewerScope(docs, options)
}
