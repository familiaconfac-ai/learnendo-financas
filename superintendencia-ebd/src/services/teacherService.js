import { listEbdDocuments, saveEbdDocument, softToggleEbdDocument, removeEbdDocument } from './ebdDataService'

const BUCKET = 'teachers'

export function listTeachers(uid) {
  return listEbdDocuments(uid, BUCKET)
}

export function saveTeacher(uid, payload, id = null) {
  return saveEbdDocument(uid, BUCKET, payload, id)
}

export function toggleTeacherStatus(uid, id, active) {
  return softToggleEbdDocument(uid, BUCKET, id, active)
}

export function removeTeacher(uid, id) {
  return removeEbdDocument(uid, BUCKET, id)
}
