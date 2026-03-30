import MonthSelector from '../../components/ui/MonthSelector'
import Card, { CardHeader } from '../../components/ui/Card'
import { SummaryCard } from '../../components/ui/Card'
import { formatCurrency } from '../../utils/formatCurrency'
import { useFinance } from '../../context/FinanceContext'
import { useDashboard } from '../../hooks/useDashboard'
import { useBudget } from '../../hooks/useBudget'
import './Mensal.css'

const MONTH_NAMES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
]

export default function Mensal() {
  const { selectedMonth, selectedYear } = useFinance()
  const { summary, loading: loadingSummary, error: summaryError } = useDashboard(selectedYear, selectedMonth)
  const { budgetItems, totalBudgeted, totalSpent, loading: loadingBudget, error: budgetError } =
    useBudget(selectedYear, selectedMonth)

  const budget = {
    categories: budgetItems.map((item) => ({
      id: item.id,
      name: item.categoryName,
      budgeted: Number(item.plannedAmount || 0),
      spent: Number(item.spent || 0),
    })),
    totalBudgeted,
    totalSpent,
  }

  const saldo = summary?.saldo ?? 0
  const isLoading = loadingSummary || loadingBudget
  const error = summaryError || budgetError

  return (
    <div className="mensal-page">
      <MonthSelector />

      <div className="mensal-content">
        {isLoading && <p>Carregando resumo mensal…</p>}
        {error && <p>Erro ao carregar: {error}</p>}

        {!isLoading && !error && (
          <>
        {/* Resumo */}
        <div className="summary-grid">
          <SummaryCard label="Receitas"     value={formatCurrency(summary.receitas)}      icon="📈" color="success" />
          <SummaryCard label="Despesas"     value={formatCurrency(summary.despesas)}      icon="📉" color="danger" />
          <SummaryCard label="Investimentos" value={formatCurrency(summary.investimentos)} icon="🏦" color="warning" />
          <SummaryCard label="Saldo"        value={formatCurrency(saldo)}                icon="💰" color={saldo >= 0 ? 'primary' : 'danger'} />
        </div>

        {/* Orçado x Realizado por categoria */}
        <Card>
          <CardHeader title="Orçado x Realizado" />
          <table className="budget-table">
            <thead>
              <tr>
                <th>Categoria</th>
                <th className="text-right">Orçado</th>
                <th className="text-right">Realizado</th>
                <th className="text-right">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {budget.categories.map((cat) => {
                const diff = cat.budgeted - cat.spent
                return (
                  <tr key={cat.id}>
                    <td>{cat.name}</td>
                    <td className="text-right">{formatCurrency(cat.budgeted)}</td>
                    <td className="text-right">{formatCurrency(cat.spent)}</td>
                    <td className={`text-right ${diff >= 0 ? 'text-success' : 'text-danger'}`}>
                      {formatCurrency(Math.abs(diff))} {diff >= 0 ? '✓' : '↑'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Total</strong></td>
                <td className="text-right"><strong>{formatCurrency(budget.totalBudgeted)}</strong></td>
                <td className="text-right"><strong>{formatCurrency(budget.totalSpent)}</strong></td>
                <td className={`text-right ${budget.totalBudgeted - budget.totalSpent >= 0 ? 'text-success' : 'text-danger'}`}>
                  <strong>{formatCurrency(Math.abs(budget.totalBudgeted - budget.totalSpent))}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>
          </>
        )}
      </div>
    </div>
  )
}
