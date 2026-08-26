import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'
import { ErrorState } from '../components/ErrorState'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
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
