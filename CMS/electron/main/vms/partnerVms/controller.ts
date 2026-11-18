import { WebContentsView, powerSaveBlocker, session, type BrowserWindow, type Session } from 'electron'
import { placeView } from '@shared/vms/partnerVms'
import { logger } from '../../services/logger'
import { DEFAULT_FLOW, flowOrigin } from './flowConfig'
import { buildInjection } from './injection'
import {
  classifyProbe,
  isFlowOrigin,
  isSameDocument,
  probeTargets,
  reportedState,
  shouldRestore
} from './state'
import type {
  CameraFormat,
  FlowConfig,
  MirrorOutcome,
  MirrorRequest,
  MirrorState,
  MirrorStatus,
  ProbeRead,
  TextSelector,
  ViewRect
} from './types'

/**
 * Runs Flipkart's VMS operator page inside the app and drives four controls on
 * it, so a Flipkart or Myntra order records on both systems from one webcam.
 * Ported from TrackVid-App @ c188745 (src/main/partnerVms/controller.ts); the
 * page-driving logic is theirs line for line. CMS changes are marked "CMS:".
 *
 * The view is owned by MAIN, never by React. A screen change in the renderer
 * must not be able to destroy the session — the seller logged in and connected
 * their feed by hand, and losing that mid-shift is the failure they would feel.
 *
 * Nothing here blocks the app's own recording. Every entry point is best
 * effort and returns a reason instead of throwing into the recording path.
 */

/**
 * The seller's Flipkart session lives in this partition and survives restarts
 * — the same partition name TrackVid-App uses. The app never reads, stores or
 * transmits their credentials.
 */
