import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useFinancialSessionInviteNotifications } from '../../hooks/useFinancialSessionInviteNotifications'
import HamburgerMenu from './HamburgerMenu'
import './Header.css'

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const PAGE_TITLES = {
  '/lancar': 'Lancar',
  '/lancamentos': 'Lancamentos',
  '/contas': 'Contas',
  '/importacao': 'Cupom',
  '/orcamento': 'Orcamento',
  '/mensal': 'Visao Mensal',
  '/relatorios': 'Relatorios',
  '/dividas': 'Dividas',
  '/reunioes': 'Reunioes',
  '/reconciliacao': 'Reconciliacao',
  '/familia': 'Familia',
  '/perfil': 'Perfil',
  '/admin': 'Painel Admin',
}

export default function Header({ selectedMonth, selectedYear, showMonthNav }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { sessionsCount, hasPendingInvites } = useFinancialSessionInviteNotifications()

  const title = location.pathname.startsWith('/reunioes/sessao/')
    ? 'Sessao Financeira'
    : (PAGE_TITLES[location.pathname] ?? '')

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
              <img src="/logo.jpg" alt="Learnendo Financas" className="header-logo" />
              <span className="header-brand-name">Learnendo Financas</span>
            </div>
          )}
          {showMonthNav && (
            <span className="header-month">
              {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
            </span>
          )}
        </div>

        <div className="header-actions">
          <button
            className={`header-meetings-btn${hasPendingInvites ? ' has-badge' : ''}`}
            onClick={() => navigate('/reunioes')}
            aria-label="Abrir reunioes"
          >
            <span className="header-meetings-icon">🎥</span>
            {hasPendingInvites && <span className="header-notification-badge">{sessionsCount}</span>}
          </button>

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
        </div>
      </header>

      <HamburgerMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  )
}
