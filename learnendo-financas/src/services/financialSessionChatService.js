import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  limit,
} from 'firebase/firestore'
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage'
import { db, storage } from '../firebase/config'

const MAX_CHAT_FILE_SIZE_BYTES = 15 * 1024 * 1024
const ALLOWED_CHAT_FILE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]

const ALLOWED_CHAT_FILE_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.csv', '.xls', '.xlsx', '.txt', '.ofx', '.qfx']

function chatCol(workspaceId, sessionId) {
  return collection(db, 'workspaces', workspaceId, 'financialSessions', sessionId, 'chat')
}

function chatDoc(workspaceId, sessionId, messageId) {
  return doc(db, 'workspaces', workspaceId, 'financialSessions', sessionId, 'chat', messageId)
}

function normalizeFileName(value = '') {
  return String(value || 'arquivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function isAllowedExtension(fileName = '') {
  const lowered = String(fileName || '').toLowerCase()
  return ALLOWED_CHAT_FILE_EXTENSIONS.some((ext) => lowered.endsWith(ext))
}

function assertChatAttachment(file) {
  if (!file) return

  if (file.size > MAX_CHAT_FILE_SIZE_BYTES) {
    throw new Error('O arquivo do chat precisa ter no maximo 15 MB.')
  }

  const mimeType = String(file.type || '').toLowerCase()
  if (!ALLOWED_CHAT_FILE_TYPES.includes(mimeType) && !isAllowedExtension(file.name)) {
    throw new Error('Envie PDF, imagem, CSV, OFX, QFX, XLSX ou TXT no chat.')
  }
}

function mapChatMessage(docSnapshot) {
  const data = docSnapshot.data() || {}
  return {
    id: docSnapshot.id,
    text: String(data.text || ''),
    senderUid: String(data.senderUid || ''),
    senderName: String(data.senderName || 'Participante'),
    senderRole: String(data.senderRole || 'viewer'),
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt ?? null,
    attachment: data.attachment ? {
      name: String(data.attachment.name || 'arquivo'),
      url: String(data.attachment.url || ''),
      storagePath: String(data.attachment.storagePath || ''),
      mimeType: String(data.attachment.mimeType || ''),
      size: Number(data.attachment.size || 0),
      kind: String(data.attachment.kind || 'file'),
    } : null,
  }
}

function messageStoragePath(workspaceId, sessionId, messageId, fileName) {
  return `financialSessions/${workspaceId}/${sessionId}/chat/${messageId}/${fileName}`
}

export function subscribeFinancialSessionMessages(workspaceId, sessionId, onData, onError) {
  if (!workspaceId || !sessionId) {
    onData([])
    return () => {}
  }

  return onSnapshot(
    query(chatCol(workspaceId, sessionId), orderBy('createdAt', 'asc'), limit(120)),
    (snapshot) => onData(snapshot.docs.map(mapChatMessage)),
    (error) => {
      if (onError) onError(error)
    },
  )
}

export async function sendFinancialSessionMessage(workspaceId, sessionId, payload = {}) {
  if (!workspaceId || !sessionId) throw new Error('Sessao indisponivel')

  const text = String(payload.text || '').trim()
  const attachmentFile = payload.attachmentFile || null
  if (!text && !attachmentFile) {
    throw new Error('Escreva uma mensagem ou envie um arquivo.')
  }

  assertChatAttachment(attachmentFile)

  const messageRef = await addDoc(chatCol(workspaceId, sessionId), {
    text,
    senderUid: payload.senderUid || '',
    senderName: payload.senderName || 'Participante',
    senderRole: payload.senderRole || 'viewer',
    attachment: null,
    createdAt: serverTimestamp(),
  })

  if (!attachmentFile) {
    return messageRef.id
  }

  if (!storage) {
    throw new Error('Storage do Firebase nao esta disponivel neste ambiente.')
  }

  const normalizedName = normalizeFileName(attachmentFile.name || 'arquivo')
  const path = messageStoragePath(workspaceId, sessionId, messageRef.id, normalizedName)
  const fileRef = storageRef(storage, path)

  await uploadBytes(fileRef, attachmentFile, {
    contentType: attachmentFile.type || 'application/octet-stream',
  })

  const downloadUrl = await getDownloadURL(fileRef)

  await updateDoc(chatDoc(workspaceId, sessionId, messageRef.id), {
    attachment: {
      name: attachmentFile.name || normalizedName,
      url: downloadUrl,
      storagePath: path,
      mimeType: attachmentFile.type || '',
      size: attachmentFile.size || 0,
      kind: String(attachmentFile.type || '').startsWith('image/') ? 'image' : 'file',
    },
  })

  return messageRef.id
}

export async function deleteFinancialSessionMessage(workspaceId, sessionId, message) {
  if (!workspaceId || !sessionId || !message?.id) {
    throw new Error('Mensagem nao encontrada.')
  }

  if (message?.attachment?.storagePath && storage) {
    try {
      await deleteObject(storageRef(storage, message.attachment.storagePath))
    } catch (_) {
      // Se o arquivo nao puder ser removido agora, seguimos com a exclusao da mensagem.
    }
  }

  await deleteDoc(chatDoc(workspaceId, sessionId, message.id))
}

export function formatChatFileSize(bytes) {
  const size = Number(bytes || 0)
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
