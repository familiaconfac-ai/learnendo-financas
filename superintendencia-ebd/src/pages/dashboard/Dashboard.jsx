import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useFinance } from '../../context/FinanceContext'
import { SummaryCard } from '../../components/ui/Card'
import Card, { CardHeader } from '../../components/ui/Card'
import { formatCurrency } from '../../utils/formatCurrency'
import { MOCK_CARDS, MOCK_FAMILY, MOCK_FAMILY_SUMMARY } from '../../utils/mockData'
import { useDashboard } from '../../hooks/useDashboard'
import './Dashboard.css'

const ORIGIN_LABEL = {
  manual:              { label: 'manual',  color: '#6b7280' },
  bank_import:         { label: 'banco',   color: '#1a56db' },
  credit_card_import:  { label: 'cartão',  color: '#8b5cf6' },
}

const TYPE_ICON = {
  income:     '📈',
  expense:    '📉',
  investment: '📊',
  transfer:   '↔️',
  adjustment: '🔧',
}

const SCOPE_LABEL = {
  personal: { label: 'pessoal',    icon: '👤', cls: 'scope-personal'  },
  family:   { label: 'familiar',   icon: '🏡', cls: 'scope-family'    },
  shared:   { label: 'compartilhado', icon: '🤝', cls: 'scope-shared' },
}

