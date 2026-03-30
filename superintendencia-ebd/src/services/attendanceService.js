import { listEbdDocuments, saveEbdDocument } from './ebdDataService'

const BUCKET = 'attendanceRegisters'

export function listAttendanceRegisters(uid) {
  return listEbdDocuments(uid, BUCKET)
}

export function saveAttendanceRegister(uid, payload, id = null) {
  return saveEbdDocument(uid, BUCKET, payload, id)
}
