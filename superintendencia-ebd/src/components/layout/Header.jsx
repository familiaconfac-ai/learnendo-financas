import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import HamburgerMenu from './HamburgerMenu'
import './Header.css'

const PAGE_TITLES = {
  '/dashboard': 'Dashboard',
  '/alunos': 'Alunos',
  '/professores': 'Professores',
  '/classes': 'Classes',
  '/matriculas': 'Matrículas',
  '/caderneta': 'Caderneta Mensal',
  '/comunicacao': 'Comunicação',
  '/relatorios': 'Relatórios',
  '/materiais': 'Materiais',
  '/configuracoes': 'Configurações',
  '/perfil': 'Perfil',
}

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, profile, role } = useAuth()

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
            <>
              <h1 className="header-title">{title}</h1>
              <span className="header-role-badge">{role === 'admin' ? 'ADMIN' : 'TEACHER'}</span>
            </>
          ) : (
            <div className="header-brand">
              <img src="/logo.png" alt="Superintendência EBD" className="header-logo" />
              <span className="header-brand-name">Superintendência EBD</span>
            </div>
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
