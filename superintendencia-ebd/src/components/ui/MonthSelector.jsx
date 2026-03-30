import './MonthSelector.css'
import { useFinance } from '../../context/FinanceContext'

const MONTH_NAMES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
]

export default function MonthSelector() {
  const { selectedMonth, selectedYear, goToPreviousMonth, goToNextMonth } = useFinance()

  return (
    <div className="month-selector">
      <button className="month-btn" onClick={goToPreviousMonth} aria-label="Mês anterior">‹</button>
      <span className="month-label">
        {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
      </span>
      <button className="month-btn" onClick={goToNextMonth} aria-label="Próximo mês">›</button>
    </div>
  )
}
