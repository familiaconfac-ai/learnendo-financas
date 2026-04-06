import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { logoutUser } from '../../firebase/auth'
import './HamburgerMenu.css'

const MENU_LINKS = [
  { to: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { to: '/importacao', label: 'Importação', icon: '🏦' },
  { to: '/lancar', label: 'Lançar', icon: '➕' },
  { to: '/lancamentos', label: 'Lançamentos', icon: '📝' },
  { to: '/dividas', label: 'Dívidas', icon: '📉' },
  { to: '/reconciliacao', label: 'Reconciliação', icon: '🔍' },
  { to: '/orcamento', label: 'Orçamento', icon: '💰' },
  { to: '/mensal', label: 'Visão Mensal', icon: '📆' },
  { to: '/relatorios', label: 'Relatórios', icon: '📊' },
  { to: '/familia', label: 'Família', icon: '🏡' },
  { to: '/perfil', label: 'Perfil', icon: '👤' },
]

export default function HamburgerMenu({ isOpen, onClose }) {
  const navigate = useNavigate()
  const { profile } = useAuth()

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
            Learnendo Finanças
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
              {link.label}
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
