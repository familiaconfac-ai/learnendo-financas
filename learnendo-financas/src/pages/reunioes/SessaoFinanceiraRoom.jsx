import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { setActiveFinancialSessionBridge } from '../../services/financialSessionBridgeService'
import './SessaoFinanceiraRoom.css'

export default function SessaoFinanceiraRoom() {
  const navigate = useNavigate()
  const { workspaceId = '', sessionId = '' } = useParams()

  useEffect(() => {
    if (!workspaceId || !sessionId) return

    setActiveFinancialSessionBridge({
      workspaceId,
      sessionId,
      activatedAt: new Date().toISOString(),
    })
    navigate('/dashboard', { replace: true })
  }, [navigate, sessionId, workspaceId])

  if (!workspaceId || !sessionId) {
    return (
      <div className="sessao-room-page">
        <Card>
          <CardHeader
            title="Sess\u00e3o indispon\u00edvel"
            subtitle="Faltam os dados necess\u00e1rios para abrir o atendimento colaborativo."
          />
          <Button onClick={() => navigate('/reunioes')}>Voltar para reuni\u00f5es</Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="sessao-room-page">
      <Card>
        <CardHeader
          title="Abrindo sess\u00e3o colaborativa"
          subtitle="Voc\u00ea ser\u00e1 levado para o dashboard e a reuni\u00e3o continuar\u00e1 no topo do app, sem criar uma tela financeira paralela."
        />
      </Card>
    </div>
  )
}
