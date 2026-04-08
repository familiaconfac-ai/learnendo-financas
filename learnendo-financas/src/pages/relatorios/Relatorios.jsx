import { useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import MonthSelector from '../../components/ui/MonthSelector'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { useFinance } from '../../context/FinanceContext'
import { useDashboard } from '../../hooks/useDashboard'
import { useBudget } from '../../hooks/useBudget'
import { useTransactions } from '../../hooks/useTransactions'
import { generateMonthlyPDF } from '../../services/pdfService'
import { formatCurrency } from '../../utils/formatCurrency'
import { buildReceiptBudgetImportanceBreakdown } from '../../utils/financeCalculations'
import { getReceiptImportanceLabel } from '../../utils/receiptDetailCatalog'
import './Relatorios.css'

const REPORT_TYPES = ['Mensal', 'Por Categoria', 'Orcado x Realizado', 'Compras detalhadas']
const IMPORTANCE_ORDER = ['essential', 'necessary', 'superfluous']

export default function Relatorios() {
  const { selectedMonth, selectedYear } = useFinance()
  const [activeReport, setActiveReport] = useState('Mensal')
  const [loadingPDF, setLoadingPDF] = useState(false)

  const { summary } = useDashboard(selectedYear, selectedMonth)
  const { budgetItems, totalBudgeted, totalSpent } = useBudget(selectedYear, selectedMonth)
  const { transactions } = useTransactions(selectedYear, selectedMonth)

  const budget = {
    categories: budgetItems.map((item) => ({
      name: item.categoryName,
      budgeted: Number(item.plannedAmount || 0),
      spent: Number(item.spent || 0),
    })),
    totalBudgeted,
    totalSpent,
  }

  const barData = budget.categories.map((category) => ({
    name: category.name.length > 10 ? `${category.name.slice(0, 10)}...` : category.name,
    Orcado: category.budgeted,
    Realizado: category.spent,
  }))

  const receiptBreakdown = buildReceiptBudgetImportanceBreakdown(
    transactions,
    `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`,
  )
  const importanceCards = IMPORTANCE_ORDER.map((key) => ({
    key,
    label: getReceiptImportanceLabel(key),
    amount: receiptBreakdown.totalsByImportance[key] || 0,
  }))

  async function handleExportPDF() {
    setLoadingPDF(true)
    try {
      await generateMonthlyPDF({ summary, budget })
    } finally {
      setLoadingPDF(false)
    }
  }

  return (
    <div className="relatorios-page">
      <MonthSelector />

      <div className="report-tabs">
        {REPORT_TYPES.map((reportName) => (
          <button
            key={reportName}
            className={`report-tab${activeReport === reportName ? ' active' : ''}`}
            onClick={() => setActiveReport(reportName)}
          >
            {reportName}
          </button>
        ))}
      </div>

      <div className="relatorios-content">
        {activeReport === 'Mensal' && (
          <Card>
            <CardHeader title="Resumo mensal" />
            <div className="report-row"><span>Receitas</span><strong className="text-success">{formatCurrency(summary.receitas)}</strong></div>
            <div className="report-row"><span>Despesas</span><strong className="text-danger">{formatCurrency(summary.despesas)}</strong></div>
            <div className="report-row"><span>Investimentos</span><strong className="text-warning">{formatCurrency(summary.investimentos)}</strong></div>
            <div className="report-row report-row--total">
              <span>Saldo final</span>
              <strong className={summary.saldo >= 0 ? 'text-success' : 'text-danger'}>
                {formatCurrency(summary.saldo)}
              </strong>
            </div>
          </Card>
        )}

        {activeReport === 'Por Categoria' && (
          <Card>
            <CardHeader title="Gastos por categoria" />
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Bar dataKey="Realizado" fill="#1a56db" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {activeReport === 'Orcado x Realizado' && (
          <Card>
            <CardHeader title="Orcado x Realizado" />
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Orcado" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Realizado" fill="#1a56db" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {activeReport === 'Compras detalhadas' && (
          <Card>
            <CardHeader title="Compras detalhadas do mes" />
            {receiptBreakdown.totalDetailed > 0 ? (
              <>
                <div className="importance-summary">
                  {importanceCards.map((item) => (
                    <div key={item.key} className={`importance-card importance-card--${item.key}`}>
                      <span>{item.label}</span>
                      <strong>{formatCurrency(item.amount)}</strong>
                    </div>
                  ))}
                </div>

                <div className="receipt-breakdown-list">
                  {receiptBreakdown.categories.map((category) => (
                    <div key={category.key} className="receipt-breakdown-item">
                      <div className="receipt-breakdown-header">
                        <strong>{category.name}</strong>
                        <strong>{formatCurrency(category.total)}</strong>
                      </div>
                      <div className="receipt-breakdown-grid">
                        {importanceCards.map((item) => (
                          <div key={`${category.key}-${item.key}`} className="receipt-breakdown-chip">
                            <span>{item.label}</span>
                            <strong>{formatCurrency(category[item.key] || 0)}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="report-empty">
                Confirme cupons detalhados neste mes para enxergar supermercado, transporte e outras categorias separadas por perfil de compra.
              </p>
            )}
          </Card>
        )}

        <Button variant="secondary" fullWidth loading={loadingPDF} onClick={handleExportPDF}>
          Exportar PDF
        </Button>
      </div>
    </div>
  )
}
