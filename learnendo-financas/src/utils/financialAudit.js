const ID_FIELDS = ['uid', 'memberId', 'userId', 'familyMemberId', 'relatedMemberId']
const AMOUNT_FIELDS = ['originalAmount', 'totalAmount', 'amount', 'value', 'valorTotal']
const PAID_FIELDS = ['initialPaidAmount', 'compensatedAmount', 'paidAmount', 'valorCompensado']

function text(value) {
  return String(value ?? '').trim()
}

function normalizedText(value) {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function numberFrom(record, fields, fallback = 0) {
  for (const field of fields) {
    const value = Number(record?.[field])
    if (Number.isFinite(value)) return Math.max(0, value)
  }
  return fallback
}

function round(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

export function auditDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000).toISOString()
  const parsed = typeof value === 'number' ? value : Date.parse(String(value))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

export function auditMemberId(member) {
  for (const field of ID_FIELDS) {
    if (text(member?.[field])) return text(member[field])
  }
  return text(member?.id)
}

function memberNames(member) {
  return [member?.displayName, member?.name, member?.fullName, member?.email]
    .map(normalizedText)
    .filter(Boolean)
}

export function identifyAuditMemberCandidates(members = [], target = {}) {
  const targetIds = new Set([target?.uid, target?.memberId, target?.userId, target?.id].map(text).filter(Boolean))
  const targetEmail = normalizedText(target?.email)
  const targetNames = new Set(memberNames(target))

  return members.map((member) => {
    const id = auditMemberId(member)
    let score = targetIds.has(id) ? 100 : 0
    if (targetEmail && normalizedText(member?.email) === targetEmail) score += 50
    if (memberNames(member).some((name) => targetNames.has(name))) score += 10
    return { member, id, score }
  }).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score)
}

function allIdentityIds(target, candidates) {
  return new Set([
    target?.uid,
    target?.memberId,
    target?.userId,
    target?.id,
    ...candidates.map((candidate) => candidate.id),
  ].map(text).filter(Boolean))
}

function recordMatchesIdentity(record, ids, names) {
  const idFields = [
    ...ID_FIELDS,
    'createdBy', 'createdByUid', 'ownerUid', 'creditorMemberId', 'debtorMemberId',
    'creditorId', 'debtorId', 'beneficiaryId', 'counterpartyMemberId', 'relatedUserId',
    'responsibleMemberId', 'paidBy', 'receivedBy', 'deletedBy', 'updatedBy',
  ]
  if (idFields.some((field) => ids.has(text(record?.[field])))) return true
  if ([
    record?.memberName, record?.relatedMemberName, record?.creditorMemberName,
    record?.debtorMemberName, record?.counterpartyMemberName, record?.contactName,
    record?.createdByName, record?.email, record?.userEmail, record?.memberEmail,
    record?.relatedMemberEmail, record?.creditorEmail, record?.debtorEmail, record?.beneficiaryEmail,
  ].some((value) => names.has(normalizedText(value)))) return true

  const nestedAuditValues = normalizedText(JSON.stringify({
    previousValue: record?.previousValue,
    newValue: record?.newValue,
    before: record?.before,
    after: record?.after,
  }))
  return Boolean(nestedAuditValues) && (
    [...ids].some((id) => nestedAuditValues.includes(normalizedText(id)))
    || [...names].some((name) => name && nestedAuditValues.includes(name))
  )
}

function isDeleted(record) {
  return ['deleted', 'excluido', 'excluído'].includes(normalizedText(record?.status)) || Boolean(record?.deletedAt)
}

function isCancelled(record) {
  return ['cancelled', 'canceled', 'cancelado'].includes(normalizedText(record?.status)) || Boolean(record?.cancelledAt)
}

function settlementStatus(settlement) {
  return normalizedText(settlement?.status || 'pending')
}

function debtDirection(debt, ids) {
  const creditor = text(debt?.creditorMemberId || debt?.creditorId)
  const debtor = text(debt?.debtorMemberId || debt?.debtorId)
  if (ids.has(creditor)) return 'creditor'
  if (ids.has(debtor)) return 'debtor'
  return 'indirect'
}

