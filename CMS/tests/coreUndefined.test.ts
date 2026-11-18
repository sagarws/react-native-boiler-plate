import { describe, expect, it } from 'vitest'
import { Linter } from 'eslint'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * No core file may reference a name that does not exist.
 *
 * WHY THIS TEST EXISTS, and it is worth stating because the cost was real. A
 * Snapdeal claim failed in production with `fitAttachmentToLimit is not
 * defined`: the call was added, the `require` for it was not, and nothing
 * caught it. Not the core's build — it only emits types. Not `node --test` —
 * the core ships no tests. Not requiring the module — the reference sits inside
 * a function body, so loading the file evaluates nothing. The first thing to
 * execute that line was a real claim, four attempts deep, on a real account.
 *
 * The core has no linter of its own. It is a submodule with two consumers and
 * adding one is a decision for both; this runs the single rule that would have
 * caught it, from the ESLint this app already has, over the files this app
 * actually loads.
 *
 * ONLY `no-undef`. Not style, not unused variables, not anything arguable —
 * every one of those would need a sweep of existing code before this could pass,
 * and a test nobody can get green is a test somebody deletes.
 */

const CORE = join(process.cwd(), 'packages/TrackVid-Automation-Core')

/** Everything the core ships, minus what is generated or vendored. */
const SKIP = new Set(['node_modules', 'types', '.git', 'scripts', 'test', 'tests'])

const jsFilesIn = (dir: string): string[] => {
  const out: string[] = []

  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue

    const full = join(dir, entry)

    if (statSync(full).isDirectory()) out.push(...jsFilesIn(full))
    else if (entry.endsWith('.js')) out.push(full)
  }

  return out
}

const linter = new Linter({ configType: 'flat' })

describe('every core file', () => {
  it('references only names that exist', () => {
    const files = jsFilesIn(CORE)

    // A sanity floor: a glob that silently matched nothing would make this
    // test pass for ever while checking no code at all.
    expect(files.length).toBeGreaterThan(50)

    const broken: string[] = []

    for (const file of files) {
      const messages = linter.verify(readFileSync(file, 'utf8'), {
        languageOptions: {
          ecmaVersion: 2023,
          sourceType: 'commonjs',
          globals: {
            require: 'readonly',
            module: 'writable',
            exports: 'writable',
            process: 'readonly',
            console: 'readonly',
            Buffer: 'readonly',
            __dirname: 'readonly',
            __filename: 'readonly',
            setTimeout: 'readonly',
            clearTimeout: 'readonly',
            setInterval: 'readonly',
            clearInterval: 'readonly',
            setImmediate: 'readonly',
            URL: 'readonly',
            URLSearchParams: 'readonly',
            TextEncoder: 'readonly',
            TextDecoder: 'readonly',
            AbortController: 'readonly',
            fetch: 'readonly',
            structuredClone: 'readonly',
            globalThis: 'readonly',
            // Page-context callbacks: these run inside the BROWSER, serialised
            // by Puppeteer or Selenium, where the document is real.
            window: 'readonly',
            document: 'readonly',
            navigator: 'readonly',
            location: 'readonly',
            localStorage: 'readonly',
            sessionStorage: 'readonly',
            getComputedStyle: 'readonly',
            Node: 'readonly',
            NodeFilter: 'readonly',
            Element: 'readonly',
            HTMLElement: 'readonly',
            MutationObserver: 'readonly',
            XMLHttpRequest: 'readonly',
            FormData: 'readonly',
            Blob: 'readonly',
            File: 'readonly',
            FileReader: 'readonly',
            atob: 'readonly',
            btoa: 'readonly',
            alert: 'readonly',
            Event: 'readonly',
            MouseEvent: 'readonly',
            KeyboardEvent: 'readonly',
            XPathResult: 'readonly',
            Notification: 'readonly',
            DOMParser: 'readonly',
            CustomEvent: 'readonly'
          }
        },
        rules: { 'no-undef': 'error' }
      })

      for (const message of messages) {
        if (message.ruleId !== 'no-undef') continue

        broken.push(`${file.slice(CORE.length + 1)}:${message.line} — ${message.message}`)
      }
    }

    expect(broken).toEqual([])
    // Lints every core file: ~1s alone, but 6–10s when the full suite runs in
    // parallel, which overran the 5s default and failed the build on time
    // rather than on anything it found.
  }, 60_000)

  it('would have caught the bug that prompted this test', () => {
    // The exact shape of it: a call added, its `require` forgotten, sitting
    // inside a function body where nothing evaluates it until a real claim
    // does. If this ever stops reporting, the test above is decoration.
    const messages = linter.verify(
      'async function upload(file) {\n  return fitAttachmentToLimit(file, {});\n}\nmodule.exports = { upload };\n',
      {
        languageOptions: {
          ecmaVersion: 2023,
          sourceType: 'commonjs',
          globals: { module: 'writable' }
        },
        rules: { 'no-undef': 'error' }
      }
    )

    expect(messages.map(message => message.message)).toContain(
      "'fitAttachmentToLimit' is not defined."
    )
  })
})
