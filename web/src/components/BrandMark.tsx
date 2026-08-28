import type { HTMLAttributes } from 'react'
import logoUrl from '../assets/anime-ongaku-logo.png'

export function BrandMark({ className = '', ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`brand-mark ${className}`.trim()} {...props}>
      <img src={logoUrl} alt="Anime Ongaku" />
    </span>
  )
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? 'brand--compact' : ''}`}>
      <BrandMark />
      <span className="brand__name">Anime Ongaku</span>
    </span>
  )
}
