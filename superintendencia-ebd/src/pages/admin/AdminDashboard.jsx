import { useState, useEffect } from 'react'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { formatCurrency } from '../../utils/formatCurrency'
import { InlineLoading } from '../../components/ui/Loading'
import { generateMonthlyPDF } from '../../services/pdfService'
import { MOCK_ADMIN_USERS } from '../../utils/mockData'
import './AdminDashboard.css'

export default function AdminDashboard() {
  // TODO: substituir por adminService.getAllUsers()
  const [users] = useState(MOCK_ADMIN_USERS)
  const [loadingPDF, setLoadingPDF] = useState(false)

  async function handleExportConsolidado() {
    setLoadingPDF(true)
    try {
      await generateMonthlyPDF({ isAdmin: true, users })
    } finally {
      setLoadingPDF(false)
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-content">
        {/* Totalizador */}
        <Card className="admin-summary-card">
          <CardHeader title="Resumo geral" subtitle="Todos os usuários" />
          <div className="admin-stat-row">
            <span>Usuários ativos</span>
            <strong>{users.length}</strong>
          </div>
          <div className="admin-stat-row">
            <span>Total receitas (soma)</span>
            <strong className="text-success">
              {formatCurrency(users.reduce((a, u) => a + u.monthlyReceitas, 0))}
            </strong>
          </div>
          <div className="admin-stat-row">
            <span>Total despesas (soma)</span>
            <strong className="text-danger">
              {formatCurrency(users.reduce((a, u) => a + u.monthlyDespesas, 0))}
            </strong>
          </div>
        </Card>

        {/* Lista de usuários */}
        <Card>
          <CardHeader title="Usuários" />
          {users.map((u) => (
            <div key={u.uid} className="admin-user-item">
              <div className="admin-user-avatar">{u.displayName?.[0]?.toUpperCase()}</div>
              <div className="admin-user-info">
                <span className="admin-user-name">{u.displayName}</span>
                <span className="admin-user-email">{u.email}</span>
              </div>
              <div className="admin-user-values">
                <span className="text-success">+{formatCurrency(u.monthlyReceitas)}</span>
                <span className="text-danger">-{formatCurrency(u.monthlyDespesas)}</span>
              </div>
            </div>
          ))}
        </Card>

        <Button
          variant="secondary"
          fullWidth
          loading={loadingPDF}
          onClick={handleExportConsolidado}
        >
          📄 Exportar relatório consolidado PDF
        </Button>
      </div>
    </div>
  )
}
