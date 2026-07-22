import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMemberStatement, statementRange, statementToCsv } from '../src/utils/memberStatement.js'

const DAY = 24 * 60 * 60 * 1000
const members = [
  { id: 'eric', uid: 'eric', displayName: 'Eric' },
  { id: 'marcio', uid: 'marcio', displayName: 'Marcio' },
]

const debts = [
  {
    id: 'loan', workspaceId: 'family', name: 'Emprestimo', originalAmount: 100,
    creditorMemberId: 'eric', debtorMemberId: 'marcio', status: 'open',
    loanConfirmedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
    settlements: [{ id: 'payment', amount: 30, status: 'confirmed', confirmedAt: '2026-01-10T00:00:00.000Z', confirmedByUid: 'eric' }],
  },
  {
    id: 'pending', workspaceId: 'family', name: 'Pendente', originalAmount: 50,
    creditorMemberId: 'eric', debtorMemberId: 'marcio', status: 'pending_confirmation',
    createdAt: '2026-01-20T00:00:00.000Z', settlements: [],
  },
]

function snapshotBuilder(debt, atMs) {
  const start = Date.parse(debt.loanConfirmedAt || debt.createdAt)
  if (debt.status === 'pending_confirmation' || atMs < start) {
    return { principalRemainingAmount: 0, accruedInterestAmount: 0, remainingAmount: 0 }
  }
  const paymentAt = Date.parse('2026-01-10T00:00:00.000Z')
  if (atMs < paymentAt) {
    const interest = Math.round((((atMs - start) / DAY) + Number.EPSILON) * 100) / 100
    return { principalRemainingAmount: 100, accruedInterestAmount: interest, remainingAmount: 100 + interest }
  }
  const interest = 9 + (((atMs - paymentAt) / DAY) * 0.7)
  return {
    principalRemainingAmount: 70,
    accruedInterestAmount: Math.round((interest + Number.EPSILON) * 100) / 100,
    remainingAmount: Math.round((70 + interest + Number.EPSILON) * 100) / 100,
  }
}

function build(filters = {}) {
  return buildMemberStatement({
    workspaceId: 'family', target: members[0], members, debts,
    start: new Date('2026-01-01T00:00:00.000Z'),
    end: new Date('2026-01-31T00:00:00.000Z'),
    now: new Date('2026-01-31T00:00:00.000Z'),
    filters, snapshotBuilder,
  })
}

test('reconstroi o extrato em ordem, separa juros e nao inclui pendencia no saldo', () => {
  const statement = build()
  assert.equal(statement.summary.openingBalance, 0)
  assert.equal(statement.summary.totalCredits, 100)
  assert.equal(statement.summary.totalDebits, 30)
  assert.equal(statement.summary.positiveInterest, 23.7)
  assert.equal(statement.summary.negativeInterest, 0)
  assert.equal(statement.summary.netInterest, 23.7)
  assert.equal(statement.summary.periodBalance, 93.7)
  assert.equal(statement.summary.closingBalance, 93.7)
  assert.equal(statement.summary.currentBalance, 93.7)
  assert.equal(statement.pending.length, 1)
  assert.equal(statement.pending[0].message, 'Aguardando confirmacao.')
  assert.equal(statement.rows.at(-1).balanceAfter, 93.7)
})

test('filtro de juros preserva o saldo oficial das linhas', () => {
  const all = build()
  const interestOnly = build({ onlyInterest: true })
  assert.ok(interestOnly.rows.length > 0)
  assert.ok(interestOnly.rows.every((row) => row.kind === 'interest'))
  assert.equal(interestOnly.summary.currentBalance, all.summary.currentBalance)
})

test('mes seguinte usa automaticamente o fechamento anterior como saldo de abertura', () => {
  const january = build()
  const february = buildMemberStatement({
    workspaceId: 'family', target: members[0], members, debts,
    start: new Date('2026-02-01T00:00:00.000Z'),
    end: new Date('2026-02-10T00:00:00.000Z'),
    now: new Date('2026-02-10T00:00:00.000Z'),
    snapshotBuilder,
  })
  const closingJanuary = snapshotBuilder(debts[0], Date.parse('2026-02-01T00:00:00.000Z') - 1).remainingAmount
  assert.equal(february.summary.openingBalance, closingJanuary)
  assert.equal(january.summary.closingBalance, 93.7)
  assert.ok(february.summary.closingBalance > february.summary.openingBalance)
})

test('gera intervalos personalizados locais e CSV bancario', () => {
  const range = statementRange('custom', new Date('2026-07-22T12:00:00-03:00'), { start: '2026-07-01', end: '2026-07-10' })
  assert.equal(range.start.getDate(), 1)
  assert.equal(range.end.getDate(), 10)
  const csv = statementToCsv(build())
  assert.match(csv, /Saldo apos movimentacao/)
  assert.match(csv, /Aguardando/)
})
