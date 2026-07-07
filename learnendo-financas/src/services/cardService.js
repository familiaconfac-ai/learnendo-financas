/**
 * cardService.js
 * CRUD real no Firestore para cartoes do workspace ativo.
 * Fallback legado: users/{uid}/cards/{cardId}
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase/config'

function userCardsCol(uid) {
  return collection(db, 'users', uid, 'cards')
}

function workspaceCardsCol(workspaceId) {
  return collection(db, 'workspaces', workspaceId, 'cards')
}

function cardCol(uid, workspaceId = null) {
  if (workspaceId) return workspaceCardsCol(workspaceId)
  return userCardsCol(uid)
}

function cardDoc(uid, cardId, workspaceId = null) {
  if (workspaceId) return doc(db, 'workspaces', workspaceId, 'cards', cardId)
  return doc(db, 'users', uid, 'cards', cardId)
}

async function migrateLegacyCardsToWorkspace(uid, workspaceId) {
  if (!uid || !workspaceId) return

  const [workspaceSnap, legacySnap] = await Promise.all([
    getDocs(workspaceCardsCol(workspaceId)),
    getDocs(userCardsCol(uid)),
  ])

  if (legacySnap.empty) return

  const existingIds = new Set(workspaceSnap.docs.map((entry) => entry.id))
  const missingLegacyDocs = legacySnap.docs.filter((entry) => !existingIds.has(entry.id))
  if (missingLegacyDocs.length === 0) return

  await Promise.all(
    missingLegacyDocs.map((entry) => setDoc(cardDoc(uid, entry.id, workspaceId), {
      ...entry.data(),
      workspaceId,
      migratedFromLegacy: true,
      migratedAt: serverTimestamp(),
      updatedAt: entry.data()?.updatedAt || serverTimestamp(),
      createdAt: entry.data()?.createdAt || serverTimestamp(),
    }, { merge: true })),
  )
}

async function resolveCardDocForMutation(uid, cardId, workspaceId = null) {
  if (!workspaceId) return cardDoc(uid, cardId)

  const workspaceRef = cardDoc(uid, cardId, workspaceId)
  const workspaceSnap = await getDoc(workspaceRef)
  if (workspaceSnap.exists()) return workspaceRef

  const legacyRef = cardDoc(uid, cardId)
  const legacySnap = await getDoc(legacyRef)
  if (legacySnap.exists()) {
    await setDoc(workspaceRef, {
      ...legacySnap.data(),
      workspaceId,
      migratedFromLegacy: true,
      migratedAt: serverTimestamp(),
      updatedAt: legacySnap.data()?.updatedAt || serverTimestamp(),
      createdAt: legacySnap.data()?.createdAt || serverTimestamp(),
    }, { merge: true })
  }

  return workspaceRef
}

export async function fetchCards(uid, options = {}) {
  const workspaceId = options.workspaceId || null

  try {
    if (workspaceId) {
      await migrateLegacyCardsToWorkspace(uid, workspaceId)
    }
    const snap = await getDocs(cardCol(uid, workspaceId))
    return snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
  } catch (err) {
    console.error('[CardService] Fetch failed:', err.code, err.message)
    throw err
  }
}

export async function addCard(uid, data, options = {}) {
  const workspaceId = options.workspaceId || data.workspaceId || null

  try {
    const ref = await addDoc(cardCol(uid, workspaceId), {
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
      workspaceId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return ref.id
  } catch (err) {
    console.error('[CardService] Write failed:', err.code, err.message)
    throw err
  }
}

export async function updateCard(uid, cardId, data, options = {}) {
  const workspaceId = options.workspaceId || data.workspaceId || null

  try {
    const payload = { ...data, updatedAt: serverTimestamp() }
    if (payload.limit !== undefined) payload.limit = Number(payload.limit)
    if (payload.usedLimit !== undefined) payload.usedLimit = Number(payload.usedLimit)
    if (payload.currentInvoice !== undefined) payload.currentInvoice = Number(payload.currentInvoice)
    if (payload.closingDay !== undefined) payload.closingDay = Number(payload.closingDay)
    if (payload.dueDay !== undefined) payload.dueDay = Number(payload.dueDay)
    if (workspaceId) payload.workspaceId = workspaceId
    await updateDoc(await resolveCardDocForMutation(uid, cardId, workspaceId), payload)
  } catch (err) {
    console.error('[CardService] Update failed:', err.code, err.message)
    throw err
  }
}

export async function deleteCard(uid, cardId, options = {}) {
  const workspaceId = options.workspaceId || null

  try {
    if (workspaceId) {
      await Promise.all([
        deleteDoc(cardDoc(uid, cardId, workspaceId)),
        deleteDoc(cardDoc(uid, cardId)),
      ])
      return
    }
    await deleteDoc(await resolveCardDocForMutation(uid, cardId, workspaceId))
  } catch (err) {
    console.error('[CardService] Delete failed:', err.code, err.message)
    throw err
  }
}