export default function Dashboard() {
  const { profile } = useAuth()
  const { selectedMonth, selectedYear } = useFinance()
  const navigate = useNavigate()

  // Dados reais do Firestore via useDashboard
  const { summary: liveSummary, loading: summaryLoading } = useDashboard(selectedYear, selectedMonth)

  // Estado zero enquanto carrega — evita tela em branco
  const ZERO = { scope: 'personal', ownerName: '', receitas: 0, despesas: 0, investimentos: 0,
    saldo: 0, orcado: 6000, pendingCount: 0, reconciled: false, recentTransactions: [] }
  const summary = liveSummary ?? ZERO

  // Cartões ainda usam mock (ainda não no Firestore)
  const totalCardInvoices = MOCK_CARDS.reduce((s, c) => s + c.currentInvoice, 0)
  const familySummary = MOCK_FAMILY_SUMMARY
  const scopeMeta = SCOPE_LABEL[summary.scope] ?? SCOPE_LABEL.personal
  const budgetRatio = summary.orcado > 0 ? (summary.despesas / summary.orcado) : 0

  const firstName = profile?.displayName?.split(' ')[0] ?? 'Usuário'

  return (
    <div className="dashboard-page">
      <div className="dashboard-greeting">
        <span>Olá, <strong>{firstName}</strong> 👋</span>
        <span className="dashboard-period">
          {summaryLoading && <span className="summary-loading-dot" title="Carregando…">⟳ </span>}
          {new Date(selectedYear, selectedMonth - 1).toLocaleString('pt-BR', {
            month: 'long', year: 'numeric',
          })}
        </span>
      </div>

      {/* Pill de escopo (pessoal / familiar) */}
      <div className="scope-row">
        <span className={`scope-pill ${scopeMeta.cls}`}>
          {scopeMeta.icon} Visão {scopeMeta.label}
        </span>
        <span className="scope-owner">{summary.ownerName}</span>
      </div>

      {/* Cards de resumo — linha 1 */}
      <div className="summary-grid">
        <SummaryCard
          label="Saldo do mês"
          value={formatCurrency(summary.saldo)}
          icon="💰"
          color={summary.saldo >= 0 ? 'primary' : 'danger'}
        />
        <SummaryCard
          label="Receitas"
          value={formatCurrency(summary.receitas)}
          icon="📈"
          color="success"
        />
        <SummaryCard
          label="Despesas"
          value={formatCurrency(summary.despesas)}
          icon="📉"
          color="danger"
        />
        <SummaryCard
          label="Investido"
          value={formatCurrency(summary.investimentos)}
          icon="📊"
          color="warning"
        />
      </div>

      {/* Prioridade 2 — Revisar Lançamentos (card de alerta, sempre visível) */}
      <div
        className={`review-alert-card${summary.pendingCount > 0 ? ' review-alert-card--active' : ' review-alert-card--ok'}`}
        onClick={() => navigate('/lancar')}
        role="button"
        tabIndex={0}
      >
        <span className="rac-icon">{summary.pendingCount > 0 ? '🔍' : '✔️'}</span>
        <div className="rac-info">
          <span className="rac-title">Revisar Lançamentos</span>
          <span className="rac-sub">
            {summary.pendingCount > 0
              ? `${summary.pendingCount} ${summary.pendingCount === 1 ? 'item aguarda' : 'itens aguardam'} revisão`
              : 'Todos os lançamentos estão em dia'}
          </span>
        </div>
        {summary.pendingCount > 0 && (
          <span className="rac-badge">{summary.pendingCount}</span>
        )}
        <span className="rac-arrow">›</span>
      </div>

      {/* Prioridade 2 — Reconciliação (card escuro com estado colorido) */}
      <div
        className={`reconcile-highlight-card rh-${summary.reconciled ? 'ok' : 'pending'}`}
        onClick={() => navigate('/reconciliacao')}
        role="button"
        tabIndex={0}
      >
        <span className="rh-icon">{summary.reconciled ? '✅' : '⚠️'}</span>
        <div className="rh-info">
          <span className="rh-title">Reconciliação</span>
          <span className="rh-status">{summary.reconciled ? 'Conciliado' : 'Pendente'}</span>
        </div>
        <span className="rh-detail">
          {summary.reconciled ? 'Extrato e lançamentos conferem' : 'Verifique divergências'}
        </span>
        <span className="rh-arrow">›</span>
      </div>

      {/* Fatura do Cartão — removida do Dashboard; disponível para uso em tela futura */}
      {/* totalCardInvoices = {formatCurrency(totalCardInvoices)} — mantido calculado */}

      {/* Card rápido da família */}
      <div
        className="family-shortcut-card"
        onClick={() => navigate('/familia')}
        role="button"
        tabIndex={0}
      >
        <span className="fsc-icon">🏡</span>
        <div className="fsc-info">
          <span className="fsc-name">{MOCK_FAMILY.name}</span>
          <span className="fsc-meta">
            Receitas: {formatCurrency(familySummary.totalReceitas)} ·  Despesas: {formatCurrency(familySummary.totalDespesas)}
          </span>
        </div>
        <span className="fsc-arrow">›</span>
      </div>

      {/* Orçado x Realizado */}
      <Card className="dashboard-budget-card">
        <CardHeader title="Orçado x Realizado" subtitle="Despesas do mês" />
        <div className="budget-progress">
          <div className="budget-labels">
            <span>Realizado</span>
            <span>{formatCurrency(summary.despesas)} / {formatCurrency(summary.orcado)}</span>
          </div>
          <div className="budget-bar-track">
            <div
              className={`budget-bar-fill${summary.despesas > summary.orcado ? ' over' : ''}`}
              style={{ width: `${Math.min(budgetRatio * 100, 100)}%` }}
            />
          </div>
          <div className="budget-pct">
            {(budgetRatio * 100).toFixed(0)}% do orçamento utilizado
          </div>
        </div>
      </Card>

      {/* Últimos lançamentos */}
      <Card>
        <CardHeader title="Últimos lançamentos" />
        <ul className="recent-list">
          {summary.recentTransactions.map((t) => {
            const originMeta = ORIGIN_LABEL[t.origin] ?? { label: t.origin, color: '#6b7280' }
            const icon = TYPE_ICON[t.type] ?? '•'
            const isCredit = t.type === 'income'
            return (
              <li key={t.id} className="recent-item">
                <span className="recent-icon">{icon}</span>
                <div className="recent-info">
                  <span className="recent-desc">
                    {t.description}
                    {t.status === 'pending' && <span className="badge badge-info ml4">Pendente</span>}
                  </span>
                  <span className="recent-meta">
                    <span className="origin-badge" style={{ background: originMeta.color }}>
                      {originMeta.label}
                    </span>
                    <span className="recent-date">{t.date}</span>
                  </span>
                </div>
                <span className={`recent-value ${isCredit ? 'income' : 'expense'}`}>
                  {isCredit ? '+' : '-'}{formatCurrency(t.amount)}
                </span>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
