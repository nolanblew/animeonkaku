import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'
import { useLocation } from 'react-router-dom'
import { ErrorState } from '../components/ErrorState'

interface Props { children: ReactNode }
interface State { error: Error | null }

class AppErrorBoundaryImpl extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error('Anime Ongaku web route error', error, info.componentStack)
  }

  render() {
    if (this.state.error) return <ErrorState details={this.state.error} />
    return this.props.children
  }
}

export function AppErrorBoundary({ children }: Props) {
  const location = useLocation()
  const routeKey = `${location.pathname}${location.search}${location.hash}`
  return <AppErrorBoundaryImpl key={routeKey}>{children}</AppErrorBoundaryImpl>
}
