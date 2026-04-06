import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import './BottomNav.css'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Inicio', icon: '🏠' },
  { to: '/lancar', label: 'Lancar', icon: '➕' },
  { to: '/importacao', label: 'Importacao', icon: '🏦' },
  { to: '/orcamento', label: 'Orcamento', icon: '📊' },
  { to: '/familia', label: 'Familia', icon: '👨‍👩‍👧‍👦' },
]

export default function BottomNav() {
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    if (!feedback) return undefined
    const timeoutId = window.setTimeout(() => setFeedback(''), 2200)
    return () => window.clearTimeout(timeoutId)
  }, [feedback])

  async function handleShare() {
    const url = window.location.origin
    const shareData = {
      title: 'Learnendo Financas',
      text: 'Conheca o Learnendo Financas',
      url,
    }

    try {
      if (navigator.share) {
        await navigator.share(shareData)
        return
      }

      await navigator.clipboard.writeText(url)
      setFeedback('Link copiado com sucesso')
    } catch (error) {
      if (error?.name === 'AbortError') return

      try {
        await navigator.clipboard.writeText(url)
        setFeedback('Link copiado com sucesso')
      } catch {
        setFeedback('Nao foi possivel compartilhar')
      }
    }
  }

  return (
    <>
      {feedback && <div className="bottom-nav-feedback">{feedback}</div>}
      <nav className="bottom-nav">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}
          >
            <span className="bottom-nav-icon">{item.icon}</span>
            <span className="bottom-nav-label">{item.label}</span>
          </NavLink>
        ))}

        <button
          type="button"
          className="bottom-nav-item bottom-nav-share"
          onClick={handleShare}
          aria-label="Compartilhar o app"
        >
          <span className="bottom-nav-icon">📤</span>
          <span className="bottom-nav-label">Share</span>
        </button>
      </nav>
    </>
  )
}
