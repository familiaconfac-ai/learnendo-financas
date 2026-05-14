import { normalizeFinancialSessionPanel } from './financialSessionStage'

function normalizedRoleValue(value) {
  return String(value || '').trim().toLowerCase()
}

export function resolveFinancialSessionRole(session, currentUserId, workspaceRole = '') {
  if (!currentUserId) return 'viewer'

  const plannerIds = Array.isArray(session?.plannerMemberIds) ? session.plannerMemberIds : []
  if (plannerIds.includes(currentUserId)) return 'planner'

  const clientIds = Array.isArray(session?.clientMemberIds) ? session.clientMemberIds : []
  if (clientIds.includes(currentUserId)) return 'client'

  const role = normalizedRoleValue(workspaceRole)
  if (role === 'gestor' || role === 'co-gestor' || role === 'planejador-master' || role === 'planejador-plus') {
    return 'planner'
  }

  return 'viewer'
}

export function canManageFinancialSession(sessionRole) {
  return sessionRole === 'planner'
}

export function canAccessFinancialPanel(state, sessionRole, panel) {
  const normalizedPanel = normalizeFinancialSessionPanel(panel)
  const allowedPanels = Array.isArray(state?.allowedPanels) ? state.allowedPanels : []
  if (sessionRole === 'planner') return true
  return allowedPanels.includes(normalizedPanel)
}

export function canClientEditFinancialSession(state, sessionRole) {
  if (sessionRole === 'planner') return true
  if (sessionRole !== 'client') return false
  if (state?.clientEditLocked) return false
  return state?.clientAccessMode === 'guided_edit' || state?.clientAccessMode === 'full_edit'
}

export function canUpdateFinancialSessionState(state, sessionRole, panel) {
  if (sessionRole === 'planner') return true
  return canClientEditFinancialSession(state, sessionRole) && canAccessFinancialPanel(state, sessionRole, panel)
}

export function canEditFinancialSharedDoc(state, sessionRole) {
  if (sessionRole === 'planner') return true
  return canClientEditFinancialSession(state, sessionRole)
}

export function canCreateFinancialActionRequest(state, sessionRole, panel = 'transactions') {
  if (sessionRole === 'planner') return true
  if (sessionRole !== 'client') return false
  return canClientEditFinancialSession(state, sessionRole) && canAccessFinancialPanel(state, sessionRole, panel)
}

export function canApplyFinancialActionRequest(sessionRole) {
  return sessionRole === 'planner'
}

export function participantAccessLabel(sessionRole, state) {
  if (sessionRole === 'planner') return 'Controle total da sessao'
  if (sessionRole === 'client') {
    if (state?.clientEditLocked || state?.clientAccessMode === 'view_only') return 'Somente visualizacao'
    if (state?.clientAccessMode === 'guided_edit') return 'Edicao guiada'
    return 'Edicao liberada'
  }
  return 'Acompanhamento'
}
