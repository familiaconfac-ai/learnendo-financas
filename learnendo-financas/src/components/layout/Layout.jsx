import { Outlet } from 'react-router-dom'
import Header from './Header'
import BottomNav from './BottomNav'
import { useFinance } from '../../context/FinanceContext'
import { useLocation } from 'react-router-dom'
import './Layout.css'

// Páginas que exibem o seletor de mês no header
const MONTH_NAV_PAGES = ['/lancar', '/lancamentos', '/mensal', '/orcamento', '/relatorios']

export default function Layout() {
  const { selectedMonth, selectedYear } = useFinance()
  const { pathname } = useLocation()

  const showMonthNav = MONTH_NAV_PAGES.includes(pathname)

  return (
    <div className="app-layout">
      <Header
        selectedMonth={selectedMonth}
        selectedYear={selectedYear}
        showMonthNav={showMonthNav}
      />
      <main className="app-main">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
