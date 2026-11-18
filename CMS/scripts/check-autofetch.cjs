/*
 * Does Create Claim still fill itself in from an AWB?
 *
 * WHAT THIS IS FOR. The form's auto-fetch is the part that cannot be unit
 * tested honestly: it is five backend lookups, a debounce each, and a chain of
 * effects that write into the form and place photographs into slots. The unit
 * tests cover the contract between them (tests/renderer/claimAutoFetchApi), and
 * this covers the thing itself — against the real backend, with a real AWB, in
 * the real window.
 *
 *   node --experimental-websocket scripts/check-autofetch.cjs AB10007C 5263527367247
 *
 * Arguments: the return AWB, then optionally a forward AWB. Both are looked up
 * on every platform the signed-in company has.
 *
 * READ-ONLY, DELIBERATELY. It types into fields and reads the screen back. It
 * never presses Save or Create Ticket, so it cannot file a claim — which is
 * what makes it safe to point at production data.
 *
 * IT RUNS ON A COPY OF THE SIGNED-IN PROFILE. The session and the company
 * document are copied to a temp directory first, for two reasons: Electron
 * holds a single-instance lock per profile, so it would otherwise refuse to
 * start while the operator has the app open; and nothing this script does can
 * reach the operator's own data. The copy is thrown away at the end.
 *
 * Sign in to the app once before running this — the copy needs a session to
 * copy. Without one it reports that and stops.
 */
const { spawn } = require('node:child_process')
const { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } = require('node:fs')
const { homedir, tmpdir } = require('node:os')
const { join } = require('node:path')

const projectDir = join(__dirname, '..')
const electron = require('electron')

const RETURN_AWB = process.argv[2] ?? process.env.RETURN_AWB
const FORWARD_AWB = process.argv[3] ?? process.env.FORWARD_AWB ?? ''
const PORT = Number(process.env.AUTOFETCH_PORT ?? 9448)

if (!RETURN_AWB) {
  console.error('Usage: node --experimental-websocket scripts/check-autofetch.cjs <returnAwb> [forwardAwb]')
  process.exit(2)
}

/** Where the installed app keeps its profile, per platform. */
const liveProfile = () => {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'trackvid-cms')
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'trackvid-cms')
  }

  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'trackvid-cms')
}

const source = liveProfile()

if (!existsSync(join(source, 'session.json'))) {
  console.error(`No signed-in session at ${source}. Open the app and sign in, then run this again.`)
  process.exit(2)
}

const userData = mkdtempSync(join(tmpdir(), 'trackvid-autofetch-'))
mkdirSync(join(userData, 'data'), { recursive: true })
copyFileSync(join(source, 'session.json'), join(userData, 'session.json'))
for (const optional of [['preferences.json'], ['data', 'company.json']]) {
  const from = join(source, ...optional)
  if (existsSync(from)) copyFileSync(from, join(userData, ...optional))
}

const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], {
  cwd: projectDir,
  stdio: ['ignore', 'pipe', 'pipe']
})
let appLog = ''
child.stdout.on('data', d => (appLog += d))
child.stderr.on('data', d => (appLog += d))

const wait = ms => new Promise(r => setTimeout(r, ms))
const cleanup = () => {
  child.kill()
  try {
    rmSync(userData, { recursive: true, force: true })
  } catch {
    // A locked file in a profile we are about to forget is not worth reporting.
  }
}

