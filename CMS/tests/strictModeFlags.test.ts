import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A flag set by an effect's cleanup must be cleared by its setup.
 *
 * THE BUG THIS EXISTS FOR. React runs an effect setup → cleanup → setup under
 * StrictMode, deliberately, to surface state that does not survive a remount.
 * Several hooks on the claim form keep an `unmountedRef` so a late response
 * cannot write into a torn-down form:
 *
 *     useEffect(() => () => { unmountedRef.current = true }, [])
 *
 * Written that way the flag is set by the simulated unmount and never cleared,
 * so from the very first render every lookup returns early at its guard. The
 * operator types an AWB and nothing arrives — no forward AWB, no video, no
 * screenshots, no Rearrange modal — and nothing errors.
 *
 * It does not reproduce in a production build, where StrictMode does not
 * double-invoke. That asymmetry is why this is a STATIC check: the behaviour is
 * correct in every build a test would normally run against, and only wrong in
 * the one developers actually use.
 *
 * TrackVid-FE carries the same shape and never sees it, because its StrictMode
 * is commented out. Ours is not, and should stay that way.
 */

const root = resolve(__dirname, '..', 'electron/renderer/pages/claims/create')

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry: string) => {
    const full = join(dir, entry)

    if (statSync(full).isDirectory()) return sourceFiles(full)

    return /\.tsx?$/.test(entry) ? [full] : []
  })

/** `something.current = true` written inside an effect's returned cleanup. */
const CLEANUP_BLOCK = /return\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\};/g
const SET_TRUE = /(\w+)\.current\s*=\s*true/g

describe('flags that an effect cleanup sets', () => {
  const offenders: string[] = []

  for (const file of sourceFiles(root)) {
    const source = readFileSync(file, 'utf8')

    for (const cleanup of source.matchAll(CLEANUP_BLOCK)) {
      for (const [, ref] of (cleanup[1] ?? '').matchAll(SET_TRUE)) {
        // The same ref has to be cleared somewhere in the file — which, for
        // every case here, is the setup directly above the cleanup.
        if (!source.includes(`${ref}.current = false`)) {
          offenders.push(`${relative(root, file)} — ${ref} is set on cleanup and never cleared`)
        }
      }
    }
  }

  it('are cleared again on setup, so a StrictMode remount does not disable them', () => {
    expect(offenders).toEqual([])
  })

  it('actually found the guards it is meant to be checking', () => {
    // Without this the test above passes just as happily when the regex stops
    // matching anything at all.
    const guarded = sourceFiles(root).filter((file) =>
      readFileSync(file, 'utf8').includes('unmountedRef.current = false')
    )

    expect(guarded.length).toBeGreaterThanOrEqual(3)
  })
})
