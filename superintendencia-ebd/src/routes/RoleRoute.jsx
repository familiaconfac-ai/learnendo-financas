import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { FullScreenLoading } from '../components/ui/Loading'

export default function RoleRoute({ allowedRoles = [] }) {
  const { user, loading, role } = useAuth()

  if (loading) return <FullScreenLoading />
  if (!user) return <Navigate to="/login" replace />
  if (!allowedRoles.includes(role)) return <Navigate to="/dashboard" replace />

  return <Outlet />
}
