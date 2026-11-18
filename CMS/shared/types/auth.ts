/**
 * Authentication types shared by main, preload and renderer.
 *
 * The TrackVid API returns a nested user document (name.firstName, phone.code,
 * …). It is flattened into AuthUser inside the main process so the renderer
 * never has to know the API's wire format, and so a backend field rename is a
 * one-file change.
 */
export interface AuthUser {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName: string
  /** Rendered as-is; already combined from phone.code + phone.number. */
  phone: string
  companyId: string
  role: string
}

export interface LoginInput {
  email: string
  password: string
}

/**
 * The renderer's whole view of the session. The access token is deliberately
 * absent: it never leaves the main process.
 */
export interface SessionState {
  authenticated: boolean
  user: AuthUser | null
  /** ISO timestamp of the last successful login, or null when signed out. */
  loggedInAt: string | null
  /**
   * The company this account belongs to, by name.
   *
   * NOT ON `AuthUser`, because the login response does not carry it — that
   * gives an id. The name is on the company document this machine already
   * holds, so it is read from there and attached here rather than fetched
   * again. Null when the document has not arrived yet, which is the first
   * moments of a fresh sign-in.
   */
  companyName: string | null
}

export const SIGNED_OUT: SessionState = {
  authenticated: false,
  user: null,
  loggedInAt: null,
  companyName: null
}

/** Signing in as another user, by id, with no password. */
export interface ImpersonateInput {
  userId: string
}
