/* End-to-end check: boots the built app in an isolated userData dir, then drives
   it over the DevTools protocol to prove the renderer + preload + IPC + storage
   path all work together. Uses only Node built-ins. */
const { spawn } = require('node:child_process')
const { mkdtempSync, existsSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')


const projectDir = join(__dirname, '..', '..')
/*
 * TRACKVID_E2E_APP points this harness at a packaged binary, e.g.
 *   TRACKVID_E2E_APP="release/0.1.0/mac-arm64/TrackVid CMS.app/Contents/MacOS/TrackVid CMS" node tests/e2e/smoke.cjs
 * With it unset, the development build is launched instead.
 */
const packagedApp = process.env.TRACKVID_E2E_APP
const electron = packagedApp ?? require('electron')
const userData = mkdtempSync(join(tmpdir(), 'trackvid-e2e-'))
const PORT = 9333

const launchArgs = packagedApp ? [] : ['.']
const child = spawn(electron, [...launchArgs, `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], {
  cwd: projectDir,
  stdio: ['ignore', 'pipe', 'pipe']
})
let appLog = ''
child.stdout.on('data', (d) => (appLog += d))
child.stderr.on('data', (d) => (appLog += d))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const findPage = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // The debugging endpoint is not up yet; retry until the deadline.
    }
    await wait(500)
  }
  throw new Error('DevTools target never appeared')
}

const run = async () => {
  const page = await findPage()
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })

  let nextId = 0
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      const onMessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.id !== id) return
        ws.removeEventListener('message', onMessage)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ id, method, params }))
    })

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
    return r.result.value
  }

  await send('Runtime.enable')
  await wait(1500) // let React mount

  const checks = {}
  checks.title = await evaluate('document.title')
  checks.bridgeExposed = await evaluate('typeof window.trackvid?.invoke === "function"')
  checks.nodeLeaks = await evaluate(
    'typeof window.require === "undefined" && typeof window.process === "undefined" && typeof window.module === "undefined"'
  )
  checks.heading = await evaluate('document.querySelector("h1")?.textContent')
  // The app shell is behind the auth gate now: with no stored session the
  // renderer must show the login screen and nothing from the members module.
  checks.membersHiddenWhenSignedOut = await evaluate(
    '!document.body.innerText.includes("No members yet") && !document.body.innerText.includes("Add member")'
  )

  // Auth surface: a signed-out session, and validation that runs BEFORE any
  // network call so this check works offline.
  checks.auth = await evaluate(`(async () => {
    const api = window.trackvid
    const session = await api.invoke('auth:session')
    const invalid = await api.invoke('auth:login', { email: 'not-an-email', password: '' })
    return {
      signedOut: session.success && session.data.authenticated === false,
      tokenNeverExposed: session.success && !('token' in session.data) && !('accessToken' in session.data),
      invalidRejected: !invalid.success && Object.keys(invalid.error.fields ?? {}).sort().join(',')
    }
  })()`)

  // The update check must always resolve to a Result, network or not. In an
  // unpacked dev build the updater must report 'unsupported' rather than throw.
  checks.update = await evaluate(`(async () => {
    const status = await window.trackvid.invoke('update:check')
    return {
      resolved: status.success,
      current: status.success ? status.data.current : null,
      phase: status.success ? status.data.phase : null,
      mandatoryIsBoolean: status.success && typeof status.data.mandatory === 'boolean'
    }
  })()`)

  // Theme preferences: the id must reach the renderer synchronously at first
  // paint (via argv), survive a round trip, and reject anything unknown.
  checks.theme = await evaluate(`(async () => {
    const api = window.trackvid
    const before = await api.invoke('preferences:get')
    const bad = await api.invoke('preferences:set-theme', { theme: 'neon-disco' })
    const good = await api.invoke('preferences:set-theme', { theme: 'ocean' })
    const after = await api.invoke('preferences:get')
    return {
      initialThemeExposed: typeof api.initialTheme === 'string' && api.initialTheme.length > 0,
      defaultsToSunset: before.success && before.data.theme === 'sunset',
      unknownRejected: !bad.success && bad.error.code === 'VALIDATION_ERROR',
      applied: good.success && good.data.theme === 'ocean',
      readBack: after.success && after.data.theme === 'ocean',
      documentAttribute: document.documentElement.getAttribute('data-theme')
    }
  })()`)

  // The push channel is a new hole in the boundary: prove it is allow-listed
  // separately from invoke, and that unsubscribing is always possible.
  checks.subscribe = await evaluate(`(() => {
    const api = window.trackvid
    const offAllowed = api.subscribe('update:status-changed', () => {})
    const offRejected = api.subscribe('members:delete', () => {})
    const offUnknown = api.subscribe('anything:at-all', () => {})
    offAllowed(); offRejected(); offUnknown()
    return {
      exposed: typeof api.subscribe === 'function',
      // A rejected channel still returns a callable, so cleanup never throws.
      alwaysReturnsUnsubscribe: [offAllowed, offRejected, offUnknown].every((f) => typeof f === 'function'),
      // An invoke channel must NOT be subscribable.
      invokeChannelNotSubscribable: offRejected.toString() === offUnknown.toString()
    }
  })()`)

  // Full CRUD round trip through the real preload bridge and IPC layer.
  checks.crud = await evaluate(`(async () => {
    const api = window.trackvid
    const created = await api.invoke('members:create', { name: 'Ada Lovelace', email: 'ADA@Example.com ', phone: '+1 555 0100', status: 'active' })
    if (!created.success) return { step: 'create', error: created.error }
    const dupe = await api.invoke('members:create', { name: 'Copy', email: 'ada@example.com', phone: '+1 555 0101', status: 'active' })
    const invalid = await api.invoke('members:create', { name: 'X', email: 'bad', phone: 'abc', status: 'nope' })
    const updated = await api.invoke('members:update', { id: created.data.id, data: { name: 'Ada L', email: 'ada@example.com', phone: '+1 555 0100', status: 'pending' } })
    const listed = await api.invoke('members:list', { page: 1, pageSize: 10, search: 'ada', sortBy: 'name', sortDirection: 'asc', filters: { status: 'pending' } })
    const blocked = await api.invoke('members:destroy-everything', {})
    const removed = await api.invoke('members:delete', { id: created.data.id })
    const after = await api.invoke('members:list', {})
    return {
      createdEmailNormalised: created.data.email,
      duplicateRejected: !dupe.success && dupe.error.code === 'CONFLICT',
      invalidRejected: !invalid.success && Object.keys(invalid.error.fields ?? {}).sort().join(','),
      updatedStatus: updated.success && updated.data.status,
      searchFilterHit: listed.success && listed.data.total,
      unknownChannelBlocked: !blocked.success,
      deleted: removed.success,
      remaining: after.success && after.data.total
    }
  })()`)

  // The six-side PDF's image path, under the window's REAL CSP. `fetch` of a
  // data URL is refused by `connect-src 'self'` — which is why imageToPdf
  // decodes the string instead — and the decoded bytes must still be an image
  // createImageBitmap accepts. A 1×1 PNG stands in for a stored photograph.
  checks.sixSide = await evaluate(`(async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    let fetchDataBlocked = false
    try { await fetch('data:image/png;base64,' + png) } catch { fetchDataBlocked = true }
    const bin = atob(png)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
    let decoded = false
    try {
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      decoded = bitmap.width === 1 && bitmap.height === 1
      bitmap.close()
    } catch {}
    const channel = await window.trackvid.invoke('claim-resources:read-image', { url: 'data:image/png;base64,' + png })
    return { fetchDataBlocked, decoded, readImageChannel: channel.success === true }
  })()`)

  await wait(600)
  const prefsFile = join(userData, 'preferences.json')
  checks.themePersisted = existsSync(prefsFile)
    ? JSON.parse(readFileSync(prefsFile, 'utf8')).theme
    : null

  const storeFile = join(userData, 'data', 'members.json')
  checks.storeFileWritten = existsSync(storeFile)
  checks.storeContents = checks.storeFileWritten ? JSON.parse(readFileSync(storeFile, 'utf8')).length : null

  ws.close()
  return checks
}

run()
  .then((checks) => {
    console.log(JSON.stringify(checks, null, 2))
    console.log('--- app log ---\n' + appLog.trim())
    child.kill('SIGTERM')
    const c = checks.crud
    const pass =
      checks.bridgeExposed &&
      checks.nodeLeaks &&
      checks.heading === 'Welcome back' &&
      checks.membersHiddenWhenSignedOut &&
      checks.auth.signedOut &&
      checks.auth.tokenNeverExposed &&
      checks.auth.invalidRejected === 'email,password' &&
      checks.update.resolved &&
      checks.update.phase === 'unsupported' &&
      checks.update.mandatoryIsBoolean &&
      checks.theme.initialThemeExposed &&
      checks.theme.defaultsToSunset &&
      checks.theme.unknownRejected &&
      checks.theme.applied &&
      checks.theme.readBack &&
      checks.themePersisted === 'ocean' &&
      checks.subscribe.exposed &&
      checks.subscribe.alwaysReturnsUnsubscribe &&
      checks.subscribe.invokeChannelNotSubscribable &&
      checks.sixSide.fetchDataBlocked &&
      checks.sixSide.decoded &&
      checks.sixSide.readImageChannel &&
      c.createdEmailNormalised === 'ada@example.com' &&
      c.duplicateRejected &&
      c.invalidRejected === 'email,name,phone,status' &&
      c.updatedStatus === 'pending' &&
      c.searchFilterHit === 1 &&
      c.unknownChannelBlocked &&
      c.deleted &&
      c.remaining === 0 &&
      checks.storeFileWritten
    console.log('\nE2E RESULT:', pass ? 'PASS' : 'FAIL')
    setTimeout(() => process.exit(pass ? 0 : 1), 500)
  })
  .catch((error) => {
    console.error('E2E ERROR:', error.message)
    console.error('--- app log ---\n' + appLog.trim())
    child.kill('SIGTERM')
    setTimeout(() => process.exit(1), 500)
  })
