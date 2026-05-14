import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { subscribePendingFinancialSessionInvites } from '../services/financialSessionInvitesService'

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase()
}

export function useFinancialSessionInviteNotifications() {
  const { user } = useAuth()
  const [incomingInvites, setIncomingInvites] = useState([])
  const currentEmail = normalizeEmail(user?.email)

  useEffect(() => {
    return subscribePendingFinancialSessionInvites(
      currentEmail,
      (nextInvites) => setIncomingInvites(nextInvites),
      () => setIncomingInvites([]),
    )
  }, [currentEmail])

  const sessionsCount = useMemo(() => {
    const uniqueSessions = new Set(
      incomingInvites.map((invite) => `${invite.workspaceId}:${invite.sessionId}`),
    )
    return uniqueSessions.size
  }, [incomingInvites])

  return {
    incomingInvites,
    sessionsCount,
    hasPendingInvites: sessionsCount > 0,
  }
}
