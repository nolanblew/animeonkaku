import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'
import { apiClient } from '../lib/api'

describe('LoginPage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('submits credentials and reports a safe authentication failure', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('credentials rejected'))
    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    fireEvent.change(screen.getByRole('textbox', { name: /kitsu username/i }), { target: { value: 'fan@example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'not-a-real-password' } })
    fireEvent.click(screen.getByRole('button', { name: /show password/i }))
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not sign you in/i))
    expect(apiClient.post).toHaveBeenCalledWith('/auth/login', { username: 'fan@example.test', password: 'not-a-real-password' })
  })

  it('navigates home after a successful sign-in', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({ ok: true })
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    fireEvent.change(screen.getByRole('textbox', { name: /kitsu username/i }), { target: { value: 'fan' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled())
  })
})
