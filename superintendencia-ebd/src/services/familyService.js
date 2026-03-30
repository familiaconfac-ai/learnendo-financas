/**
 * familyService.js
 *
 * Firestore CRUD for the Family feature.
 *
 * Paths:
 *   users/{uid}/families/{familyId}                        — family document
 *   users/{uid}/families/{familyId}/members/{memberId}     — members sub-collection
 *   users/{uid}/families/{familyId}/invitations/{invId}    — invitations sub-collection
 *
 * Role values (new canonical names):
 *   'gestor'    — full control (owner), can do everything
 *   'co-gestor' — almost full control, can manage members
 *   'membro'    — can create/edit their own transactions
 *   'planejador' — view-only, no edits
 */

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'

// ── Path helpers ──────────────────────────────────────────────────────────────

function familyCol(uid)                     { return collection(db, 'users', uid, 'families') }
function familyDoc(uid, fid)               { return doc(db, 'users', uid, 'families', fid) }
function memberCol(uid, fid)               { return collection(db, 'users', uid, 'families', fid, 'members') }
function memberDoc(uid, fid, mid)          { return doc(db, 'users', uid, 'families', fid, 'members', mid) }
function inviteCol(uid, fid)               { return collection(db, 'users', uid, 'families', fid, 'invitations') }
function inviteDoc(uid, fid, iid)          { return doc(db, 'users', uid, 'families', fid, 'invitations', iid) }

// ── Family CRUD ───────────────────────────────────────────────────────────────

/**
 * Returns the first family document for the user, or null if none exists.
 */
export async function fetchUserFamily(uid) {
  const snap = await getDocs(familyCol(uid))
  if (snap.empty) return null
  const d = snap.docs[0]
  return { id: d.id, ...d.data() }
}

/**
 * Creates a new family for the user.
 * @param {string} uid
 * @param {{ name: string, plan?: string }} data
 * @returns {string} new family ID
 */
export async function createFamily(uid, { name, plan = 'family' }) {
  console.log('[FamilyService] ➕ Creating family for', uid)
  const ref = await addDoc(familyCol(uid), {
    name,
    plan,
    ownerUid:  uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  console.log('[FamilyService] ✅ Family created:', ref.id)
  return ref.id
}

/**
 * Updates a family document (e.g. name, plan).
 */
export async function updateFamily(uid, familyId, data) {
  console.log('[FamilyService] ✏️ Updating family', familyId)
  await updateDoc(familyDoc(uid, familyId), {
    ...data,
    updatedAt: serverTimestamp(),
  })
  console.log('[FamilyService] ✅ Family updated')
}

/**
 * Deletes a family document AND all its members/invitations sub-documents.
 * Note: in production you'd use a Cloud Function for recursive deletes;
 * this is safe for the small sub-collections this app uses client-side.
 */
export async function deleteFamily(uid, familyId) {
  console.log('[FamilyService] 🗑️ Deleting family', familyId)

  // Fetch sub-collections concurrently
  const [membersSnap, invitesSnap] = await Promise.all([
    getDocs(memberCol(uid, familyId)),
    getDocs(inviteCol(uid, familyId)),
  ])

  // Delete all sub-documents
  const subDeletes = [
    ...membersSnap.docs.map((d) => deleteDoc(memberDoc(uid, familyId, d.id))),
    ...invitesSnap.docs.map((d) => deleteDoc(inviteDoc(uid, familyId, d.id))),
  ]
  await Promise.all(subDeletes)

  // Delete the family document itself
  await deleteDoc(familyDoc(uid, familyId))
  console.log('[FamilyService] ✅ Family deleted')
}

// ── Members ───────────────────────────────────────────────────────────────────

/**
 * Fetches all members for a family, ordered by join date.
 */
export async function fetchMembers(uid, familyId) {
  try {
    const snap = await getDocs(query(memberCol(uid, familyId), orderBy('joinedAt', 'asc')))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    // orderBy requires an index — fall back to unordered if index is missing
    console.warn('[FamilyService] orderBy failed, fetching unordered:', err.message)
    const snap = await getDocs(memberCol(uid, familyId))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  }
}

/**
 * Adds a member to the family.
 */
export async function addMember(uid, familyId, memberData) {
  const ref = await addDoc(memberCol(uid, familyId), {
    ...memberData,
    joinedAt:  serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

/**
 * Changes a member's role.
 */
export async function updateMemberRole(uid, familyId, memberId, role) {
  console.log('[FamilyService] ✏️ Role change', memberId, '→', role)
  await updateDoc(memberDoc(uid, familyId, memberId), {
    role,
    updatedAt: serverTimestamp(),
  })
}

/**
 * Removes a member from the family.
 */
export async function removeMember(uid, familyId, memberId) {
  console.log('[FamilyService] 🗑️ Removing member', memberId)
  await deleteDoc(memberDoc(uid, familyId, memberId))
  console.log('[FamilyService] ✅ Member removed')
}

// ── Invitations ───────────────────────────────────────────────────────────────

/**
 * Fetches all invitations for a family.
 */
export async function fetchInvitations(uid, familyId) {
  const snap = await getDocs(inviteCol(uid, familyId))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/**
 * Adds a new invitation record.
 */
export async function addInvitation(uid, familyId, data) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const ref = await addDoc(inviteCol(uid, familyId), {
    ...data,
    status:    'pending',
    sentAt:    serverTimestamp(),
    expiresAt,
    sentBy:    uid,
  })
  return ref.id
}

/**
 * Cancels (soft-deletes) an invitation.
 */
export async function cancelInvitation(uid, familyId, inviteId) {
  await updateDoc(inviteDoc(uid, familyId, inviteId), {
    status:    'cancelled',
    updatedAt: serverTimestamp(),
  })
}

// ── Pending member ─────────────────────────────────────────────────────────────

/**
 * Adds a pending member entry by email (no UID required).
 * The member appears in the list with status 'pending' until they join.
 * @returns {{ id: string, email: string, displayName: string, role: string, status: string }}
 */
export async function addPendingMember(uid, familyId, email, role = 'membro') {
  const normEmail = email.trim().toLowerCase()
  const ref = await addDoc(memberCol(uid, familyId), {
    email:       normEmail,
    uid:         null,
    displayName: normEmail,
    name:        normEmail,
    role,
    status:      'pending',
    joinedAt:    serverTimestamp(),
    invitedAt:   serverTimestamp(),
    updatedAt:   serverTimestamp(),
  })
  return {
    id:          ref.id,
    email:       normEmail,
    displayName: normEmail,
    name:        normEmail,
    role,
    status:      'pending',
    uid:         null,
  }
}
