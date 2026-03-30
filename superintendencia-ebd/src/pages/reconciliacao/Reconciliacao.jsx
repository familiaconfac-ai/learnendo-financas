import Card, { CardHeader } from '../../components/ui/Card'
import { formatCurrency } from '../../utils/formatCurrency'
import { MOCK_RECONCILIATION, MOCK_ACCOUNTS, MOCK_TRANSACTIONS } from '../../utils/mockData'
import './Reconciliacao.css'

export default function Reconciliacao() {
  const rec     = MOCK_RECONCILIATION
  const account = MOCK_ACCOUNTS.find(a => a.id === rec.accountId)
  const hasDiff = rec.difference !== 0

  // Lançamentos pendentes/para revisar no período
  const [y, m] = rec.month.split('-')
  const pendingTxs = MOCK_TRANSACTIONS.filter(
    t => t.competencyMonth === rec.month &&
         (t.status === 'needs_review' || t.status === 'pending')
  )

  return (
    <div className="reconciliacao-page">
      {/* Header do período */}
      <Card className={`rec-status-card ${hasDiff ? 'rec-diff' : 'rec-ok'}`}>
        <div className="rec-status-header">
          <span className="rec-status-icon">{hasDiff ? '⚠️' : '✅'}</span>
          <div>
            <div className="rec-status-title">
              {hasDiff ? 'Divergência encontrada' : 'Conta reconciliada'}
            </div>
            <div className="rec-status-sub">
              {account?.name} · {new Date(parseInt(y), parseInt(m) - 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}
            </div>
          </div>
        </div>
        {hasDiff && (
          <div className="rec-diff-value">
            Diferença: <strong className="red">{formatCurrency(rec.difference)}</strong>
          </div>
        )}
      </Card>

      {/* Fórmula visual */}
      <Card>
        <CardHeader title="Cálculo do saldo esperado" />
        <div className="rec-formula">
          <div className="rec-row">
            <span>Saldo inicial</span>
            <span className="neutral">{formatCurrency(rec.openingBalance)}</span>
          </div>
          <div className="rec-row">
            <span>+ Receitas</span>
            <span className="green">+{formatCurrency(rec.totalIncome)}</span>
          </div>
          <div className="rec-row">
            <span>− Despesas</span>
            <span className="red">−{formatCurrency(rec.totalExpenses)}</span>
          </div>
          <div className="rec-row">
            <span>− Investimentos</span>
            <span className="red">−{formatCurrency(rec.totalInvestments)}</span>
          </div>
          <div className="rec-row">
            <span>− Transferências saída</span>
            <span className="red">−{formatCurrency(rec.totalTransfers)}</span>
          </div>
          <div className="rec-divider" />
          <div className="rec-row rec-row-total">
            <span>Saldo esperado</span>
            <strong>{formatCurrency(rec.expectedClosingBalance)}</strong>
          </div>
        </div>
      </Card>

      {/* Comparação com saldo real */}
      <Card>
        <CardHeader title="Comparação com banco" />
        <div className="rec-comparison">
          <div className="rec-comp-item">
            <span className="rec-comp-label">Saldo esperado</span>
            <span className="rec-comp-value neutral">{formatCurrency(rec.expectedClosingBalance)}</span>
          </div>
          <div className="rec-comp-sep">vs</div>
          <div className="rec-comp-item">
            <span className="rec-comp-label">Saldo real (banco)</span>
            <span className={`rec-comp-value ${hasDiff ? 'red' : 'green'}`}>
              {formatCurrency(rec.informedClosingBalance)}
            </span>
          </div>
        </div>
        {hasDiff && (
          <div className="rec-reason">
            <span>ℹ️</span>
            <span>{rec.divergenceReason}</span>
          </div>
        )}
      </Card>

      {/* Lançamentos pendentes de revisão */}
      {pendingTxs.length > 0 && (
        <Card>
          <CardHeader
            title="Lançamentos para revisar"
            subtitle={`${pendingTxs.length} item(s) pendente(s)`}
          />
          <ul className="rec-tx-list">
            {pendingTxs.map((t) => (
              <li key={t.id} className="rec-tx-item">
                <span className="rec-tx-icon">
                  {t.status === 'needs_review' ? '⚠️' : '🕐'}
                </span>
                <div className="rec-tx-info">
                  <span className="rec-tx-desc">{t.description}</span>
                  <span className="rec-tx-date">{t.date}</span>
                </div>
                <span className={`rec-tx-value ${t.type === 'income' ? 'green' : 'red'}`}>
                  {t.type === 'income' ? '+' : '−'}{formatCurrency(t.amount)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Ação */}
      {!hasDiff ? (
        <div className="rec-done-msg">
          ✅ Tudo certo! Sua conta está totalmente reconciliada.
        </div>
      ) : (
        <button className="rec-action-btn">
          Iniciar reconciliação manual
        </button>
      )}
    </div>
  )
}
