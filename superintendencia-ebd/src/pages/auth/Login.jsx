import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { loginUser, resetPassword } from '../../firebase/auth'
import Button from '../../components/ui/Button'
import './Auth.css'

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [form, setForm] = useState({ email: '', password: '' })
  const [mode, setMode] = useState('login')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      await loginUser(form.email, form.password)
      navigate(searchParams.get('next') || '/dashboard')
    } catch (err) {
      const code = err?.code ?? ''
      if (
        code === 'auth/invalid-credential' ||
        code === 'auth/user-not-found' ||
        code === 'auth/wrong-password'
      ) {
        setError('E-mail ou senha inválidos.')
      } else if (code === 'auth/too-many-requests') {
        setError('Muitas tentativas. Aguarde alguns minutos e tente novamente.')
      } else if (code === 'auth/network-request-failed') {
        setError('Sem conexão. Verifique sua internet e tente novamente.')
      } else if (code === 'auth/user-disabled') {
        setError('Esta conta foi desativada. Entre em contato com o suporte.')
      } else {
        setError('Erro ao entrar. Tente novamente.')
      }
    } finally {
      setLoading(false)
    }
  }

  function openForgotPassword() {
    setMode('forgot')
    setError('')
    setSuccess('')
  }

  function openLogin() {
    setMode('login')
    setError('')
    setSuccess('')
  }

  async function handleResetPassword(e) {
    e.preventDefault()
    const email = form.email.trim()
    setError('')
    setSuccess('')

    if (!email) {
      setError('Informe seu e-mail para receber o link de recuperação.')
      return
    }

    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    if (!isValidEmail) {
      setError('Informe um e-mail válido.')
      return
    }

    setLoading(true)
    try {
      await resetPassword(email)
      setSuccess('Se o e-mail estiver cadastrado, enviaremos um link de recuperação em instantes.')
    } catch (err) {
      const code = err?.code ?? ''
      if (code === 'auth/invalid-email') {
        setError('E-mail inválido. Verifique e tente novamente.')
      } else if (code === 'auth/network-request-failed') {
        setError('Sem conexão. Verifique sua internet e tente novamente.')
      } else if (code === 'auth/too-many-requests') {
        setError('Muitas tentativas. Aguarde alguns minutos e tente novamente.')
      } else {
        setError('Não foi possível enviar o link de recuperação agora. Tente novamente.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <img src="/logo.png" alt="Superintendência EBD" className="auth-logo-img" />
        <h1 className="auth-app-name">Superintendência EBD</h1>
        <p className="auth-tagline">Gestão da Escola Bíblica Dominical em um só lugar</p>
      </div>

      <form className="auth-form" onSubmit={mode === 'login' ? handleSubmit : handleResetPassword} noValidate>
        <h2 className="auth-title">{mode === 'login' ? 'Entrar' : 'Recuperar senha'}</h2>

        {error && <div className="auth-error">{error}</div>}
        {success && <div className="auth-success">{success}</div>}

        <div className="form-group">
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={handleChange}
            required
            placeholder="seu@email.com"
          />
        </div>

        {mode === 'login' && (
          <>
            <div className="form-group">
              <label htmlFor="password">Senha</label>
              <div className="password-field">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={form.password}
                  onChange={handleChange}
                  required
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </div>

            <button type="button" className="auth-text-btn" onClick={openForgotPassword}>
              Esqueci minha senha
            </button>

            <Button type="submit" fullWidth loading={loading}>
              Entrar
            </Button>

            <p className="auth-link">
              Não tem conta? <Link to={searchParams.get('next') ? `/cadastro?next=${encodeURIComponent(searchParams.get('next'))}` : '/cadastro'}>Cadastrar-se</Link>
            </p>
          </>
        )}

        {mode === 'forgot' && (
          <>
            <Button type="submit" fullWidth loading={loading}>
              Enviar link de recuperação
            </Button>
            <button type="button" className="auth-text-btn" onClick={openLogin}>
              Voltar ao login
            </button>
          </>
        )}
      </form>
    </div>
  )
}
