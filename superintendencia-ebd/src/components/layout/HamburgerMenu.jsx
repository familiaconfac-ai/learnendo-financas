import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { logoutUser } from '../../firebase/auth'
import './HamburgerMenu.css'

const MENU_LINKS = [
  { to: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { to: '/alunos', label: 'Alunos', icon: '👥' },
  { to: '/professores', label: 'Professores', icon: '🧑‍🏫' },
  { to: '/classes', label: 'Classes', icon: '🏫' },
  { to: '/matriculas', label: 'Matrículas EBD', icon: '🧾' },
  { to: '/caderneta', label: 'Caderneta Mensal', icon: '📒' },
  { to: '/comunicacao', label: 'Comunicação', icon: '💬' },
  { to: '/relatorios', label: 'Relatórios', icon: '📊' },
  { to: '/materiais', label: 'Materiais', icon: '📚' },
  { to: '/configuracoes', label: 'Configurações', icon: '⚙️' },
  { to: '/perfil', label: 'Perfil', icon: '👤' },
]

export default function HamburgerMenu({ isOpen, onClose }) {
  const navigate = useNavigate()
  const { profile, role, canManageStructure } = useAuth()
  const links = canManageStructure
    ? MENU_LINKS
    : MENU_LINKS.filter((item) => !['/alunos', '/professores', '/matriculas', '/configuracoes'].includes(item.to))

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
            <img src="/logo.png" alt="EBD" className="menu-logo-img" />
            Superintendência EBD
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
              <div className="menu-user-role">Perfil: {role === 'admin' ? 'Administrador' : 'Professor'}</div>
            </div>
          </div>
        )}

        <nav className="menu-links">
          {links.map((link) => (
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
