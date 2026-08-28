import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export interface FocusScopeOptions {
  active?: boolean
  onEscape?: () => void
  restoreFocusRef?: RefObject<HTMLElement | null>
  initialFocusRef?: RefObject<HTMLElement | null>
}

/**
 * Gives a transient dialog or menu a predictable keyboard boundary. The
 * active element that opened the scope is restored when it closes, which is
 * especially important for menus rendered outside their trigger row.
 */
export function useAccessibleFocusScope<T extends HTMLElement>({
  active = true,
  onEscape,
  restoreFocusRef,
  initialFocusRef,
}: FocusScopeOptions = {}): RefObject<T | null> {
  const scopeRef = useRef<T | null>(null)
  const restoreAtRenderRef = useRef<HTMLElement | null>(null)
  const onEscapeRef = useRef(onEscape)
  const restoreFocusRefRef = useRef(restoreFocusRef)
  const initialFocusRefRef = useRef(initialFocusRef)
  onEscapeRef.current = onEscape
  restoreFocusRefRef.current = restoreFocusRef
  initialFocusRefRef.current = initialFocusRef
  if (active && restoreAtRenderRef.current === null && typeof document !== 'undefined') {
    restoreAtRenderRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  if (!active) restoreAtRenderRef.current = null

  useEffect(() => {
    if (!active) return undefined
    const scope = scopeRef.current
    if (!scope) return undefined

    const restoreTarget = restoreFocusRefRef.current?.current ?? restoreAtRenderRef.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    const focusable = () => Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    const requestedInitialTarget = initialFocusRefRef.current?.current
    const initialTarget = requestedInitialTarget && !requestedInitialTarget.hasAttribute('disabled')
      ? requestedInitialTarget
      : focusable()[0]
    if (initialTarget) initialTarget.focus()
    else {
      if (!scope.hasAttribute('tabindex')) scope.setAttribute('tabindex', '-1')
      scope.focus()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onEscapeRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const elements = focusable()
      if (elements.length === 0) {
        event.preventDefault()
        scope.focus()
        return
      }
      const currentIndex = elements.indexOf(document.activeElement as HTMLElement)
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? elements.length - 1 : currentIndex - 1)
        : (currentIndex === elements.length - 1 ? 0 : currentIndex + 1)
      if (currentIndex >= 0) {
        event.preventDefault()
        elements[nextIndex]?.focus()
      }
    }

    scope.addEventListener('keydown', handleKeyDown)
    return () => {
      scope.removeEventListener('keydown', handleKeyDown)
      if (restoreTarget && document.contains(restoreTarget)) restoreTarget.focus()
      restoreAtRenderRef.current = null
    }
  }, [active])

  return scopeRef
}

export interface RovingMenuOptions {
  open: boolean
  onClose: () => void
  triggerRef?: RefObject<HTMLElement | null>
}

/** Menu-specific arrow/Home/End navigation with Escape and focus return. */
export function useRovingMenu<T extends HTMLElement>({ open, onClose, triggerRef }: RovingMenuOptions): RefObject<T | null> {
  const menuRef = useRef<T | null>(null)
  const onCloseRef = useRef(onClose)
  const triggerRefRef = useRef(triggerRef)
  onCloseRef.current = onClose
  triggerRefRef.current = triggerRef

  useEffect(() => {
    if (!open) return undefined
    const menu = menuRef.current
    if (!menu) return undefined
    const items = () => Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'))
    const first = items()[0]
    first?.focus()

    const restore = () => {
      onCloseRef.current()
      triggerRefRef.current?.current?.focus()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const menuItems = items()
      if (event.key === 'Escape') {
        event.preventDefault()
        restore()
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        restore()
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || menuItems.length === 0) return
      event.preventDefault()
      const currentIndex = menuItems.indexOf(document.activeElement as HTMLElement)
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? menuItems.length - 1
          : event.key === 'ArrowUp'
            ? (currentIndex <= 0 ? menuItems.length - 1 : currentIndex - 1)
            : (currentIndex === menuItems.length - 1 ? 0 : currentIndex + 1)
      menuItems[nextIndex]?.focus()
    }

    menu.addEventListener('keydown', handleKeyDown)
    return () => {
      menu.removeEventListener('keydown', handleKeyDown)
      triggerRefRef.current?.current?.focus()
    }
  }, [open])

  return menuRef
}
