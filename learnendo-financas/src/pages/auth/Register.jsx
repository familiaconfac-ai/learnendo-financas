import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { registerUser } from '../../firebase/auth'
import Button from '../../components/ui/Button'
import './Auth.css'

export default function Register() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm) {
      setError('As senhas não coincidem.')
      return
    }
    if (form.password.length < 6) {
      setError('A senha precisa ter pelo menos 6 caracteres.')
      return
    }
    setLoading(true)
    try {
      await registerUser(form.email, form.password, form.name)
      navigate(searchParams.get('next') || '/dashboard')
    } catch (err) {
      const code = err?.code ?? ''
      if (code === 'auth/email-already-in-use') {
        setError('Este e-mail já está cadastrado. Tente fazer login.')
      } else if (code === 'auth/weak-password') {
        setError('Senha muito fraca. Use pelo menos 6 caracteres.')
      } else if (code === 'auth/invalid-email') {
        setError('Endereço de e-mail inválido.')
      } else if (code === 'auth/network-request-failed') {
        setError('Sem conexão. Verifique sua internet e tente novamente.')
      } else {
        setError('Erro ao criar conta. Tente novamente.')
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
      </div>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <h2 className="auth-title">Criar conta</h2>

        {error && <div className="auth-error">{error}</div>}

        <div className="form-group">
          <label htmlFor="name">Nome</label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            value={form.name}
            onChange={handleChange}
            required
            placeholder="Seu nome completo"
          />
        </div>

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
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={handleChange}
            required
            placeholder="Mínimo 6 caracteres"
          />
        </div>

        <div className="form-group">
          <label htmlFor="confirm">Confirmar senha</label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={handleChange}
            required
            placeholder="Repita a senha"
          />
        </div>

        <Button type="submit" fullWidth loading={loading}>
          Criar conta
        </Button>

        <p className="auth-link">
          Já tem conta? <Link to={searchParams.get('next') ? `/login?next=${encodeURIComponent(searchParams.get('next'))}` : '/login'}>Entrar</Link>
        </p>
      </form>
    </div>
  )
}
