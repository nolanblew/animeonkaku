import { Music2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { browserAssetUrl } from '../lib/assets'
import './media-presentation.css'

type MediaRoot = 'article' | 'div' | 'li'

export interface MediaArtworkProps {
  imageUrl?: string | null
  imageUrls?: readonly string[]
  label?: string
  fallback?: ReactNode
  className?: string
  testId?: string
}

export function MediaArtwork({ imageUrl, imageUrls, label = 'Media artwork unavailable', fallback, className = '', testId = 'media-artwork' }: MediaArtworkProps) {
  const urls = [...(imageUrls ?? []), ...(imageUrl ? [imageUrl] : [])]
    .map((value) => browserAssetUrl(value))
    .filter((value): value is string => Boolean(value))
    .slice(0, 4)
  const layout = urls.length === 0 ? 'empty' : urls.length === 1 ? 'single' : urls.length === 2 ? 'double' : 'quad'

  return <span className={`media-artwork media-artwork--${layout} ${className}`.trim()} data-layout={layout} data-testid={testId}>
    {urls.length > 0
      ? urls.map((url, index) => <img key={`${url}:${index}`} src={url} alt="" loading="lazy" decoding="async" />)
      : <span className="media-artwork__fallback" aria-label={label}>{fallback ?? <Music2 aria-hidden="true" />}</span>}
  </span>
}

interface SharedMediaProps extends MediaArtworkProps {
  title: ReactNode
  subtitle?: ReactNode
  href?: string
  onActivate?: () => void
  activateLabel?: string
  artwork?: ReactNode
  actions?: ReactNode
  className?: string
  testId?: string
  element?: MediaRoot
}

export function MediaListItem({ title, subtitle, href, onActivate, activateLabel, artwork, actions, element = 'div', className = '', testId, ...artworkProps }: SharedMediaProps) {
  const Root = element
  const content = <>{artwork ?? <MediaArtwork {...artworkProps} />}<span className="media-item__copy"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span></>
  const main = href
    ? <Link className="media-item__main" to={href} aria-label={activateLabel}>{content}</Link>
    : onActivate
      ? <button type="button" className="media-item__main media-item__main--button" onClick={onActivate} aria-label={activateLabel}>{content}</button>
      : <span className="media-item__main">{content}</span>

  return <Root className={`media-item ${className}`.trim()} data-testid={testId}>{main}{actions && <span className="media-item__actions">{actions}</span>}</Root>
}

export function MediaCard({ title, subtitle, href, onActivate, activateLabel, artwork, actions, element = 'article', className = '', testId, ...artworkProps }: SharedMediaProps) {
  const Root = element
  const content = <>{artwork ?? <MediaArtwork {...artworkProps} />}<span className="media-card__copy"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span></>
  const main = href
    ? <Link className="media-card__main" to={href} aria-label={activateLabel}>{content}</Link>
    : onActivate
      ? <button type="button" className="media-card__main media-card__main--button" onClick={onActivate} aria-label={activateLabel}>{content}</button>
      : <span className="media-card__main">{content}</span>

  return <Root className={`media-card ${className}`.trim()} data-testid={testId}>{main}{actions && <span className="media-card__actions">{actions}</span>}</Root>
}
