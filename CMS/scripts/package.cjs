/* Packaging entry point: validate the update feed URL, then run electron-builder.
 *
 * Why this exists rather than calling electron-builder directly:
 *
 * publish.url in electron-builder.yml is ${env.MAIN_VITE_API_BASE_URL}, and
 * electron-builder reads that from the environment only. If it is missing the
 * build still SUCCEEDS - it just bakes an empty feed URL into app-update.yml,
 * and every copy shipped from that build can never update itself. There is no
 * way to repair those installs afterwards, because the mechanism for telling
 * them the new address is the thing that broke.
 *
 * So this script fails loudly instead, and reads .env as a fallback so the
 * value lives in one place rather than in everyone's shell history.
 *
 * Arguments are passed straight through: node scripts/package.cjs --win --x64
 */
const { spawn } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const { report } = require('./signingPlan.cjs')

/*
 * ONE URL for the API and the releases — the same key the app talks to, so
 * there is one address in .env rather than two that must agree.
 *
 * Which makes this check the load-bearing part: the development value in .env
 * is now within reach of a shipped installer. A build cut while it points at
 * localhost would bake that into app-update.yml, and every copy from it could
 * never update. So anything that is not a public https URL stops the build.
 */
const KEY = 'MAIN_VITE_API_BASE_URL'
const envFile = join(__dirname, '..', '.env')

/** Minimal .env reader: KEY=value, optionally quoted, # starts a comment line. */
const loadEnvFile = () => {
  if (!existsSync(envFile)) return
  for (const rawLine of readFileSync(envFile, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator === -1) continue

    const key = line.slice(0, separator).trim()
    // A real environment variable always wins over the file, so a one-off
    // override on the command line still works.
    if (key === '' || process.env[key] !== undefined) continue

    process.env[key] = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }
}

const fail = (message) => {
  console.error(`\n  Cannot package: ${message}\n`)
  console.error(`  Set ${KEY} in .env, or pass it for one build:`)
  console.error(`    ${KEY}="https://api.trackvid.in" npm run build:win:x64\n`)
  console.error('  It is the HOST ROOT for both halves: the API under /api, and the')
  console.error('  releases (latest.yml, the installers, /cms/version) at the root.')
  console.error('  It is baked into app-update.yml and cannot be changed afterwards.\n')
  process.exit(1)
}

/** Localhost and friends: reachable on the machine that built it, nowhere else. */
const isLocal = (value) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(value)

loadEnvFile()

const url = (process.env[KEY] ?? '').trim()

if (url === '') fail(`${KEY} is not set.`)
if (isLocal(url)) {
  fail(
    `${KEY} is "${url}". That address only exists on this machine, and it would be baked ` +
      'into every installer from this build permanently — switch .env to the public host first.'
  )
}
if (!url.startsWith('https://')) {
  fail(`${KEY} must be https, got "${url}". Updates download executables; plain http is not acceptable.`)
}

console.log(`  API and update feed: ${url}`)

const args = process.argv.slice(2)

/*
 * Say what will happen about signing before it happens.
 *
 * electron-builder signs when it finds a certificate and quietly does not when
 * it cannot, which makes an unsigned release indistinguishable from a signed
 * one until somebody downloads it. The plan is printed every run; a release
 * passes --require-signing and the run refuses rather than shipping something
 * Gatekeeper will reject.
 *
 * Read from the environment AFTER loadEnvFile, so .env works here exactly as it
 * does for the feed URL — one place for the values, not everyone's shell.
 */
const strict = args.includes('--require-signing')
// Ours, not electron-builder's: it would reject an unknown flag.
const builderArgs = args.filter((arg) => arg !== '--require-signing')

const platforms = []

if (builderArgs.includes('--mac')) platforms.push('mac')
if (builderArgs.includes('--win')) platforms.push('win')
// No platform flag means electron-builder targets the host.
if (platforms.length === 0) platforms.push(process.platform === 'darwin' ? 'mac' : 'win')

if (!report({ platforms, strict })) process.exit(1)

/*
 * electron-builder's own CLI, run with this Node — not `npx`. Without a shell,
 * Windows cannot start `npx` (it is `npx.cmd`) and the spawn fails with
 * ENOENT; running the script directly behaves the same on every platform.
 */
const builderCli = require.resolve('electron-builder/cli.js')

const child = spawn(process.execPath, [builderCli, ...builderArgs], {
  stdio: 'inherit',
  env: process.env,
  // electron-builder resolves config relative to the working directory.
  cwd: join(__dirname, '..')
})

child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)))
child.on('error', (error) => fail(`could not start electron-builder: ${error.message}`))