function missingDebtFields(debt) {
  const missing = []
  if (!text(debt?.workspaceId || debt?.familyId || debt?.family_id)) missing.push('workspaceId/familyId')
  if (!text(debt?.creditorMemberId) || !text(debt?.debtorMemberId)) missing.push('creditorMemberId/debtorMemberId')
  if (!auditDate(debt?.createdAt || debt?.date)) missing.push('createdAt')
  if (numberFrom(debt, AMOUNT_FIELDS) <= 0) missing.push('amount')
  return missing
}

function duplicateKey(record) {
  return [
    record.operationType,
    record.direction,
    normalizedText(record.title),
    round(record.originalAmount),
    String(record.date || '').slice(0, 10),
  ].join('|')
}

export function buildFinancialAudit({
  workspaceId,
  target,
  members = [],
  debts = [],
  transactions = [],
  auditLogs = [],
  adjustments = [],
  sourceErrors = [],
  now = new Date(),
} = {}) {
  const candidates = identifyAuditMemberCandidates(members, target)
  const strongest = candidates[0]?.score || 0
  const strongestIds = new Set(candidates.filter((item) => item.score === strongest).map((item) => item.id))
  const ambiguous = strongest > 0 && strongestIds.size > 1 && strongest < 100
  const ids = allIdentityIds(target, candidates)
  const names = new Set([...memberNames(target), ...candidates.flatMap((item) => memberNames(item.member))])

  const matchedDebts = debts.filter((debt) => recordMatchesIdentity(debt, ids, names))
  const matchedDebtIds = new Set(matchedDebts.map((debt) => text(debt.id)).filter(Boolean))
  const matchedTransactions = transactions.filter((tx) => (
    matchedDebtIds.has(text(tx?.debtId)) || recordMatchesIdentity(tx, ids, names)
  ))
  const matchedLogs = auditLogs.filter((log) => (
    matchedDebtIds.has(text(log?.recordId || log?.affectedDocumentId || log?.debtId))
    || recordMatchesIdentity(log, ids, names)
  ))
  const matchedAdjustments = adjustments.filter((adjustment) => recordMatchesIdentity(adjustment, ids, names))

  const movements = []
  let originallyOwedBy = 0
  let originallyOwedTo = 0
  let restitutedBy = 0
  let restitutedTo = 0
  let compensated = 0
  let cancelled = 0
  let logicallyDeleted = 0
  let reconstructed = 0
  let current = 0
  let reconstructedCreditOpen = 0
  let reconstructedDebitOpen = 0
  let currentCreditOpen = 0
  let currentDebitOpen = 0
  let compensatedBy = 0
  let compensatedTo = 0
  let positiveInterest = 0
  let negativeInterest = 0
  let pendingCredits = 0
  let pendingDebits = 0

  matchedDebts.forEach((debt) => {
    const direction = debtDirection(debt, ids)
    const originalAmount = round(numberFrom(debt, AMOUNT_FIELDS))
    const initialPaid = round(numberFrom(debt, PAID_FIELDS))
    const deleted = isDeleted(debt)
    const cancelledDebt = isCancelled(debt)
    const settlements = Array.isArray(debt?.settlements) ? debt.settlements : []
    const linkedTransactionIds = new Set()
    const confirmedSettlementTotal = round(settlements.reduce((sum, settlement) => {
      if (settlementStatus(settlement) !== 'confirmed') return sum
      if (text(settlement?.linkedTransactionId)) linkedTransactionIds.add(text(settlement.linkedTransactionId))
      return sum + numberFrom(settlement, ['amount', 'value', 'valorTotal'])
    }, 0))
    const linkedTx = matchedTransactions.filter((tx) => text(tx?.debtId) === text(debt?.id))
    const unembeddedTransactionTotal = round(linkedTx.reduce((sum, tx) => {
      if (isDeleted(tx) || isCancelled(tx) || normalizedText(tx?.status) !== 'confirmed') return sum
      if (linkedTransactionIds.has(text(tx?.id))) return sum
      return sum + numberFrom(tx, ['amount', 'value', 'totalAmount', 'valorTotal'])
    }, 0))
    const paid = round(Math.min(originalAmount, initialPaid + confirmedSettlementTotal + unembeddedTransactionTotal))
    const remaining = round(Math.max(0, originalAmount - paid))
    const storedRemaining = round(numberFrom(debt, ['remainingAmount', 'saldoRestante'], Math.max(0, originalAmount - numberFrom(debt, ['paidAmount']))))
    const missing = missingDebtFields(debt)
    const participatesInCurrentBalance = !deleted && !cancelledDebt && normalizedText(debt?.status) !== 'pending_confirmation'
    const balanceSnapshot = debt?._auditBalanceSnapshot || null
    const principalRemainingAmount = round(
      Number.isFinite(Number(balanceSnapshot?.principalRemainingAmount))
        ? Number(balanceSnapshot.principalRemainingAmount)
        : remaining,
    )
    const accruedInterestAmount = participatesInCurrentBalance
      ? round(Number(balanceSnapshot?.accruedInterestAmount || 0))
      : 0
    const systemRemainingAmount = participatesInCurrentBalance
      ? round(Number.isFinite(Number(balanceSnapshot?.remainingAmount))
        ? Number(balanceSnapshot.remainingAmount)
        : principalRemainingAmount + accruedInterestAmount)
      : remaining
    const pendingConfirmation = normalizedText(debt?.status) === 'pending_confirmation'

    if (direction === 'debtor') {
      originallyOwedBy += originalAmount
      restitutedBy += confirmedSettlementTotal + unembeddedTransactionTotal
      if (participatesInCurrentBalance) reconstructed -= principalRemainingAmount
      if (participatesInCurrentBalance) current -= systemRemainingAmount
      if (participatesInCurrentBalance) reconstructedDebitOpen += principalRemainingAmount
      if (participatesInCurrentBalance) currentDebitOpen += systemRemainingAmount
      if (participatesInCurrentBalance) negativeInterest += accruedInterestAmount
      if (pendingConfirmation) pendingDebits += originalAmount
      compensatedBy += initialPaid
    } else if (direction === 'creditor') {
      originallyOwedTo += originalAmount
      restitutedTo += confirmedSettlementTotal + unembeddedTransactionTotal
      if (participatesInCurrentBalance) reconstructed += principalRemainingAmount
      if (participatesInCurrentBalance) current += systemRemainingAmount
      if (participatesInCurrentBalance) reconstructedCreditOpen += principalRemainingAmount
      if (participatesInCurrentBalance) currentCreditOpen += systemRemainingAmount
      if (participatesInCurrentBalance) positiveInterest += accruedInterestAmount
      if (pendingConfirmation) pendingCredits += originalAmount
      compensatedTo += initialPaid
    }
    compensated += initialPaid
    if (deleted) logicallyDeleted += originalAmount
    if (cancelledDebt) cancelled += originalAmount

    movements.push({
      recordKind: 'debt',
      date: auditDate(debt?.createdAt || debt?.date),
      documentId: text(debt?.id),
      collection: debt?._collection || `workspaces/${workspaceId}/debts`,
      operationType: debt?.type || 'debt',
      title: debt?.name || debt?.title || debt?.description || 'Saldo sem titulo',
      originalAmount,
      principalRemainingAmount,
      accruedInterestAmount,
      compensatedAmount: initialPaid,
      restitutedAmount: round(confirmedSettlementTotal + unembeddedTransactionTotal),
      remainingAmount: systemRemainingAmount,
      direction,
      createdBy: debt?.createdBy || debt?.createdByUid || null,
      debtor: debt?.debtorMemberId || debt?.debtorMemberName || null,
      creditor: debt?.creditorMemberId || debt?.creditorMemberName || null,
      targetRole: direction,
      status: debt?.status || 'open',
      createdAt: auditDate(debt?.createdAt),
      updatedAt: auditDate(debt?.updatedAt),
      deletedAt: auditDate(debt?.deletedAt),
      changedBy: debt?.deletedBy || debt?.updatedBy || null,
      missingFields: missing,
      orphan: missing.includes('workspaceId/familyId') || missing.includes('creditorMemberId/debtorMemberId'),
      possibleDuplicate: false,
      includedInCalculation: participatesInCurrentBalance && ['creditor', 'debtor'].includes(direction),
      calculationJustification: participatesInCurrentBalance
        ? 'Documento principal usado na reconstrucao do saldo.'
        : `Documento principal fora do saldo por status ${debt?.status || 'desconhecido'}.`,
      technicalNotes: [
        unembeddedTransactionTotal > 0 ? 'Foram reaplicados lancamentos vinculados que nao estavam embutidos em settlements.' : '',
        storedRemaining !== remaining ? `Saldo armazenado (${storedRemaining}) difere do reconstruido (${remaining}).` : '',
        participatesInCurrentBalance && !balanceSnapshot ? 'Snapshot de juros indisponivel; saldo calculado somente pelo principal.' : '',
      ].filter(Boolean),
    })

    settlements.forEach((settlement) => {
      movements.push({
        recordKind: 'settlement',
        date: auditDate(settlement?.confirmedAt || settlement?.cancelledAt || settlement?.deletedAt || settlement?.createdAt),
        documentId: `${text(debt?.id)}:${text(settlement?.id)}`,
        collection: `${debt?._collection || `workspaces/${workspaceId}/debts`}/settlements`,
        operationType: 'settlement',
        title: settlement?.note || 'Restituicao',
        originalAmount: round(numberFrom(settlement, ['amount', 'value'])),
        compensatedAmount: settlementStatus(settlement) === 'confirmed' ? round(numberFrom(settlement, ['amount', 'value'])) : 0,
        restitutedAmount: settlementStatus(settlement) === 'confirmed' ? round(numberFrom(settlement, ['amount', 'value'])) : 0,
        remainingAmount: null,
        direction,
        createdBy: settlement?.createdByUid || null,
        debtor: debt?.debtorMemberId || debt?.debtorMemberName || null,
        creditor: debt?.creditorMemberId || debt?.creditorMemberName || null,
        targetRole: direction,
        status: settlement?.status || 'pending',
        createdAt: auditDate(settlement?.createdAt),
        updatedAt: auditDate(settlement?.confirmedAt || settlement?.cancelledAt),
        deletedAt: auditDate(settlement?.deletedAt),
        changedBy: settlement?.confirmedByUid || settlement?.cancelledByUid || settlement?.deletedByUid || null,
        missingFields: text(settlement?.id) ? [] : ['settlement.id'],
        orphan: !text(debt?.id),
        possibleDuplicate: false,
        includedInCalculation: false,
        calculationJustification: settlementStatus(settlement) === 'confirmed'
          ? 'Valor incorporado no documento principal da divida; nao somado novamente.'
          : `Restituicao com status ${settlement?.status || 'pending'} fora do saldo.`,
        technicalNotes: settlement?.linkedTransactionId ? [`Lancamento vinculado: ${settlement.linkedTransactionId}`] : [],
      })
    })
  })

  matchedTransactions.forEach((tx) => movements.push({
    recordKind: 'transaction',
    date: auditDate(tx?.date || tx?.createdAt),
    documentId: text(tx?.id),
    collection: tx?._collection || `workspaces/${workspaceId}/transactions`,
    operationType: tx?.transactionNatureKey || tx?.transactionNatureId || tx?.type || 'transaction',
    title: tx?.description || tx?.title || 'Movimentacao',
    originalAmount: round(numberFrom(tx, ['amount', 'value', 'totalAmount'])),
    compensatedAmount: tx?.countsAsDebtSettlement ? round(numberFrom(tx, ['amount', 'value'])) : 0,
    restitutedAmount: tx?.countsAsDebtSettlement ? round(numberFrom(tx, ['amount', 'value'])) : 0,
    remainingAmount: null,
    direction: 'linked_transaction',
    createdBy: tx?.createdBy || tx?.userId || null,
    debtor: tx?.debtorMemberId || null,
    creditor: tx?.creditorMemberId || null,
    targetRole: recordMatchesIdentity(tx, ids, names) ? 'direct' : 'indirect',
    status: tx?.status || 'unknown',
    createdAt: auditDate(tx?.createdAt),
    updatedAt: auditDate(tx?.updatedAt),
    deletedAt: auditDate(tx?.deletedAt),
    changedBy: tx?.deletedBy || tx?.updatedBy || null,
    missingFields: text(tx?.workspaceId || tx?.familyId) ? [] : ['workspaceId/familyId'],
    orphan: !text(tx?.debtId) && !recordMatchesIdentity(tx, ids, names),
    possibleDuplicate: false,
    includedInCalculation: false,
    calculationJustification: tx?.debtId
      ? 'Lancamento reaplicado na divida vinculada; nao somado novamente na linha consolidada.'
      : 'Lancamento indireto mantido para revisao, sem direcao de divida suficiente.',
    technicalNotes: tx?.debtId ? [`Divida vinculada: ${tx.debtId}`] : [],
  }))

  matchedLogs.forEach((log) => movements.push({
    recordKind: 'audit_log',
    date: auditDate(log?.createdAt || log?.timestamp),
    documentId: text(log?.id),
    collection: log?._collection || `workspaces/${workspaceId}/financialAuditLogs`,
    operationType: log?.action || log?.operationType || 'audit_log',
    title: log?.reason || log?.description || 'Log de auditoria',
    originalAmount: 0, compensatedAmount: 0, restitutedAmount: 0, remainingAmount: null,
    direction: 'audit', createdBy: log?.actorUid || log?.createdBy || null,
    debtor: log?.debtorMemberId || null, creditor: log?.creditorMemberId || null,
    targetRole: 'indirect', status: log?.status || 'recorded',
    createdAt: auditDate(log?.createdAt), updatedAt: null, deletedAt: null,
    changedBy: log?.actorUid || null, missingFields: [], orphan: false, possibleDuplicate: false,
    includedInCalculation: false,
    calculationJustification: 'Log informativo; nao representa novo valor financeiro.',
    technicalNotes: [`Documento afetado: ${log?.affectedDocumentId || log?.recordId || 'nao informado'}`],
  }))

  matchedAdjustments.forEach((adjustment) => movements.push({
    recordKind: 'adjustment',
    date: auditDate(adjustment?.createdAt || adjustment?.updatedAt),
    documentId: text(adjustment?.id || adjustment?.auditId),
    collection: adjustment?._collection || `workspaces/${workspaceId}/auditAdjustments`,
    operationType: adjustment?.type || 'audit_adjustment',
    title: adjustment?.description || adjustment?.reason || 'Ajuste administrativo',
    originalAmount: round(Math.abs(Number(adjustment?.adjustmentAmount || 0))),
    compensatedAmount: 0,
    restitutedAmount: 0,
    remainingAmount: Number(adjustment?.reconstructedBalance ?? 0),
    direction: Number(adjustment?.adjustmentAmount || 0) >= 0 ? 'credit_adjustment' : 'debit_adjustment',
    createdBy: adjustment?.createdBy || null,
    debtor: adjustment?.debtorMemberId || null,
    creditor: adjustment?.creditorMemberId || null,
    targetRole: 'direct',
    status: adjustment?.status || 'active',
    createdAt: auditDate(adjustment?.createdAt),
    updatedAt: auditDate(adjustment?.updatedAt),
    deletedAt: auditDate(adjustment?.deletedAt),
    changedBy: adjustment?.updatedBy || null,
    missingFields: [],
    orphan: !text(adjustment?.workspaceId || adjustment?.familyId),
    possibleDuplicate: false,
    includedInCalculation: false,
    calculationJustification: 'Ajuste historico exibido como evidencia; nao reaplicado automaticamente na reconstrucao.',
    technicalNotes: adjustment?.auditId ? [`Auditoria de origem: ${adjustment.auditId}`] : [],
  }))

  const groups = new Map()
  movements.filter((item) => item.operationType !== 'audit_log').forEach((item) => {
    const key = duplicateKey(item)
    groups.set(key, [...(groups.get(key) || []), item])
  })
  groups.forEach((items) => {
    if (items.length < 2) return
    items.forEach((item) => { item.possibleDuplicate = true })
  })

  movements.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
  const inconsistencies = movements.reduce((sum, item) => (
    sum + item.missingFields.length + item.technicalNotes.filter((note) => note.includes('difere')).length
  ), sourceErrors.length)
  const duplicateCount = movements.filter((item) => item.possibleDuplicate).length
  const orphanCount = movements.filter((item) => item.orphan).length
  const principalConfirmed = round(reconstructed)
  const interestPositive = round(positiveInterest)
  const interestNegative = round(negativeInterest)
  const netInterest = round(interestPositive - interestNegative)
  const reconstructedBalanceWithInterest = round(principalConfirmed + netInterest)
  const displayedSystemBalance = round(current)
  const realDifference = round(reconstructedBalanceWithInterest - displayedSystemBalance)

  return {
    auditId: `financial_audit_${text(workspaceId) || 'unknown'}_${text(target?.uid || target?.id) || 'member'}_${now.getTime()}`,
    auditOnly: true,
    dryRun: true,
    generatedAt: now.toISOString(),
    workspaceId: text(workspaceId),
    target: {
      uid: text(target?.uid || target?.id),
      email: text(target?.email),
      displayName: text(target?.displayName || target?.name),
      identityIds: [...ids],
    },
    identityCandidates: candidates.map(({ member, id, score }) => ({ id, score, email: member?.email || '', name: member?.displayName || member?.name || '' })),
    ambiguousIdentity: ambiguous,
    movements,
    summary: {
      originallyOwedBy: round(originallyOwedBy),
      originallyOwedTo: round(originallyOwedTo),
      restitutedBy: round(restitutedBy),
      restitutedTo: round(restitutedTo),
      compensated: round(compensated),
      compensatedBy: round(compensatedBy),
      compensatedTo: round(compensatedTo),
      cancelled: round(cancelled),
      logicallyDeleted: round(logicallyDeleted),
      principalConfirmed,
      interestPositive,
      interestNegative,
      netInterest,
      reconstructedBalanceWithInterest,
      displayedSystemBalance,
      realDifference,
      pendingCredits: round(pendingCredits),
      pendingDebits: round(pendingDebits),
      reconstructedBalance: reconstructedBalanceWithInterest,
      currentBalance: displayedSystemBalance,
      difference: realDifference,
      reconstructedCreditOpen: round(reconstructedCreditOpen),
      reconstructedDebitOpen: round(reconstructedDebitOpen),
      currentCreditOpen: round(currentCreditOpen),
      currentDebitOpen: round(currentDebitOpen),
      paidByTarget: round(restitutedBy + compensatedBy),
      receivedByTarget: round(restitutedTo + compensatedTo),
      recordsAnalyzed: movements.length,
      inconsistencies,
      possibleDuplicates: duplicateCount,
      orphanRecords: orphanCount,
    },
    sourceErrors,
    proposedCorrections: [
      ...(realDifference !== 0 ? [{ type: 'audit_adjustment', amount: realDifference, description: 'Ajustar somente apos revisao manual deste relatorio.' }] : []),
      ...movements.filter((item) => item.missingFields.length).map((item) => ({ type: 'normalize_fields', documentId: item.documentId, fields: item.missingFields })),
      ...movements.filter((item) => item.possibleDuplicate).map((item) => ({ type: 'review_duplicate', documentId: item.documentId })),
    ],
    adjustments: matchedAdjustments,
  }
}

