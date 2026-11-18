import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { SIGNED_OUT } from '@shared/types/auth'
import type { AuthUser, ImpersonateInput, LoginInput, SessionState } from '@shared/types/auth'
import type { AppError } from '@shared/types/result'
import { authClient } from '@renderer/services/auth.service'

/**
 * Holds the signed-in session for the whole renderer.
 *
 * `status` starts at 'loading' because a stored session is restored in the main
 * process - rendering the login screen before that answer arrives would flash
 * the form at every already-signed-in user.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface AuthApi {
  status: AuthStatus
  user: AuthUser | null
  loggedInAt: string | null
  /** The company this account belongs to. Null until its document arrives. */
  companyName: string | null
  /** Resolves to null on success, or the error to render on the form. */
  signIn: (credentials: LoginInput) => Promise<AppError | null>
  /** Signs in as another user by id, with no password. See auth.service. */
  signInAs: (input: ImpersonateInput) => Promise<AppError | null>
  signOut: () => Promise<void>
  /** Re-reads the session — picks up the company name once its document lands. */
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthApi | null>(null)

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [session, setSession] = useState<SessionState | null>(null)

  const apply = useCallback((next: SessionState) => {
    setSession(next)
    setStatus(next.authenticated ? 'authenticated' : 'unauthenticated')
  }, [])

  useEffect(() => {
    let cancelled = false

    void authClient.session().then((response) => {
      if (cancelled) return
      // A failed session probe means "not signed in", never a blocking error.
      apply(response.success ? response.data : SIGNED_OUT)
    })

    return () => {
      cancelled = true
    }
  }, [apply])

  const signIn = useCallback(
    async (credentials: LoginInput): Promise<AppError | null> => {
      const response = await authClient.login(credentials)
      if (!response.success) return response.error
      apply(response.data)
      return null
    },
    [apply]
  )

  const signInAs = useCallback(
    async (input: ImpersonateInput): Promise<AppError | null> => {
      const response = await authClient.impersonate(input)
      if (!response.success) return response.error
      apply(response.data)
      return null
    },
    [apply]
  )

  const signOut = useCallback(async (): Promise<void> => {
    const response = await authClient.logout()
    // Even if the main process failed to clear the file, the UI must return to
    // the login screen - leaving a signed-out user inside the app is worse.
    apply(response.success ? response.data : SIGNED_OUT)
  }, [apply])

  const refresh = useCallback(async (): Promise<void> => {
    const response = await authClient.session()
    // A failed re-read changes nothing: the session already on screen stands.
    if (response.success) apply(response.data)
  }, [apply])

  const api = useMemo<AuthApi>(
    () => ({
      status,
      user: session?.user ?? null,
      loggedInAt: session?.loggedInAt ?? null,
      companyName: session?.companyName ?? null,
      signIn,
      signInAs,
      signOut,
      refresh
    }),
    [status, session, signIn, signInAs, signOut, refresh]
  )

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>
}
