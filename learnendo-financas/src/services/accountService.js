/**
 * accountService.js
 * CRUD real no Firestore para contas bancarias do usuario.
 * Path: users/{uid}/accounts/{accountId}
 */
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { testGeminiConnectionRequest } from './geminiService'

function accCol(uid) {
  return collection(db, 'users', uid, 'accounts')
}

export async function fetchAccounts(uid) {
  console.log(`[AccountService] Fetching users/${uid}/accounts`)
  try {
    const snap = await getDocs(accCol(uid))
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    console.log(`[AccountService] Fetched ${docs.length} accounts`)
    return docs
  } catch (err) {
    console.error('[AccountService] Fetch failed:', err.code, err.message)
    throw err
  }
}

export async function addAccount(uid, data) {
  console.log(`[AccountService] Writing to users/${uid}/accounts`)
  try {
    const ref = await addDoc(accCol(uid), {
      name: data.name,
      bank: data.bank || '',
      holderName: data.holderName || '',
      branchNumber: data.branchNumber || '',
      accountNumber: data.accountNumber || '',
      type: data.type || 'checking',
      balance: Number(data.balance || 0),
      current_balance: Number(data.current_balance ?? data.balance ?? 0),
      initialBalance: Number(data.balance || 0),
      color: data.color || '#1a56db',
      icon: data.icon || '🏦',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    console.log('[AccountService] Write succeeded - Firestore id:', ref.id)
    return ref.id
  } catch (err) {
    console.error('[AccountService] Write failed:', err.code, err.message)
    throw err
  }
}

export async function updateAccount(uid, accId, data) {
  console.log(`[AccountService] Updating users/${uid}/accounts/${accId}`)
  try {
    const payload = { ...data, updatedAt: serverTimestamp() }
    if (payload.balance !== undefined) payload.balance = Number(payload.balance)
    if (payload.current_balance !== undefined) payload.current_balance = Number(payload.current_balance)
    if (payload.initialBalance !== undefined) payload.initialBalance = Number(payload.initialBalance)
    if (Array.isArray(payload.adjustmentAuditEntries) && payload.adjustmentAuditEntries.length > 0) {
      const entries = payload.adjustmentAuditEntries.map((entry) => ({
        type: entry.type || 'auto_balance_adjustment',
        label: entry.label || 'Ajuste Automatico',
        description: entry.description || 'Ajuste de saldo',
        amount: Number(entry.amount || 0),
        rawAmount: Number(entry.rawAmount || 0),
        rawBalance: entry.rawBalance === null || entry.rawBalance === undefined ? null : Number(entry.rawBalance),
        date: entry.date || null,
        source: entry.source || 'bank_import',
        importRule: entry.importRule || 'balance_adjustment',
        adjustmentReason: entry.adjustmentReason || 'manual_balance_adjustment',
        createdAtIso: new Date().toISOString(),
      }))
      payload.balanceAdjustmentAuditLog = arrayUnion(...entries)
      payload.lastBalanceAdjustmentAt = new Date().toISOString()
      delete payload.adjustmentAuditEntries
    }
    await updateDoc(doc(db, 'users', uid, 'accounts', accId), payload)
    console.log('[AccountService] Update succeeded')
  } catch (err) {
    console.error('[AccountService] Update failed:', err.code, err.message)
    throw err
  }
}

export async function deleteAccount(uid, accId) {
  console.log(`[AccountService] Deleting users/${uid}/accounts/${accId}`)
  try {
    await deleteDoc(doc(db, 'users', uid, 'accounts', accId))
    console.log('[AccountService] Delete succeeded')
  } catch (err) {
    console.error('[AccountService] Delete failed:', err.code, err.message)
    throw err
  }
}

export async function testGeminiConnection() {
  console.log('[AccountService] Testing Gemini connection with gemini-1.5-flash')
  try {
    return await testGeminiConnectionRequest()
  } catch (err) {
    console.error('[AccountService] Gemini test failed:', err.code || err.name, err.message)
    throw err
  }
}