export const PARTNER_VMS_PARTITION = 'persist:fkvms'

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    p,
    new Promise<T>((_, rej) => {
      timer = setTimeout(() => rej(new Error(`timed out: ${what}`)), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** CMS: the partitions whose permission policy has already been set. */
const configuredSessions = new WeakSet<Session>()

/**
 * CMS: the CMS's own permission policy (main.ts) covers the default session
 * only and stays untouched. The mirror's partition gets its own, narrower one:
 * camera / microphone for the operator page's origin, and nothing else, for
 * anyone. TrackVid-App left Electron's allow-all default in place.
 */
const configurePartition = (flow: FlowConfig): Session => {
  const ses = session.fromPartition(PARTNER_VMS_PARTITION)
  if (configuredSessions.has(ses)) return ses
  configuredSessions.add(ses)
  const origin = flowOrigin(flow)

  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const allowed = permission === 'media' && isFlowOrigin(details.requestingUrl, origin)
    if (!allowed) logger.warn('[partner-vms] denied permission request', { permission, url: details.requestingUrl })
    callback(allowed)
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    permission === 'media' && isFlowOrigin(requestingOrigin, origin)
  )
  return ses
}

export class PartnerVmsController {
  private win: BrowserWindow | null = null
  private view: WebContentsView | null = null
  private flow: FlowConfig = DEFAULT_FLOW
  private rect: ViewRect | null = null
  private visible = false
  private probeTimer: NodeJS.Timeout | null = null
  private psbId: number | null = null
  private status: MirrorStatus = { state: 'DISABLED', configVersion: DEFAULT_FLOW.version }
  private booting = false
  /** CMS: bumped by disable(), so an enable() still loading cannot resurrect a torn-down view. */
  private generation = 0

  /**
   * When enable() last began, and whether the page has ever reached a usable
   * state since. Their app takes ~25 seconds from launch to a connected feed
   * and passes screens that look exactly like real faults on the way.
   */
  private enabledAt = 0
  private hasSettled = false

  private cameraLabel: string | null = null
  private cameraFormat: CameraFormat | null = null
  private lastRestoreAt = 0

  constructor(private readonly onStatus: (s: MirrorStatus) => void) {}

  // -- lifecycle ------------------------------------------------------------

  /**
   * CMS: the window the view is drawn in. Called for every main window the app
   * creates (macOS re-creates it from the dock); the view goes when its window
   * goes, so nothing is left attached to a destroyed window.
   */
  attachWindow(win: BrowserWindow): void {
    if (this.win && this.win !== win) this.disable()
    this.win = win
    win.once('closed', () => {
      if (this.win !== win) return
      this.disable()
      this.win = null
    })
  }

  setFlow(flow: FlowConfig): void {
    this.flow = flow
    this.status.configVersion = flow.version
  }

  isEnabled(): boolean {
    return this.view !== null
  }

  /**
   * Bring the view up. Safe to call repeatedly — a second call is a no-op while
   * one is already in flight or established.
   */
  async enable(cameraLabel?: string | null, format?: CameraFormat | null): Promise<MirrorStatus> {
    if (cameraLabel) this.cameraLabel = cameraLabel
    if (format) this.cameraFormat = format
    const win = this.win
    if (this.view || this.booting || !win || win.isDestroyed()) {
      logger.debug(
        `[partner-vms] enable skipped (view=${!!this.view} booting=${this.booting} win=${!!this.win})`
      )
      return this.status
    }
    logger.info(`[partner-vms] enable starting, camera hint=${this.cameraLabel ?? 'none'}`)
    const generation = ++this.generation
    this.enabledAt = Date.now()
    this.hasSettled = false
    this.booting = true
    this.emit('BOOTING')

    try {
      const ses = configurePartition(this.flow)
      const view = new WebContentsView({
        webPreferences: {
          // Guard 1 of 4 — keep the page running while it is out of sight.
          backgroundThrottling: false,
          session: ses,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      })
      view.webContents.setBackgroundThrottling(false)
      this.view = view

      // CMS: their page never opens windows of its own inside the app.
      view.webContents.setWindowOpenHandler(({ url }) => {
        logger.warn('[partner-vms] refused a new window from the VMS page', { url })
        return { action: 'deny' }
      })

      // Forward only OUR OWN lines out of their page — the camera pin, the
      // format they asked for, what they got. Filtered to the '[trackvid]'
      // prefix: their bundle is third-party and chatty.
      view.webContents.on('console-message', (event) => {
        const message = event.message
        if (typeof message === 'string' && message.startsWith('[trackvid]')) {
          logger.info(`[partner-vms] ${message}`)
        }
      })

      win.contentView.addChildView(view)
      this.applyBounds()

      // ORDER MATTERS. A fresh WebContentsView has no renderer process until it
      // navigates, and CDP commands sent before that are never answered —
      // Page.enable hangs with no error. So: about:blank to spin up a renderer,
      // THEN attach and register the document-start script, THEN load the real
      // page so the pin lands before their bundle runs.
      await this.navigate('about:blank', 10000, 'about:blank')
      this.assertCurrent(generation)

      const dbg = view.webContents.debugger
      if (!dbg.isAttached()) dbg.attach('1.3')
      await withTimeout(dbg.sendCommand('Page.enable'), 5000, 'Page.enable')
      await withTimeout(
        dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
          source: buildInjection(this.cameraLabel, this.cameraFormat)
        }),
        5000,
        'addScriptToEvaluateOnNewDocument'
      )
      this.assertCurrent(generation)

      await this.navigate(this.flow.url, 30000, 'load operator page')
      this.assertCurrent(generation)

      // The view is created hidden, and loading their page gives it focus. Hand
      // the keyboard straight back or only the first scan of a session works.
      this.returnKeyboardToPackingScreen()

      this.startProbing()
      await this.probe()
    } catch (err) {
      const detail = describe(err)
      if (generation === this.generation) {
        logger.error('[partner-vms] enable failed', { detail })
        this.status.lastError = detail
        this.teardownView()
        this.emit('DISABLED')
      }
    } finally {
      if (generation === this.generation) this.booting = false
    }

    return this.status
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation || !this.view) throw new Error('mirror was switched off while starting')
  }

  disable(): void {
    // CMS: also invalidates an enable() that is still loading.
    this.generation += 1
    this.booting = false
    this.desiredAwb = null
    this.stopProbing()
    this.releasePowerBlocker()
    const hadView = this.view !== null
    this.teardownView()
    if (hadView || this.status.state !== 'DISABLED') logger.info('[partner-vms] disabled')
    this.emit('DISABLED')
  }

  private teardownView(): void {
    const view = this.view
    if (!view) return
    this.view = null
    this.visible = false
    try {
      const dbg = view.webContents.debugger
      if (dbg.isAttached()) dbg.detach()
    } catch {
      /* already gone */
    }
    try {
      if (this.win && !this.win.isDestroyed()) this.win.contentView.removeChildView(view)
    } catch {
      /* window may be closing */
    }
    // CMS: destroy the renderer too. Removing the view alone leaves their page
    // (and the camera it holds) running until garbage collection.
    try {
      if (!view.webContents.isDestroyed()) view.webContents.close()
    } catch {
      /* already closed */
    }
  }

  /**
   * Go to a URL and resolve when it has actually arrived.
   *
   * Their app is a hash router, so #/dashboard → #/operator/vms is a
   * SAME-DOCUMENT navigation: `did-finish-load` never fires. `did-navigate-in-page`
   * is trusted only when the target really is same-document. The timeout lives
   * here so a navigation that never completes still detaches its listeners.
   */
  private navigate(url: string, timeoutMs: number, what: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const wc = this.view?.webContents
      if (!wc || wc.isDestroyed()) {
        reject(new Error('no view'))
        return
      }

      const sameDocument = isSameDocument(wc.getURL(), url)

      const cleanup = (): void => {
        clearTimeout(timer)
        if (wc.isDestroyed()) return
        wc.off('did-finish-load', done)
        wc.off('did-navigate-in-page', inPage)
        wc.off('did-fail-load', fail)
        wc.off('destroyed', gone)
      }
      const done = (): void => {
        cleanup()
        resolve()
      }
      const inPage = (): void => {
        if (!sameDocument) return
        done()
      }
      const fail = (_e: unknown, code: number, desc: string): void => {
        cleanup()
        reject(new Error(`${code} ${desc}`))
      }
      const gone = (): void => {
        cleanup()
        reject(new Error('view destroyed'))
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`timed out: ${what}`))
      }, timeoutMs)

      wc.on('did-finish-load', done)
      wc.on('did-navigate-in-page', inPage)
      wc.on('did-fail-load', fail)
      wc.once('destroyed', gone)
      wc.loadURL(url).catch(() => {
        /* settled by the events above */
      })
    })
  }

  /**
   * Point their page at the same camera the recorder is using.
   *
   * Takes effect on their next getUserMedia call. Their page requests the
   * camera once, on load, so the page is reloaded for a change to apply —
   * except mid-recording, when it applies at the next start instead.
   */
  async setPreferredCamera(label: string | null, format?: CameraFormat | null): Promise<{ applied: boolean }> {
    const sameFormat =
      !format ||
      ((this.cameraFormat?.width ?? null) === (format.width ?? null) &&
        (this.cameraFormat?.height ?? null) === (format.height ?? null) &&
        (this.cameraFormat?.frameRate ?? null) === (format.frameRate ?? null))
    const changed = label !== this.cameraLabel || !sameFormat
    this.cameraLabel = label
    if (format) this.cameraFormat = format
    if (!this.view || this.booting || !changed) return { applied: !changed }

    try {
      const dbg = this.view.webContents.debugger
      if (dbg.isAttached()) {
        await withTimeout(
          dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
            source: buildInjection(this.cameraLabel, this.cameraFormat)
          }),
          5000,
          'addScriptToEvaluateOnNewDocument'
        )
      }
      await this.pageEval(
        `window.__tvCameraLabel = ${JSON.stringify(label)}; window.__tvCameraFormat = ${JSON.stringify(this.cameraFormat)}`,
        'set camera label'
      )

      if (this.status.state !== 'MIRRORING' && this.view) {
        logger.info(`[partner-vms] camera changed to ${label ?? 'none'} — reloading VMS page`)
        this.view.webContents.reload()
        return { applied: true }
      }
      return { applied: false }
    } catch (err) {
      logger.warn('[partner-vms] setPreferredCamera failed', { detail: describe(err) })
      return { applied: false }
    }
  }

  // -- visibility -----------------------------------------------------------

  /** The renderer measures its own host area and sends the rect. */
  setBounds(rect: ViewRect): void {
    this.rect = rect
    this.applyBounds()
  }

  show(): void {
    this.visible = true
    this.applyBounds()
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.focus()
  }

  hide(): void {
    this.visible = false
    this.applyBounds()
    this.returnKeyboardToPackingScreen()
  }

  /**
   * Give the keyboard back to the app.
   *
   * Their page is a WebContentsView in the same window, and a focused view
   * receives every keystroke — so while it holds focus the packing screen gets
   * NOTHING: no barcode, no Space for a screenshot, no Enter. Whenever the view
   * is hidden the window gets the keyboard back, but only inside our own window
   * and only while the app is the active one — never pulled from another app.
   */
  private returnKeyboardToPackingScreen(): void {
    if (this.visible) return
    const win = this.win
    if (!win || win.isDestroyed()) return
    if (!win.isFocused()) return
    const wc = win.webContents
    if (!wc.isDestroyed()) wc.focus()
  }

  /**
   * Hidden means OFF-SCREEN AT FULL SIZE. Never 0x0, never detached: a
   * zero-area or removed view lets Chromium throttle the page — which stops
   * their recording while everything still looks fine.
   */
  private applyBounds(): void {
    if (!this.view || !this.rect) return
    this.view.setBounds(placeView(this.rect, this.visible))
  }

  // -- state ----------------------------------------------------------------

  private startProbing(): void {
    this.stopProbing()
    this.probeTimer = setInterval(() => {
      void this.probe()
    }, this.flow.timings.probeMs)
  }

  private stopProbing(): void {
    if (this.probeTimer) clearInterval(this.probeTimer)
    this.probeTimer = null
  }

  private emit(state: MirrorState, missing?: string[]): void {
    this.status = {
      ...this.status,
      state,
      missing,
      lastProbeAt: Date.now(),
      configVersion: this.flow.version
    }
    try {
      this.onStatus(this.status)
    } catch (err) {
      logger.warn('[partner-vms] status listener failed', { detail: describe(err) })
    }
  }

  getStatus(): MirrorStatus {
    return this.status
  }

  /**
   * Reads the truth off the page. State is derived, never remembered — if our
   * bookkeeping and the page disagree, the page wins.
   */
  async probe(): Promise<MirrorState> {
    const view = this.view
    if (!view) {
      this.emit('DISABLED')
      return 'DISABLED'
    }

    const wanted = probeTargets(this.flow.selectors)

    const script = `(() => {
      const want = ${JSON.stringify(wanted)};
      const out = { hash: location.hash || '' };
      for (const k of Object.keys(want)) {
        try { out[k] = !!document.querySelector(want[k]); } catch (e) { out[k] = null; }
      }
      return JSON.stringify(out);
    })()`

    let read: ProbeRead

    try {
      const raw = await withTimeout(view.webContents.executeJavaScript(script, true) as Promise<string>, 4000, 'probe')
      read = JSON.parse(raw) as ProbeRead
    } catch (err) {
      if (this.view !== view) return this.status.state
      this.status.lastError = describe(err)
      this.emit('DEGRADED', ['probe'])
      return 'DEGRADED'
    }
    // CMS: switched off (or replaced) while the probe was in flight.
    if (this.view !== view) return this.status.state

    const { state: next, broken } = classifyProbe(read, wanted)
    if (broken.length) {
      this.emit('DEGRADED', broken)
      return 'DEGRADED'
    }

    // If the seller wandered off the operator screen, put the page back — only
    // while the tab is hidden, or from the post-login landing page.
    if (
      shouldRestore({
        state: next,
        hash: read.hash,
        route: this.flow.route,
        visible: this.visible,
        lastRestoreAt: this.lastRestoreAt,
        now: Date.now()
      })
    ) {
      this.lastRestoreAt = Date.now()
      logger.info(`[partner-vms] page drifted to ${String(read.hash)} — restoring operator screen`)
      void this.navigate(this.flow.url, 30000, 'restore operator page').catch((e: unknown) =>
        logger.warn('[partner-vms] restore failed', { detail: describe(e) })
      )
    }

    // Their page can take the keyboard at any time; the probe corrects it.
    this.returnKeyboardToPackingScreen()

    if (next === 'MIRRORING') this.holdPowerBlocker()
    else this.releasePowerBlocker()

    if (next === 'READY' || next === 'MIRRORING') this.hasSettled = true

    const reported = reportedState(next, this.hasSettled, this.enabledAt, Date.now())
    this.emit(reported, reported === 'DEGRADED' ? ['operator screen not recognised'] : undefined)
    return reported
  }

  // -- the four writes ------------------------------------------------------

  /**
   * Run script in their page, but never wait forever. Every call sits on the
   * single operation queue, so one that never settles would stall every order
   * after it for the rest of the shift.
   */
  private async pageEval<T = unknown>(script: string, label: string, ms = 6000): Promise<T> {
    if (!this.view) throw new Error('no view')
    return withTimeout(this.view.webContents.executeJavaScript(script, true) as Promise<T>, ms, label)
  }

  private async cdp<T = unknown>(method: string, params?: object): Promise<T> {
    if (!this.view) throw new Error('no view')
    return withTimeout(this.view.webContents.debugger.sendCommand(method, params) as Promise<T>, 5000, method)
  }

  private async boxCentre(selector: string): Promise<{ x: number; y: number }> {
    const { root } = await this.cdp<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0 })
    const { nodeId } = await this.cdp<{ nodeId: number }>('DOM.querySelector', {
      nodeId: root.nodeId,
      selector
    })
    if (!nodeId) throw new Error(`selector not found: ${selector}`)
    const { model } = await this.cdp<{ model: { content: number[] } }>('DOM.getBoxModel', { nodeId })
    const [x1 = 0, y1 = 0, , , x3 = 0, y3 = 0] = model.content
    return { x: (x1 + x3) / 2, y: (y1 + y3) / 2 }
  }

  private async click(selector: string): Promise<void> {
    // Never click an unconfigured selector — a blank one would put a real mouse
    // event somewhere unintended on the seller's live VMS page.
    if (!selector) throw new Error('selector not configured')

    // Their page can re-render between the three CDP round trips; look the
    // node up again once if it vanished.
    let centre: { x: number; y: number }
    try {
      centre = await this.boxCentre(selector)
    } catch (err) {
      if (!/Could not find node/i.test(describe(err))) throw err
      await sleep(250)
      centre = await this.boxCentre(selector)
    }

    const base = { x: centre.x, y: centre.y, button: 'left', clickCount: 1 }
    await this.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
    await this.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
  }

  /**
   * Types the AWB the way the barcode scanner would — CDP input, not
   * `el.value = awb`, because their framework only updates on genuine input
   * events. The box is cleared with a real Delete first, so re-entering the
   * SAME number is still a change their page sees.
   */
  private async typeInto(selector: string, text: string): Promise<void> {
    await this.pageEval(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false; el.focus(); if (el.select) el.select(); return true; })()`,
      'focus awb input'
    )

    const del = { windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46, key: 'Delete', code: 'Delete' }
    await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...del })
    await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...del })
    await sleep(80)

    await this.cdp('Input.insertText', { text })
  }

  /**
   * Whether their page is currently recording. Null when we cannot tell —
   * null is not "no": treating it as "not recording" would click Record on a
   * running recording and toggle it off.
   */
  private async isRecording(): Promise<boolean | null> {
    const sel = this.flow.selectors.recordingSignal
    if (!sel) return null
    const r = await this.pageEval<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`, 'read recording indicator', 4000)
    return Boolean(r)
  }

  /** Poll for their recording indicator (their camera takes ~4 s to spin up). */
  private async waitForRecording(timeoutMs: number): Promise<boolean | null> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const state = await this.isRecording()
      if (state === null) return null
      if (state) return true
      if (Date.now() >= deadline) return false
      await sleep(250)
    }
  }

  /** Wait for their recording indicator to clear. Null when we cannot tell. */
  private async waitForNotRecording(timeoutMs: number): Promise<boolean | null> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const state = await this.isRecording()
      if (state === null) return null
      if (!state) return true
      if (Date.now() >= deadline) return false
      await sleep(250)
    }
  }

  /**
   * One page operation at a time. A scan stops one order and starts the next
   * milliseconds apart; fired at their page together, park and start fought
   * and the next order's mirror began 17 s late. Their page is one surface.
   */
  private opChain: Promise<unknown> = Promise.resolve()

  private serialise<T>(op: () => Promise<T>): Promise<T> {
    const next = this.opChain.then(op, op)
    // Keep the chain alive after a rejection, or one failure stalls every order.
    this.opChain = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  /**
   * What the packer most recently asked for: an AWB to mirror, or idle. Every
   * queued operation checks, when it runs, whether it still reflects that.
   * Last instruction wins; everything older is dropped — a Flipkart clip that
   * starts after its own recording ended looks like evidence and contains none.
   */
  private desiredAwb: string | null = null

  /** Mirror one order. Called the instant the recorder starts; never awaited by it. */
  async startMirror(req: MirrorRequest): Promise<MirrorOutcome> {
    this.desiredAwb = req.awb
    return this.serialise(async () => {
      if (this.desiredAwb !== req.awb) {
        return {
          ok: false,
          reason: 'superseded',
          state: this.status.state,
          detail:
            this.desiredAwb === null
              ? 'the order had already been stopped before this reached their page'
              : 'a later order was scanned before this one reached the page'
        }
      }
      return this.startMirrorNow(req)
    })
  }

  async park(): Promise<MirrorOutcome> {
    this.desiredAwb = null
    return this.serialise(async () => {
      // A scan's stop and the next start arrive as two IPC messages 1-3 ms
      // apart; this pause lets a following start defer the park to itself.
      await sleep(400)

      if (this.desiredAwb !== null) {
        return { ok: true, state: this.status.state, detail: 'deferred to the next order' }
      }
      return this.parkNow()
    })
  }

  private async startMirrorNow(req: MirrorRequest): Promise<MirrorOutcome> {
    if (!this.view) return { ok: false, reason: 'disabled', state: 'DISABLED' }

    const state = await this.probe()
    if (state === 'MIRRORING') {
      // Their recorder is a running tap: park first so the previous order's
      // video cannot absorb this one. parkNow, not park: we hold the queue slot.
      await this.parkNow()
    } else if (state !== 'READY') {
      return { ok: false, reason: state === 'DEGRADED' ? 'degraded' : 'not_ready', state }
    }

    try {
      const hash = await this.pageEval<string>('location.hash || ""', 'read route')
      if (!hash.includes(this.flow.route)) {
        return { ok: false, reason: 'wrong_route', state, detail: hash }
      }

      await this.syncOrderType(req.orderType)
      await this.typeInto(this.flow.selectors.awbInput, req.awb)
      await sleep(this.flow.timings.settleMs)

      // Read the recording state back BEFORE deciding to click. Never click blind.
      const confirmMs = this.flow.timings.recordConfirmMs ?? 8000
      const autoStarted = await this.waitForRecording(confirmMs)
      if (autoStarted === null && this.flow.entryMethod !== 'insertText') {
        return {
          ok: false,
          reason: 'selector_missing',
          state: this.status.state,
          detail: 'recordingSignal not configured — cannot confirm recording started'
        }
      }
      if (autoStarted === false && this.flow.entryMethod !== 'insertText') {
        if (this.flow.entryMethod === 'insertText+enter') {
          const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }
          await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...enter })
          await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...enter })
        } else {
          await this.click(this.flow.selectors.recordButton)
        }
        await sleep(this.flow.timings.settleMs)
      }

      const recording = autoStarted === true ? true : await this.waitForRecording(confirmMs)
      if (recording === null) {
        return {
          ok: false,
          reason: 'selector_missing',
          state: this.status.state,
          detail: 'AWB entered but recordingSignal not configured — unverified'
        }
      }
      if (!recording) {
        this.emit('READY')
        return { ok: false, reason: 'record_not_started', state: 'READY', autoStarted: autoStarted === true }
      }

      this.holdPowerBlocker()
      this.emit('MIRRORING')
      return { ok: true, state: 'MIRRORING', autoStarted: autoStarted === true }
    } catch (err) {
      const detail = describe(err)
      logger.error('[partner-vms] startMirror failed', { detail })
      this.status.lastError = detail
      return { ok: false, reason: 'error', state: this.status.state, detail }
    }
  }

  /**
   * Click a control that has no id and no class, located by its visible label,
   * with a real mouse event at its centre.
   */
  private async clickByText(sel: TextSelector, label: string): Promise<boolean> {
    const found = await this.pageEval<string | null>(
      `(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(sel.scope)})];
        const hit = els.find((e) => (e.textContent || '').trim() === ${JSON.stringify(label)});
        if (!hit) return null;
        const target =
          hit.closest('button, [role="button"]') || hit.closest('div') || hit;
        const r = target.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      })()`,
      `locate ${label}`
    )
    if (!found) return false

    const { x, y } = JSON.parse(found) as { x: number; y: number }
    const base = { x, y, button: 'left', clickCount: 1 }
    await this.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
    await this.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
    return true
  }

  /** Which label the order-type control is currently showing, if any. */
  private async readToggleLabel(sel: TextSelector): Promise<string | null> {
    return this.pageEval<string | null>(
      `(() => {
        const want = ${JSON.stringify(sel.anyOf)};
        const els = [...document.querySelectorAll(${JSON.stringify(sel.scope)})];
        const hit = els.find((e) => want.includes((e.textContent || '').trim()));
        return hit ? (hit.textContent || '').trim() : null;
      })()`,
      'read order-type toggle'
    )
  }

  /** Match their Forward/Return control to the recorder's order type. */
  private async syncOrderType(orderType: string): Promise<void> {
    const sel = this.flow.selectors.orderTypeToggle
    if (!sel) return
    const want = orderType.trim().toLowerCase()

    try {
      if (typeof sel === 'string') {
        const current = await this.pageEval<string>(
          `(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`,
          'read order-type control'
        )
        if (current.trim().toLowerCase() !== want) {
          await this.click(sel)
          await sleep(this.flow.timings.settleMs)
        }
        return
      }

      const current = await this.readToggleLabel(sel)
      if (!current) {
        logger.warn('[partner-vms] order type control not found — left as is')
        return
      }
      if (current.toLowerCase() === want) return

      await this.clickByText(sel, current)
      await sleep(this.flow.timings.settleMs)

      const after = await this.readToggleLabel(sel)
      if (after && after.toLowerCase() !== want) {
        logger.warn(`[partner-vms] order type still "${after}", wanted "${orderType}"`)
      }
    } catch (err) {
      // Not fatal: a mirrored order filed under the wrong type beats no video.
      logger.warn('[partner-vms] order type sync skipped', { detail: describe(err) })
    }
  }

  /**
   * End their recording so the next order's footage cannot be appended to this
   * AWB. Config picks which control does it.
   */
  private async parkNow(): Promise<MirrorOutcome> {
    if (!this.view) return { ok: false, reason: 'disabled', state: 'DISABLED' }

    const strategy = this.flow.parkStrategy
    if (strategy === 'none') {
      return {
        ok: false,
        reason: 'not_ready',
        state: this.status.state,
        detail: 'no park strategy configured — contamination risk'
      }
    }

    try {
      if ((await this.isRecording()) === false) {
        this.releasePowerBlocker()
        return { ok: true, state: this.status.state, detail: 'already idle' }
      }

      const confirmMs = this.flow.timings.parkConfirmMs

      // Click Stop repeatedly rather than once-and-wait: something on their
      // page swallows the first click on a control that just changed state.
      // Alternating the two aiming methods covers whichever one breaks next.
      const clickStop = async (attempt: number): Promise<string> => {
        const sel = this.flow.selectors.stopButton || this.flow.selectors.recordButton
        if (attempt % 2 === 0) {
          const hit = await this.clickByText({ scope: 'button, span', anyOf: ['Stop'] }, 'Stop')
          if (hit) return 'label'
        }
        await this.click(sel)
        return 'css'
      }

      const stopStartedAt = Date.now()
      let cleared: boolean | null = null
      let how = ''
      let attempts = 0

      if (strategy === 'stopButton') {
        const deadline = Date.now() + confirmMs
        do {
          how = await clickStop(attempts)
          attempts += 1
          cleared = await this.waitForNotRecording(2000)
        } while (cleared === false && Date.now() < deadline)
        how = `stopButton(${how}, ${attempts} click${attempts === 1 ? '' : 's'})`
      } else if (strategy === 'disconnect') {
        await this.click(this.flow.selectors.disconnectButton)
        how = 'disconnect'
        cleared = await this.waitForNotRecording(confirmMs)
      } else {
        await this.typeInto(this.flow.selectors.awbInput, this.flow.sentinelAwb ?? 'TRACKVID-PARK')
        how = 'sentinelAwb'
        cleared = await this.waitForNotRecording(confirmMs)
      }

      if (attempts > 1) {
        logger.info(
          `[partner-vms] stop took ${((Date.now() - stopStartedAt) / 1000).toFixed(1)}s ` +
            `and ${attempts} clicks — their page holds a clip open for ~10s before it will stop`
        )
      }

      // Check once more before crying wolf: the last click lands as the budget
      // runs out, and the next probe often finds the page already idle.
      if (cleared === false) cleared = await this.waitForNotRecording(1500)

      const stillRecording = cleared === false
      this.releasePowerBlocker()
      await this.probe()

      return stillRecording
        ? {
            ok: false,
            reason: 'error',
            state: this.status.state,
            detail: `still recording ${confirmMs}ms after park via ${how}`
          }
        : { ok: true, state: this.status.state }
    } catch (err) {
      const detail = describe(err)
      logger.error('[partner-vms] park failed', { detail })
      this.releasePowerBlocker()
      return { ok: false, reason: 'error', state: this.status.state, detail }
    }
  }

  // -- power ----------------------------------------------------------------

  private holdPowerBlocker(): void {
    if (this.psbId !== null) return
    this.psbId = powerSaveBlocker.start('prevent-app-suspension')
  }

  private releasePowerBlocker(): void {
    if (this.psbId === null) return
    try {
      powerSaveBlocker.stop(this.psbId)
    } catch {
      /* already stopped */
    }
    this.psbId = null
  }
}
