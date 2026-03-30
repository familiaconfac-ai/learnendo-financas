import { listEbdDocuments, saveEbdDocument } from './ebdDataService'

const BUCKET = 'enrollments'

export function listEnrollments(uid) {
  return listEbdDocuments(uid, BUCKET)
}

export function saveEnrollment(uid, payload, id = null) {
  return saveEbdDocument(uid, BUCKET, payload, id)
}
