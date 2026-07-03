import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { acceptWorkspaceInvite, getWorkspaceInviteByToken } from '../../services/workspaceService'
import './Auth.css'

const PENDING_WORKSPACE_INVITE_KEY = 'lf:pending-workspace-invite-token'

function savePendingInviteToken(token) {
  try {
    localStorage.setItem(PENDING_WORKSPACE_INVITE_KEY, token)
  } catch (_) {
    // Storage is optional for resuming the invite flow after login.
  }
}

function clearPendingInviteToken(token) {
  try {
    const currentToken = localStorage.getItem(PENDING_WORKSPACE_INVITE_KEY)
    if (!token || currentToken === token) {
      localStorage.removeItem(PENDING_WORKSPACE_INVITE_KEY)
    }
  } catch (_) {
    // Ignore storage failures during cleanup.
  }
}

export default function InviteAccept() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { user, loading } = useAuth()

  const [invite, setInvite] = useState(null)
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (token) savePendingInviteToken(token)
  }, [token])

  useEffect(() => {
    let cancelled = false

    async function loadInvite() {
      if (loading) return

      if (!user?.uid) {
        setInvite(null)
        setStatus('auth_required')
        setMessage('')
        return
      }

      try {
        const data = await getWorkspaceInviteByToken(token)
        if (cancelled) return

        if (!data) {
          setStatus('error')
          setMessage('Convite invalido.')
          return
        }

        if (data.expired) {
          setStatus('error')
          setMessage('Convite expirado.')
          return
        }

        if (data.status !== 'pending') {
          if (data.status === 'awaiting_confirmation' && data.acceptedBy === user.uid) {
            setInvite(data)
            setStatus('accepted')
            setMessage('Seu pedido de entrada ja foi enviado. Agora a familia precisa confirmar sua entrada.')
            return
          }

          if (data.status === 'accepted' && data.acceptedBy === user.uid) {
            clearPendingInviteToken(token)
            setInvite(data)
            setStatus('accepted')
            setMessage('Voce ja faz parte desta familia.')
            return
          }

          setStatus('error')
          setMessage('Este convite nao esta mais disponivel.')
          return
        }

        setInvite(data)
        setStatus('ready')
      } catch (err) {
        if (cancelled) return

        if (err?.code === 'permission-denied') {
          setInvite(null)
          setStatus('auth_required')
          setMessage('')
          return
        }

        setStatus('error')
        setMessage(err.message)
      }
    }

    loadInvite()
    return () => { cancelled = true }
  }, [loading, token, user?.uid])

  async function handleAccept() {
    if (!user?.uid) return
    setStatus('processing')

    try {
      const workspaceId = await acceptWorkspaceInvite(user.uid, token)
      clearPendingInviteToken(token)
      setStatus('accepted')
      setMessage('Pedido enviado. Agora a familia precisa confirmar sua entrada.')
      setTimeout(() => navigate('/familia', { replace: true, state: { workspaceId } }), 600)
    } catch (err) {
      setStatus('error')
      setMessage(err.message)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-form">
        <h2 className="auth-title">Convite para familia</h2>

        {status === 'loading' && <p>Preparando convite...</p>}

        {status === 'auth_required' && (
          <>
            <p className="auth-link">
              Entre ou crie sua conta para continuar com este convite de familia.
            </p>
            <div className="invite-auth-actions">
              <Link className="invite-link-btn" to={`/login?next=/convite/${token}`}>Entrar</Link>
              <Link className="invite-link-btn" to={`/cadastro?next=/convite/${token}`}>Criar conta</Link>
            </div>
          </>
        )}

        {status === 'ready' && (
          <>
            <p className="auth-link">
              Papel sugerido: <strong>{invite?.role || 'membro'}</strong>
            </p>
            <button className="invite-link-btn" onClick={handleAccept}>
              Solicitar entrada
            </button>
          </>
        )}

        {status === 'processing' && <p>Aceitando convite...</p>}
        {status === 'accepted' && <p>{message}</p>}

        {status === 'error' && (
          <div className="auth-error">
            {message || 'Nao foi possivel validar o convite.'}
          </div>
        )}
      </div>
    </div>
  )
}
