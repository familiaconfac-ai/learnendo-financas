import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { loginUser } from '../../firebase/auth'
import Button from '../../components/ui/Button'
import './Auth.css'

export default function Login() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await loginUser(form.email, form.password)
      navigate('/dashboard')
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

  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <img src="/logo.jpg" alt="Learnendo Finanças" className="auth-logo-img" />
        <h1 className="auth-app-name">Learnendo Finanças</h1>
        <p className="auth-tagline">Controle financeiro na palma da sua mão</p>
      </div>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <h2 className="auth-title">Entrar</h2>

        {error && <div className="auth-error">{error}</div>}

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

        <Button type="submit" fullWidth loading={loading}>
          Entrar
        </Button>

        <p className="auth-link">
          Não tem conta? <Link to="/cadastro">Cadastrar-se</Link>
        </p>
      </form>
    </div>
  )
}
