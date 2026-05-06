import { useEffect, useMemo, useState } from 'react'
import Card, { CardHeader } from '../../components/ui/Card'
import MonthSelector from '../../components/ui/MonthSelector'
import { useFinance } from '../../context/FinanceContext'
import { useAccounts } from '../../hooks/useAccounts'
import { useTransactions } from '../../hooks/useTransactions'
import { formatCurrency } from '../../utils/formatCurrency'
import { buildAccountsReconciliation } from '../../utils/financeCalculations'
import './Reconciliacao.css'

function formatMonthLabel(year, month) {
  return new Date(year, month - 1, 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
}

export default function Reconciliacao() {
  const { selectedMonth, selectedYear } = useFinance()
  const { accounts, loading: accountsLoading } = useAccounts()
  const { transactions, loading: transactionsLoading } = useTransactions(selectedYear, selectedMonth)
  const [selectedAccountId, setSelectedAccountId] = useState('')

  const selectedMonthKey = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`
  const reconciliations = useMemo(
    () => buildAccountsReconciliation(accounts, transactions, selectedMonthKey),
    [accounts, transactions, selectedMonthKey],
  )
  const availableAccounts = reconciliations.filter((item) => item.hasSnapshot)

  useEffect(() => {
    if (availableAccounts.length === 0) {
      setSelectedAccountId('')
      return
    }

    if (!availableAccounts.some((item) => item.accountId === selectedAccountId)) {
      setSelectedAccountId(availableAccounts[0].accountId)
    }
  }, [availableAccounts, selectedAccountId])

  const current = availableAccounts.find((item) => item.accountId === selectedAccountId) || null
  const hasDiff = current && Math.abs(Number(current.difference || 0)) >= 0.01
  const loading = accountsLoading || transactionsLoading

  if (loading) {
    return (
      <div className="reconciliacao-page">
        <MonthSelector />
        <Card>
          <div className="rec-empty-state">Carregando conciliacao...</div>
        </Card>
      </div>
    )
  }

  if (availableAccounts.length === 0) {
    return (
      <div className="reconciliacao-page">
        <MonthSelector />
        <Card>
          <div className="rec-empty-state">
            <strong>Nenhum extrato disponível para conciliar.</strong>
            <p>Importe um extrato em Contas para comparar o saldo esperado com o saldo real do banco.</p>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="reconciliacao-page">
      <MonthSelector />

      <Card>
        <div className="rec-account-picker">
          <label htmlFor="reconciliation-account">Conta para conciliar</label>
          <select
            id="reconciliation-account"
            value={selectedAccountId}
            onChange={(event) => setSelectedAccountId(event.target.value)}
          >
            {availableAccounts.map((item) => (
              <option key={item.accountId} value={item.accountId}>{item.accountName}</option>
            ))}
          </select>
        </div>
      </Card>

      {current && (
        <>
          <Card className={`rec-status-card ${hasDiff ? 'rec-diff' : 'rec-ok'}`}>
            <div className="rec-status-header">
              <span className="rec-status-icon">{hasDiff ? '⚠️' : '✅'}</span>
              <div>
                <div className="rec-status-title">
                  {hasDiff ? 'Divergência encontrada' : 'Conta reconciliada'}
                </div>
                <div className="rec-status-sub">
                  {current.accountName} · {formatMonthLabel(selectedYear, selectedMonth)}
                </div>
              </div>
            </div>
            {hasDiff && (
              <div className="rec-diff-value">
                Diferença: <strong className="red">{formatCurrency(current.difference || 0)}</strong>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Cálculo do saldo esperado" />
            <div className="rec-formula">
              <div className="rec-row">
                <span>Saldo inicial</span>
                <span className="neutral">{formatCurrency(current.openingBalance)}</span>
              </div>
              <div className="rec-row">
                <span>+ Entradas</span>
                <span className="green">+{formatCurrency(current.totalIncome)}</span>
              </div>
              <div className="rec-row">
                <span>− Saídas</span>
                <span className="red">−{formatCurrency(current.totalExpenses)}</span>
              </div>
              <div className="rec-row">
                <span>− Transferências de saída</span>
                <span className="red">−{formatCurrency(current.totalTransfers)}</span>
              </div>
              <div className="rec-divider" />
              <div className="rec-row rec-row-total">
                <span>Saldo esperado</span>
                <strong>{formatCurrency(current.expectedClosingBalance)}</strong>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Comparação com o extrato" />
            <div className="rec-comparison">
              <div className="rec-comp-item">
                <span className="rec-comp-label">Saldo esperado</span>
                <span className="rec-comp-value neutral">{formatCurrency(current.expectedClosingBalance)}</span>
              </div>
              <div className="rec-comp-sep">vs</div>
              <div className="rec-comp-item">
                <span className="rec-comp-label">Saldo real</span>
                <span className={`rec-comp-value ${hasDiff ? 'red' : 'green'}`}>
                  {formatCurrency(current.actualClosingBalance || 0)}
                </span>
              </div>
            </div>
            {hasDiff && (
              <div className="rec-reason">
                <span>ℹ️</span>
                <span>
                  Há diferença entre o saldo calculado pelos lançamentos confirmados e o saldo final do extrato.
                  Revise pendências, transferências e lançamentos fora da conta.
                </span>
              </div>
            )}
          </Card>

          {current.pendingTransactions.length > 0 && (
            <Card>
              <CardHeader
                title="Lançamentos para revisar"
                subtitle={`${current.pendingTransactions.length} item(ns) pendente(s) nesta conta`}
              />
              <ul className="rec-tx-list">
                {current.pendingTransactions.map((tx) => (
                  <li key={tx.id} className="rec-tx-item">
                    <span className="rec-tx-icon">🕐</span>
                    <div className="rec-tx-info">
                      <span className="rec-tx-desc">{tx.description}</span>
                      <span className="rec-tx-date">{tx.date}</span>
                    </div>
                    <span className={`rec-tx-value ${tx.type === 'income' ? 'green' : 'red'}`}>
                      {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {!hasDiff ? (
            <div className="rec-done-msg">
              Tudo certo. O saldo desta conta está conciliado para {formatMonthLabel(selectedYear, selectedMonth)}.
            </div>
          ) : (
            <div className="rec-action-hint">
              Resolva as pendências em Lançar e confira se o extrato foi importado na conta correta.
            </div>
          )}
        </>
      )}
    </div>
  )
}
