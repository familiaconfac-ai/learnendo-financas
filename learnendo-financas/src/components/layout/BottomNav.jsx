import { NavLink } from 'react-router-dom'
import './BottomNav.css'

const NAV_ITEMS = [
  { to: '/dashboard',   label: 'Início',    icon: '🏠' },
  { to: '/lancamentos', label: 'Lançar',    icon: '➕' },
  { to: '/importacao',  label: 'Importar',  icon: '📥' },
  { to: '/orcamento',   label: 'Orçamento', icon: '📊' },
  { to: '/familia',     label: 'Família',   icon: '👨‍👩‍👧‍👦' },
  { to: '/perfil',      label: 'Perfil',    icon: '👤' },
]

export default function BottomNav() {
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
    </nav>
  )
}

