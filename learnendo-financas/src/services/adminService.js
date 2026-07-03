import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'
import { IS_MOCK_MODE } from '../firebase/mockMode'
import { MOCK_ADMIN_USERS } from '../utils/mockData'
import {
  assignUserCodeToExistingUser,
  formatUserCode,
  isAdminEmail,
  normalizeUserEmail,
} from './userRegistryService'

function toMillis(value) {
  if (!value) return 0
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeAdminUser(docSnap) {
  const data = docSnap.data() || {}
  const email = normalizeUserEmail(data.email)
  const role = data.role || (isAdminEmail(email) ? 'admin' : 'user')
  const numericUserNumber = Number(data.userNumber || 0)
  const userNumber = Number.isFinite(numericUserNumber) && numericUserNumber > 0
    ? Math.trunc(numericUserNumber)
    : null
  const memberCode = String(data.memberCode || '').trim() || (role === 'admin' ? 'ADMIN' : formatUserCode(userNumber))

  return {
    uid: data.uid || docSnap.id,
    email,
    displayName: data.displayName || data.name || email || 'Usuario',
    role,
    memberCode: memberCode || null,
    userNumber,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    lastLoginAt: data.lastLoginAt || null,
    lastSeenAt: data.lastSeenAt || null,
    monthlyReceitas: Number(data.monthlyReceitas || 0),
    monthlyDespesas: Number(data.monthlyDespesas || 0),
  }
}

function sortAdminUsers(a, b) {
  const aAdmin = a.role === 'admin' ? 1 : 0
  const bAdmin = b.role === 'admin' ? 1 : 0
  if (aAdmin !== bAdmin) return bAdmin - aAdmin

  const aNumber = a.userNumber || Number.MAX_SAFE_INTEGER
  const bNumber = b.userNumber || Number.MAX_SAFE_INTEGER
  if (aNumber !== bNumber) return aNumber - bNumber

  const createdDiff = toMillis(a.createdAt) - toMillis(b.createdAt)
  if (createdDiff !== 0) return createdDiff

  return String(a.displayName || '').localeCompare(String(b.displayName || ''))
}

export async function fetchAdminUsers() {
  if (IS_MOCK_MODE || !db) {
    return MOCK_ADMIN_USERS.map((user) => ({
      ...user,
      role: user.role || 'user',
      memberCode: user.memberCode || formatUserCode(user.userNumber || 0) || null,
      userNumber: Number(user.userNumber || 0) || null,
      lastLoginAt: user.lastLoginAt || null,
      lastSeenAt: user.lastSeenAt || null,
    })).sort(sortAdminUsers)
  }

  const snap = await getDocs(collection(db, 'users'))
  return snap.docs
    .map(normalizeAdminUser)
    .sort(sortAdminUsers)
}

export async function backfillMissingUserCodes(users = []) {
  if (IS_MOCK_MODE || !db) return []

  const pending = [...users]
    .filter((user) => user.role !== 'admin' && !user.userNumber)
    .sort(sortAdminUsers)

  const updated = []
  for (const user of pending) {
    const result = await assignUserCodeToExistingUser(user)
    if (result) updated.push(result)
  }
  return updated
}

export function countRecentlyActiveUsers(users = [], days = 30) {
  const threshold = Date.now() - (days * 24 * 60 * 60 * 1000)
  return users.filter((user) => toMillis(user.lastLoginAt || user.lastSeenAt) >= threshold).length
}
