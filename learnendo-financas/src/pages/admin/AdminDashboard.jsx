import { useCallback, useEffect, useMemo, useState } from 'react'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { InlineLoading } from '../../components/ui/Loading'
import {
  backfillMissingUserCodes,
  countRecentlyActiveUsers,
  fetchAdminUsers,
} from '../../services/adminService'
import './AdminDashboard.css'
import FinancialAuditPanel from './FinancialAuditPanel'

function toMillis(value) {
  if (!value) return 0
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

function formatDateTime(value) {
  const time = toMillis(value)
  if (!time) return 'Nunca'
  return new Date(time).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function accountStatus(user) {
  const lastAccess = toMillis(user.lastLoginAt || user.lastSeenAt)
  if (!lastAccess) return 'Sem acesso'
  const days = Math.floor((Date.now() - lastAccess) / (24 * 60 * 60 * 1000))
  if (days <= 7) return 'Ativo na semana'
  if (days <= 30) return 'Ativo no mes'
  return 'Sem acesso recente'
}

export default function AdminDashboard() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadingPDF, setLoadingPDF] = useState(false)
  const [syncingCodes, setSyncingCodes] = useState(false)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const allUsers = await fetchAdminUsers()
      setUsers(allUsers)
    } catch (err) {
      console.error('[AdminDashboard] load error:', err.message)
      setError(err.message || 'Nao foi possivel carregar os usuarios.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  const nonAdminUsers = useMemo(
    () => users.filter((user) => user.role !== 'admin'),
    [users],
  )
  const usersMissingCode = useMemo(
    () => nonAdminUsers.filter((user) => !user.userNumber),
    [nonAdminUsers],
  )
  const recentUsers = useMemo(
    () => countRecentlyActiveUsers(nonAdminUsers, 30),
    [nonAdminUsers],
  )

  async function handleExportConsolidado() {
    setLoadingPDF(true)
    try {
      const { generateMonthlyPDF } = await import('../../services/pdfService')
      await generateMonthlyPDF({
        isAdmin: true,
        users: users.map((user) => ({
          ...user,
          monthlyReceitas: Number(user.monthlyReceitas || 0),
          monthlyDespesas: Number(user.monthlyDespesas || 0),
        })),
      })
    } finally {
      setLoadingPDF(false)
    }
  }

  async function handleSyncCodes() {
    setSyncingCodes(true)
    setError('')

    try {
      await backfillMissingUserCodes(usersMissingCode)
      await loadUsers()
    } catch (err) {
      console.error('[AdminDashboard] backfill error:', err.message)
      setError(err.message || 'Nao foi possivel gerar os numeros pendentes.')
    } finally {
      setSyncingCodes(false)
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-content">
        <Card className="admin-summary-card">
          <CardHeader title="Resumo geral" subtitle="Cadastros e acompanhamento do app" />
          <div className="admin-stat-row">
            <span>Pessoas cadastradas</span>
            <strong>{nonAdminUsers.length}</strong>
          </div>
          <div className="admin-stat-row">
            <span>Contas totais</span>
            <strong>{users.length}</strong>
          </div>
          <div className="admin-stat-row">
            <span>Ativos nos ultimos 30 dias</span>
            <strong>{recentUsers}</strong>
          </div>
          <div className="admin-stat-row">
            <span>Sem numero ainda</span>
            <strong>{usersMissingCode.length}</strong>
          </div>
        </Card>

        <Card>
          <CardHeader title="Acoes do admin" subtitle="Atualize a lista ou gere numeros pendentes" />
          <div className="admin-actions">
            <Button variant="secondary" onClick={loadUsers} loading={loading && users.length > 0}>
              Atualizar lista
            </Button>
            <Button
              variant="secondary"
              onClick={handleSyncCodes}
              loading={syncingCodes}
              disabled={usersMissingCode.length === 0}
            >
              Gerar numeros pendentes
            </Button>
          </div>
          {error && <div className="admin-error-box">{error}</div>}
        </Card>

        <Card>
          <CardHeader title="Usuarios" subtitle="Codigo, cadastro e ultimo acesso" />

          {loading ? (
            <InlineLoading text="Carregando usuarios..." />
          ) : users.length === 0 ? (
            <p className="admin-empty">Nenhum usuario encontrado ainda.</p>
          ) : (
            users.map((user) => (
              <div key={user.uid} className="admin-user-item">
                <div className="admin-user-avatar">{user.displayName?.[0]?.toUpperCase() || '?'}</div>
                <div className="admin-user-info">
                  <div className="admin-user-topline">
                    <span className="admin-user-name">{user.displayName}</span>
                    <span className={`admin-status-badge admin-status-badge--${user.role === 'admin' ? 'admin' : 'user'}`}>
                      {user.role === 'admin' ? 'Admin' : accountStatus(user)}
                    </span>
                  </div>
                  <span className="admin-user-email">{user.email || 'Sem e-mail'}</span>
                  <span className="admin-user-meta">
                    Codigo: <strong>{user.memberCode || 'Pendente'}</strong> · Cadastro: {formatDateTime(user.createdAt)}
                  </span>
                  <span className="admin-user-meta">
                    Ultimo acesso: {formatDateTime(user.lastLoginAt || user.lastSeenAt)}
                  </span>
                </div>
              </div>
            ))
          )}
        </Card>

        <FinancialAuditPanel users={nonAdminUsers} />

        <Button
          variant="secondary"
          fullWidth
          loading={loadingPDF}
          onClick={handleExportConsolidado}
          disabled={users.length === 0}
        >
          Exportar relatorio consolidado PDF
        </Button>
      </div>
    </div>
  )
}
