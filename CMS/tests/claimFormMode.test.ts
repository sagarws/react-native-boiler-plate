import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every field of `ClaimFormModeApi` survives the provider's memo.
 *
 * THE BUG THIS EXISTS FOR. The provider does not pass `value` through — it
 * destructures the fields it knows about and rebuilds the object, to avoid
 * re-rendering every consumer on each keystroke. So a field added to the
 * interface and passed by the page is SILENTLY DROPPED unless it is also added
 * to the destructure, the returned object and the dependency array.
 *
 * `lookupSource` — the API/Report toggle — was added in exactly that way. The
 * toggle moved, the log said REPORT, and every lookup still went to AJIO,
 * because the form read `undefined` and fell back to the default. Nothing
 * failed: the rebuilt object still satisfies the interface, since the field is
 * optional, so neither the compiler nor any runtime check had anything to say.
 *
 * Read as TEXT rather than rendered, deliberately. The fault is one of omission
 * — a field that is not mentioned — and a render test can only catch the fields
 * somebody remembered to assert on. Comparing the interface against the memo
 * catches the next one too.
 */

const source = readFileSync(
  join(process.cwd(), 'electron/renderer/pages/claims/create/ClaimFormMode.tsx'),
  'utf8'
)

/** Field names declared on the interface, comments and types stripped. */
const declaredFields = (): string[] => {
  const body = source.slice(
    source.indexOf('export interface ClaimFormModeApi'),
    source.indexOf('const CREATE')
  )

  return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map(match => match[1] ?? '')
}

describe('the claim-form-mode provider', () => {
  it('carries every declared field through its memo', () => {
    /*
     * THE RETURNED OBJECT ONLY — `() => ({ … })` — not the whole memo block.
     *
     * Checking the block was useless and this test proved it: putting the bug
     * back still passed, because the dependency array below mentions every
     * field whether or not the object does. The object is the thing consumers
     * actually receive.
     */
    const built = source.slice(source.indexOf('() => ({'), source.indexOf('})', source.indexOf('() => ({')))
    const destructured = source.slice(source.indexOf('const {'), source.indexOf('const memoised'))
    const missing = declaredFields().filter(
      field => !built.includes(field) || !destructured.includes(field)
    )

    expect(missing).toEqual([])
  })

  it('knows about more than the original four', () => {
    // A floor: if the interface is ever reduced to the fields that were there
    // when the bug happened, the test above would pass trivially.
    expect(declaredFields().length).toBeGreaterThanOrEqual(5)
    expect(declaredFields()).toContain('lookupSource')
  })
})
