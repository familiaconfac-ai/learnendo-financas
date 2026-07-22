import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCrossFinancialAudit, buildFinancialAudit, financialAuditToCsv, identifyAuditMemberCandidates } from '../src/utils/financialAudit.js'

const target = { uid: 'eric-uid', email: 'eric@example.com', displayName: 'Eric Martins' }
const members = [
  { uid: 'eric-uid', email: 'eric@example.com', displayName: 'Eric Martins' },
  { uid: 'ana-uid', email: 'ana@example.com', displayName: 'Ana' },
]

function audit(overrides = {}) {
  return buildFinancialAudit({ workspaceId: 'family-1', target, members, now: new Date('2026-07-22T12:00:00Z'), ...overrides })
}

test('identifica Eric por UID e email, sem assumir apenas pelo nome', () => {
  const candidates = identifyAuditMemberCandidates(members, target)
  assert.equal(candidates[0].id, 'eric-uid')
  assert.ok(candidates[0].score >= 150)
})

test('reconstroi Eric como devedor com restituicao parcial e lancamento legado', () => {
  const report = audit({
    debts: [{
      id: 'd1', workspaceId: 'family-1', name: 'Emprestimo', originalAmount: 100,
      initialPaidAmount: 10, remainingAmount: 90, creditorMemberId: 'ana-uid', debtorMemberId: 'eric-uid',
      status: 'open', createdAt: '2026-01-01T10:00:00Z',
      settlements: [{ id: 's1', amount: 20, status: 'confirmed', createdAt: '2026-01-02T10:00:00Z' }],
    }],
    transactions: [{ id: 't1', workspaceId: 'family-1', debtId: 'd1', amount: 15, status: 'confirmed', countsAsDebtSettlement: true, date: '2026-01-03' }],
  })
  assert.equal(report.summary.originallyOwedBy, 100)
  assert.equal(report.summary.restitutedBy, 35)
  assert.equal(report.summary.compensated, 10)
  assert.equal(report.summary.reconstructedBalance, -55)
  assert.equal(report.summary.currentBalance, -55)
  assert.equal(report.summary.difference, 0)
  assert.equal(report.summary.principalConfirmed, -55)
  assert.equal(report.summary.netInterest, 0)
  assert.equal(report.summary.reconstructedCreditOpen, 0)
  assert.equal(report.summary.reconstructedDebitOpen, 55)
  assert.equal(report.summary.paidByTarget, 45)
  assert.equal(report.dryRun, true)
})

test('separa principal, juros e pendencias usando o snapshot da mesma regra da tela Familia', () => {
  const report = audit({ debts: [
    {
      id: 'pix', workspaceId: 'family-1', originalAmount: 1675,
      creditorMemberId: 'eric-uid', debtorMemberId: 'ana-uid', status: 'open', createdAt: '2026-05-11',
      _auditBalanceSnapshot: { principalRemainingAmount: 1675, accruedInterestAmount: 60.38, remainingAmount: 1735.38 },
    },
    {
      id: 'credito', workspaceId: 'family-1', originalAmount: 273,
      creditorMemberId: 'eric-uid', debtorMemberId: 'ana-uid', status: 'open', createdAt: '2026-06-06',
      _auditBalanceSnapshot: { principalRemainingAmount: 273, accruedInterestAmount: 6.28, remainingAmount: 279.28 },
    },
    {
      id: 'debito', workspaceId: 'family-1', originalAmount: 589,
      creditorMemberId: 'ana-uid', debtorMemberId: 'eric-uid', status: 'open', createdAt: '2026-06-06',
      _auditBalanceSnapshot: { principalRemainingAmount: 589, accruedInterestAmount: 13.54, remainingAmount: 602.54 },
    },
    { id: 'pendente-100', workspaceId: 'family-1', originalAmount: 100, creditorMemberId: 'eric-uid', debtorMemberId: 'ana-uid', status: 'pending_confirmation', createdAt: '2026-07-03' },
    { id: 'pendente-300', workspaceId: 'family-1', originalAmount: 300, creditorMemberId: 'levi-uid', debtorMemberId: 'eric-uid', status: 'pending_confirmation', createdAt: '2026-07-07' },
    { id: 'pendente-200', workspaceId: 'family-1', originalAmount: 200, creditorMemberId: 'eric-uid', debtorMemberId: 'ana-uid', status: 'pending_confirmation', createdAt: '2026-07-13' },
  ] })

  assert.equal(report.summary.principalConfirmed, 1359)
  assert.equal(report.summary.interestPositive, 66.66)
  assert.equal(report.summary.interestNegative, 13.54)
  assert.equal(report.summary.netInterest, 53.12)
  assert.equal(report.summary.reconstructedBalanceWithInterest, 1412.12)
  assert.equal(report.summary.displayedSystemBalance, 1412.12)
  assert.equal(report.summary.realDifference, 0)
  assert.equal(report.summary.pendingCredits, 300)
  assert.equal(report.summary.pendingDebits, 300)
})

