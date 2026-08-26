import { AlertTriangle, RotateCcw } from 'lucide-react'
import { sanitizeErrorDetails } from '../../components/ErrorState'

export function CatalogError({
  title,
  message = 'The service could not complete that request. Try again in a moment.',
  error,
  onRetry,
}: {
  title: string
  message?: string
  error?: unknown
  onRetry?: () => void
}) {
  return (
    <section className="catalog-status catalog-status--error" aria-labelledby="catalog-error-title">
      <AlertTriangle size={28} aria-hidden="true" />
      <div>
        <h2 id="catalog-error-title">{title}</h2>
        <p>{message}</p>
        {error !== undefined && (
          <details className="catalog-status__details">
            <summary>Show technical details</summary>
            <pre>{sanitizeErrorDetails(error)}</pre>
          </details>
        )}
      </div>
      {onRetry && <button className="button button--secondary" type="button" onClick={onRetry}><RotateCcw size={16} /> Try again</button>}
    </section>
  )
}

export function CatalogLoading({ label }: { label: string }) {
  return <div className="catalog-status" role="status" aria-live="polite"><span className="spinner" /><span>{label}</span></div>
}
