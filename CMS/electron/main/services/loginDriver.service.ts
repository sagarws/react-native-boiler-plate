import type { BrowserWindow, WebContents } from 'electron'
import { urlMatches, type LoginOutcomeMatch } from '@shared/utils/loginOutcome'
import { logger } from './logger'

/**
 * Runs a platform's scripted sign-in inside an already-open BrowserWindow.
 *
 * This file contains no marketplace-specific anything. Every selector, step and
 * success condition comes from `@trackvid/automation-core/common/loginForms`,
 * which is shared with the server's own logins — so a portal redesign is fixed
 * in one place rather than two. See that file for the step vocabulary.
 *
 * What it does not do: solve a challenge. If the platform asks for an OTP or a
 * captcha, the driver stops and reports `challenged`, and the caller leaves the
 * window open for the operator to finish by hand. A human is already sitting in
 * front of this app — pretending otherwise is how these break silently.
 */

export interface LoginStep {
  kind: 'wait' | 'fill' | 'click' | 'clickText' | 'settle'
  selector?: string
  text?: string
  /** How `text` is compared. Exact unless a portal decorates its label. */
  match?: 'exact' | 'contains'
  field?: 'username' | 'password'
  label?: string
  ms?: number
  timeoutMs?: number
  optional?: boolean
  visibleOnly?: boolean
  /**
   * Skip this step when this selector is already on the page.
   *
   * For launchers that only exist on some builds: AJIO's landing page shows a
   * "Log in" button, but some builds redirect straight to the SSO form, and
   * clicking a launcher that is not there would fail a sign-in that was already
   * one step further along.
   */
  skipIfSelector?: string
}

export type { LoginOutcomeMatch }

export interface LoginForm {
  platform: string
  steps: LoginStep[]
  frameSelector?: string
  success?: LoginOutcomeMatch
  failure?: LoginOutcomeMatch
  otp?: LoginOutcomeMatch
  /**
   * How to ANSWER a one-time code, where the driver can.
   *
   * `otp` above only recognises the challenge; this is what to do about it.
   * Both are needed and they are not the same question — a portal whose
   * challenge we can see but whose box we cannot fill must still hand over to
   * the operator rather than typing into nothing.
   */
  otpEntry?: { input: string; submit: string }
  /**
   * Screens that may appear on the way in and only need one click — AJIO's
   * "Select a sales channel" after its one-time code. While the page shows
   * `whenText`, the visible element reading exactly `clickText` is clicked.
   */
  interstitials?: { whenText: string; clickText: string }[]
}

export type LoginVerdict =
  | { status: 'signed-in' }
  | { status: 'challenged'; reason: string }
  | { status: 'failed'; reason: string }

const STEP_TIMEOUT_MS = 20_000
const OUTCOME_TIMEOUT_MS = 45_000
const POLL_MS = 400

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Evaluates in the page.
 *
 * Wrapped so a step that runs before the document exists, or during a
 * navigation, reads as "not there yet" and gets retried by the poll loop rather
 * than aborting the whole sign-in.
 */
const evaluate = async <T>(contents: WebContents, source: string, fallback: T): Promise<T> => {
  try {
    return (await contents.executeJavaScript(source, true)) as T
  } catch {
    return fallback
  }
}

/** JS literal for a selector or text, safely escaped. */
const lit = (value: string): string => JSON.stringify(value)

/**
 * Resolves selectors inside the login iframe when the descriptor names one.
 *
 * Only Nykaa needs this — its form is a Zoho IAM widget in `#iamFrame`. Same
 * document object either way, so every helper below takes the root expression
 * rather than branching on it.
 */
const rootExpr = (frameSelector?: string): string =>
  frameSelector
    ? `(document.querySelector(${lit(frameSelector)})?.contentDocument ?? null)`
    : 'document'

/** True once the selector matches an element with a non-zero box. */
const visibleCheck = (root: string, selector: string): string => `(() => {
  const root = ${root};
  if (!root) return false;
  return Array.from(root.querySelectorAll(${lit(selector)})).some(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
})()`

const waitForSelector = async (
  contents: WebContents,
  root: string,
  selector: string,
  timeoutMs: number
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await evaluate(contents, visibleCheck(root, selector), false)) return true
    await sleep(POLL_MS)
  }

  return false
}

/**
 * Sets an input's value the way a user would, as far as the page can tell.
 *
 * The native value setter plus input+change events is not ceremony: every one
 * of these portals is React or Angular, and a plain `el.value = x` leaves the
 * framework's own state empty — the field looks filled and the form submits
 * blank. This is the same technique the server's Delhivery login uses.
 */
