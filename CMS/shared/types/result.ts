/**
 * Every IPC call resolves to a Result. Errors are values, never thrown across
 * the process boundary, so the renderer always gets a predictable shape.
 */
export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STORAGE_ERROR'
  | 'INTERNAL_ERROR'
  /**
   * Stopped on purpose, having done everything up to the irreversible step.
   *
   * Not a failure: the work ran, and refusing to file the claim was the point
   * (DISABLE_SUBMIT). It is still a non-success — nothing was filed, so the
   * caller must not record a ticket — but anything that reports outcomes
   * should say "stopped", not "failed".
   */
  | 'DRY_RUN'

export interface AppError {
  code: AppErrorCode
  /** Safe to display to the user. Never contains stack traces or file paths. */
  message: string
  /** Field-level messages for form validation. */
  fields?: Record<string, string>
  /**
   * The backend refused the access token itself (HTTP 401 on a call that sent
   * one): expired, revoked by a logout elsewhere, or ended by a password
   * change. Signing in again is the only remedy, so a screen that cannot work
   * without a session should sign out rather than offer a retry that will be
   * refused the same way. Absent on every other failure; the `code` is
   * unchanged (still VALIDATION_ERROR) so no existing caller reads it
   * differently.
   */
  sessionEnded?: true
}

export type Result<T> = { success: true; data: T } | { success: false; error: AppError }

export const ok = <T>(data: T): Result<T> => ({ success: true, data })

export const fail = (code: AppErrorCode, message: string, fields?: Record<string, string>): Result<never> =>
  fields ? { success: false, error: { code, message, fields } } : { success: false, error: { code, message } }