const findPage = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const target = (await res.json()).find(t => t.type === 'page' && t.webSocketDebuggerUrl)
      if (target) return target
    } catch {
      // The debugging endpoint is not up yet.
    }
    await wait(500)
  }
  throw new Error('the window never appeared')
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
      const onMessage = event => {
        const msg = JSON.parse(event.data)
        if (msg.id !== id) return
        ws.removeEventListener('message', onMessage)
        if (msg.error) {
          reject(new Error(JSON.stringify(msg.error)))
        } else {
          resolve(msg.result)
        }
      }
      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }

  await send('Runtime.enable')
  await wait(6000)

  if (await evaluate("document.body.innerText.includes('Welcome back')")) {
    console.error('The copied session did not restore — it has probably expired. Sign in again.')
    cleanup()
    process.exit(1)
  }

  await evaluate(`[...document.querySelectorAll('a')].find(a => a.getAttribute('href') === '/create-claim')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))`)
  await wait(2500)

  const typeInto = (name, value) => evaluate(`(() => {
    const el = [...document.querySelectorAll('input,textarea')].find(i => i.name === ${JSON.stringify(name)})
    if (!el) return false
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)

  /** Close whatever is open. A trapped focus stops the next platform switch. */
  const dismissDialogs = async () => {
    for (let i = 0; i < 4; i += 1) {
      const closed = await evaluate(`(() => {
        const d = [...document.querySelectorAll('[role=dialog]')].pop()
        if (!d) return false
        const btn = [...d.querySelectorAll('button')].find(b => /cancel|close|skip/i.test(b.textContent))
        if (btn) { btn.click(); return true }
        return false
      })()`)
      if (!closed) return
      await wait(600)
    }
  }

  /**
   * Choose a platform the way a person does: open the list, click the row.
   *
   * Two steps with the wait between them on THIS side rather than one async
   * expression in the page — a promise returned to the debugger can be
   * collected before it settles, which surfaces as "Promise was collected"
   * and kills the run.
   */
  const selectPlatform = async label => {
    await evaluate(`(() => {
      const el = [...document.querySelectorAll('input')].find(i => i.name === 'platform')
      if (!el) return false
      const arrow = el.closest('.MuiAutocomplete-root')?.querySelector('.MuiAutocomplete-popupIndicator')
      if (arrow) { arrow.click() } else { el.focus(); el.click() }
      return true
    })()`)
    await wait(900)

    /*
     * Matched by CONTAINS, and only against real options.
     *
     * Two traps. Each option renders a badge of the platform's initials as
     * text, so its textContent is "MEMeesho" rather than "Meesho" — an equality
     * match silently never fires and the platform quietly stays as it was. And
     * a bare li selector also matches the navigation, so the search has to be
     * scoped to role=option.
     *
     * A company also names its platforms however it likes ("Tata CLiQ",
     * "shopify") while the picker shows the registry's label where it has one
     * ("Nykaa" reaches the operator as "Nykaa Fashion"), so punctuation and
     * case are dropped on both sides.
     */
    return evaluate(`(() => {
      const want = ${JSON.stringify(label)}.toLowerCase().replace(/[^a-z0-9]/g, '')
      const hit = [...document.querySelectorAll('[role=option]')]
        .find(o => o.textContent.trim().toLowerCase().replace(/[^a-z0-9]/g, '').includes(want))
      if (!hit) return false
      hit.click()
      return true
    })()`)
  }

  const observe = async () => ({
    fields: await evaluate(`Object.fromEntries(
      [...document.querySelectorAll('input,textarea')]
        .filter(i => i.name && i.value && i.name !== 'feedId')
        .map(i => [i.name, i.value.slice(0, 60)]))`),
    videos: await evaluate("[...document.querySelectorAll('video')].filter(v => v.src || v.currentSrc).length"),
    images: await evaluate("[...document.querySelectorAll('img')].filter(i => i.src.startsWith('http')).length"),
    rearrangeAutoOpened: await evaluate(
      "/rearrange/i.test([...document.querySelectorAll('[role=dialog] h2, [role=dialog] h6')].map(h=>h.textContent).join(' '))"
    )
  })

  const platforms = await evaluate(`window.trackvid.invoke('claim-create:catalogue', {})
    .then(r => (r.success ? r.data.platforms.map(p => p.name) : []))`)

  console.log(`\nAuto-fetch check — return AWB ${RETURN_AWB}${FORWARD_AWB ? `, forward AWB ${FORWARD_AWB}` : ''}`)
  console.log(`${platforms.length} platform(s) on this company\n`)

  const rows = []
  for (const label of platforms) {
    // Empty the AWB before switching, or the refetch re-opens Rearrange over
    // the platform picker and the next switch never lands.
    await typeInto('AWBNumber', '')
    await typeInto('forwardAWB', '')
    await wait(700)
    await dismissDialogs()
    const switched = await selectPlatform(label)
    await wait(2200)
    await typeInto('AWBNumber', RETURN_AWB)
    await wait(7000)

    const seen = await observe()
    rows.push({ platform: label, switched, ...seen })
    console.log(
      `${switched ? '  ' : '! '}${label.padEnd(14)} ` +
        `fwd=${(seen.fields.forwardAWB ?? '—').padEnd(16)} ` +
        `video=${seen.videos} img=${seen.images} rearrange=${seen.rearrangeAutoOpened ? 'auto' : 'no'} ` +
        `${seen.fields.subOrderNumber ? 'subOrder=' + seen.fields.subOrderNumber : ''}`
    )
    await dismissDialogs()
  }

  if (FORWARD_AWB) {
    await typeInto('AWBNumber', '')
    await typeInto('forwardAWB', '')
    await wait(700)
    await dismissDialogs()
    await typeInto('forwardAWB', FORWARD_AWB)
    await wait(7000)
    const seen = await observe()
    console.log(`\n  forward-AWB cross-fill → return AWB = ${seen.fields.AWBNumber ?? '—'}`)
  }

  const filled = rows.filter(r => r.images > 0 || r.videos > 0 || r.fields.forwardAWB)
  console.log(`\n${filled.length} of ${rows.length} platform(s) auto-filled something for this AWB.`)
  console.log('A platform that filled nothing may simply have no master data for it.\n')

  ws.close()
  cleanup()
  process.exit(0)
}

run().catch(error => {
  console.error('check-autofetch failed:', error.message)
  console.error(appLog.slice(-2000))
  cleanup()
  process.exit(1)
})
