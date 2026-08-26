import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiClient } from '../lib/api'

export const AUTH_QUERY_KEY = ['auth', 'me'] as const

export interface AuthProfile {
  displayName: string | null
  avatarUrl: string | null
}

export interface AuthUser extends AuthProfile {
  kitsuUserId: string
  username: string
}

export type LoginSyncMode = 'FULL' | 'DELTA'
export interface AuthLoginResponse {
  user: AuthUser
  isNewUser: boolean
  syncMode: LoginSyncMode
}

export interface AuthMeResponse {
  user: AuthUser
  kitsuAuthState: string
  lastSyncAt: number | null
  devices: Array<{
    id: number
    deviceName: string
    createdAt: number
    lastUsedAt: number
    current: boolean
  }>
}

export interface ProfileResponse {
  profile: AuthProfile
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'
export type FirstSyncStatus = 'idle' | 'syncing' | 'ready'

export interface FirstSyncState {
  status: FirstSyncStatus
  mode: LoginSyncMode | null
  /** Mirrors the server login field for consumers that prefer its name. */
  syncMode: LoginSyncMode | null
  isNewUser: boolean
}

export interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  me: AuthMeResponse | null
  firstSync: FirstSyncState
  login: (username: string, password: string) => Promise<AuthLoginResponse>
  logout: () => Promise<void>
  updateProfile: (profile: { displayName: string | null }) => Promise<AuthProfile>
  uploadAvatar: (avatar: Blob) => Promise<AuthProfile>
  removeAvatar: () => Promise<AuthProfile>
  markInitialSyncReady: () => void
  refresh: () => Promise<unknown>
}

const defaultAuth: AuthContextValue = {
  status: 'unauthenticated',
  user: null,
  me: null,
  firstSync: { status: 'idle', mode: null, syncMode: null, isNewUser: false },
  login: async (username, password) => apiClient.post<AuthLoginResponse>('/auth/login', { username, password }),
  logout: async () => { await apiClient.post('/auth/logout') },
  updateProfile: async (profile) => {
    const response = await apiClient.patch<ProfileResponse>('/auth/profile', profile)
    return response.profile
  },
  uploadAvatar: async (avatar) => {
    const response = await apiClient.postRaw<ProfileResponse>('/auth/profile/avatar', avatar)
    return response.profile
  },
  removeAvatar: async () => {
    const response = await apiClient.request<ProfileResponse>('/auth/profile/avatar', { method: 'DELETE' })
    return response.profile
  },
  markInitialSyncReady: () => undefined,
  refresh: async () => undefined,
}

const AuthContext = createContext<AuthContextValue>(defaultAuth)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const meQuery = useQuery<AuthMeResponse>({
    queryKey: AUTH_QUERY_KEY,
    queryFn: () => apiClient.get<AuthMeResponse>('/auth/me'),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const [loginSession, setLoginSession] = useState<AuthLoginResponse | null>(null)
  const [hasLoggedOut, setHasLoggedOut] = useState(false)
  const [firstSync, setFirstSync] = useState<FirstSyncState>({ status: 'idle', mode: null, syncMode: null, isNewUser: false })

  useEffect(() => {
    if (meQuery.isError && loginSession === null) {
      setFirstSync({ status: 'idle', mode: null, syncMode: null, isNewUser: false })
      if (isUnauthorized(meQuery.error)) setHasLoggedOut(true)
    }
  }, [loginSession, meQuery.error, meQuery.isError])

  const login = useCallback(async (username: string, password: string): Promise<AuthLoginResponse> => {
    const result = await apiClient.post<AuthLoginResponse>('/auth/login', { username, password })
    setLoginSession(result)
    setHasLoggedOut(false)
    setFirstSync({ status: 'syncing', mode: result.syncMode, syncMode: result.syncMode, isNewUser: result.isNewUser })
    void queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY })
    return result
  }, [queryClient])

  const logout = useCallback(async (): Promise<void> => {
    let failure: unknown
    try {
      await apiClient.post('/auth/logout')
    } catch (error) {
      failure = error
    } finally {
      setLoginSession(null)
      setHasLoggedOut(true)
      setFirstSync({ status: 'idle', mode: null, syncMode: null, isNewUser: false })
      queryClient.removeQueries({ queryKey: ['library'] })
      queryClient.removeQueries({ queryKey: AUTH_QUERY_KEY })
    }
    if (failure) throw failure
  }, [queryClient])

  const updateProfile = useCallback(async ({ displayName }: { displayName: string | null }): Promise<AuthProfile> => {
    const response = await apiClient.patch<ProfileResponse>('/auth/profile', { displayName })
    setLoginSession((current) => current ? { ...current, user: { ...current.user, ...response.profile } } : current)
    queryClient.setQueryData<AuthMeResponse>(AUTH_QUERY_KEY, (current) => current ? { ...current, user: { ...current.user, ...response.profile } } : current)
    return response.profile
  }, [queryClient])

  const uploadAvatar = useCallback(async (avatar: Blob): Promise<AuthProfile> => {
    const response = await apiClient.postRaw<ProfileResponse>('/auth/profile/avatar', avatar)
    setLoginSession((current) => current ? { ...current, user: { ...current.user, ...response.profile } } : current)
    queryClient.setQueryData<AuthMeResponse>(AUTH_QUERY_KEY, (current) => current ? { ...current, user: { ...current.user, ...response.profile } } : current)
    return response.profile
  }, [queryClient])

  const removeAvatar = useCallback(async (): Promise<AuthProfile> => {
    const response = await apiClient.request<ProfileResponse>('/auth/profile/avatar', { method: 'DELETE' })
    setLoginSession((current) => current ? { ...current, user: { ...current.user, ...response.profile } } : current)
    queryClient.setQueryData<AuthMeResponse>(AUTH_QUERY_KEY, (current) => current ? { ...current, user: { ...current.user, ...response.profile } } : current)
    return response.profile
  }, [queryClient])

  const markInitialSyncReady = useCallback(() => {
    setFirstSync((current) => current.status === 'syncing' ? { ...current, status: 'ready' } : current)
  }, [])

  const refresh = useCallback(() => meQuery.refetch(), [meQuery])
  const me = hasLoggedOut ? null : meQuery.data ?? null
  // The login result gives the shell an immediate user, while a subsequent
  // `/auth/me` response remains authoritative for profile updates from other
  // browser/device sessions.
  const user = hasLoggedOut ? null : me?.user ?? loginSession?.user ?? null
  const status: AuthStatus = user ? 'authenticated' : hasLoggedOut ? 'unauthenticated' : meQuery.isPending ? 'loading' : 'unauthenticated'

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    me,
    firstSync,
    login,
    logout,
    updateProfile,
    uploadAvatar,
    removeAvatar,
    markInitialSyncReady,
    refresh,
  }), [firstSync, login, logout, markInitialSyncReady, me, refresh, removeAvatar, status, updateProfile, uploadAvatar, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}

function isUnauthorized(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status?: unknown }).status === 401
}
