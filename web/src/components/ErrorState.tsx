import { AlertTriangle, ArrowLeft, Home, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export function sanitizeErrorDetails(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? 'Unknown error')
  const sensitiveKeyPattern = '(?:password|passwd|token|access[_-]?token|refresh[_-]?token|auth[_-]?token|secret|client[_-]?secret|api[_-]?key|apikey|authorization|cookie)'
  const jsonSecretPattern = new RegExp(
    `((?:["'])${sensitiveKeyPattern}(?:["'])\\s*:\\s*)("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^,}\\s]+)`,
    'gi',
  )
  const querySecretPattern = new RegExp(`([?&#]${sensitiveKeyPattern}(?:=|%3D))([^&#\\s,;]*)`, 'gi')
  const plainSecretPattern = new RegExp(`\\b(${sensitiveKeyPattern})\\s*[:=]\\s*(?!Bearer\\b|\\[redacted\\])([^\\s,;&}"']+)`, 'gi')

  return raw
    .replace(/(\bBearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(jsonSecretPattern, (_match: string, prefix: string, secret: string) => {
      const quote = secret.startsWith('"') || secret.startsWith("'") ? secret[0] : ''
      return `${prefix}${quote}[redacted]${quote}`
    })
    .replace(querySecretPattern, '$1[redacted]')
    .replace(plainSecretPattern, '$1: [redacted]')
    .replace(/(postgres(?:ql)?:\/\/)[^\s]+/gi, '$1[redacted]')
    .slice(0, 240)
}

export function ErrorState({
  kind = 'server',
  title,
  message,
  details,
  onRetry,
}: {
  kind?: 'not-found' | 'server'
  title?: string
  message?: string
  details?: unknown
  onRetry?: () => void
}) {
  const navigate = useNavigate()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const notFound = kind === 'not-found'

  return (
    <section className="status-page" aria-labelledby="status-title">
      <div className={`status-page__icon ${notFound ? 'status-page__icon--cyan' : ''}`} aria-hidden="true">
        {notFound ? <Home size={28} /> : <AlertTriangle size={28} />}
      </div>
      <p className="eyebrow">{notFound ? '404 · Lost in the library' : '500 · Playback paused'}</p>
      <h1 id="status-title">{title ?? (notFound ? 'Page not found' : 'Something went wrong')}</h1>
      <p className="status-page__message">{message ?? (notFound ? 'That destination is not in the current release.' : 'The service could not complete that request. Try again in a moment.')}</p>
      <div className="status-page__actions">
        <button className="button button--primary" type="button" onClick={() => navigate('/')}>
          <Home size={17} /> Go home
        </button>
        {!notFound && (
          <button className="button button--secondary" type="button" onClick={onRetry ?? (() => window.location.reload())}>
            <RotateCcw size={17} /> Try again
          </button>
        )}
        <button className="button button--text" type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>
          {detailsOpen ? 'Hide technical details' : 'Show technical details'}
        </button>
      </div>
      {detailsOpen && (
        <pre className="status-page__details" aria-label="Technical details">{sanitizeErrorDetails(details ?? 'No additional details are available.')}</pre>
      )}
    </section>
  )
}
