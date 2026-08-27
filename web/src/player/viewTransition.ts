type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown
}

export function runPlayerViewTransition(update: () => void): void {
  const startViewTransition = (document as ViewTransitionDocument).startViewTransition
  if (typeof startViewTransition !== 'function') {
    update()
    return
  }
  startViewTransition.call(document, update)
}