const fillScript = (root: string, selector: string, value: string, visibleOnly: boolean): string => `(() => {
  const root = ${root};
  if (!root) return false;
  const all = Array.from(root.querySelectorAll(${lit(selector)}));
  const el = ${visibleOnly}
    ? all.find(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    : all[0];
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  el.focus();
  if (setter) setter.call(el, ${value}); else el.value = ${value};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`

const clickScript = (root: string, selector: string): string => `(() => {
  const root = ${root};
  if (!root) return false;
  const all = Array.from(root.querySelectorAll(${lit(selector)}));
  const el = all.find(node => {
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !node.disabled;
  }) ?? all[0];
  if (!el) return false;
  el.click();
  return true;
})()`

/**
 * Click by text — several of these buttons carry no usable id.
 *
 * `contains` exists because a label is not always the whole string: AJIO's
 * launcher reads "Log in →". Whitespace is normalised either way, since these
 * labels are often broken across lines in the markup.
 */
const clickTextScript = (root: string, text: string, contains: boolean): string => `(() => {
  const root = ${root};
  if (!root) return false;
  const wanted = ${lit(text)}.replace(/\\s+/g, ' ').trim().toLowerCase();
  const el = Array.from(root.querySelectorAll('a, button, div, span, input[type="submit"]'))
    .find(node => {
      const label = (node.value ?? node.textContent ?? '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const hit = ${contains} ? label.includes(wanted) : label === wanted;
      if (!hit) return false;
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  if (!el) return false;
  el.click();
  return true;
})()`

/** True when the page's visible text contains `text` (case and spacing ignored). */
const textShownScript = (root: string, text: string): string => `(() => {
  const root = ${root};
  const body = root && root.body ? root.body.innerText || '' : '';
  return body.replace(/\\s+/g, ' ').toLowerCase().includes(${lit(text)}.replace(/\\s+/g, ' ').toLowerCase());
})()`

/** Clicks through any interstitial on screen. True when one was clicked. */
const passInterstitials = async (contents: WebContents, root: string, form: LoginForm): Promise<boolean> => {
  for (const screen of form.interstitials ?? []) {
    if (!(await evaluate(contents, textShownScript(root, screen.whenText), false))) continue

    if (await evaluate(contents, clickTextScript(root, screen.clickText, false), false)) {
      logger.info(`${form.platform} sign-in: "${screen.whenText}" — clicked "${screen.clickText}"`)

      return true
    }
  }

  return false
}

const matches = async (
  contents: WebContents,
  root: string,
  match: LoginOutcomeMatch | undefined
): Promise<boolean> => {
  if (!match) return false

  // The URL half is pure and tested in shared/utils/loginOutcome.
  if (urlMatches(contents.getURL(), match)) return true

  for (const selector of match.anySelector ?? []) {
    if (await evaluate(contents, visibleCheck(root, selector), false)) return true
  }

  return false
}

/** Runs one step. Returns false when it did not apply and was not optional. */
const runStep = async (
  contents: WebContents,
  root: string,
  step: LoginStep,
  secrets: { username: string; password: string }
): Promise<boolean> => {
  const timeout = step.timeoutMs ?? STEP_TIMEOUT_MS

  // A launcher that is only on some builds. Checked once, not polled: if the
  // form is already up there is nothing to wait for.
  if (step.skipIfSelector) {
    if (await evaluate(contents, visibleCheck(root, step.skipIfSelector), false)) return true
  }

  if (step.kind === 'settle') {
    await sleep(step.ms ?? 1000)

    return true
  }

  if (step.kind === 'wait') {
    return waitForSelector(contents, root, step.selector ?? '', timeout)
  }

  if (step.kind === 'clickText') {
    const deadline = Date.now() + timeout

    while (Date.now() < deadline) {
      const script = clickTextScript(root, step.text ?? '', step.match === 'contains')

      if (await evaluate(contents, script, false)) return true
      await sleep(POLL_MS)
    }

    return false
  }

  const selector = step.selector ?? ''

  if (!(await waitForSelector(contents, root, selector, timeout))) return false

  if (step.kind === 'click') {
    return evaluate(contents, clickScript(root, selector), false)
  }

  // fill
  const value = step.field === 'password' ? secrets.password : secrets.username

  return evaluate(contents, fillScript(root, selector, lit(value), step.visibleOnly === true), false)
}

/**
 * Fills and submits the sign-in form, then waits for a verdict.
 *
 * `failure` and `otp` are checked before `success` on every poll: a `success`
 * expressed as "the URL no longer contains /login" would otherwise match an
 * error page that redirected, and report a failed sign-in as a good one.
 */
