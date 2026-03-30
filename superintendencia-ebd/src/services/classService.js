import { listEbdDocuments, saveEbdDocument, softToggleEbdDocument, removeEbdDocument } from './ebdDataService'

const BUCKET = 'classes'

export function listClasses(uid) {
  return listEbdDocuments(uid, BUCKET)
}

export function saveClass(uid, payload, id = null) {
  return saveEbdDocument(uid, BUCKET, payload, id)
}

export function toggleClassStatus(uid, id, active) {
  return softToggleEbdDocument(uid, BUCKET, id, active)
}

export function removeClass(uid, id) {
  return removeEbdDocument(uid, BUCKET, id)
}
