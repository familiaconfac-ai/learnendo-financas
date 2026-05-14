import { AccessToken } from 'livekit-server-sdk'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const WORKSPACE_MANAGER_ROLES = ['gestor', 'co-gestor', 'planejador-master', 'planejador-plus']
const REQUIRED_LIVEKIT_ENV_KEYS = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']
const REQUIRED_FIREBASE_ADMIN_ENV_KEYS = ['FIREBASE_ADMIN_PROJECT_ID', 'FIREBASE_ADMIN_CLIENT_EMAIL', 'FIREBASE_ADMIN_PRIVATE_KEY']

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }

  if (chunks.length === 0) return {}
  const rawBody = Buffer.concat(chunks).toString('utf8').trim()
  if (!rawBody) return {}
  return JSON.parse(rawBody)
}

function getBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  if (!header || typeof header !== 'string') return ''
  if (!header.startsWith('Bearer ')) return ''
  return header.slice('Bearer '.length).trim()
}

function normalizePrivateKey(value = '') {
  return String(value).replace(/\\n/g, '\n')
}

function initFirebaseAdmin() {
  if (getApps().length > 0) {
    return getApps()[0]
  }

  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: normalizePrivateKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY || ''),
    }),
  })
}

function getMissingEnv(keys = []) {
  return keys.filter((key) => !process.env[key]?.trim())
}

function sanitizeRoomChunk(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildRoomName(workspaceId, sessionId) {
  const workspaceChunk = sanitizeRoomChunk(workspaceId) || 'workspace'
  const sessionChunk = sanitizeRoomChunk(sessionId) || 'session'
  return `learnendo-financas-${workspaceChunk}-${sessionChunk}`
}

function deriveSessionRole(sessionData = {}, uid, workspaceRole = '') {
  const plannerMemberIds = Array.isArray(sessionData.plannerMemberIds) ? sessionData.plannerMemberIds : []
  const clientMemberIds = Array.isArray(sessionData.clientMemberIds) ? sessionData.clientMemberIds : []
  const participantMemberIds = Array.isArray(sessionData.participantMemberIds) ? sessionData.participantMemberIds : []

  if (WORKSPACE_MANAGER_ROLES.includes(workspaceRole) || plannerMemberIds.includes(uid)) {
    return 'planner'
  }

  if (clientMemberIds.includes(uid)) {
    return 'client'
  }

  if (participantMemberIds.includes(uid)) {
    return 'viewer'
  }

  return ''
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  const missingLiveKitEnv = getMissingEnv(REQUIRED_LIVEKIT_ENV_KEYS)
  const missingFirebaseAdminEnv = getMissingEnv(REQUIRED_FIREBASE_ADMIN_ENV_KEYS)

  if (missingLiveKitEnv.length > 0) {
    sendJson(res, 500, {
      error: `LiveKit nao esta configurado neste ambiente. Adicione: ${missingLiveKitEnv.join(', ')}.`,
    })
    return
  }

  if (missingFirebaseAdminEnv.length > 0) {
    sendJson(res, 500, {
      error: `Firebase Admin nao esta configurado para validar a sessao. Adicione: ${missingFirebaseAdminEnv.join(', ')}.`,
    })
    return
  }

  const idToken = getBearerToken(req)
  if (!idToken) {
    sendJson(res, 401, { error: 'Autenticacao obrigatoria para entrar no audio e camera da sessao.' })
    return
  }

  let body
  try {
    body = typeof req.body === 'object' && req.body !== null
      ? req.body
      : await readJsonBody(req)
  } catch {
    sendJson(res, 400, { error: 'O corpo da requisicao nao esta em JSON valido.' })
    return
  }

  const workspaceId = String(body?.workspaceId || '').trim()
  const sessionId = String(body?.sessionId || '').trim()
  const participantName = String(body?.username || '').trim() || 'Participante'

  if (!workspaceId || !sessionId) {
    sendJson(res, 400, { error: 'workspaceId e sessionId sao obrigatorios.' })
    return
  }

  try {
    initFirebaseAdmin()
    const adminAuth = getAuth()
    const firestore = getFirestore()
    const decoded = await adminAuth.verifyIdToken(idToken)
    const uid = decoded.uid

    const [memberSnapshot, sessionSnapshot] = await Promise.all([
      firestore.doc(`workspaces/${workspaceId}/members/${uid}`).get(),
      firestore.doc(`workspaces/${workspaceId}/financialSessions/${sessionId}`).get(),
    ])

    if (!memberSnapshot.exists) {
      sendJson(res, 403, { error: 'Sua conta nao pertence a este workspace.' })
      return
    }

    if (!sessionSnapshot.exists) {
      sendJson(res, 404, { error: 'Sessao financeira nao encontrada.' })
      return
    }

    const memberData = memberSnapshot.data() || {}
    const sessionData = sessionSnapshot.data() || {}
    const workspaceRole = String(memberData.role || '')
    const sessionRole = deriveSessionRole(sessionData, uid, workspaceRole)

    if (!sessionRole) {
      sendJson(res, 403, { error: 'Sua conta nao participa desta sessao financeira.' })
      return
    }

    const roomName = buildRoomName(workspaceId, sessionId)
    const participantIdentity = `${sessionRole}:${uid}`
    const wsUrl = process.env.LIVEKIT_URL.trim()
    const apiKey = process.env.LIVEKIT_API_KEY.trim()
    const apiSecret = process.env.LIVEKIT_API_SECRET.trim()

    const token = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
      name: participantName,
      metadata: JSON.stringify({
        workspaceId,
        sessionId,
        uid,
        role: sessionRole,
      }),
    })

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    })

    sendJson(res, 200, {
      token: await token.toJwt(),
      wsUrl,
      roomName,
      participantIdentity,
      participantName,
      sessionRole,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nao foi possivel gerar o token da sessao.'
    sendJson(res, 500, { error: message })
  }
}