test('mantem Levi zerado e separa o credito pendente contra Eric', () => {
  const levi = buildFinancialAudit({
    workspaceId: 'family-1',
    target: { uid: 'levi-uid', displayName: 'Levi' },
    members: [...members, { uid: 'levi-uid', displayName: 'Levi' }],
    debts: [
      { id: 'credito-pendente', workspaceId: 'family-1', originalAmount: 300, creditorMemberId: 'levi-uid', debtorMemberId: 'eric-uid', status: 'pending_confirmation', createdAt: '2026-07-07' },
      { id: 'recarga', workspaceId: 'family-1', originalAmount: 20, initialPaidAmount: 20, creditorMemberId: 'ana-uid', debtorMemberId: 'levi-uid', status: 'settled', createdAt: '2026-07-08', _auditBalanceSnapshot: { principalRemainingAmount: 0, accruedInterestAmount: 0, remainingAmount: 0 } },
    ],
    now: new Date('2026-07-22T12:00:00Z'),
  })
  assert.equal(levi.summary.principalConfirmed, 0)
  assert.equal(levi.summary.reconstructedBalanceWithInterest, 0)
  assert.equal(levi.summary.displayedSystemBalance, 0)
  assert.equal(levi.summary.realDifference, 0)
  assert.equal(levi.summary.pendingCredits, 300)
})

test('reconstroi Eric como credor e ignora registro cancelado ou excluido no saldo', () => {
  const report = audit({ debts: [
    { id: 'open', workspaceId: 'family-1', originalAmount: 80, remainingAmount: 80, creditorMemberId: 'eric-uid', debtorMemberId: 'ana-uid', status: 'open', createdAt: '2026-01-01' },
    { id: 'cancel', workspaceId: 'family-1', originalAmount: 20, remainingAmount: 20, creditorMemberId: 'eric-uid', debtorMemberId: 'ana-uid', status: 'cancelled', createdAt: '2026-01-02' },
    { id: 'deleted', workspaceId: 'family-1', originalAmount: 30, remainingAmount: 30, creditorMemberId: 'eric-uid', debtorMemberId: 'ana-uid', status: 'deleted', deletedAt: '2026-01-03', createdAt: '2026-01-03' },
  ] })
  assert.equal(report.summary.originallyOwedTo, 130)
  assert.equal(report.summary.reconstructedBalance, 80)
  assert.equal(report.summary.cancelled, 20)
  assert.equal(report.summary.logicallyDeleted, 30)
})

test('nao duplica settlement que possui o mesmo lancamento vinculado', () => {
  const report = audit({
    debts: [{
      id: 'd1', workspaceId: 'family-1', originalAmount: 100, remainingAmount: 75,
      creditorMemberId: 'ana-uid', debtorMemberId: 'eric-uid', status: 'open', createdAt: '2026-01-01',
      settlements: [{ id: 's1', amount: 25, status: 'confirmed', linkedTransactionId: 't1', createdAt: '2026-01-02' }],
    }],
    transactions: [{ id: 't1', workspaceId: 'family-1', debtId: 'd1', amount: 25, status: 'confirmed', countsAsDebtSettlement: true, date: '2026-01-02' }],
  })
  assert.equal(report.summary.restitutedBy, 25)
  assert.equal(report.summary.reconstructedBalance, -75)
})

test('classifica documentos orfaos, campos legados e possiveis duplicidades', () => {
  const debt = { name: 'Ajuste Eric', value: 10, creditorMemberName: 'Eric Martins', debtorMemberName: 'Ana', status: 'open', date: '2026-01-01' }
  const report = audit({ debts: [{ id: 'a', ...debt }, { id: 'b', ...debt }] })
  assert.ok(report.summary.orphanRecords >= 2)
  assert.ok(report.summary.inconsistencies >= 2)
  assert.ok(report.summary.possibleDuplicates >= 2)
  assert.ok(report.proposedCorrections.some((item) => item.type === 'normalize_fields'))
})

test('exporta linha do tempo em CSV', () => {
  const report = audit({ debts: [{ id: 'd1', workspaceId: 'family-1', totalAmount: 10, remainingAmount: 10, creditorMemberId: 'eric-uid', debtorMemberId: 'ana-uid', createdAt: '2026-01-01' }] })
  const csv = financialAuditToCsv(report)
  assert.match(csv, /documentId/)
  assert.match(csv, /d1/)
})

test('consolida Eric, Levi e Arthur sem duplicar o mesmo documento', () => {
  const commonDebt = {
    id: 'shared', workspaceId: 'family-1', originalAmount: 50, remainingAmount: 50,
    creditorMemberId: 'eric-uid', debtorMemberId: 'levi-uid', createdAt: '2026-01-01', status: 'open',
  }
  const eric = audit({ debts: [commonDebt] })
  const levi = buildFinancialAudit({
    workspaceId: 'family-1',
    target: { uid: 'levi-uid', displayName: 'Levi' },
    members: [...members, { uid: 'levi-uid', displayName: 'Levi' }],
    debts: [commonDebt],
    now: new Date('2026-07-22T12:00:00Z'),
  })
  const arthur = buildFinancialAudit({
    workspaceId: 'family-1',
    target: { uid: 'arthur-uid', displayName: 'Arthur' },
    members: [...members, { uid: 'arthur-uid', displayName: 'Arthur' }],
    debts: [],
    now: new Date('2026-07-22T12:00:00Z'),
  })
  const consolidated = buildCrossFinancialAudit([
    { key: 'eric', label: 'Eric', audit: { target, reports: [eric], summary: eric.summary } },
    { key: 'levi', label: 'Levi', audit: { target: { uid: 'levi-uid' }, reports: [levi], summary: levi.summary } },
    { key: 'arthur', label: 'Arthur', audit: { target: { uid: 'arthur-uid' }, reports: [arthur], summary: arthur.summary } },
  ])
  assert.equal(consolidated.movements.filter((movement) => movement.documentId === 'shared').length, 1)
  assert.equal(consolidated.movements[0].betweenSelectedMembers, true)
  assert.deepEqual(consolidated.movements[0].affectedMembers.sort(), ['Eric', 'Levi'])
  assert.equal(consolidated.summary.totalMoved, 50)
})
