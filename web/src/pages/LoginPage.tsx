import { Eye, EyeOff, LockKeyhole, Server, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../lib/api'
import { Brand, BrandMark } from '../components/BrandMark'

export function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      await apiClient.post('/auth/login', { username, password })
      navigate('/')
    } catch {
      setError('We could not sign you in. Check your details and try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-page__wash" aria-hidden="true" />
      <div className="auth-card">
        <div className="auth-card__brand"><Brand compact /></div>
        <div className="auth-card__intro"><BrandMark /><p className="eyebrow">Anime theme music, together</p><h1>Welcome back</h1><p>Sign in to sync your library and pick up your listening session.</p></div>
        <form onSubmit={submit} className="auth-form" aria-label="Sign in form">
          <label className="field"><span>Kitsu username or email</span><span className="field__control"><UserRound size={18} aria-hidden="true" /><input value={username} onChange={(event) => setUsername(event.target.value)} type="text" name="username" autoComplete="username" required /></span></label>
          <label className="field"><span>Password</span><span className="field__control"><LockKeyhole size={18} aria-hidden="true" /><input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} name="password" autoComplete="current-password" required /><button className="field__action" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button--primary button--full" type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <div className="auth-card__foot"><Server size={15} aria-hidden="true" /> <span>Connected securely through your Anime Ongaku server.</span></div>
      </div>
    </main>
  )
}
