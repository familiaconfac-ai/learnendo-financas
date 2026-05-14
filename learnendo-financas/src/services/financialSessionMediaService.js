import { auth } from '../firebase/config'

const DEFAULT_FINANCIAL_SESSION_TOKEN_ENDPOINT = '/api/getFinancialSessionToken'

function sanitizeRoomChunk(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isHtmlResponse(contentType, responseText) {
  return contentType.includes('text/html') || /^\s*</.test(responseText)
}

function validateReturnedLiveKitUrl(wsUrl) {
  try {
    const parsedUrl = new URL(wsUrl)
    if (parsedUrl.protocol !== 'wss:') {
      throw new Error('O endpoint de mídia retornou uma URL inválida. Era esperado um endereço wss://.')
    }
    if (!parsedUrl.host) {
      throw new Error('O endpoint de mídia retornou uma URL sem host válido.')
    }
    return parsedUrl.host
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error('O endpoint de mídia retornou uma URL inválida para a sessão.')
  }
}

function mapCredentialErrorMessage(message = '') {
  const normalized = String(message || '').trim()
  if (!normalized) return ''

  if (
    normalized.includes('LIVEKIT_URL')
    || normalized.includes('LIVEKIT_API_KEY')
    || normalized.includes('LIVEKIT_API_SECRET')
  ) {
    return 'Áudio, câmera e compartilhamento de tela ainda não foram configurados neste ambiente.'
  }

  return normalized
}

export function getFinancialSessionMediaRoomName(workspaceId, sessionId) {
  const workspaceChunk = sanitizeRoomChunk(workspaceId) || 'workspace'
  const sessionChunk = sanitizeRoomChunk(sessionId) || 'session'
  return `learnendo-financas-${workspaceChunk}-${sessionChunk}`
}

export function getFinancialSessionTokenEndpoint() {
  const configured = import.meta.env.VITE_FINANCIAL_SESSION_TOKEN_ENDPOINT?.trim()
  return configured || DEFAULT_FINANCIAL_SESSION_TOKEN_ENDPOINT
}

export async function requestFinancialSessionMediaCredentials({
  workspaceId,
  sessionId,
  userName,
}) {
  const endpoint = getFinancialSessionTokenEndpoint()
  const idToken = await auth.currentUser?.getIdToken?.().catch(() => '')
  const roomName = getFinancialSessionMediaRoomName(workspaceId, sessionId)

  if (!workspaceId || !sessionId) {
    throw new Error('Sessão financeira indisponível para conectar a mídia.')
  }

  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        workspaceId,
        sessionId,
        room: roomName,
        username: userName,
      }),
    })
  } catch (error) {
    console.error('[FinancialSessionMedia] network error calling token endpoint', endpoint, error)
    throw new Error('Não foi possível contactar o endpoint de áudio e câmera da sessão.')
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  const responseText = await response.text()

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Sua conta não tem permissão para entrar no áudio e câmera desta sessão.')
    }

    if (response.status === 404) {
      throw new Error('O endpoint de áudio e câmera não foi encontrado neste ambiente.')
    }

    try {
      const payload = JSON.parse(responseText)
      const message = mapCredentialErrorMessage(payload?.error)
      if (message) {
        throw new Error(message)
      }
    } catch (error) {
      if (error instanceof Error && error.message) {
        throw error
      }
    }

    if (isHtmlResponse(contentType, responseText)) {
      throw new Error('O endpoint de áudio e câmera respondeu HTML em vez de JSON.')
    }

    throw new Error(responseText || 'Não foi possível criar as credenciais de áudio e câmera.')
  }

  if (!responseText.trim()) {
    throw new Error('O endpoint de áudio e câmera retornou uma resposta vazia.')
  }

  if (contentType && !contentType.includes('application/json')) {
    if (isHtmlResponse(contentType, responseText)) {
      throw new Error('O endpoint de áudio e câmera respondeu HTML em vez de JSON.')
    }
    throw new Error('O endpoint de áudio e câmera não retornou JSON válido.')
  }

  let payload
  try {
    payload = JSON.parse(responseText)
  } catch {
    throw new Error('A resposta de credenciais de áudio e câmera não era JSON válido.')
  }

  const wsUrl = payload.wsUrl ?? payload.url
  const resolvedRoomName = payload.roomName ?? payload.room ?? roomName

  if (!payload?.token || !wsUrl || !resolvedRoomName) {
    throw new Error('A resposta de credenciais de áudio e câmera veio incompleta.')
  }

  validateReturnedLiveKitUrl(wsUrl)

  return {
    token: payload.token,
    wsUrl,
    roomName: resolvedRoomName,
    participantIdentity: payload.participantIdentity || '',
    participantName: payload.participantName || userName || 'Participante',
    sessionRole: payload.sessionRole || 'viewer',
  }
}
