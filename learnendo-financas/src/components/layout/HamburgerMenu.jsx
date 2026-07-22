import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { logoutUser } from '../../firebase/auth'
import './HamburgerMenu.css'

const MENU_LINKS = [
  { to: '/dashboard', label: 'Dashboard', icon: '\u{1F3E0}' },
  { to: '/importacao', label: 'Cupom', icon: '\u{1F9FE}' },
  { to: '/lancar', label: 'Lan\u00e7ar', icon: '\u2795' },
  { to: '/lancamentos', label: 'Lan\u00e7amentos', icon: '\u{1F4DD}' },
  { to: '/dividas', label: 'D\u00edvidas', icon: '\u{1F4C9}' },
  { to: '/extrato', label: 'Extrato', icon: '\u{1F4C4}' },
  { to: '/reconciliacao', label: 'Reconcilia\u00e7\u00e3o', icon: '\u{1F50D}' },
  { to: '/orcamento', label: 'Or\u00e7amento', icon: '\u{1F4B0}' },
  { to: '/mensal', label: 'Vis\u00e3o Mensal', icon: '\u{1F4C6}' },
  { to: '/relatorios', label: 'Relat\u00f3rios', icon: '\u{1F4CA}' },
  { to: '/familia', label: 'Fam\u00edlia', icon: '\u{1F3E1}' },
  { to: '/perfil', label: 'Perfil', icon: '\u{1F464}' },
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
            Learnendo Finan\u00e7as
          </div>
          <button className="menu-close-btn" onClick={onClose} aria-label="Fechar menu">
            {'\u2715'}
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
              <span className="menu-link-label">{link.label}</span>
            </button>
          ))}
        </nav>

        <div className="menu-footer">
          <button className="menu-logout-btn" onClick={handleLogout}>
            {'\u{1F6AA}'} Sair
          </button>
        </div>
      </aside>
    </>
  )
}
