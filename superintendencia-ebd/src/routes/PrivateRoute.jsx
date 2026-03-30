import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { FullScreenLoading } from '../components/ui/Loading'

export default function PrivateRoute() {
  const { user, loading } = useAuth()

  if (loading) return <FullScreenLoading />
  if (!user) return <Navigate to="/login" replace />

  return <Outlet />
}
