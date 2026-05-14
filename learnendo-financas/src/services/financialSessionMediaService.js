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
      throw new Error('O endpoint de midia retornou uma URL invalida. Era esperado um endereco wss://.')
    }
    if (!parsedUrl.host) {
      throw new Error('O endpoint de midia retornou uma URL sem host valido.')
    }
    return parsedUrl.host
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error('O endpoint de midia retornou uma URL invalida para a sessao.')
  }
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
    throw new Error('Sessao financeira indisponivel para conectar a midia.')
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
    throw new Error('Nao foi possivel contactar o endpoint de audio e camera da sessao.')
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  const responseText = await response.text()

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Sua conta nao tem permissao para entrar no audio e camera desta sessao.')
    }

    if (response.status === 404) {
      throw new Error('O endpoint de audio e camera nao foi encontrado neste ambiente.')
    }

    try {
      const payload = JSON.parse(responseText)
      const message = String(payload?.error || '').trim()
      if (message) {
        throw new Error(message)
      }
    } catch (error) {
      if (error instanceof Error && error.message) {
        throw error
      }
    }

    if (isHtmlResponse(contentType, responseText)) {
      throw new Error('O endpoint de audio e camera respondeu HTML em vez de JSON.')
    }

    throw new Error(responseText || 'Nao foi possivel criar as credenciais de audio e camera.')
  }

  if (!responseText.trim()) {
    throw new Error('O endpoint de audio e camera retornou uma resposta vazia.')
  }

  if (contentType && !contentType.includes('application/json')) {
    if (isHtmlResponse(contentType, responseText)) {
      throw new Error('O endpoint de audio e camera respondeu HTML em vez de JSON.')
    }
    throw new Error('O endpoint de audio e camera nao retornou JSON valido.')
  }

  let payload
  try {
    payload = JSON.parse(responseText)
  } catch {
    throw new Error('A resposta de credenciais de audio e camera nao era JSON valido.')
  }

  const wsUrl = payload.wsUrl ?? payload.url
  const resolvedRoomName = payload.roomName ?? payload.room ?? roomName

  if (!payload?.token || !wsUrl || !resolvedRoomName) {
    throw new Error('A resposta de credenciais de audio e camera veio incompleta.')
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
