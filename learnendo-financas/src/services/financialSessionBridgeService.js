const STORAGE_KEY = 'learnendo-financas.active-financial-session'
const EVENT_NAME = 'learnendo-financas:active-financial-session'

function normalizeBridgePayload(value = null) {
  if (!value || typeof value !== 'object') return null

  const workspaceId = String(value.workspaceId || '').trim()
  const sessionId = String(value.sessionId || '').trim()
  if (!workspaceId || !sessionId) return null

  return {
    workspaceId,
    sessionId,
    activatedAt: String(value.activatedAt || new Date().toISOString()),
  }
}

function notifyBridgeChange(detail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }))
}

export function getActiveFinancialSessionBridge() {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return normalizeBridgePayload(JSON.parse(raw))
  } catch {
    return null
  }
}

export function setActiveFinancialSessionBridge(value) {
  const normalized = normalizeBridgePayload(value)
  if (typeof window === 'undefined') return normalized

  if (!normalized) {
    window.localStorage.removeItem(STORAGE_KEY)
    notifyBridgeChange(null)
    return null
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  notifyBridgeChange(normalized)
  return normalized
}

export function clearActiveFinancialSessionBridge() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
  notifyBridgeChange(null)
}

export function subscribeActiveFinancialSessionBridge(onChange) {
  if (typeof window === 'undefined') return () => {}

  const handleCustomEvent = (event) => {
    onChange(normalizeBridgePayload(event.detail))
  }

  const handleStorage = (event) => {
    if (event.key !== STORAGE_KEY) return
    if (!event.newValue) {
      onChange(null)
      return
    }

    try {
      onChange(normalizeBridgePayload(JSON.parse(event.newValue)))
    } catch {
      onChange(null)
    }
  }

  window.addEventListener(EVENT_NAME, handleCustomEvent)
  window.addEventListener('storage', handleStorage)

  return () => {
    window.removeEventListener(EVENT_NAME, handleCustomEvent)
    window.removeEventListener('storage', handleStorage)
  }
}
