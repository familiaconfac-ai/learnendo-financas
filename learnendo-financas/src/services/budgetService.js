/**
 * budgetService.js
 * CRUD real no Firestore para orcamentos por categoria.
 * Path: users/{uid}/budgets/{budgetId}
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

function budgetCol(uid, workspaceId = null) {
  if (workspaceId) return collection(db, 'workspaces', workspaceId, 'budgets')
  return collection(db, 'users', uid, 'budgets')
}

export async function fetchBudgets(uid, year, month, options = {}) {
  const workspaceId = options.workspaceId || null
  const monthStr = `${year}-${String(month).padStart(2, '0')}`
  try {
    const q = query(budgetCol(uid, workspaceId), where('competencyMonth', '==', monthStr))
    const snap = await getDocs(q)
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('[BudgetService] Fetch failed:', err.code, err.message)
    throw err
  }
}

export async function addBudget(uid, data, options = {}) {
  const workspaceId = options.workspaceId || data.workspaceId || null
  try {
    const ref = await addDoc(budgetCol(uid, workspaceId), {
      categoryName: data.categoryName,
      categoryId: data.categoryId || null,
      parentCategoryName: data.parentCategoryName || null,
      itemName: data.itemName || null,
      subcategoryName: data.subcategoryName || null,
      structureModel: data.structureModel || null,
      type: data.type || 'expense',
      plannedAmount: Number(data.plannedAmount),
      competencyMonth: data.competencyMonth,
      workspaceId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return ref.id
  } catch (err) {
    console.error('[BudgetService] Write failed:', err.code, err.message)
    throw err
  }
}

export async function updateBudget(uid, budgetId, data, options = {}) {
  const workspaceId = options.workspaceId || data.workspaceId || null
  try {
    const payload = { ...data, updatedAt: serverTimestamp() }
    if (payload.plannedAmount !== undefined) payload.plannedAmount = Number(payload.plannedAmount)
    const budgetRef = workspaceId
      ? doc(db, 'workspaces', workspaceId, 'budgets', budgetId)
      : doc(db, 'users', uid, 'budgets', budgetId)
    await updateDoc(budgetRef, payload)
  } catch (err) {
    console.error('[BudgetService] Update failed:', err.code, err.message)
    throw err
  }
}

export async function deleteBudget(uid, budgetId, options = {}) {
  const workspaceId = options.workspaceId || null
  try {
    const budgetRef = workspaceId
      ? doc(db, 'workspaces', workspaceId, 'budgets', budgetId)
      : doc(db, 'users', uid, 'budgets', budgetId)
    await deleteDoc(budgetRef)
  } catch (err) {
    console.error('[BudgetService] Delete failed:', err.code, err.message)
    throw err
  }
}
