import { useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface ViewportMenuProps {
  open: boolean
  triggerRef: RefObject<HTMLElement | null>
  menuRef: RefObject<HTMLDivElement | null>
  className?: string
  label: string
  children: ReactNode
}

const VIEWPORT_GUTTER = 12
const TRIGGER_GAP = 8

/**
 * Renders compact action menus outside cards and player surfaces so ancestor
 * overflow rules cannot clip them. Positioning stays related to the trigger,
 * then flips and clamps to remain usable at phone-sized viewports.
 */
export function ViewportMenu({ open, triggerRef, menuRef, className = '', label, children }: ViewportMenuProps) {
  const [position, setPosition] = useState<CSSProperties | null>(null)

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return undefined }

    const place = () => {
      const trigger = triggerRef.current
      const menu = menuRef.current
      if (!trigger || !menu) return
      const triggerRect = trigger.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const availableWidth = Math.max(0, window.innerWidth - VIEWPORT_GUTTER * 2)
      const width = Math.min(menuRect.width || 200, availableWidth)
      const height = Math.min(menuRect.height || 0, Math.max(0, window.innerHeight - VIEWPORT_GUTTER * 2))
      const left = Math.min(
        Math.max(VIEWPORT_GUTTER, triggerRect.right - width),
        Math.max(VIEWPORT_GUTTER, window.innerWidth - VIEWPORT_GUTTER - width),
      )
      const below = triggerRect.bottom + TRIGGER_GAP
      const above = triggerRect.top - TRIGGER_GAP - height
      const top = below + height <= window.innerHeight - VIEWPORT_GUTTER
        ? below
        : Math.max(VIEWPORT_GUTTER, above)
      setPosition({ left, top, maxHeight: `calc(100dvh - ${VIEWPORT_GUTTER * 2}px)` })
    }

    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [menuRef, open, triggerRef])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={menuRef}
      className={`viewport-menu ${className}`.trim()}
      role="menu"
      aria-label={label}
      style={position ?? { left: 0, top: 0, visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  )
}