function movementIdentityValues(movement) {
  return [movement?.createdBy, movement?.debtor, movement?.creditor, movement?.changedBy]
    .map(normalizedText)
    .filter(Boolean)
}

export function buildCrossFinancialAudit(memberAudits = []) {
  const identityByKey = new Map(memberAudits.map((entry) => {
    const ids = new Set()
    ;(entry?.audit?.reports || []).forEach((report) => {
      ;(report?.target?.identityIds || []).forEach((id) => ids.add(normalizedText(id)))
      ;[report?.target?.displayName, report?.target?.email].map(normalizedText).filter(Boolean).forEach((alias) => ids.add(alias))
    })
    ;[entry?.audit?.target?.uid, entry?.audit?.target?.displayName, entry?.audit?.target?.email]
      .map(normalizedText).filter(Boolean).forEach((alias) => ids.add(alias))
    return [entry.key, ids]
  }))
  const movementMap = new Map()

  memberAudits.forEach((entry) => {
    ;(entry?.audit?.reports || []).forEach((report) => {
      ;(report?.movements || []).forEach((movement) => {
        const key = `${movement.collection}/${movement.documentId}`
        const existing = movementMap.get(key) || {
          ...movement,
          affectedMemberKeys: [],
          affectedMembers: [],
        }
        const identityValues = movementIdentityValues(movement)
        memberAudits.forEach((candidate) => {
          const ids = identityByKey.get(candidate.key) || new Set()
          if (candidate.key === entry.key || identityValues.some((value) => ids.has(value))) {
            if (!existing.affectedMemberKeys.includes(candidate.key)) existing.affectedMemberKeys.push(candidate.key)
            if (!existing.affectedMembers.includes(candidate.label)) existing.affectedMembers.push(candidate.label)
          }
        })
        existing.betweenSelectedMembers = existing.affectedMemberKeys.length >= 2
        movementMap.set(key, existing)
      })
    })
  })

  const movements = [...movementMap.values()].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
  const principalDebts = movements.filter((movement) => movement.recordKind === 'debt')
  const includedDebts = principalDebts.filter((movement) => movement.includedInCalculation)

  return {
    auditOnly: true,
    dryRun: true,
    generatedAt: new Date().toISOString(),
    movements,
    summary: {
      totalMoved: round(principalDebts.reduce((sum, movement) => sum + Number(movement.originalAmount || 0), 0)),
      stillOpen: round(includedDebts.reduce((sum, movement) => sum + Number(movement.remainingAmount || 0), 0)),
      settled: round(principalDebts.reduce((sum, movement) => sum + Number(movement.restitutedAmount || 0) + Number(movement.compensatedAmount || 0), 0)),
      untrustedLinks: movements.filter((movement) => movement.orphan || movement.missingFields?.length).length,
      possibleDuplicates: movements.filter((movement) => movement.possibleDuplicate).length,
      divergences: memberAudits.filter((entry) => Number(entry?.audit?.summary?.difference || 0) !== 0).length,
      crossRelationships: movements.filter((movement) => movement.betweenSelectedMembers).length,
    },
  }
}

export function financialAuditToCsv(report) {
  const columns = ['date', 'documentId', 'collection', 'operationType', 'title', 'originalAmount', 'principalRemainingAmount', 'accruedInterestAmount', 'compensatedAmount', 'restitutedAmount', 'remainingAmount', 'direction', 'createdBy', 'debtor', 'creditor', 'targetRole', 'status', 'affectedMembers', 'includedInCalculation', 'calculationJustification', 'createdAt', 'updatedAt', 'deletedAt', 'changedBy', 'missingFields', 'possibleDuplicate', 'orphan', 'technicalNotes']
  const quote = (value) => `"${String(Array.isArray(value) ? value.join(' | ') : value ?? '').replace(/"/g, '""')}"`
  return [columns.join(','), ...(report?.movements || []).map((row) => columns.map((column) => quote(row[column])).join(','))].join('\n')
}
