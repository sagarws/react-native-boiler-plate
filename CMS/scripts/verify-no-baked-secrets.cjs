#!/usr/bin/env node
/*
 * Refuses to ship a build that carries a secret from .env.
 *
 * THIS IS NOT HYPOTHETICAL. A login email and password sat in
 * out/renderer/assets/AppRoot-*.js as literal strings, because Vite inlines
 * every MAIN_VITE_* and RENDERER_VITE_* key at build time and LoginPage read
 * the pair without a `DEV` guard. `npx asar extract` reached them in one
 * command. A comment warning about it had been sitting directly above the code
 * that did it, so the comment is not the control — this is.
 *
 * IT CHECKS THE ARTIFACT, NOT THE SOURCE, and that is the point. Whether a
 * value arrives through `import.meta.env`, a default, a string concatenation or
 * a copy somebody pasted, the question is the same: is it in what we hand out.
 * Grepping the built output answers that; reading the source only answers what
 * the source looked like today.
 *
 * It never prints a value it finds, not even partially, because this runs in CI
 * and a build log is not a safe place to reprint a password.
 */

const { readFileSync, readdirSync, statSync, existsSync } = require('node:fs')
const { join, relative, sep } = require('node:path')

const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'out')
const ENV = join(ROOT, '.env')

/** Values shorter than this are words, not secrets, and would match everything. */
const MIN_SECRET_LENGTH = 6

/**
 * Keys worth checking.
 *
 * Every key is checked for presence in the bundle, not only credential-shaped
 * ones: an API base URL being inlined is expected and fine, so the severity
 * comes from the NAME, while the search covers everything.
 */
const SECRET_NAME =
  /(PASSWORD|SECRET|TOKEN|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL|SESSION|COOKIE|EMAIL)/

/**
 * Credential-shaped keys the build is MEANT to carry, and the one place each
 * may appear.
 *
 * The TrackVid OTP mailbox: one shared Gmail inbox whose login the desktop app
 * reads codes with, filtered to each credential's own address — the check-otp
 * arrangement. Shipping it is a deliberate product decision (no server relay,
 * no per-machine setup), taken knowing that anyone with the installer can
 * extract it. Allowed in the MAIN-process bundle only: the renderer and the
 * preload never need it, and a copy there still fails the build.
 */
const ALLOWED_IN_MAIN = new Set(['MAIN_VITE_GMAIL_IMAP_USER', 'MAIN_VITE_GMAIL_IMAP_PASSWORD'])

const MAIN_BUNDLE = join('out', 'main') + sep

const parseEnv = (text) => {
  const out = new Map()

  for (const line of text.split('\n')) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) continue

    const at = trimmed.indexOf('=')

    if (at === -1) continue

    const key = trimmed.slice(0, at).trim()
    const value = trimmed
      .slice(at + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .replace(/^'(.*)'$/, '$1')

    if (value.length >= MIN_SECRET_LENGTH) out.set(key, value)
  }

  return out
}

const walk = (dir, files = []) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)

    if (statSync(path).isDirectory()) walk(path, files)
    else files.push(path)
  }

  return files
}

if (!existsSync(ENV)) {
  console.log('verify:secrets — no .env on this machine, nothing to check against')
  process.exit(0)
}

if (!existsSync(OUT)) {
  console.error('verify:secrets — out/ is missing. Run this AFTER the build, on the real artifact.')
  process.exit(1)
}

const values = parseEnv(readFileSync(ENV, 'utf8'))
const files = walk(OUT)
const findings = []

for (const [key, value] of values) {
  const hits = files.filter((file) => {
    try {
      return readFileSync(file, 'utf8').includes(value)
    } catch {
      // A binary that cannot be read as text is not where a secret hides in a
      // JS bundle; skipping it is not a gap worth failing the build over.
      return false
    }
  })

  if (hits.length > 0) findings.push({ key, files: hits.map((hit) => relative(ROOT, hit)) })
}

const allowed = (finding) =>
  ALLOWED_IN_MAIN.has(finding.key) && finding.files.every((file) => file.startsWith(MAIN_BUNDLE))

const secrets = findings.filter((finding) => SECRET_NAME.test(finding.key) && !allowed(finding))

for (const finding of findings) {
  const severity = !SECRET_NAME.test(finding.key) ? 'inlined' : allowed(finding) ? 'allowed' : 'SECRET'

  console.log(`  ${severity.padEnd(7)} ${finding.key} -> ${finding.files.join(', ')}`)
}

if (secrets.length > 0) {
  console.error(
    `\nverify:secrets — ${secrets.length} credential-shaped value from .env is inside the build.\n` +
      'Read it behind `import.meta.env.DEV` so it is dead-stripped, or move it out of the\n' +
      'client entirely. A secret the app can read is a secret its user can read.'
  )
  process.exit(1)
}

console.log(
  `verify:secrets — ${files.length} built file(s) checked against ${values.size} .env value(s), ` +
    'no credential inlined'
)
