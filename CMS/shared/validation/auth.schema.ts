import { z } from 'zod'

/**
 * Login input is validated in the main process before any network call, so a
 * malformed IPC payload never reaches the API.
 */
export const loginInputSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(160, 'Email is too long')
    .pipe(z.email('Enter a valid email address')),
  password: z.string().min(1, 'Password is required').max(128, 'Password is too long')
})

export type LoginFormValues = z.infer<typeof loginInputSchema>

/**
 * Impersonation takes a Mongo ObjectId and nothing else.
 *
 * Validated to 24 hex characters here so a typo fails in the app rather than
 * becoming a request that mints a token for whatever it happens to match.
 */
export const impersonateInputSchema = z.object({
  userId: z
    .string()
    .trim()
    .regex(/^[a-f\d]{24}$/i, 'Enter a 24-character user ID')
})

export type ImpersonateFormValues = z.infer<typeof impersonateInputSchema>
