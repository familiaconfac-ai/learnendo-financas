import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { FullScreenLoading } from '../components/ui/Loading'

export default function AdminRoute() {
  const { user, isAdmin, loading } = useAuth()

  if (loading) return <FullScreenLoading />
  if (!user) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/dashboard" replace />

  return <Outlet />
}
