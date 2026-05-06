/**
 * cardService.js
 * CRUD real no Firestore para cartoes do usuario.
 * Path: users/{uid}/cards/{cardId}
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase/config'

function cardCol(uid) {
  return collection(db, 'users', uid, 'cards')
}

export async function fetchCards(uid) {
  try {
    const snap = await getDocs(cardCol(uid))
    return snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
  } catch (err) {
    console.error('[CardService] Fetch failed:', err.code, err.message)
    throw err
  }
}

export async function addCard(uid, data) {
  try {
    const ref = await addDoc(cardCol(uid), {
      name: data.name,
      holderName: data.holderName || '',
      issuerBank: data.issuerBank || '',
      flag: data.flag || '',
      limit: Number(data.limit || 0),
      usedLimit: Number(data.usedLimit || data.currentInvoice || 0),
      closingDay: Number(data.closingDay || 0),
      dueDay: Number(data.dueDay || 0),
      currentInvoice: Number(data.currentInvoice || 0),
      color: data.color || '#8b5cf6',
      icon: data.icon || '💳',
      lastInvoiceImportedAt: data.lastInvoiceImportedAt || null,
      lastInvoiceFileName: data.lastInvoiceFileName || '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return ref.id
  } catch (err) {
    console.error('[CardService] Write failed:', err.code, err.message)
    throw err
  }
}

export async function updateCard(uid, cardId, data) {
  try {
    const payload = { ...data, updatedAt: serverTimestamp() }
    if (payload.limit !== undefined) payload.limit = Number(payload.limit)
    if (payload.usedLimit !== undefined) payload.usedLimit = Number(payload.usedLimit)
    if (payload.currentInvoice !== undefined) payload.currentInvoice = Number(payload.currentInvoice)
    if (payload.closingDay !== undefined) payload.closingDay = Number(payload.closingDay)
    if (payload.dueDay !== undefined) payload.dueDay = Number(payload.dueDay)
    await updateDoc(doc(db, 'users', uid, 'cards', cardId), payload)
  } catch (err) {
    console.error('[CardService] Update failed:', err.code, err.message)
    throw err
  }
}

export async function deleteCard(uid, cardId) {
  try {
    await deleteDoc(doc(db, 'users', uid, 'cards', cardId))
  } catch (err) {
    console.error('[CardService] Delete failed:', err.code, err.message)
    throw err
  }
}
