import { useNavigate } from 'react-router-dom'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { logoutUser } from '../../firebase/auth'

export default function ProfilePage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logoutUser()
    navigate('/login', { replace: true })
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <h2 className="feature-title">Perfil</h2>
      </div>

      <Card>
        <CardHeader title={profile?.displayName || user?.displayName || 'Usuário'} subtitle={user?.email || 'Sem e-mail'} />
        <p className="feature-subtitle">Use este ambiente para registrar cadernetas e acompanhar a frequência da EBD.</p>
      </Card>

      <Button variant="danger" onClick={handleLogout}>Sair da conta</Button>
    </div>
  )
}
