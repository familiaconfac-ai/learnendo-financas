/**
 * categoryService.js
 * CRUD real no Firestore para categorias do usuario.
 * Path: users/{uid}/categories/{categoryId}
 */
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase/config'

function catCol(uid, workspaceId = null) {
  if (workspaceId) return collection(db, 'workspaces', workspaceId, 'categories')
  return collection(db, 'users', uid, 'categories')
}

function catDoc(uid, catId, workspaceId = null) {
  if (workspaceId) return doc(db, 'workspaces', workspaceId, 'categories', catId)
  return doc(db, 'users', uid, 'categories', catId)
}

export async function fetchCategories(uid, options = {}) {
  const workspaceId = options.workspaceId || null
  try {
    const snap = await getDocs(catCol(uid, workspaceId))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('[CategoryService] Fetch failed:', err.code, err.message)
    throw err
  }
}

export async function addCategory(uid, data, options = {}) {
  const workspaceId = options.workspaceId || data.workspaceId || null
  try {
    const ref = await addDoc(catCol(uid, workspaceId), {
      name: data.name,
      icon: data.icon || '📦',
      type: data.type || 'expense',
      subcategories: Array.isArray(data.subcategories) ? data.subcategories : [],
      workspaceId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return ref.id
  } catch (err) {
    console.error('[CategoryService] Write failed:', err.code, err.message)
    throw err
  }
}

export async function updateCategory(uid, catId, data, options = {}) {
  const workspaceId = options.workspaceId || data.workspaceId || null
  try {
    await updateDoc(catDoc(uid, catId, workspaceId), {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.icon !== undefined ? { icon: data.icon } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.subcategories !== undefined ? { subcategories: Array.isArray(data.subcategories) ? data.subcategories : [] } : {}),
      updatedAt: serverTimestamp(),
    })
  } catch (err) {
    console.error('[CategoryService] Update failed:', err.code, err.message)
    throw err
  }
}

export async function deleteCategory(uid, catId, options = {}) {
  const workspaceId = options.workspaceId || null
  try {
    const categoryRef = workspaceId
      ? doc(db, 'workspaces', workspaceId, 'categories', catId)
      : doc(db, 'users', uid, 'categories', catId)
    await deleteDoc(categoryRef)
  } catch (err) {
    console.error('[CategoryService] Delete failed:', err.code, err.message)
    throw err
  }
}
