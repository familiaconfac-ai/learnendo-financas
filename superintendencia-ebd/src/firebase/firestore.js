import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './config'

// ── Utilitário genérico ──────────────────────────────────────────────────────

export async function addDocument(collectionPath, data) {
  return addDoc(collection(db, collectionPath), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function updateDocument(collectionPath, docId, data) {
  return updateDoc(doc(db, collectionPath, docId), {
    ...data,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteDocument(collectionPath, docId) {
  return deleteDoc(doc(db, collectionPath, docId))
}

export async function getDocument(collectionPath, docId) {
  const snap = await getDoc(doc(db, collectionPath, docId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function queryDocuments(collectionPath, constraints = []) {
  const q = query(collection(db, collectionPath), ...constraints)
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// ── Exportar helpers de query do Firestore para uso nos serviços ─────────────
export { where, orderBy }
