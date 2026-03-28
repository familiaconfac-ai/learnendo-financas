import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { FinanceProvider } from './context/FinanceContext'
import { WorkspaceProvider } from './context/WorkspaceContext'
import AppRoutes from './routes/AppRoutes'
import './styles/global.css'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <WorkspaceProvider>
          <FinanceProvider>
            <AppRoutes />
          </FinanceProvider>
        </WorkspaceProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
