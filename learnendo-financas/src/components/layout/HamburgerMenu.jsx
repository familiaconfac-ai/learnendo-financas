import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useFinancialSessionInviteNotifications } from '../../hooks/useFinancialSessionInviteNotifications'
import { logoutUser } from '../../firebase/auth'
import './HamburgerMenu.css'

const MENU_LINKS = [
  { to: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { to: '/importacao', label: 'Cupom', icon: '🧾' },
  { to: '/lancar', label: 'Lancar', icon: '➕' },
  { to: '/lancamentos', label: 'Lancamentos', icon: '📝' },
  { to: '/dividas', label: 'Dividas', icon: '📉' },
  { to: '/reunioes', label: 'Reunioes', icon: '🎥' },
  { to: '/reconciliacao', label: 'Reconciliacao', icon: '🔍' },
  { to: '/orcamento', label: 'Orcamento', icon: '💰' },
  { to: '/mensal', label: 'Visao Mensal', icon: '📆' },
  { to: '/relatorios', label: 'Relatorios', icon: '📊' },
  { to: '/familia', label: 'Familia', icon: '🏡' },
  { to: '/perfil', label: 'Perfil', icon: '👤' },
]

export default function HamburgerMenu({ isOpen, onClose }) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { sessionsCount, hasPendingInvites } = useFinancialSessionInviteNotifications()

  async function handleLogout() {
    await logoutUser()
    navigate('/login')
  }

  function handleNav(to) {
    navigate(to)
    onClose()
  }

  return (
    <>
      <div
        className={`menu-overlay${isOpen ? ' visible' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={`hamburger-menu${isOpen ? ' open' : ''}`}>
        <div className="menu-header">
          <div className="menu-logo">
            <img src="/logo.jpg" alt="Learnendo" className="menu-logo-img" />
            Learnendo Financas
          </div>
          <button className="menu-close-btn" onClick={onClose} aria-label="Fechar menu">
            ✕
          </button>
        </div>

        {profile && (
          <div className="menu-user">
            <div className="menu-user-avatar">
              {profile.displayName?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div>
              <div className="menu-user-name">{profile.displayName}</div>
              <div className="menu-user-email">{profile.email}</div>
              {hasPendingInvites && (
                <div className="menu-user-alert">
                  {sessionsCount} convite(s) de sessao esperando por voce
                </div>
              )}
            </div>
          </div>
        )}

        <nav className="menu-links">
          {MENU_LINKS.map((link) => (
            <button
              key={link.to}
              className="menu-link"
              onClick={() => handleNav(link.to)}
            >
              <span className="menu-link-icon">{link.icon}</span>
              <span className="menu-link-label">{link.label}</span>
              {link.to === '/reunioes' && hasPendingInvites && (
                <span className="menu-link-badge">{sessionsCount}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="menu-footer">
          <button className="menu-logout-btn" onClick={handleLogout}>
            🚪 Sair
          </button>
        </div>
      </aside>
    </>
  )
}
