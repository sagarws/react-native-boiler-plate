import { describe, expect, it } from 'vitest'
import { impersonateInputSchema, loginInputSchema } from '@shared/validation/auth.schema'

describe('loginInputSchema', () => {
  const valid = { email: '  Ada@Example.com ', password: 'correct horse battery' }

  it('trims and lower-cases the email', () => {
    expect(loginInputSchema.parse(valid).email).toBe('ada@example.com')
  })

  it('keeps the password byte-for-byte', () => {
    // Trimming a password would silently reject a legitimate credential.
    const parsed = loginInputSchema.parse({ ...valid, password: '  spaced  ' })
    expect(parsed.password).toBe('  spaced  ')
  })

  it('rejects a malformed email', () => {
    expect(loginInputSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false)
  })

  it('rejects an empty password', () => {
    expect(loginInputSchema.safeParse({ ...valid, password: '' }).success).toBe(false)
  })
})

describe('impersonateInputSchema', () => {
  it('accepts a 24-character ObjectId', () => {
    const parsed = impersonateInputSchema.parse({ userId: '6a3a629dfc3a2a4d651870bd' })
    expect(parsed.userId).toBe('6a3a629dfc3a2a4d651870bd')
  })

  it('accepts uppercase hex', () => {
    expect(impersonateInputSchema.safeParse({ userId: '6A3A629DFC3A2A4D651870BD' }).success).toBe(true)
  })

  it('trims surrounding whitespace', () => {
    expect(impersonateInputSchema.parse({ userId: '  6a3a629dfc3a2a4d651870bd  ' }).userId).toBe(
      '6a3a629dfc3a2a4d651870bd'
    )
  })

  it('rejects an id that is too short', () => {
    expect(impersonateInputSchema.safeParse({ userId: '6a3a629dfc3a' }).success).toBe(false)
  })

  it('rejects non-hex characters', () => {
    expect(impersonateInputSchema.safeParse({ userId: 'zzza629dfc3a2a4d651870bd' }).success).toBe(false)
  })

  it('rejects an empty value', () => {
    expect(impersonateInputSchema.safeParse({ userId: '' }).success).toBe(false)
  })
})
