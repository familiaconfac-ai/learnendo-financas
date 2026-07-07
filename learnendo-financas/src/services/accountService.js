/**
 * accountService.js
 * CRUD real no Firestore para contas do workspace ativo.
 * Fallback legado: users/{uid}/accounts/{accountId}
 */
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { testGeminiConnectionRequest } from './geminiService'

function userAccountsCol(uid) {
  return collection(db, 'users', uid, 'accounts')
}

function workspaceAccountsCol(workspaceId) {
  return collection(db, 'workspaces', workspaceId, 'accounts')
}

function accountCol(uid, workspaceId = null) {
  if (workspaceId) return workspaceAccountsCol(workspaceId)
  return userAccountsCol(uid)
}

function accountDoc(uid, accId, workspaceId = null) {
  if (workspaceId) return doc(db, 'workspaces', workspaceId, 'accounts', accId)
  return doc(db, 'users', uid, 'accounts', accId)
}

function normalizeAccountPayload(data = {}, workspaceId = null) {
  return {
    name: data.name,
    bank: data.bank || '',
    holderName: data.holderName || '',
    branchNumber: data.branchNumber || '',
    accountNumber: data.accountNumber || '',
    type: data.type || 'checking',
    balance: Number(data.balance || 0),
    current_balance: Number(data.current_balance ?? data.balance ?? 0),
    initialBalance: Number(data.initialBalance ?? data.balance ?? 0),
    color: data.color || '#1a56db',
    icon: data.icon || '🏦',
    lastStatementImportedAt: data.lastStatementImportedAt || null,
    lastStatementFileName: data.lastStatementFileName || '',
    lastStatementOpeningBalance: data.lastStatementOpeningBalance ?? null,
    lastStatementClosingBalance: data.lastStatementClosingBalance ?? null,
    lastStatementNetMovement: data.lastStatementNetMovement ?? null,
    monthlyOpeningBalances: data.monthlyOpeningBalances || {},
    balanceAdjustmentAuditLog: Array.isArray(data.balanceAdjustmentAuditLog) ? data.balanceAdjustmentAuditLog : [],
    lastBalanceAdjustmentAt: data.lastBalanceAdjustmentAt || null,
    workspaceId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
}

async function migrateLegacyAccountsToWorkspace(uid, workspaceId) {
  if (!uid || !workspaceId) return

  const [workspaceSnap, legacySnap] = await Promise.all([
    getDocs(workspaceAccountsCol(workspaceId)),
    getDocs(userAccountsCol(uid)),
  ])

  if (legacySnap.empty) return

  const existingIds = new Set(workspaceSnap.docs.map((entry) => entry.id))
  const missingLegacyDocs = legacySnap.docs.filter((entry) => !existingIds.has(entry.id))
  if (missingLegacyDocs.length === 0) return

  await Promise.all(
    missingLegacyDocs.map((entry) => setDoc(accountDoc(uid, entry.id, workspaceId), {
      ...entry.data(),
      workspaceId,
      migratedFromLegacy: true,
      migratedAt: serverTimestamp(),
      updatedAt: entry.data()?.updatedAt || serverTimestamp(),
      createdAt: entry.data()?.createdAt || serverTimestamp(),
    }, { merge: true })),
  )
}

async function resolveAccountDocForMutation(uid, accId, workspaceId = null) {
  if (!workspaceId) return accountDoc(uid, accId)

  const workspaceRef = accountDoc(uid, accId, workspaceId)
  const workspaceSnap = await getDoc(workspaceRef)
  if (workspaceSnap.exists()) return workspaceRef

  const legacyRef = accountDoc(uid, accId)
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

export async function fetchAccounts(uid, options = {}) {
  const workspaceId = options.workspaceId || null

  try {
    if (workspaceId) {
      await migrateLegacyAccountsToWorkspace(uid, workspaceId)
    }
    const snap = await getDocs(accountCol(uid, workspaceId))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('[AccountService] Fetch failed:', err.code, err.message)
    throw err
  }
}

export async function addAccount(uid, data, options = {}) {
  const workspaceId = options.workspaceId || data.workspaceId || null

  try {
    const ref = await addDoc(accountCol(uid, workspaceId), {
      ...normalizeAccountPayload(data, workspaceId),
    })
    return ref.id
  } catch (err) {
    console.error('[AccountService] Write failed:', err.code, err.message)
    throw err
  }
}

export async function updateAccount(uid, accId, data, options = {}) {
  const workspaceId = options.workspaceId || data.workspaceId || null

  try {
    const payload = { ...data, updatedAt: serverTimestamp() }
    if (payload.balance !== undefined) payload.balance = Number(payload.balance)
    if (payload.current_balance !== undefined) payload.current_balance = Number(payload.current_balance)
    if (payload.initialBalance !== undefined) payload.initialBalance = Number(payload.initialBalance)
    if (workspaceId) payload.workspaceId = workspaceId
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

    await updateDoc(await resolveAccountDocForMutation(uid, accId, workspaceId), payload)
  } catch (err) {
    console.error('[AccountService] Update failed:', err.code, err.message)
    throw err
  }
}

export async function deleteAccount(uid, accId, options = {}) {
  const workspaceId = options.workspaceId || null

  try {
    if (workspaceId) {
      await Promise.all([
        deleteDoc(accountDoc(uid, accId, workspaceId)),
        deleteDoc(accountDoc(uid, accId)),
      ])
      return
    }
    await deleteDoc(await resolveAccountDocForMutation(uid, accId, workspaceId))
  } catch (err) {
    console.error('[AccountService] Delete failed:', err.code, err.message)
    throw err
  }
}

export async function testGeminiConnection() {
  try {
    return await testGeminiConnectionRequest()
  } catch (err) {
    console.error('[AccountService] Gemini test failed:', err.code || err.name, err.message)
    throw err
  }
}
