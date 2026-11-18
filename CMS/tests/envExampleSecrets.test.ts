import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `.env.example` is committed, so whatever is in it is published.
 *
 * THIS HAS HAPPENED. The file carried a working TrackVid login — and because
 * LoginPage read it without a `DEV` guard, Vite inlined the same password into
 * the renderer bundle, where `npx asar extract` reached it. Two failures, one
 * value: a secret in a tracked file, and a secret in a shipped artifact.
 *
 * A comment saying "do not put a real password here" did not stop it, so this
 * does. Anything that looks like a credential has to be blank or an obvious
 * placeholder; the real value belongs in `.env`, which is git-ignored.
 */

const EXAMPLE = readFileSync(join(__dirname, '..', '.env.example'), 'utf8')

/** Keys whose value would be a credential if it were real. */
const SECRET_KEY = /(PASSWORD|SECRET|TOKEN|APIKEY|API_KEY|ACCESS_KEY|CREDENTIAL)/

/**
 * Values that say "fill this in" rather than being a usable secret. Kept
 * deliberately short — a placeholder nobody could mistake for a password.
 */
const PLACEHOLDER = /^(|your-[a-z0-9-]*|<[^>]+>|changeme|xxx+|placeholder|todo)$/i

const assignments = EXAMPLE.split('\n')
  .map(line => line.trim())
  .filter(line => line.length > 0 && !line.startsWith('#'))
  .map(line => {
    const at = line.indexOf('=')

    if (at === -1) return null

    return {
      key: line.slice(0, at).trim(),
      // Unquoted, so a quoted secret cannot slip past by looking like `"x"`.
      value: line
        .slice(at + 1)
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .replace(/^'(.*)'$/, '$1')
    }
  })
  .filter((entry): entry is { key: string; value: string } => entry !== null)

describe('.env.example carries no real secret', () => {
  it('parses as key=value, so the check below is actually looking at something', () => {
    expect(assignments.length).toBeGreaterThan(5)
  })

  it('leaves every credential-shaped key blank or an obvious placeholder', () => {
    const offenders = assignments
      .filter(entry => SECRET_KEY.test(entry.key) && !PLACEHOLDER.test(entry.value))
      // Named, not shown: a failure message must not reprint the secret it
      // just caught into CI logs.
      .map(entry => entry.key)

    expect(offenders).toEqual([])
  })

  /**
   * The login prefill specifically, because that is the pair that leaked and
   * the email half is just as inlineable as the password half.
   */
  it('ships no login prefill — that pair is what reached app.asar', () => {
    const prefill = assignments.filter(entry => entry.key.startsWith('RENDERER_VITE_LOGIN_'))

    expect(prefill.length).toBeGreaterThan(0)
    expect(prefill.filter(entry => entry.value !== '').map(entry => entry.key)).toEqual([])
  })
})
