import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useFinancialSessionInviteNotifications } from '../../hooks/useFinancialSessionInviteNotifications'
import {
  getActiveFinancialSessionBridge,
  subscribeActiveFinancialSessionBridge,
} from '../../services/financialSessionBridgeService'
import HamburgerMenu from './HamburgerMenu'
import './Header.css'

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Mar\u00e7o', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const PAGE_TITLES = {
  '/lancar': 'Lan\u00e7ar',
  '/lancamentos': 'Lan\u00e7amentos',
  '/contas': 'Contas',
  '/importacao': 'Cupom',
  '/orcamento': 'Or\u00e7amento',
  '/mensal': 'Vis\u00e3o Mensal',
  '/relatorios': 'Relat\u00f3rios',
  '/dividas': 'D\u00edvidas',
  '/reunioes': 'Reuni\u00f5es',
  '/reconciliacao': 'Reconcilia\u00e7\u00e3o',
  '/familia': 'Fam\u00edlia',
  '/perfil': 'Perfil',
  '/admin': 'Painel Admin',
}

export default function Header({ selectedMonth, selectedYear, showMonthNav }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [hasActiveSession, setHasActiveSession] = useState(() => !!getActiveFinancialSessionBridge())
  const location = useLocation()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { sessionsCount, hasPendingInvites } = useFinancialSessionInviteNotifications()

  useEffect(() => (
    subscribeActiveFinancialSessionBridge((nextSession) => {
      setHasActiveSession(!!nextSession)
    })
  ), [])

  const title = location.pathname.startsWith('/reunioes/sessao/')
    ? 'Sess\u00e3o Financeira'
    : (PAGE_TITLES[location.pathname] ?? '')

  return (
    <>
      <header className="app-header">
        <button
          className="hamburger-btn"
          onClick={() => setMenuOpen(true)}
          aria-label="Abrir menu"
        >
          <span className="hamburger-icon">{'\u2630'}</span>
        </button>

        <div className="header-center">
          {title ? (
            <h1 className="header-title">{title}</h1>
          ) : (
            <div className="header-brand">
              <img src="/logo.jpg" alt="Learnendo Finan\u00e7as" className="header-logo" />
              <span className="header-brand-name">Learnendo Finan\u00e7as</span>
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
            className={`header-meetings-btn${hasPendingInvites || hasActiveSession ? ' has-badge' : ''}`}
            onClick={() => navigate('/reunioes')}
            aria-label="Abrir reuni\u00f5es"
          >
            <span className="header-meetings-icon">{'\u{1F4F9}'}</span>
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
              profile?.displayName?.[0]?.toUpperCase()
              ?? user?.email?.[0]?.toUpperCase()
              ?? 'U'
            )}
          </button>
        </div>
      </header>

      <HamburgerMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  )
}
