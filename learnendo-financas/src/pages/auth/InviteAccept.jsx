import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { acceptWorkspaceInvite, getWorkspaceInviteByToken } from '../../services/workspaceService'
import './Auth.css'

export default function InviteAccept() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { user, loading } = useAuth()

  const [invite, setInvite] = useState(null)
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadInvite() {
      try {
        const data = await getWorkspaceInviteByToken(token)
        if (cancelled) return
        if (!data) {
          setStatus('error')
          setMessage('Convite inválido.')
          return
        }
        if (data.expired) {
          setStatus('error')
          setMessage('Convite expirado.')
          return
        }
        setInvite(data)
        setStatus('ready')
      } catch (err) {
        if (!cancelled) {
          setStatus('error')
          setMessage(err.message)
        }
      }
    }
    loadInvite()
    return () => { cancelled = true }
  }, [token])

  async function handleAccept() {
    if (!user?.uid) return
    setStatus('processing')
    try {
      const workspaceId = await acceptWorkspaceInvite(user.uid, token)
      setStatus('accepted')
      setMessage('Convite aceito com sucesso!')
      setTimeout(() => navigate('/familia', { replace: true, state: { workspaceId } }), 600)
    } catch (err) {
      setStatus('error')
      setMessage(err.message)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-form">
        <h2 className="auth-title">Convite para workspace</h2>

        {status === 'loading' && <p>Validando convite…</p>}

        {status === 'ready' && (
          <>
            <p className="auth-link">
              Papel sugerido: <strong>{invite?.role || 'membro'}</strong>
            </p>
            {!loading && !user && (
              <div className="invite-auth-actions">
                <Link className="invite-link-btn" to={`/login?next=/convite/${token}`}>Entrar</Link>
                <Link className="invite-link-btn" to={`/cadastro?next=/convite/${token}`}>Criar conta</Link>
              </div>
            )}
            {!loading && user && (
              <button className="invite-link-btn" onClick={handleAccept}>
                Aceitar convite
              </button>
            )}
          </>
        )}

        {status === 'processing' && <p>Aceitando convite…</p>}
        {status === 'accepted' && <p>{message}</p>}

        {status === 'error' && (
          <div className="auth-error">
            {message || 'Não foi possível validar o convite.'}
          </div>
        )}
      </div>
    </div>
  )
}
