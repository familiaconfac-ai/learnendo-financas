import { Routes, Route, Navigate } from 'react-router-dom'
import PrivateRoute from './PrivateRoute'
import AdminRoute from './AdminRoute'
import Layout from '../components/layout/Layout'

// Auth pages
import Login from '../pages/auth/Login'
import Register from '../pages/auth/Register'
import InviteAccept from '../pages/auth/InviteAccept'

// App pages
import Dashboard from '../pages/dashboard/Dashboard'
import Lancamentos from '../pages/lancamentos/Lancamentos'
import Orcamento from '../pages/orcamento/Orcamento'
import Mensal from '../pages/mensal/Mensal'
import Relatorios from '../pages/relatorios/Relatorios'
import Perfil from '../pages/perfil/Perfil'
import Contas from '../pages/contas/Contas'
import Importacao from '../pages/importacao/Importacao'
import Reconciliacao from '../pages/reconciliacao/Reconciliacao'
import Dividas from '../pages/dividas/Dividas'

// Admin pages
import AdminDashboard from '../pages/admin/AdminDashboard'
import Familia from '../pages/familia/Familia'

export default function AppRoutes() {
  return (
    <Routes>
      {/* Rotas públicas */}
      <Route path="/login" element={<Login />} />
      <Route path="/cadastro" element={<Register />} />
      <Route path="/convite/:token" element={<InviteAccept />} />

      {/* Rotas protegidas – usuário autenticado */}
      <Route element={<PrivateRoute />}>
        <Route element={<Layout />}>
          <Route path="/dashboard"     element={<Dashboard />} />
          <Route path="/lancar"        element={<Lancamentos view="pending" />} />
          <Route path="/lancamentos"   element={<Lancamentos view="confirmed" />} />
          <Route path="/orcamento"     element={<Orcamento />} />
          <Route path="/mensal"        element={<Mensal />} />
          <Route path="/relatorios"    element={<Relatorios />} />
          <Route path="/perfil"        element={<Perfil />} />
          <Route path="/contas"        element={<Contas />} />
          <Route path="/dividas"       element={<Dividas />} />
          <Route path="/importacao"    element={<Importacao />} />
          <Route path="/reconciliacao" element={<Reconciliacao />} />
        </Route>
      </Route>

      {/* Rota Família — acessível a todos os membros autenticados */}
      <Route element={<PrivateRoute />}>
        <Route element={<Layout />}>
          <Route path="/familia" element={<Familia />} />
        </Route>
      </Route>

      {/* Rota Admin técnica — mantida internamente, não exposta na navegação */}
      <Route element={<AdminRoute />}>
        <Route element={<Layout />}>
          <Route path="/admin" element={<AdminDashboard />} />
        </Route>
      </Route>

      {/* Redirecionamentos */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
