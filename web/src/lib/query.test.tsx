import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppQueryProvider } from './query'

describe('AppQueryProvider', () => {
  it('provides a React Query context to future server-backed routes', () => {
    render(<AppQueryProvider><span>query-ready</span></AppQueryProvider>)
    expect(screen.getByText('query-ready')).toBeInTheDocument()
  })
})
