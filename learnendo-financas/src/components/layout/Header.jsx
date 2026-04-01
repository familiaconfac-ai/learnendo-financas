import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import HamburgerMenu from './HamburgerMenu'
import './Header.css'

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const PAGE_TITLES = {
  '/lancar': 'Lançar',
  '/lancamentos': 'Lançamentos',
  '/contas': 'Contas',
  '/orcamento': 'Orçamento',
  '/mensal': 'Visão Mensal',
  '/relatorios': 'Relatórios',
  '/dividas': 'Dívidas',
  '/reconciliacao': 'Reconciliação',
  '/perfil': 'Perfil',
  '/admin': 'Painel Admin',
}

export default function Header({ selectedMonth, selectedYear, showMonthNav }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, profile } = useAuth()

  const title = PAGE_TITLES[location.pathname] ?? ''

  return (
    <>
      <header className="app-header">
        <button
          className="hamburger-btn"
          onClick={() => setMenuOpen(true)}
          aria-label="Abrir menu"
        >
          <span className="hamburger-icon">☰</span>
        </button>

        <div className="header-center">
          {title ? (
            <h1 className="header-title">{title}</h1>
          ) : (
            <div className="header-brand">
              <img src="/logo.jpg" alt="Learnendo Finanças" className="header-logo" />
              <span className="header-brand-name">Learnendo Finanças</span>
            </div>
          )}
          {showMonthNav && (
            <span className="header-month">
              {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
            </span>
          )}
        </div>

        <button
          className="header-avatar"
          onClick={() => navigate('/perfil')}
          aria-label="Abrir perfil"
        >
          {profile?.photoURL || user?.photoURL ? (
            <img
              src={profile?.photoURL ?? user?.photoURL}
              alt="avatar"
              className="header-avatar-img"
            />
          ) : (
            profile?.displayName?.[0]?.toUpperCase() ??
            user?.email?.[0]?.toUpperCase() ??
            'U'
          )}
        </button>
      </header>

      <HamburgerMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  )
}
