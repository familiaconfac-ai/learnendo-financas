import { listEbdDocuments, saveEbdDocument, softToggleEbdDocument, removeEbdDocument } from './ebdDataService'

const BUCKET = 'people'

export function listPeople(uid) {
  return listEbdDocuments(uid, BUCKET)
}

export function savePerson(uid, payload, id = null) {
  return saveEbdDocument(uid, BUCKET, payload, id)
}

export function togglePersonStatus(uid, id, active) {
  return softToggleEbdDocument(uid, BUCKET, id, active)
}

export function removePerson(uid, id) {
  return removeEbdDocument(uid, BUCKET, id)
}