/**
 * Read a code and type it into the challenge.
 *
 * Returns a verdict only when there is nothing left to judge — no code arrived,
 * or the box vanished under us. Null means "submitted, keep watching", because
 * what happens next is the portal's answer and the caller's loop already knows
 * how to read that.
 */
const answerOtp = async (
  contents: WebContents,
  root: string,
  form: LoginForm,
  username: string,
  fetchOtp: (username: string, since: Date) => Promise<string | null>,
  since: Date
): Promise<LoginVerdict | null> => {
  const entry = form.otpEntry

  if (!entry) return null

  logger.info(`${form.platform} asked for a one-time code — reading it`)

  let code: string | null = null

  try {
    code = await fetchOtp(username, since)
  } catch (error) {
    // Not fatal. The operator can still finish it by hand, which is strictly
    // better than failing a sign-in over a mailbox that was briefly unhappy.
    logger.warn(`${form.platform} one-time code could not be read`, error)
  }

  if (!code) {
    return {
      status: 'challenged',
      reason: `${form.platform} asked for a one-time code and none arrived`
    }
  }

  if (!(await waitForSelector(contents, root, entry.input, STEP_TIMEOUT_MS))) {
    return { status: 'challenged', reason: `${form.platform} one-time code box went away` }
  }

  await evaluate(contents, fillScript(root, entry.input, lit(code), true), false)
  await evaluate(contents, clickScript(root, entry.submit), false)

  logger.info(`${form.platform} one-time code submitted`)

  return null
}

export const driveLogin = async (
  window: BrowserWindow,
  form: LoginForm,
  secrets: { username: string; password: string },
  /**
   * Where a one-time code comes from, when this machine can read one.
   *
   * Optional, and absent is the old behaviour exactly: see the challenge, stop,
   * hand the window to the operator. Given one, the driver answers the
   * challenge itself — which is the difference between a scheduled sign-in that
   * completes at 02:00 and one that waits all night for somebody to type six
   * digits.
   */
  fetchOtp?: (username: string, since: Date) => Promise<string | null>
): Promise<LoginVerdict> => {
  const contents = window.webContents
  const root = rootExpr(form.frameSelector)

  /*
   * STAMPED BEFORE THE FORM IS TOUCHED, and this is what makes a read code
   * trustworthy: these mails all share one subject, so without a cutoff the
   * newest match is often the PREVIOUS sign-in's code — retired, rejected, and
   * failing in a way that reads exactly like a wrong password.
   */
  const since = new Date()

  for (const [index, step] of form.steps.entries()) {
    if (window.isDestroyed()) return { status: 'failed', reason: 'The sign-in window was closed' }

    const done = await runStep(contents, root, step, secrets)

    if (!done && step.optional !== true) {
      const what = step.label ?? step.selector ?? step.text ?? step.kind

      return {
        status: 'failed',
        reason: `${form.platform} sign-in stalled at step ${index + 1} (${what})`
      }
    }
  }

  let deadline = Date.now() + OUTCOME_TIMEOUT_MS
  /** One answer per sign-in — see the OTP branch below. */
  let answered = false

  while (Date.now() < deadline) {
    if (window.isDestroyed()) return { status: 'failed', reason: 'The sign-in window was closed' }

    if (await matches(contents, root, form.otp)) {
      /*
       * ANSWERED ONCE, THEN BACK TO THE SAME LOOP.
       *
       * Not a return: a submitted code has to be judged by the same three
       * outcomes as the password was — the portal may sign us in, reject the
       * code and leave the box, or fail outright. Falling back into the poll
       * is what gets that for free, and a wrong code simply lands here again
       * with `answered` already spent, so it hands over rather than retyping
       * a code the portal has refused.
       */
      if (fetchOtp && form.otpEntry && !answered) {
        answered = true

        const verdict = await answerOtp(contents, root, form, secrets.username, fetchOtp, since)

        if (verdict !== null) return verdict

        // The mail wait can outlast the whole outcome window; the portal's
        // answer to the code gets a fresh one rather than a timeout.
        deadline = Date.now() + OUTCOME_TIMEOUT_MS

        continue
      }

      return { status: 'challenged', reason: `${form.platform} asked for a one-time code` }
    }
    if (await passInterstitials(contents, root, form)) {
      await sleep(1500)

      continue
    }
    if (await matches(contents, root, form.failure)) {
      return { status: 'failed', reason: `${form.platform} rejected the sign-in` }
    }
    if (await matches(contents, root, form.success)) {
      return { status: 'signed-in' }
    }

    await sleep(POLL_MS)
  }

  logger.warn(`${form.platform} scripted sign-in reached no verdict within ${OUTCOME_TIMEOUT_MS}ms`)

  return {
    status: 'challenged',
    reason: `${form.platform} did not finish signing in on its own`
  }
}
