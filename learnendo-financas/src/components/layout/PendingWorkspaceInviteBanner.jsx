import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { fetchPendingWorkspaceInvitesForEmail } from '../../services/workspaceService'
import './PendingWorkspaceInviteBanner.css'

export default function PendingWorkspaceInviteBanner() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [invite, setInvite] = useState(null)

  useEffect(() => {
    let active = true
    const email = user?.email || profile?.email || ''
    if (!email) {
      setInvite(null)
      return () => { active = false }
    }
    fetchPendingWorkspaceInvitesForEmail(email, user?.uid)
      .then((items) => { if (active) setInvite(items[0] || null) })
      .catch(() => { if (active) setInvite(null) })
    return () => { active = false }
  }, [profile?.email, user?.email, user?.uid])

  if (!invite) return null
  const waitingApproval = invite.status === 'awaiting_confirmation' && invite.acceptedBy === user?.uid
  return (
    <div className="workspace-invite-banner" role="status">
      <div>
        <strong>{waitingApproval ? 'Entrada aguardando aprovação' : 'Você recebeu um convite de família'}</strong>
        <span>{invite.workspaceName || 'Família'}{invite.role ? ` · papel ${invite.role}` : ''}</span>
      </div>
      <button type="button" onClick={() => navigate(waitingApproval ? '/familia' : `/convite/${invite.token}`)}>
        {waitingApproval ? 'Acompanhar' : 'Ver convite'}
      </button>
    </div>
  )
}
