import {
  collection,
  collectionGroup,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getDebtBalanceSnapshot } from './debtService'
import {
  buildCrossFinancialAudit,
  buildFinancialAudit,
  financialAuditToCsv,
  identifyAuditMemberCandidates,
} from '../utils/financialAudit'

function withSource(snapshot, collectionPath) {
  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
    _collection: collectionPath,
  }))
}

function parentIdForMember(snapshot) {
  const parts = snapshot.ref.path.split('/')
  const memberIndex = parts.lastIndexOf('members')
  return memberIndex > 0 ? { scope: parts[memberIndex - 2], id: parts[memberIndex - 1] } : null
}

async function safeCollection(path, sourceErrors) {
  try {
    const snapshot = await getDocs(collection(db, ...path))
    return withSource(snapshot, path.join('/'))
  } catch (error) {
    sourceErrors.push({ collection: path.join('/'), error: error?.message || String(error) })
    return []
  }
}

async function fetchAllMemberDocuments() {
  const snapshot = await getDocs(collectionGroup(db, 'members'))
  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
    _collection: item.ref.parent.path,
    _parent: parentIdForMember(item),
  }))
}

function uniqueById(records) {
  const seen = new Set()
  return records.filter((record) => {
    const key = `${record?._collection || ''}/${record?.id || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function withAuditBalanceSnapshots(debts = [], nowMs = Date.now()) {
  return debts.map((debt) => ({
    ...debt,
    _auditBalanceSnapshot: getDebtBalanceSnapshot(debt, nowMs),
  }))
}

function sumReportSummaries(reports = []) {
  return reports.reduce((total, report) => {
    Object.entries(report.summary).forEach(([key, value]) => {
      total[key] = Math.round(((total[key] || 0) + Number(value || 0) + Number.EPSILON) * 100) / 100
    })
    return total
  }, {})
}

function normalizeIdentityText(value) {
  return String(value || '').trim().toLowerCase()
}

function invitationMatches(invitation, target) {
  const targetUid = String(target?.uid || '').trim()
  const targetEmail = normalizeIdentityText(target?.email)
  return Boolean(
    (targetUid && [invitation?.acceptedBy, invitation?.userId, invitation?.uid].some((value) => String(value || '').trim() === targetUid))
    || (targetEmail && normalizeIdentityText(invitation?.email || invitation?.inviteeEmail) === targetEmail),
  )
}

function buildRegistrationDiagnostic(target, candidates, invitations, authDiagnostic, targetWorkspaceId = '') {
  const workspaceRecords = candidates.filter((candidate) => candidate.member?._parent?.scope === 'workspaces')
  const familyRecords = candidates.filter((candidate) => candidate.member?._parent?.scope === 'families')
  const matchingInvitations = invitations.filter((invitation) => invitationMatches(invitation, target))
  const targetWorkspaceRecords = targetWorkspaceId
    ? workspaceRecords.filter((candidate) => candidate.member?._parent?.id === targetWorkspaceId)
    : workspaceRecords
  const targetWorkspaceInvitations = targetWorkspaceId
    ? matchingInvitations.filter((invitation) => String(invitation.workspaceId || invitation.familyId || '') === targetWorkspaceId)
    : matchingInvitations
  const targetUid = String(target?.uid || '').trim()
  const authUid = String(authDiagnostic?.uid || '').trim()
  const mismatchedUid = Boolean(authDiagnostic?.uidMatches === false) || candidates.some((candidate) => (
    targetUid && candidate.id && candidate.id !== targetUid && candidate.score < 100
  )) || Boolean(authUid && candidates.some((candidate) => candidate.id && candidate.id !== authUid && candidate.score >= 50))
  const activeWorkspaceRecord = targetWorkspaceRecords.find((candidate) => (
    ['active', 'ativo', 'accepted'].includes(normalizeIdentityText(candidate.member?.status || 'active'))
  ))
  const duplicateIds = [...new Set(candidates.map((candidate) => candidate.id).filter(Boolean))]
  let probableCause = 'Nenhum impedimento cadastral evidente nos documentos consultados.'
  let proposedCorrection = 'Conferir o erro apresentado no dispositivo e os logs de regras antes de qualquer alteracao.'

  if (authDiagnostic?.exists === false) {
    probableCause = 'Nao foi encontrado usuario correspondente no Firebase Authentication.'
    proposedCorrection = 'Confirmar o e-mail correto e concluir o cadastro no Authentication antes de vincular um membro.'
  } else if (target?._profileExists === false) {
    probableCause = 'Existe identidade informada, mas nao foi localizado documento correspondente em users.'
    proposedCorrection = 'Criar ou recuperar o perfil users somente depois de confirmar UID e e-mail no Authentication.'
  } else if (targetWorkspaceId && targetWorkspaceRecords.length === 0) {
    probableCause = targetWorkspaceInvitations.some((invitation) => ['pending', 'awaiting_confirmation'].includes(invitation.status))
      ? `Arthur ainda nao pertence ao workspace familiar ${targetWorkspaceId}; existe convite em andamento.`
      : `Arthur possui conta e workspaces pessoais, mas nao pertence ao workspace familiar ${targetWorkspaceId} e nao possui convite pendente para ele.`
    proposedCorrection = targetWorkspaceInvitations.length
      ? 'Concluir o convite existente sem criar outro vinculo.'
      : 'Disponibilizar convite explicito para o workspace familiar, preservando todos os workspaces pessoais.'
  } else if (workspaceRecords.length === 0 && familyRecords.length > 0) {
    probableCause = 'O membro existe apenas no espelho legado families e nao foi sincronizado para workspaces.'
    proposedCorrection = 'Propor sincronizacao idempotente do membro legado para workspaces, preservando o ID original.'
  } else if (workspaceRecords.length === 0) {
    probableCause = 'Nao existe documento de membro no workspace, ainda que possam existir convite ou referencias financeiras.'
    proposedCorrection = 'Revisar o aceite do convite e criar o vinculo apenas apos confirmar Authentication, users e familia correta.'
  } else if (!activeWorkspaceRecord) {
    probableCause = `O documento de membro existe, mas nao esta ativo (${workspaceRecords.map((item) => item.member?.status || 'sem status').join(', ')}).`
    proposedCorrection = 'Revisar o fluxo de aprovacao do convite; nao ativar automaticamente durante a auditoria.'
  } else if (mismatchedUid) {
    probableCause = 'Ha divergencia entre o UID do perfil e um ou mais IDs usados nos documentos de membro.'
    proposedCorrection = 'Confirmar a identidade no Authentication e preparar uma vinculacao explicita dos IDs antigos, sem sobrescrever historico.'
  } else if (matchingInvitations.some((invitation) => ['pending', 'awaiting_confirmation'].includes(invitation.status))) {
    probableCause = 'Ha convite ainda pendente ou aguardando confirmacao.'
    proposedCorrection = 'Concluir o fluxo de aceite/aprovacao existente em vez de criar um segundo membro.'
  }

  return {
    displayName: target?.displayName || target?.name || '',
    email: target?.email || '',
    uid: target?.uid || '',
    authentication: authDiagnostic || { exists: null, error: 'Authentication nao verificado pelo backend.' },
    targetWorkspaceId,
    targetWorkspaceMemberExists: targetWorkspaceRecords.length > 0,
    targetWorkspacePendingInvitations: targetWorkspaceInvitations.filter((invitation) => ['pending', 'awaiting_confirmation'].includes(invitation.status)),
    userDocumentExists: target?._profileExists !== false,
    workspaceMemberships: workspaceRecords.map((candidate) => ({
      workspaceId: candidate.member._parent?.id || '',
      memberId: candidate.id,
      uid: candidate.member?.uid || '',
      userId: candidate.member?.userId || '',
      status: candidate.member?.status || '',
      origin: candidate.member?._collection || '',
    })),
    legacyFamilyMemberships: familyRecords.map((candidate) => ({
      familyId: candidate.member._parent?.id || '',
      memberId: candidate.id,
      uid: candidate.member?.uid || '',
      userId: candidate.member?.userId || '',
      status: candidate.member?.status || '',
      origin: candidate.member?._collection || '',
    })),
    invitations: matchingInvitations,
    oldIds: duplicateIds.filter((id) => id !== targetUid),
    possibleDuplicateRecords: Math.max(0, duplicateIds.length - 1),
    uidMismatch: mismatchedUid,
    active: Boolean(activeWorkspaceRecord),
    probableCause,
    affectedDocument: targetWorkspaceId
      ? `workspaces/${targetWorkspaceId}/members/${targetUid || '{uid}'}`
      : workspaceRecords[0]?.member?._collection || familyRecords[0]?.member?._collection || matchingInvitations[0]?._collection || 'nao identificado',
    involvedFunction: 'fetchWorkspaceMembers / approveWorkspaceInvite / fetchUserWorkspaces',
    proposedCorrection,
    wrongUserLinkRisk: mismatchedUid || duplicateIds.length > 1
      ? 'Alto: existem IDs divergentes ou duplicados; nao vincular automaticamente.'
      : 'Moderado: confirmar UID e e-mail no Authentication antes de qualquer vinculacao.',
  }
}

export async function fetchAuthenticationDiagnostics(targets = [], idToken = '') {
  if (!idToken) return { identities: {}, legacyDiscovery: { records: [], errors: ['Token administrativo ausente.'] } }
  try {
    const response = await fetch('/api/adminIdentityAudit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ targets }),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload?.error || 'Falha ao consultar Authentication.')
    return {
      identities: payload.identities || {},
      legacyDiscovery: payload.legacyDiscovery || { records: [], errors: [] },
    }
  } catch (error) {
    return {
      identities: Object.fromEntries(targets.map((target) => [target.key, {
        exists: null,
        error: error?.message || 'Authentication nao verificado.',
      }])),
      legacyDiscovery: { records: [], errors: [error?.message || 'Varredura legada nao executada.'] },
    }
  }
}

export async function runCrossMemberFinancialAudit(targetEntries = [], authDiagnostics = {}, legacyDiscovery = {}) {
  if (targetEntries.length !== 3 || targetEntries.some((entry) => !entry?.target)) {
    throw new Error('Identifique Eric, Levi e Arthur antes de executar a auditoria cruzada.')
  }

  const auditNow = new Date()
  const allMembers = await fetchAllMemberDocuments()
  const candidatesByKey = new Map(targetEntries.map((entry) => [
    entry.key,
    identifyAuditMemberCandidates(allMembers, entry.target),
  ]))
  const workspaceIds = new Set()

  for (const entry of targetEntries) {
    const candidates = candidatesByKey.get(entry.key) || []
    candidates.forEach((candidate) => {
      if (candidate.member?._parent?.id) workspaceIds.add(candidate.member._parent.id)
    })
    if (entry.target?.uid) {
      const membershipErrors = []
      const memberships = await safeCollection(['users', entry.target.uid, 'workspaceMemberships'], membershipErrors)
      memberships.forEach((membership) => workspaceIds.add(membership.workspaceId || membership.id))
    }
  }
  ;(legacyDiscovery?.records || []).forEach((record) => {
    if (record?._workspaceId) workspaceIds.add(String(record._workspaceId))
  })

  const sourceErrors = []
  ;(legacyDiscovery?.errors || []).forEach((error) => sourceErrors.push({ collection: 'legacy-discovery', error }))
  const inviteTokens = await safeCollection(['workspaceInviteTokens'], sourceErrors)
  const sourcesByWorkspace = new Map()
  for (const workspaceId of workspaceIds) {
    const workspaceErrors = []
    const [workspaceMembers, familyMembers, debts, transactions, legacyTransactions, auditLogs, adjustments, workspaceInvites, familyInvites] = await Promise.all([
      safeCollection(['workspaces', workspaceId, 'members'], workspaceErrors),
      safeCollection(['families', workspaceId, 'members'], workspaceErrors),
      safeCollection(['workspaces', workspaceId, 'debts'], workspaceErrors),
      safeCollection(['workspaces', workspaceId, 'transactions'], workspaceErrors),
      safeCollection(['families', workspaceId, 'transactions'], workspaceErrors),
      safeCollection(['workspaces', workspaceId, 'financialAuditLogs'], workspaceErrors),
      safeCollection(['workspaces', workspaceId, 'auditAdjustments'], workspaceErrors),
      safeCollection(['workspaces', workspaceId, 'invitations'], workspaceErrors),
      safeCollection(['families', workspaceId, 'invitations'], workspaceErrors),
    ])
    const discovered = (legacyDiscovery?.records || []).filter((record) => String(record?._workspaceId || '') === String(workspaceId))
    sourcesByWorkspace.set(workspaceId, {
      members: uniqueById([...workspaceMembers, ...familyMembers]),
      debts: withAuditBalanceSnapshots(
        uniqueById([...debts, ...discovered.filter((record) => record._legacyKind === 'debt')]),
        auditNow.getTime(),
      ),
      transactions: uniqueById([...transactions, ...legacyTransactions, ...discovered.filter((record) => record._legacyKind === 'transaction')]),
      auditLogs: uniqueById([...auditLogs, ...discovered.filter((record) => record._legacyKind === 'audit_log')]),
      adjustments,
      invitations: uniqueById([...workspaceInvites, ...familyInvites]),
      sourceErrors: workspaceErrors,
    })
  }

  const unscopedLegacy = (legacyDiscovery?.records || []).filter((record) => !record?._workspaceId)
  if (unscopedLegacy.length > 0) {
    sourcesByWorkspace.set('legacy-unscoped', {
      members: allMembers,
      debts: withAuditBalanceSnapshots(
        unscopedLegacy.filter((record) => record._legacyKind === 'debt'),
        auditNow.getTime(),
      ),
      transactions: unscopedLegacy.filter((record) => record._legacyKind === 'transaction'),
      auditLogs: unscopedLegacy.filter((record) => record._legacyKind === 'audit_log'),
      adjustments: [],
      invitations: [],
      sourceErrors: [{ collection: 'legacy-discovery', error: 'Registros legados encontrados sem workspaceId/familyId confiavel.' }],
    })
  }

  const individual = {}
  for (const entry of targetEntries) {
    const reports = []
    const candidates = candidatesByKey.get(entry.key) || []
    for (const [workspaceId, sources] of sourcesByWorkspace.entries()) {
      reports.push(buildFinancialAudit({
        workspaceId,
        target: entry.target,
        members: uniqueById([...sources.members, ...candidates.map((candidate) => candidate.member)]),
        debts: sources.debts,
        transactions: sources.transactions,
        auditLogs: sources.auditLogs,
        adjustments: sources.adjustments,
        sourceErrors: sources.sourceErrors,
        now: auditNow,
      }))
    }
    if (reports.length === 0) {
      reports.push(buildFinancialAudit({
        workspaceId: '',
        target: entry.target,
        members: candidates.map((candidate) => candidate.member),
        sourceErrors: [{ collection: 'members', error: 'Nenhum workspace ou familia foi associado aos tres membros.' }],
      }))
    }
    individual[entry.key] = {
      auditOnly: true,
      dryRun: true,
      target: entry.target,
      reports,
      ambiguousIdentity: reports.some((report) => report.ambiguousIdentity),
      summary: sumReportSummaries(reports),
    }
  }

  const allInvitations = uniqueById([
    ...inviteTokens,
    ...[...sourcesByWorkspace.values()].flatMap((source) => source.invitations),
  ])
  const registrationDiagnostics = Object.fromEntries(targetEntries.map((entry) => [
    entry.key,
    buildRegistrationDiagnostic(
      entry.target,
      candidatesByKey.get(entry.key) || [],
      allInvitations,
      authDiagnostics[entry.key],
      entry.targetWorkspaceId || '',
    ),
  ]))
  const consolidated = buildCrossFinancialAudit(targetEntries.map((entry) => ({
    key: entry.key,
    label: entry.label,
    audit: individual[entry.key],
  })))

  return {
    auditOnly: true,
    dryRun: true,
    generatedAt: new Date().toISOString(),
    individual,
    registrationDiagnostics,
    consolidated,
    sourceErrors,
    legacyDiscovery: {
      recordsFound: legacyDiscovery?.records?.length || 0,
      truncated: Boolean(legacyDiscovery?.truncated),
      errors: legacyDiscovery?.errors || [],
    },
  }
}

export async function runMemberFinancialAudit(target = {}) {
  if (!target?.uid && !target?.email && !target?.displayName) {
    throw new Error('Selecione um membro identificado por UID, e-mail ou nome completo.')
  }

  const auditNow = new Date()
  const allMembers = await fetchAllMemberDocuments()
  const candidates = identifyAuditMemberCandidates(allMembers, target)
  const relevantMembers = candidates.map((candidate) => candidate.member)
  const workspaceIds = new Set()
  const familyIds = new Set()

  relevantMembers.forEach((member) => {
    if (member?._parent?.scope === 'workspaces') workspaceIds.add(member._parent.id)
    if (member?._parent?.scope === 'families') familyIds.add(member._parent.id)
  })

  familyIds.forEach((familyId) => workspaceIds.add(familyId))
  const reports = []

  for (const workspaceId of workspaceIds) {
    const sourceErrors = []
    const [workspaceMembers, familyMembers, debts, transactions, legacyTransactions, auditLogs, adjustments] = await Promise.all([
      safeCollection(['workspaces', workspaceId, 'members'], sourceErrors),
      safeCollection(['families', workspaceId, 'members'], sourceErrors),
      safeCollection(['workspaces', workspaceId, 'debts'], sourceErrors),
      safeCollection(['workspaces', workspaceId, 'transactions'], sourceErrors),
      safeCollection(['families', workspaceId, 'transactions'], sourceErrors),
      safeCollection(['workspaces', workspaceId, 'financialAuditLogs'], sourceErrors),
      safeCollection(['workspaces', workspaceId, 'auditAdjustments'], sourceErrors),
    ])

    reports.push(buildFinancialAudit({
      workspaceId,
      target,
      members: uniqueById([...workspaceMembers, ...familyMembers, ...relevantMembers]),
      debts: withAuditBalanceSnapshots(debts, auditNow.getTime()),
      transactions: uniqueById([...transactions, ...legacyTransactions]),
      auditLogs,
      adjustments,
      sourceErrors,
      now: auditNow,
    }))
  }

  if (reports.length === 0) {
    reports.push(buildFinancialAudit({
      workspaceId: '',
      target,
      members: relevantMembers,
      sourceErrors: [{ collection: 'members', error: 'Nenhum workspace ou familia foi associado com seguranca a este membro.' }],
    }))
  }

  return {
    auditOnly: true,
    dryRun: true,
    target,
    reports,
    ambiguousIdentity: reports.some((report) => report.ambiguousIdentity),
    summary: reports.reduce((total, report) => {
      Object.entries(report.summary).forEach(([key, value]) => {
        total[key] = Math.round(((total[key] || 0) + Number(value || 0) + Number.EPSILON) * 100) / 100
      })
      return total
    }, {}),
  }
}

export async function restoreFinancialAudit({ report, reason, actorUid, confirmed }) {
  if (!confirmed) throw new Error('A confirmacao explicita e obrigatoria.')
  if (!actorUid) throw new Error('Administrador responsavel nao identificado.')
  if (!report?.workspaceId || !report?.auditId) throw new Error('Relatorio de auditoria invalido.')
  if (report?.ambiguousIdentity) throw new Error('A identidade do membro esta ambigua. A restauracao foi bloqueada.')
  if (!String(reason || '').trim()) throw new Error('Informe o motivo da restauracao.')

  const adjustmentRef = doc(db, 'workspaces', report.workspaceId, 'auditAdjustments', report.auditId)
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(adjustmentRef)
    if (existing.exists()) throw new Error('Esta auditoria ja gerou um ajuste e nao pode ser executada novamente.')

    const payload = {
      type: 'audit_adjustment',
      auditId: report.auditId,
      memberId: report.target?.uid || null,
      familyId: report.workspaceId,
      workspaceId: report.workspaceId,
      previousCalculatedBalance: Number(report.summary?.currentBalance || 0),
      reconstructedBalance: Number(report.summary?.reconstructedBalance || 0),
      adjustmentAmount: Number(report.summary?.difference || 0),
      reason: String(reason).trim(),
      description: `Ajuste administrativo decorrente de auditoria do historico financeiro do membro ${report.target?.displayName || report.target?.email || report.target?.uid}.`,
      createdBy: actorUid,
      createdAt: serverTimestamp(),
      source: 'financial_audit',
      status: 'active',
      reportSnapshot: {
        generatedAt: report.generatedAt,
        recordsAnalyzed: report.summary?.recordsAnalyzed || 0,
        inconsistencies: report.summary?.inconsistencies || 0,
        possibleDuplicates: report.summary?.possibleDuplicates || 0,
        orphanRecords: report.summary?.orphanRecords || 0,
      },
    }
    transaction.set(adjustmentRef, payload)

    const logRef = doc(collection(db, 'workspaces', report.workspaceId, 'financialAuditLogs'))
    transaction.set(logRef, {
      action: 'audit_adjustment_created',
      affectedDocumentId: adjustmentRef.id,
      collection: 'auditAdjustments',
      previousValue: null,
      newValue: payload,
      actorUid,
      memberId: report.target?.uid || null,
      familyId: report.workspaceId,
      workspaceId: report.workspaceId,
      reason: String(reason).trim(),
      source: 'financial_audit_restore',
      originalDocumentRef: adjustmentRef.path,
      createdAt: serverTimestamp(),
    })
  })

  return adjustmentRef.id
}

function download(content, filename, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function exportFinancialAuditJson(audit) {
  download(JSON.stringify(audit, null, 2), `${audit?.target?.displayName || 'membro'}-auditoria-financeira.json`, 'application/json')
}

export function exportFinancialAuditCsv(audit) {
  const csv = (audit?.reports || []).map((report) => financialAuditToCsv(report)).join('\n')
  download(`\uFEFF${csv}`, `${audit?.target?.displayName || 'membro'}-auditoria-financeira.csv`, 'text/csv;charset=utf-8')
}

export function exportCrossFinancialAuditJson(crossAudit) {
  download(JSON.stringify(crossAudit?.consolidated || crossAudit, null, 2), 'auditoria-cruzada-eric-levi-arthur.json', 'application/json')
}

export function exportCrossFinancialAuditCsv(crossAudit) {
  const csv = financialAuditToCsv(crossAudit?.consolidated || crossAudit)
  download(`\uFEFF${csv}`, 'auditoria-cruzada-eric-levi-arthur.csv', 'text/csv;charset=utf-8')
}
