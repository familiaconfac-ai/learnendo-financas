import { Routes, Route, Navigate } from 'react-router-dom'
import PrivateRoute from './PrivateRoute'
import RoleRoute from './RoleRoute'
import Layout from '../components/layout/Layout'

// Auth pages
import Login from '../pages/auth/Login'
import Register from '../pages/auth/Register'

// EBD features
import DashboardPage from '../features/dashboard/DashboardPage'
import PeoplePage from '../features/people/PeoplePage'
import TeachersPage from '../features/teachers/TeachersPage'
import ClassesPage from '../features/classes/ClassesPage'
import EnrollmentsPage from '../features/enrollments/EnrollmentsPage'
import AttendancePage from '../features/attendance/AttendancePage'
import CommunicationPage from '../features/communication/CommunicationPage'
import ReportsPage from '../features/reports/ReportsPage'
import MaterialsPage from '../features/materials/MaterialsPage'
import SettingsPage from '../features/settings/SettingsPage'
import ProfilePage from '../features/settings/ProfilePage'
import { ROLES } from '../utils/accessControl'

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/cadastro" element={<Register />} />

      <Route element={<PrivateRoute />}>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route element={<RoleRoute allowedRoles={[ROLES.ADMIN]} />}>
            <Route path="/alunos" element={<PeoplePage />} />
            <Route path="/professores" element={<TeachersPage />} />
            <Route path="/matriculas" element={<EnrollmentsPage />} />
            <Route path="/configuracoes" element={<SettingsPage />} />
          </Route>
          <Route path="/classes" element={<ClassesPage />} />
          <Route path="/caderneta" element={<AttendancePage />} />
          <Route path="/comunicacao" element={<CommunicationPage />} />
          <Route path="/relatorios" element={<ReportsPage />} />
          <Route path="/materiais" element={<MaterialsPage />} />
          <Route path="/perfil" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
