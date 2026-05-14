export const FINANCIAL_SESSION_PANELS = [
  'overview',
  'transactions',
  'budget',
  'goals',
  'notes',
  'planning',
]

const FINANCIAL_SESSION_MEDIA_TRANSPORTS = [
  'not_configured',
  'connecting',
  'connected',
  'error',
]

const FINANCIAL_SESSION_CLIENT_CAMERA_MODES = [
  'off',
  'follow_mic',
  'free',
  'required',
]

export function normalizeFinancialSessionStatus(value) {
  if (value === 'active') return 'active'
  if (value === 'paused') return 'paused'
  if (value === 'ended') return 'ended'
  if (value === 'archived') return 'archived'
  return 'draft'
}

export function normalizeFinancialSessionPanel(value) {
  return FINANCIAL_SESSION_PANELS.includes(value) ? value : 'overview'
}

export function normalizeClientAccessMode(value) {
  if (value === 'full_edit') return 'full_edit'
  if (value === 'guided_edit') return 'guided_edit'
  return 'view_only'
}

export function normalizeAllowedPanels(value) {
  const source = Array.isArray(value) ? value : []
  const filtered = source
    .map((entry) => String(entry || '').trim())
    .filter((entry) => FINANCIAL_SESSION_PANELS.includes(entry))

  return filtered.length > 0 ? Array.from(new Set(filtered)) : [...FINANCIAL_SESSION_PANELS]
}

export function normalizeFinancialSessionMediaTransport(value) {
  return FINANCIAL_SESSION_MEDIA_TRANSPORTS.includes(value) ? value : 'not_configured'
}

export function normalizeClientCameraMode(value) {
  return FINANCIAL_SESSION_CLIENT_CAMERA_MODES.includes(value) ? value : 'off'
}

export function buildDefaultFinancialSessionState() {
  return {
    sessionStatus: 'draft',
    activePanel: 'overview',
    clientAccessMode: 'view_only',
    clientEditLocked: true,
    allowedPanels: [...FINANCIAL_SESSION_PANELS],
    collaborationMode: 'shared_navigation',
    focusedEntityPanel: 'overview',
    focusedEntityType: '',
    focusedEntityId: '',
    focusedEntityLabel: '',
    editingOwnerUid: '',
    editingOwnerName: '',
    mediaTransport: 'not_configured',
    plannerMicEnabled: false,
    plannerCameraEnabled: false,
    plannerScreenShareEnabled: false,
    allowClientMicrophone: false,
    clientCameraMode: 'off',
    notes: '',
  }
}

export function mapFinancialSessionState(data = {}) {
  const base = buildDefaultFinancialSessionState()
  return {
    ...base,
    sessionStatus: normalizeFinancialSessionStatus(data?.sessionStatus),
    activePanel: normalizeFinancialSessionPanel(data?.activePanel),
    clientAccessMode: normalizeClientAccessMode(data?.clientAccessMode),
    clientEditLocked: data?.clientEditLocked !== false,
    allowedPanels: normalizeAllowedPanels(data?.allowedPanels),
    collaborationMode: String(data?.collaborationMode || base.collaborationMode),
    focusedEntityPanel: normalizeFinancialSessionPanel(data?.focusedEntityPanel),
    focusedEntityType: String(data?.focusedEntityType || ''),
    focusedEntityId: String(data?.focusedEntityId || ''),
    focusedEntityLabel: String(data?.focusedEntityLabel || ''),
    editingOwnerUid: String(data?.editingOwnerUid || ''),
    editingOwnerName: String(data?.editingOwnerName || ''),
    mediaTransport: normalizeFinancialSessionMediaTransport(data?.mediaTransport),
    plannerMicEnabled: data?.plannerMicEnabled === true,
    plannerCameraEnabled: data?.plannerCameraEnabled === true,
    plannerScreenShareEnabled: data?.plannerScreenShareEnabled === true,
    allowClientMicrophone: data?.allowClientMicrophone === true,
    clientCameraMode: normalizeClientCameraMode(data?.clientCameraMode),
    notes: String(data?.notes || ''),
    lastUpdatedBy: String(data?.lastUpdatedBy || ''),
    lastUpdatedByName: String(data?.lastUpdatedByName || ''),
    updatedAt: data?.updatedAt?.toDate?.()?.toISOString?.() ?? data?.updatedAt ?? null,
  }
}
