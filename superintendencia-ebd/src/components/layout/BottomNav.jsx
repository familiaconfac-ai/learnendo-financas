import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { logoutUser } from '../../firebase/auth'
import './BottomNav.css'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Início', icon: '🏠' },
  { to: '/alunos', label: 'Alunos', icon: '👥' },
  { to: '/professores', label: 'Professores', icon: '🧑‍🏫' },
  { to: '/matriculas', label: 'Matrículas', icon: '🧾' },
  { to: '/caderneta', label: 'Caderneta', icon: '📒' },
  { to: '/perfil', label: 'Perfil', icon: '👤' },
]

export default function BottomNav() {
  const navigate = useNavigate()
  const { canManageStructure } = useAuth()
  const items = canManageStructure
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => !['/alunos', '/professores', '/matriculas'].includes(item.to))

  async function handleLogout() {
    await logoutUser()
    navigate('/login')
  }

  return (
    <nav className="bottom-nav">
      {items.map((item) => (
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

