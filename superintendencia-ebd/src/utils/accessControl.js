export const ROLES = {
  ADMIN: 'admin',
  TEACHER: 'teacher',
}

export const PRIMARY_ADMIN_EMAIL = 'igrejabatistaolimpia@gmail.com'

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase()
}

export function resolveRoleFromEmail(email) {
  return normalizeEmail(email) === PRIMARY_ADMIN_EMAIL
    ? ROLES.ADMIN
    : ROLES.TEACHER
}

export function isAdminRole(role) {
  return role === ROLES.ADMIN
}

export function isTeacherRole(role) {
  return role === ROLES.TEACHER
}

function normalizeText(value) {
  return (value || '')
    .toString()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function getUserIdentityTokens(user, profile) {
  const email = normalizeEmail(profile?.email || user?.email || '')
  const emailName = email.includes('@') ? email.split('@')[0] : email
  const names = [profile?.displayName, user?.displayName, emailName]
    .map(normalizeText)
    .filter(Boolean)

  return {
    uid: user?.uid || '',
    email,
    names,
  }
}

export function belongsToTeacherRecord(record, user, profile) {
  if (!record) return false

  const identity = getUserIdentityTokens(user, profile)
  if (!identity.uid && !identity.email && identity.names.length === 0) return false

  const ownerUid = record.teacherUserUid || record.createdByUid || ''
  if (ownerUid && identity.uid && ownerUid === identity.uid) return true

  const ownerEmail = normalizeEmail(record.teacherEmail || record.defaultTeacherEmail || '')
  if (ownerEmail && identity.email && ownerEmail === identity.email) return true

  const ownerName = normalizeText(record.teacherName || record.defaultTeacherName || '')
  if (ownerName && identity.names.includes(ownerName)) return true

  return false
}
