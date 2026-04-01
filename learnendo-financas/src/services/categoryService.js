/**
 * categoryService.js
 * CRUD real no Firestore para categorias do usuário.
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
  const path = workspaceId ? `workspaces/${workspaceId}/categories` : `users/${uid}/categories`
  console.log(`[CategoryService] 📥 Fetching ${path}`)
  try {
    const snap = await getDocs(catCol(uid, workspaceId))
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    console.log(`[CategoryService] ✅ Fetched ${docs.length} categories`)
    return docs
  } catch (err) {
    console.error('[CategoryService] ❌ Fetch failed:', err.code, err.message)
    throw err
  }
}

export async function addCategory(uid, data, options = {}) {
  const workspaceId = options.workspaceId || data.workspaceId || null
  const path = workspaceId ? `workspaces/${workspaceId}/categories` : `users/${uid}/categories`
  console.log(`[CategoryService] ➕ Writing to ${path}`)
  try {
    const ref = await addDoc(catCol(uid, workspaceId), {
      name:      data.name,
      icon:      data.icon || '📦',
      type:      data.type || 'expense',
      subcategories: Array.isArray(data.subcategories) ? data.subcategories : [],
      workspaceId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    console.log('[CategoryService] ✅ Write succeeded — Firestore id:', ref.id)
    return ref.id
  } catch (err) {
    console.error('[CategoryService] ❌ Write failed:', err.code, err.message)
    throw err
  }
}

export async function updateCategory(uid, catId, data, options = {}) {
  const workspaceId = options.workspaceId || data.workspaceId || null
  const path = workspaceId
    ? `workspaces/${workspaceId}/categories/${catId}`
    : `users/${uid}/categories/${catId}`
  console.log(`[CategoryService] ✏️ Updating ${path}`)
  try {
    await updateDoc(catDoc(uid, catId, workspaceId), {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.icon !== undefined ? { icon: data.icon } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.subcategories !== undefined ? { subcategories: Array.isArray(data.subcategories) ? data.subcategories : [] } : {}),
      updatedAt: serverTimestamp(),
    })
    console.log('[CategoryService] ✅ Update succeeded')
  } catch (err) {
    console.error('[CategoryService] ❌ Update failed:', err.code, err.message)
    throw err
  }
}

export async function deleteCategory(uid, catId, options = {}) {
  const workspaceId = options.workspaceId || null
  const path = workspaceId
    ? `workspaces/${workspaceId}/categories/${catId}`
    : `users/${uid}/categories/${catId}`
  console.log(`[CategoryService] 🗑️ Deleting ${path}`)
  try {
    const categoryRef = workspaceId
      ? doc(db, 'workspaces', workspaceId, 'categories', catId)
      : doc(db, 'users', uid, 'categories', catId)
    await deleteDoc(categoryRef)
    console.log('[CategoryService] ✅ Delete succeeded')
  } catch (err) {
    console.error('[CategoryService] ❌ Delete failed:', err.code, err.message)
    throw err
  }
}
