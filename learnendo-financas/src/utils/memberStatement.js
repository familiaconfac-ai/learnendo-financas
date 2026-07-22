const DAY_MS = 24 * 60 * 60 * 1000

function round(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function toMillis(value) {
  if (!value) return 0
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

function iso(value) {
  const timestamp = typeof value === 'number' ? value : toMillis(value)
  return timestamp ? new Date(timestamp).toISOString() : null
}

function normalizedStatus(value) {
  return String(value || '').trim().toLowerCase()
}

function targetIds(target = {}) {
  return new Set([target.id, target.uid, target.userId, target.memberId]
    .map((value) => String(value || '').trim())
    .filter(Boolean))
}

function debtRole(debt, ids) {
  const creditor = String(debt?.creditorMemberId || '').trim()
  const debtor = String(debt?.debtorMemberId || '').trim()
  if (ids.has(creditor)) return 'creditor'
  if (ids.has(debtor)) return 'debtor'
  return null
}

function roleSign(role) {
  return role === 'creditor' ? 1 : role === 'debtor' ? -1 : 0
}

function confirmedAtMs(debt) {
  return toMillis(debt?.loanConfirmedAt || debt?.receiptConfirmedAt || debt?.confirmedAt || debt?.createdAt)
}

function inactiveAtMs(debt) {
  const status = normalizedStatus(debt?.status)
  if (status === 'cancelled' || status === 'canceled') {
    return toMillis(debt?.cancelledAt || debt?.canceledAt || debt?.updatedAt)
  }
  if (status === 'deleted' || debt?.deletedAt) return toMillis(debt?.deletedAt || debt?.updatedAt)
  return 0
}

function isPending(debt) {
  return normalizedStatus(debt?.status) === 'pending_confirmation'
}

function isInactiveWithoutDate(debt) {
  const status = normalizedStatus(debt?.status)
  return ['cancelled', 'canceled', 'deleted'].includes(status) && !inactiveAtMs(debt)
}

function snapshotComponent(debt, role, atMs, snapshotBuilder) {
  const startMs = confirmedAtMs(debt)
  const stopMs = inactiveAtMs(debt)
  if (!role || !startMs || atMs < startMs || isPending(debt) || isInactiveWithoutDate(debt) || (stopMs && atMs >= stopMs)) {
    return { principal: 0, interest: 0, total: 0, snapshot: null }
  }
  const snapshot = snapshotBuilder(debt, atMs)
  const sign = roleSign(role)
  return {
    principal: round(sign * Number(snapshot?.principalRemainingAmount || 0)),
    interest: round(sign * Number(snapshot?.accruedInterestAmount || 0)),
    total: round(sign * Number(snapshot?.remainingAmount || 0)),
    snapshot,
  }
}

function monthBoundaryTimes(startMs, endMs) {
  const boundaries = []
  const cursor = new Date(startMs)
  cursor.setHours(0, 0, 0, 0)
  cursor.setMonth(cursor.getMonth() + 1, 1)
  while (cursor.getTime() <= endMs) {
    boundaries.push(cursor.getTime() - 1)
    cursor.setMonth(cursor.getMonth() + 1, 1)
  }
  return boundaries
}

function memberNameById(members = []) {
  const names = new Map()
  members.forEach((member) => {
    const name = member?.displayName || member?.name || member?.email || 'Membro'
    ;[member?.id, member?.uid, member?.userId, member?.memberId]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .forEach((id) => names.set(id, name))
  })
  return (id) => names.get(String(id || '').trim()) || String(id || 'Nao informado')
}

function debtHistory(debt, resolveName = (value) => value) {
  const history = [
    { date: iso(debt?.createdAt), label: 'Movimentacao criada', actor: debt?.createdBy ? resolveName(debt.createdBy) : null },
    debt?.loanConfirmedAt || debt?.receiptConfirmedAt || debt?.confirmedAt
      ? { date: iso(debt?.loanConfirmedAt || debt?.receiptConfirmedAt || debt?.confirmedAt), label: 'Recebimento confirmado', actor: debt?.confirmedByUid || debt?.receiptConfirmedByUid ? resolveName(debt?.confirmedByUid || debt?.receiptConfirmedByUid) : null }
      : null,
    ...(Array.isArray(debt?.settlements) ? debt.settlements.map((settlement) => ({
      date: iso(settlement.confirmedAt || settlement.cancelledAt || settlement.createdAt),
      label: settlement.status === 'confirmed' ? 'Restituicao confirmada' : settlement.status === 'cancelled' ? 'Restituicao cancelada' : 'Restituicao solicitada',
      actor: settlement.confirmedByUid || settlement.cancelledByUid || settlement.createdByUid ? resolveName(settlement.confirmedByUid || settlement.cancelledByUid || settlement.createdByUid) : null,
      amount: Number(settlement.amount || 0),
    })) : []),
    debt?.cancelledAt ? { date: iso(debt.cancelledAt), label: 'Movimentacao cancelada', actor: debt?.cancelledBy ? resolveName(debt.cancelledBy) : null } : null,
    debt?.deletedAt ? { date: iso(debt.deletedAt), label: 'Movimentacao excluida logicamente', actor: debt?.deletedBy ? resolveName(debt.deletedBy) : null } : null,
    debt?.updatedAt ? { date: iso(debt.updatedAt), label: 'Ultima atualizacao', actor: debt?.updatedBy ? resolveName(debt.updatedBy) : null } : null,
  ].filter((item) => item?.date)
  return history.sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

function baseDetails(debt, workspaceId, snapshot = null, resolveName = (value) => value) {
  return {
    sourceDocument: `${debt?._collection || `workspaces/${workspaceId}/debts`}/${debt?.id || ''}`,
    createdBy: debt?.createdBy ? resolveName(debt.createdBy) : null,
    confirmedBy: debt?.confirmedByUid || debt?.receiptConfirmedByUid ? resolveName(debt?.confirmedByUid || debt?.receiptConfirmedByUid) : null,
    accruedInterest: round(snapshot?.accruedInterestAmount || 0),
    notes: debt?.notes || debt?.note || '',
    history: debtHistory(debt, resolveName),
  }
}

function statusLabel(status) {
  if (status === 'pending') return 'Pendente'
  if (status === 'cancelled') return 'Cancelado'
  if (status === 'settled') return 'Quitado'
  return 'Confirmado'
}

function filterRows(rows, filters = {}) {
  return rows.filter((row) => {
    if (filters.direction === 'credits' && row.totalAmount <= 0) return false
    if (filters.direction === 'debits' && row.totalAmount >= 0) return false
    if (filters.status === 'pending' && row.status !== 'pending') return false
    if (filters.status === 'confirmed' && !['confirmed', 'settled'].includes(row.status)) return false
    if (filters.onlyInterest && row.kind !== 'interest') return false
    return true
  })
}

function totalsAt(debts, roles, atMs, snapshotBuilder) {
  return debts.reduce((total, debt) => round(total + snapshotComponent(debt, roles.get(debt.id), atMs, snapshotBuilder).total), 0)
}

export function buildMemberStatement({
  workspaceId,
  target,
  members = [],
  debts = [],
  start,
  end,
  now = new Date(),
  filters = {},
  snapshotBuilder,
}) {
  if (typeof snapshotBuilder !== 'function') throw new Error('A funcao compartilhada de juros e obrigatoria.')
  const ids = targetIds(target)
  const relatedDebts = debts.filter((debt) => debtRole(debt, ids))
  const roles = new Map(relatedDebts.map((debt) => [debt.id, debtRole(debt, ids)]))
  const resolveName = memberNameById(members)
  const nowMs = now instanceof Date ? now.getTime() : toMillis(now)
  const startMs = Math.max(0, toMillis(start))
  const requestedEndMs = toMillis(end) || nowMs
  const endMs = Math.min(requestedEndMs, nowMs)
  if (!startMs || startMs > endMs) throw new Error('Periodo do extrato invalido.')

  const eventTimes = new Set([endMs, ...monthBoundaryTimes(startMs, endMs)])
  const eventsByTime = new Map()
  const addEvent = (timestamp, event) => {
    if (!timestamp || timestamp < startMs || timestamp > endMs) return
    eventTimes.add(timestamp)
    eventsByTime.set(timestamp, [...(eventsByTime.get(timestamp) || []), event])
  }

  relatedDebts.forEach((debt) => {
    const startTime = confirmedAtMs(debt)
    if (!isPending(debt) && !isInactiveWithoutDate(debt)) addEvent(startTime, { kind: 'origin', debt })
    ;(Array.isArray(debt.settlements) ? debt.settlements : [])
      .filter((settlement) => normalizedStatus(settlement.status) === 'confirmed')
      .forEach((settlement) => addEvent(toMillis(settlement.confirmedAt || settlement.createdAt), { kind: 'settlement', debt, settlement }))
    const stopTime = inactiveAtMs(debt)
    if (stopTime) addEvent(stopTime, { kind: 'cancelled', debt })
  })

  const openingBalance = totalsAt(relatedDebts, roles, startMs - 1, snapshotBuilder)
  let runningBalance = openingBalance
  let previousTime = startMs - 1
  const rows = []

  const sortedTimes = [...eventTimes].filter((value) => value >= startMs && value <= endMs).sort((a, b) => a - b)
  sortedTimes.forEach((time) => {
    const hasFinancialEvent = (eventsByTime.get(time) || []).length > 0
    const interestCutoff = hasFinancialEvent ? Math.max(previousTime, time - 1) : time
    relatedDebts.forEach((debt) => {
      const role = roles.get(debt.id)
      const previous = snapshotComponent(debt, role, previousTime, snapshotBuilder)
      const before = snapshotComponent(debt, role, interestCutoff, snapshotBuilder)
      const generatedInterest = round(before.interest - previous.interest)
      if (!generatedInterest) return
      runningBalance = round(runningBalance + generatedInterest)
      rows.push({
        id: `interest:${debt.id}:${time}`,
        debtId: debt.id,
        kind: 'interest',
        date: iso(time),
        type: generatedInterest > 0 ? 'Juros positivos' : 'Juros negativos',
        description: `Juros acumulados - ${debt.name || debt.reasonLabel || 'saldo entre membros'}`,
        creditor: resolveName(debt.creditorMemberId),
        debtor: resolveName(debt.debtorMemberId),
        principalAmount: 0,
        interestAmount: generatedInterest,
        accruedInterestToDate: round(before.interest),
        totalAmount: generatedInterest,
        status: 'confirmed',
        statusLabel: statusLabel('confirmed'),
        balanceAfter: runningBalance,
        details: baseDetails(debt, workspaceId, before.snapshot, resolveName),
      })
    })

    const grouped = new Map()
    ;(eventsByTime.get(time) || []).forEach((event) => {
      const key = `${event.kind}:${event.debt.id}`
      const group = grouped.get(key) || { ...event, settlements: [] }
      if (event.settlement) group.settlements.push(event.settlement)
      grouped.set(key, group)
    })

    grouped.forEach((event) => {
      const { debt } = event
      const role = roles.get(debt.id)
      const before = snapshotComponent(debt, role, time - 1, snapshotBuilder)
      const after = snapshotComponent(debt, role, time, snapshotBuilder)
      const principalDelta = round(after.principal - before.principal)
      const interestDelta = round(after.interest - before.interest)
      const totalDelta = round(after.total - before.total)
      if (!totalDelta && event.kind !== 'cancelled') return
      runningBalance = round(runningBalance + totalDelta)
      const isSettled = event.kind === 'settlement' && Math.abs(after.total) < 0.005
      const status = event.kind === 'cancelled' ? 'cancelled' : isSettled ? 'settled' : 'confirmed'
      const settlementAmount = event.settlements.reduce((sum, settlement) => sum + Number(settlement.amount || 0), 0)
      rows.push({
        id: `${event.kind}:${debt.id}:${time}`,
        debtId: debt.id,
        kind: event.kind,
        date: iso(time),
        type: event.kind === 'origin' ? 'Saldo confirmado' : event.kind === 'settlement' ? 'Pagamento / restituicao' : 'Cancelamento',
        description: event.kind === 'settlement'
          ? (event.settlements.map((item) => item.note).filter(Boolean).join('; ') || `Restituicao de ${resolveName(debt.debtorMemberId)}`)
          : debt.name || debt.reasonLabel || 'Movimentacao entre membros',
        creditor: resolveName(debt.creditorMemberId),
        debtor: resolveName(debt.debtorMemberId),
        principalAmount: principalDelta,
        interestAmount: interestDelta,
        accruedInterestToDate: round(after.interest),
        totalAmount: totalDelta,
        informedAmount: round(event.kind === 'settlement' ? settlementAmount : debt.originalAmount || debt.totalAmount),
        status,
        statusLabel: statusLabel(status),
        balanceAfter: runningBalance,
        details: {
          ...baseDetails(debt, workspaceId, after.snapshot || before.snapshot, resolveName),
          confirmedBy: event.settlements.map((item) => item.confirmedByUid).filter(Boolean).map(resolveName).join(', ') || (debt.confirmedByUid || debt.receiptConfirmedByUid ? resolveName(debt.confirmedByUid || debt.receiptConfirmedByUid) : null),
        },
      })
    })
    previousTime = time
  })

  const pending = relatedDebts
    .filter(isPending)
    .map((debt) => {
      const role = roles.get(debt.id)
      const sign = roleSign(role)
      const amount = round(sign * Number(debt.originalAmount || debt.totalAmount || 0))
      return {
        id: `pending:${debt.id}`,
        debtId: debt.id,
        kind: 'pending',
        date: iso(debt.createdAt),
        type: 'Movimentacao pendente',
        description: debt.name || debt.reasonLabel || 'Movimentacao entre membros',
        creditor: resolveName(debt.creditorMemberId),
        debtor: resolveName(debt.debtorMemberId),
        principalAmount: amount,
        interestAmount: 0,
        accruedInterestToDate: 0,
        totalAmount: amount,
        status: 'pending',
        statusLabel: statusLabel('pending'),
        balanceAfter: null,
        message: 'Aguardando confirmacao.',
        details: baseDetails(debt, workspaceId, null, resolveName),
      }
    })
    .filter((row) => {
      const timestamp = toMillis(row.date)
      return timestamp >= startMs && timestamp <= endMs
    })

  const closingBalance = totalsAt(relatedDebts, roles, endMs, snapshotBuilder)
  const currentBalance = totalsAt(relatedDebts, roles, nowMs, snapshotBuilder)
  const totalCredits = round(rows.filter((row) => row.kind !== 'interest' && row.principalAmount > 0).reduce((sum, row) => sum + row.principalAmount, 0))
  const totalDebits = round(Math.abs(rows.filter((row) => row.kind !== 'interest' && row.principalAmount < 0).reduce((sum, row) => sum + row.principalAmount, 0)))
  const positiveInterest = round(rows.filter((row) => row.interestAmount > 0).reduce((sum, row) => sum + row.interestAmount, 0))
  const negativeInterest = round(Math.abs(rows.filter((row) => row.interestAmount < 0).reduce((sum, row) => sum + row.interestAmount, 0)))
  const netInterest = round(positiveInterest - negativeInterest)

  return {
    generatedAt: new Date(nowMs).toISOString(),
    workspaceId,
    target: {
      id: target.id || target.uid || target.userId || '',
      uid: target.uid || target.userId || target.id || '',
      displayName: target.displayName || target.name || target.email || 'Membro',
      email: target.email || '',
    },
    period: { start: iso(startMs), end: iso(endMs) },
    summary: {
      openingBalance,
      totalCredits,
      totalDebits,
      positiveInterest,
      negativeInterest,
      netInterest,
      periodBalance: round(closingBalance - openingBalance),
      closingBalance,
      currentBalance,
    },
    rows: filterRows(rows, filters),
    allRows: rows,
    pending: filterRows(pending, filters),
    pendingAll: pending,
    officialBalanceMatches: round(currentBalance - totalsAt(relatedDebts, roles, nowMs, snapshotBuilder)) === 0,
  }
}

export function statementRange(preset, reference = new Date(), custom = {}) {
  const now = new Date(reference)
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)
  let start = new Date(now)
  let end = new Date(Math.min(endOfToday.getTime(), now.getTime()))

  if (preset === 'today') start.setHours(0, 0, 0, 0)
  if (preset === '7days') {
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
  }
  if (preset === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1)
  }
  if (preset === 'previousMonth') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    end = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, -1)
  }
  if (preset === 'year') start = new Date(now.getFullYear(), 0, 1)
  if (preset === 'custom') {
    const localInputTime = (value) => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
      return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() : toMillis(value)
    }
    const customStart = localInputTime(custom.start)
    const customEnd = localInputTime(custom.end)
    if (customStart) {
      start = new Date(customStart)
      start.setHours(0, 0, 0, 0)
    }
    if (customEnd) {
      end = new Date(customEnd)
      end.setHours(23, 59, 59, 999)
    }
  }
  return { start, end: new Date(Math.min(end.getTime(), now.getTime())) }
}

export function statementToCsv(statement) {
  const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const header = ['Data', 'Hora', 'Tipo', 'Descricao', 'Credor', 'Devedor', 'Principal', 'Juros', 'Total', 'Situacao', 'Saldo apos movimentacao']
  const lines = [...statement.rows, ...statement.pending].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  return [header, ...lines.map((row) => {
    const date = row.date ? new Date(row.date) : null
    return [
      date?.toLocaleDateString('pt-BR') || '',
      date?.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) || '',
      row.type,
      row.description,
      row.creditor,
      row.debtor,
      row.principalAmount.toFixed(2),
      row.interestAmount.toFixed(2),
      row.totalAmount.toFixed(2),
      row.message ? `${row.statusLabel} - ${row.message}` : row.statusLabel,
      row.balanceAfter == null ? '' : Number(row.balanceAfter).toFixed(2),
    ].map(quote)
  })].map((line) => line.join(';')).join('\n')
}

export { round as roundStatementCurrency, toMillis as statementTimeValue, DAY_MS }
