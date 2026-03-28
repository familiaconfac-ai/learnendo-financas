import { NavLink, useNavigate } from 'react-router-dom'
import { logoutUser } from '../../firebase/auth'
import './BottomNav.css'

const NAV_ITEMS = [
  { to: '/dashboard',   label: 'Início',    icon: '🏠' },
  { to: '/lancar',      label: 'Lançar',    icon: '➕' },
  { to: '/orcamento',   label: 'Orçamento', icon: '📊' },
  { to: '/familia',     label: 'Família',   icon: '👨‍👩‍👧‍👦' },
  { to: '/perfil',      label: 'Perfil',    icon: '👤' },
]

export default function BottomNav() {
  const navigate = useNavigate()

  async function handleLogout() {
    await logoutUser()
    navigate('/login')
  }

  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `bottom-nav-item${isActive ? ' active' : ''}`
          }
        >
          <span className="bottom-nav-icon">{item.icon}</span>
          <span className="bottom-nav-label">{item.label}</span>
        </NavLink>
      ))}
      <button className="bottom-nav-item bottom-nav-logout" onClick={handleLogout}>
        <span className="bottom-nav-icon">🚪</span>
        <span className="bottom-nav-label">Sair</span>
      </button>
    </nav>
  )
}

