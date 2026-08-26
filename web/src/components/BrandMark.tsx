import type { HTMLAttributes } from 'react'

export function BrandMark({ className = '', ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`brand-mark ${className}`.trim()} aria-hidden="true" {...props}>
      <span className="brand-mark__orbit" />
      <span className="brand-mark__core">▶</span>
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
