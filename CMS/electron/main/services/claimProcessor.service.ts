import type {
  ClaimBatchPlatform,
  ClaimBatchProgress,
  ProcessResult,
  QueuedClaim,
  SkippedAccount
} from '@shared/types/claimQueue'
import { SKIPPED_SESSION_EXPIRED } from '@shared/constants/claims'
import { fail, ok, type Result } from '@shared/types/result'
import { apiRequest } from './httpClient'
import { getAccessToken, getSession } from './session.store'
import { listClaims, recordDispatch, setStatus } from './claimQueue.service'
import { autoLoginEnabled, claimRoutingSnapshot, runsHere, usesApiFlow } from './automationRouting.service'
import { signInAllowed, withSignInFor } from './signInPolicy'
import { automationHolder, isAutomationBusy, withAutomationLock } from './automationLock'
import { closeClaimLease, openClaimLease } from './browserLease.service'
import { broadcast } from '../ipc/broadcast'
import { platformSkipped } from './platformSkip.store'
import { CLAIM_QUEUE_EVENTS } from '@shared/constants/channels'
import { CLAIM_RUNNERS, resolveClaimRunner, ticketLookup } from '@main/automations/registry'
import type { ClaimRunner } from '@main/automations/common/types'
import type { ClaimDocument } from '@main/automations/common/types'
import { processName, withProcessLogResult } from '@main/automations/common/processLog'
import type { ClaimStatusTab, ClaimSupport } from '@shared/types/claimQueue'
import type { ScheduledTaskId } from '@shared/types/automationSchedule'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import {
  beginRun,
  endRun,
  reportClaimSkipped,
  settleIfUnreported
} from './claimLiveness.service'
import { accountKey, describeBlocked, inactiveAccounts, sessionVerdicts } from './claimSessionGuard'
import { renewForClaim } from './claimSession.service'
import {
  claimAccountUsername,
  companyWideAccount,
  requireClaimAccount,
  stampClaimAccount
} from '@main/automations/common/claimAccount'
import { probeOpener } from '@main/automations/accountMapping/registry'
import type { MappingCredential } from '@main/automations/accountMapping/types'
import { ProbePool } from './accountMapping.service'
import { mappingAccounts } from './mappingAccounts.service'
import { closeRefillContexts, refillClaimFields } from './refill.service'
import { logger } from './logger'
import { env } from '../config/env'

/**
 * Files queued claims from this machine.
 *
 * Orchestration only — the queue, the routing check, the backend write-back and
 * the terminal states. The per-platform sequences live under
 * `electron/main/automations/platforms/<platform>/...`, and the sequences those
 * call live in @trackvid/automation-core, shared with the Automated-Scripts
 * server so both file a claim identically.
 *
 * Nothing marketplace-specific belongs in this file.
 */

/**
 * Platforms this app will actually file a claim for.
 *
 * Two conditions, both required: the company has routed the platform here
 * (`settings.desktopExecution.<platform>.claim`), and this build has a runner
 * for it. Routing alone is not enough — the claim would fail — and a runner
 * alone is not enough, because a platform routed to the server is the server's
 * to file and doing it here too would raise the dispute twice.
 */
export const supportedPlatforms = async (): Promise<ClaimSupport> => {
  const { known, platforms } = await claimRoutingSnapshot('claim')

  // A platform is only really supported in the FLOW this company uses. Checking
  // the platform alone would enable Create Ticket for a company on the Selenium
  // path for a platform where only the API runner exists — the button would
  // work, and every claim would fail at the last moment with the row already
  // marked attempted.
  const supported: string[] = []

  for (const platform of platforms) {
    const chosen = (await usesApiFlow(platform, 'claim')) ? 'api' : 'script'

    // Resolved, not looked up: a platform this build has only one flow for is
    // still supported, because refusing it would leave the claim unfiled —
    // TrackVid has already routed it here. See resolveClaimRunner.
    if (resolveClaimRunner(platform, chosen)) supported.push(platform)
  }

  return {
    routingKnown: known,
    // Every platform this build could file in SOME flow, regardless of routing.
    // Lets the UI say "there is no desktop runner for Amazon" instead of
    // blaming a setting that would not help.
    runners: Object.keys(CLAIM_RUNNERS),
    routedHere: platforms,
    supported
  }
}

/**
 * Processes one queued claim.
 *
 * The queue row is moved to `running` before any network call and to a terminal
 * state in every exit path, so a crash mid-run leaves a row visibly stuck in
 * `running` rather than silently back at `received` where it would be retried
 * blindly.
 */

/**
 * Marks the credential unverified when a claim failed because the password is
 * wrong. Best-effort and silent otherwise.
 *
 * Uses the signed-in operator's own token against the same endpoint the
 * automation server's cron calls. The core's `markCredentialsUnverified` is NOT
 * used here: it mints its own token from `TRACKVID_GET_USER_PROFILE_URL`, and
 * this app must not read automation env keys — it has a token already.
 */
const unverifyOnBadCredentials = async (
  claim: { platform: string; username?: string },
  error: unknown,
  token: string
): Promise<void> => {
  const code = (error as { code?: string })?.code

  if (code !== 'INVALID_CREDENTIALS' && code !== 'LOGIN_FAILED') return
  if (!claim.username) return

  const session = getSession()

  if (!session) return

  const marked = await apiRequest<unknown>('/master-setting/mark-credentials-unverified', {
    method: 'POST',
    token,
    body: {
      items: [
        {
          companyId: session.user.companyId,
          trackVidEmail: session.user.email,
          platform: claim.platform,
          username: claim.username
        }
      ]
    }
  })

  if (marked.success) {
    logger.warn(`Marked ${claim.platform}/${claim.username} unverified — the sign-in was rejected`)
  } else {
    logger.warn(`Could not flag ${claim.platform}/${claim.username}: ${marked.error.message}`)
  }
}

/**
 * Brings a claim the operator picked from the list into the local queue.
 *
 * The platform and AWB come from the row they clicked. Without them there is
 * nothing to look the claim up by — `/cms/find-by-awb` is keyed on both — so a
 * caller with only an id is told exactly that.
 */
const adopt = async (
  cmsId: string,
  hint: ClaimHint | undefined
): Promise<Result<QueuedClaim>> => {
  const platform = hint?.platform?.trim().toLowerCase()
  const awbNumber = hint?.awbNumber?.trim()
  const session = getSession()

  if (!platform || !awbNumber) {
    return fail(
      'NOT_FOUND',
      `Claim ${cmsId} is not queued on this machine, and no platform or AWB was given to look it up`
    )
  }

  if (!session) return fail('VALIDATION_ERROR', 'Sign in to process claims')

  await recordDispatch({
    cmsId,
    companyId: session.user.companyId,
    platform,
    awbNumber,
    dispatchedAt: new Date().toISOString()
  })

  const stored = (await listClaims()).find(entry => entry.cmsId === cmsId)

  if (!stored) {
    // recordDispatch declines when another claim for the same AWB is mid-run —
    // which is the right answer, and worth saying plainly.
    return fail(
      'VALIDATION_ERROR',
      `A claim for ${platform} AWB ${awbNumber} is already running on this machine`
    )
  }

  logger.info(`Adopted claim ${cmsId} (${platform} ${awbNumber}) from the list`)

  return ok(stored)
}

/** What the caller knows about a claim that was never dispatched here. */
export interface ClaimHint {
  platform?: string
  awbNumber?: string
}

/**
 * Files ONE claim. Takes no lock and holds no browser lease of its own.
 *
 * Both belong to the batch above it — `processClaims` here, `drainClaims` in
 * the auto-runner — because both are what a browser should be shared across.
 * Taking the lock here as well would deadlock: it is FIFO and not reentrant, so
 * a batch that already holds it would wait on itself.
 */
export const runClaim = async (
  cmsId: string,
  hint?: ClaimHint
): Promise<Result<ProcessResult>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to process claims')

  const claims = await listClaims()
  let claim = claims.find(entry => entry.cmsId === cmsId)

  // Not dispatched here — picked from the app's own list.
  //
  // The Claims page shows EVERY claim the company has, straight from the
  // backend, but only ones the socket dispatched were in the local queue. So
  // selecting a row and pressing Create Ticket answered "not queued on this
  // machine", which is true and useless: the operator is looking at the row and
  // asking for it to be filed.
  //
  // Adopting it into the queue rather than filing it outside means it gets
  // everything a dispatched claim gets — liveness, recovery after a crash, AWB
  // de-duplication, the status callbacks.
  if (!claim) {
    const adopted = await adopt(cmsId, hint)

    if (!adopted.success) return adopted

    claim = adopted.data
  }

  // Only from here on is there a process worth announcing, and only from here
  // is its name known — a start line has to say which platform and which AWB,
  // and neither exists until the claim has been found.
  // Claims dispatched from TrackVid reach here one at a time, not through a
  // batch — so this is where they too are allowed to re-capture an expired
  // login, on a platform with auto-login on. Inside a batch it adds nothing.
  const filed = claim

  return withProcessLogResult(processName(filed.platform, 'claim', filed.awbNumber), async () =>
    withSignInFor(await autoLoginPlatforms([filed]), () => fileClaim(filed, token))
  )
}

/**
 * Reorders a selection so claims for one marketplace account run together.
 *
 * Only ONE browser is held at a time, so a selection that alternates between
 * two AJIO logins would close and relaunch Chrome on every row — twenty claims,
 * twenty launches, which is the thing the lease was added to stop. Grouping
 * first makes it one launch per account no matter what order the operator
 * happened to tick the boxes in.
 *
 * STABLE: accounts keep the order they first appear in, and claims keep their
 * order within an account. An operator who selected top-to-bottom still sees
 * roughly that, and a row with no account attached simply keeps its place among
 * the others that have none.
 */
const groupedByAccount = <T extends { platform?: string; username?: string }>(items: T[]): T[] => {
  const groups = new Map<string, T[]>()

  for (const item of items) {
    const key = `${item.platform ?? ''}:${item.username ?? ''}`.toLowerCase()

    groups.set(key, [...(groups.get(key) ?? []), item])
  }

  return [...groups.values()].flat()
}

/**
 * What a run says when it passed claims over, naming the accounts.
 *
 * The same shape as `describeBlocked` and deliberately NOT the same words: one
 * says nothing was filed and asks the operator to act, the other says what was
 * left out of a run that otherwise went ahead.
 */
export const describeSkipped = (skipped: SkippedAccount[]): string => {
  const names = skipped
    .map(account => `${account.platform} (${account.username}) — ${account.claims}`)
    .join(', ')
  const claims = skipped.reduce((total, account) => total + account.claims, 0)

  return (
    `${claims} claim(s) skipped, no usable session: ${names}. ` +
    'Re-capture on the Login page; nothing was counted against them.'
  )
}

/**
 * Files a selection of claims, one after another, sharing one browser.
 *
 * THIS IS THE PATH "CREATE TICKET" TAKES, and it used to be a loop in the
 * renderer calling the single-claim entry point once per row. That had two
 * problems, both invisible until you watched the screen:
 *
 *   1. No lock. The loop ran outside `withAutomationLock`, so pressing Create
 *      Ticket during a bulk run or an auto-drain opened a SECOND marketplace
 *      browser — the exact thing the lock exists to prevent.
 *   2. No lease. Each call found no open lease and launched its own Chrome, so
 *      twenty selected rows meant twenty launches and twenty sign-ins.
 *
 * Moving the loop here fixes both at once: the batch is the thing that holds
 * the lock and the browser, and the renderer just waits for the summary.
 *
 * Sequential, deliberately: claims on one platform share a marketplace session
 * and its rate limit, and firing them together is how an account gets
 * throttled.
 */
export interface ProcessClaimsOptions {
  /**
   * Asked before each claim: should the batch stop here?
   *
   * FOR THE UNATTENDED RUN ONLY, and absent by default so Create Ticket is
   * untouched — a batch somebody pressed runs to the end. The nightly run
   * passes the schedule's master switch, so switching automations off stops
   * after the claim in flight rather than after all four hundred.
   *
   * BETWEEN CLAIMS, never inside one. A claim abandoned half-filed can exist on
   * the marketplace with no ticket recorded here, and the next run would file
   * it again.
   */
  shouldStop?: () => boolean
  /**
   * What to do when an account in the selection has no usable session.
   *
   * `refuse` (the default, and what Create Ticket takes) tries to renew each
   * dead session first and then refuses the WHOLE batch if any is still dead.
   * A selection is a unit of work somebody pressed once, and half of it
   * silently succeeding is harder to reason about than none of it running —
   * and there is a person at the machine who can answer a one-time code.
   *
   * `skip` is for a run with nobody watching. It renews NOTHING: at 04:00 a
   * sign-in window is a browser sitting open until it times out, not a
   * repair. The claims belonging to the dead account are passed over with
   * SKIPPED_SESSION_EXPIRED on the row and no attempt charged, and every other
   * account's claims are filed as normal — one expired login must not cost a
   * whole night's work.
   */
  onDeadSession?: 'refuse' | 'skip'
  /**
   * Which scheduled task's "Skip this marketplace" this batch obeys.
   *
   * Auto claim by default, which is what every caller passed before Proceed
   * eligible claims existed. That task files through this same batch, and a
   * Skip pressed on ITS row must reach it rather than the other task's.
   */
  skipTaskId?: ScheduledTaskId
}

/**
 * The batch's platforms whose company setting says to sign in by script —
 * `settings.isAutoLoginOnActiveSession.<platform>`, the flag Monitor writes.
 *
 * Asked once per platform, before the batch, because the gates that read the
 * answer are synchronous. `autoLoginEnabled` fails closed: unreadable settings
 * mean no platform signs in, which is what the batch did before this existed.
 */
const autoLoginPlatforms = async (items: { platform?: string }[]): Promise<string[]> => {
  const platforms = [...new Set(items.map(item => item.platform ?? '').filter(Boolean))]
  const answers = await Promise.all(platforms.map(async platform => ((await autoLoginEnabled(platform)) ? platform : null)))

  return answers.filter((platform): platform is string => platform !== null)
}

/**
 * Files a batch of claims — Create Ticket, a claim dispatched from TrackVid,
 * and the scheduled Proceed eligible claims / Auto claim.
 *
 * A SAVED LOGIN THAT HAS EXPIRED IS RE-CAPTURED, NOT A FAILURE, wherever the
 * company has auto-login on for that platform. The rule that no automation
 * signs in on its own still holds everywhere else: platforms with auto-login
 * off are refused as before (a person signs in there), and Refill Data, which
 * runs inside this batch, stays refused for every platform.
 */
export const processClaims = async (
  items: { cmsId: string; platform?: string; awbNumber?: string; username?: string }[],
  options: ProcessClaimsOptions = {}
): ReturnType<typeof fileClaims> => {
  if (items.length === 0) return fileClaims(items, options)

  return withSignInFor(await autoLoginPlatforms(items), () => fileClaims(items, options))
}

const fileClaims = async (
  items: { cmsId: string; platform?: string; awbNumber?: string; username?: string }[],
  { onDeadSession = 'refuse', shouldStop, skipTaskId = 'auto-claim' }: ProcessClaimsOptions = {}
): Promise<
  Result<{
    done: number
    ticketless: number
    failed: number
    failures: string[]
    skipped: SkippedAccount[]
    /** The batch's per-platform tally, as its progress ticks report it. */
    platforms: ClaimBatchPlatform[]
  }>
> => {
  if (items.length === 0) {
    return ok({ done: 0, ticketless: 0, failed: 0, failures: [], skipped: [], platforms: [] })
  }

  // Reassigned once, and only in `skip` mode, when the claims of a dead
  // account are taken out of the batch. Everything that reports progress reads
  // it at call time so the totals follow.
  let ordered = groupedByAccount(items)

  /** Accounts passed over, and what each one cost. Empty in `refuse` mode. */
  const skippedAccounts: SkippedAccount[] = []
  /** Claims passed over, per platform, for the chips. */
  const skippedByPlatform = new Map<string, { platform: string; claims: number }>()

  /**
   * Record a claim nobody attempted.
   *
   * The two reasons share this on purpose — an account with no usable login,
   * and a marketplace an operator passed over by hand. Both mean the same
   * thing to every tally downstream: not filed, not failed, no attempt spent,
   * and it files normally on the next run.
   */
  const skipClaim = (
    item: { platform?: string; awbNumber?: string },
    reason: string
  ): void => {
    const platform = item.platform ?? ''
    const key = platform.toLowerCase()
    const entry = skippedByPlatform.get(key) ?? { platform, claims: 0 }

    entry.claims += 1
    skippedByPlatform.set(key, entry)

    logger.info(`[create-ticket] ${platform} ${item.awbNumber ?? ''}: ${reason}`)
  }

  /**
   * The batch's marketplaces, counted before anything runs.
   *
   * Fixed at this point on purpose: the Auto claim row draws a chip per
   * platform the moment the batch starts, and a list that grew as platforms
   * were reached would say nothing about the ones still to come — which is the
   * half an operator actually wants to know about.
   */
  const tally = new Map<string, ClaimBatchPlatform>()

  const countPlatforms = (): void => {
    tally.clear()

    for (const item of ordered) {
      const platform = item.platform ?? ''
      const key = platform.toLowerCase()
      const entry = tally.get(key) ?? {
        platform,
        total: 0,
        done: 0,
        succeeded: 0,
        ticketless: 0,
        failed: 0,
        skipped: 0
      }

      entry.total += 1
      tally.set(key, entry)
    }

    // A platform whose every claim was skipped has no runnable share at all,
    // and still has to appear — "Myntra, 8 skipped" is the whole message.
    for (const [key, entry] of skippedByPlatform) {
      const existing = tally.get(key) ?? {
        platform: entry.platform,
        total: 0,
        done: 0,
        succeeded: 0,
        ticketless: 0,
        failed: 0,
        skipped: 0
      }

      existing.skipped = entry.claims
      tally.set(key, existing)
    }
  }

  countPlatforms()

  const skippedClaims = (): number =>
    [...skippedByPlatform.values()].reduce((total, entry) => total + entry.claims, 0)

  /** A copy per tick — the listener must not be handed the live counters. */
  const platforms = (): ClaimBatchPlatform[] => [...tally.values()].map(entry => ({ ...entry }))

  const record = (
    platform: string | undefined,
    outcome: 'filed' | 'ticketless' | 'failed'
  ): void => {
    const entry = tally.get((platform ?? '').toLowerCase())

    if (!entry) return

    entry.done += 1
    if (outcome === 'filed') entry.succeeded += 1
    else if (outcome === 'ticketless') entry.ticketless += 1
    else entry.failed += 1
  }

  /**
   * One tick, one shape.
   *
   * Everything below announces through this so a caller cannot send a
   * half-filled tick — which is how the refusal path below managed to end a
   * batch without ever saying it had ended.
   */
  const publish = (over: Partial<ClaimBatchProgress> = {}): void =>
    broadcast(CLAIM_QUEUE_EVENTS.batchProgress, {
      done: 0,
      total: ordered.length,
      succeeded: 0,
      ticketless: 0,
      failed: 0,
      failures: [],
      cmsId: '',
      platform: '',
      awbNumber: '',
      running: true,
      platforms: platforms(),
      skipped: skippedClaims(),
      ...over
    })

  // ANNOUNCED BEFORE THE PRE-FLIGHT, not after it.
  //
  // What follows can take minutes: every distinct account's session is probed,
  // and an account whose session is dead goes through `renewForClaim`, which on
  // a company with scripted sign-in off opens a window and waits up to five
  // minutes for a person. Three accounts is a quarter of an hour in the worst
  // case — and until now the first tick came after all of it, so an operator
  // pressed Create Ticket, watched a spinner, and had nothing anywhere saying
  // work had begun. The batch is real from the moment it is pressed, and the
  // panel should say so.
  publish({ phase: 'checking the accounts’ logins' })

  // CHECKED BEFORE ANYTHING OPENS. A dead session fails every claim it covers,
  // one at a time, burning an attempt each — and the operator was already being
  // told about it by the banner at the top of the screen. Dealing with it up
  // front costs one probe per account and files nothing it would have had to
  // undo.
  if (onDeadSession === 'skip') {
    // NOTHING IS RENEWED HERE. `sessionVerdicts`, not `inactiveAccounts`: the
    // renewal the latter attempts opens a sign-in window on an installation
    // with scripted login off, and at 04:00 that is a window nobody answers —
    // it holds the browser and the automation lock until it times out, and the
    // rest of the night's claims queue behind it.
    // A dead account on an auto-login platform is re-captured by script now —
    // no window, nobody needed — and its claims are filed with the rest. Only
    // what could not be renewed, or may not be, is passed over.
    const dead: Awaited<ReturnType<typeof sessionVerdicts>> = []

    for (const account of await sessionVerdicts(ordered)) {
      if (signInAllowed(account.platform)) {
        publish({ phase: `re-capturing the ${account.platform} login for ${account.username}` })

        const renewed = await renewForClaim(
          account.platform,
          account.username,
          undefined,
          `auto-login is on — ${account.detail}`
        )

        if (renewed) continue
      }

      dead.push(account)
    }

    const blockedKeys = new Map(
      dead.map(account => [accountKey(account.platform, account.username), account])
    )

    if (blockedKeys.size > 0) {
      const passedOver = ordered.filter(item =>
        blockedKeys.has(accountKey(item.platform ?? '', item.username ?? ''))
      )

      ordered = ordered.filter(
        item => !blockedKeys.has(accountKey(item.platform ?? '', item.username ?? ''))
      )

      for (const item of passedOver) {
        const platform = item.platform ?? ''
        const key = platform.toLowerCase()
        const entry = skippedByPlatform.get(key) ?? { platform, claims: 0 }

        entry.claims += 1
        skippedByPlatform.set(key, entry)
      }

      for (const [key, account] of blockedKeys) {
        skippedAccounts.push({
          platform: account.platform,
          username: account.username,
          claims: passedOver.filter(
            item => accountKey(item.platform ?? '', item.username ?? '') === key
          ).length,
          detail: account.detail
        })
      }

      countPlatforms()

      logger.warn(
        `[auto-claim] passing over ${passedOver.length} claim(s): ` +
          skippedAccounts
            .map(account => `${account.platform} (${account.username})`)
            .join(', ') +
          ' — no usable session'
      )

      // Written to every skipped row, one by one and BEFORE the batch starts,
      // so the Claims page says why a claim sat still tonight rather than
      // leaving it looking untouched. No attempt is charged for any of them.
      for (const item of passedOver) {
        await reportClaimSkipped(item.cmsId, SKIPPED_SESSION_EXPIRED)
      }
    }

    // Every account in the selection was dead. There is no batch to run, and
    // the panel has to be told or it sits at "running" forever.
    if (ordered.length === 0) {
      publish({
        running: false,
        phase: describeSkipped(skippedAccounts)
      })

      return ok({
        done: 0,
        ticketless: 0,
        failed: 0,
        failures: [],
        skipped: skippedAccounts,
        platforms: platforms()
      })
    }
  } else {
    // The whole batch, not the affected claims: a selection is a unit of work
    // an operator pressed once, and half of it silently succeeding is harder to
    // reason about than none of it running.
    const blocked = await inactiveAccounts(ordered)

    if (blocked.length > 0) {
      const message = describeBlocked(blocked)

      logger.warn(`[create-ticket] refused: ${message}`)

      // The batch is over, so the panel has to be told. Without this the tick
      // above was the last one it ever saw and it sat at "running" forever —
      // the failure mode that made the missing first tick worth fixing in the
      // first place, arrived at from the other end.
      publish({ running: false, phase: message })

      return fail('VALIDATION_ERROR', message)
    }
  }

  // Queued, not started. The lock is FIFO and a bulk run can hold it for hours,
  // so a batch pressed behind one would otherwise sit with no explanation —
  // which looks exactly like the bug above.
  if (isAutomationBusy()) {
    publish({ phase: `waiting for ${automationHolder() ?? 'another automation'} to finish` })
  }

  return withAutomationLock('create-ticket', async () => {
    openClaimLease()

    let done = 0
    /** Reported success, no ticket id came back. See the loop below. */
    let ticketless = 0
    const failures: string[] = []
    // Kept alongside `failures` rather than derived from it: the panel names the
    // AWB an operator can act on, and a bare message list cannot say which
    // claim it belongs to.
    const failed: { awbNumber: string; error: string }[] = []

    try {
      for (const [index, item] of ordered.entries()) {
        // The caller's own reason to stop — the schedule's master switch, for
        // the nightly run. Checked here so the claim in flight finishes and
        // nothing further is started.
        if (shouldStop?.()) {
          logger.info(`[create-ticket] stopped after ${index} of ${ordered.length}`)
          break
        }

        /*
         * ONE MARKETPLACE PASSED OVER BY HAND, the rest of the batch carrying
         * on. `continue`, not `break`: a batch is ordered by ACCOUNT so one
         * marketplace's claims are not contiguous, and breaking here would
         * abandon every platform behind it — which is the task-level Skip, not
         * this one.
         *
         * Counted as skipped, never failed: no attempt was made and none is
         * charged, so these claims are filed normally on the next run.
         */
        if (platformSkipped(skipTaskId, item.platform ?? '')) {
          skipClaim(item, 'Skipped by hand — the marketplace was passed over on this run')

          continue
        }

        // Announced BEFORE the call, so the panel names the claim that is
        // running rather than the one that just finished.
        publish({
          done: done + ticketless + failed.length,
          succeeded: done,
          ticketless,
          failed: failed.length,
          failures: failed,
          cmsId: item.cmsId,
          platform: item.platform ?? '',
          awbNumber: item.awbNumber ?? ''
        })

        logger.info(`[create-ticket] ${index + 1}/${ordered.length} — ${item.cmsId}`)

        const result = await runClaim(item.cmsId, {
          ...(item.platform ? { platform: item.platform } : {}),
          ...(item.awbNumber ? { awbNumber: item.awbNumber } : {})
        })

        /**
         * A SUCCESS WITHOUT A TICKET ID IS NOT A FILED CLAIM.
         *
         * `done` used to increment on `result.success` alone, and the runners
         * report success whether or not the marketplace gave a ticket back —
         * AJIO's says so in its own message, "claim raised (no ticket id)".
         * Worse, `processOne` guards the `/cms/update-ticket` write-back on
         * that same id, so those claims wrote nothing to TrackVid and were
         * still counted as filed. That is how a run reported 46 filed over a
         * list holding 6 tickets.
         *
         * Counted apart rather than as a failure: something probably WAS raised
         * at the marketplace, and calling it failed would invite the retry that
         * raises a second ticket for one return.
         */
        if (result.success) {
          if (result.data.ticketId) {
            done += 1
            record(item.platform, 'filed')
          } else {
            ticketless += 1
            logger.warn(
              `[create-ticket] ${item.awbNumber ?? item.cmsId}: reported success with no ticket id — ` +
                'nothing was written back to TrackVid. Check the marketplace before retrying.'
            )
            record(item.platform, 'ticketless')
          }
        } else {
          failures.push(result.error.message)
          failed.push({
            awbNumber: item.awbNumber ?? item.cmsId,
            error: result.error.message
          })
          record(item.platform, 'failed')
        }
      }
    } finally {
      await closeClaimLease()

      // Always sent, including after a throw: a panel still showing a running
      // batch is worse than one that shows nothing.
      //
      // This tick is also the RESULT. The panel keeps it on screen until the
      // operator dismisses it, so the totals survive the run that produced them
      // — a batch that vanished at 100% left nobody able to say how many of the
      // twenty actually went through.
      publish({
        done: done + ticketless + failed.length,
        succeeded: done,
        ticketless,
        failed: failed.length,
        failures: failed,
        running: false
      })
    }

    return ok({
      done,
      ticketless,
      failed: failures.length,
      failures,
      skipped: skippedAccounts,
      platforms: platforms()
    })
  })
}

/**
 * Runs a claim, and gives it a second chance when the marketplace says the
 * session expired.
 *
 * A pre-flight check cannot cover this. The session is asked about before the
 * claim starts and can die during it — and worse, the two questions are not the
 * same question: Myntra's probe reads the partner boot payload, which answers
 * happily, while the SPF API the claim actually calls replies "session expired"
 * for the very same jar. Nine claims failed that way with a session the probe
 * had just called healthy.
 *
 * The core already says which failures are this: `authError` tags them
 * `AUTH_EXPIRED` with the comment "so callers can re-login and retry once".
 * Nothing ever did. This is that caller.
 *
 * ONCE, deliberately. A second expiry after a fresh sign-in is not a stale
 * session — it is something else wearing the same message, and retrying it in a
 * loop would keep a marketplace account signing in over and over.
 */
export const runWithSessionRetry = async (
  claim: QueuedClaim,
  doc: ClaimDocument,
  runner: ClaimRunner
): Promise<ProcessResult> => {
  try {
    return await runner(claim, doc)
  } catch (error) {
    const expired = (error as { code?: string })?.code === 'AUTH_EXPIRED'

    if (!expired) throw error

    const username = await requireClaimAccount(claim.platform, doc).catch(() => null)

    if (!username) throw error

    logger.warn(
      `[claim] ${claim.platform} ${claim.cmsId}: the marketplace rejected the session mid-claim — ` +
        'renewing and trying once more'
    )

    const renewed = await renewForClaim(
      claim.platform,
      username,
      undefined,
      'the marketplace rejected the login while filing'
    )

    // Rethrow the ORIGINAL error, not a renewal failure: what the operator
    // needs to see is what the marketplace said, and a second message about the
    // sign-in would bury it.
    if (!renewed) throw error

    return runner(claim, doc)
  }
}

interface MappingEngine {
  mapAwbToAccount: (input: {
    awb: string
    alternates?: string[]
    accounts: MappingCredential[]
    probe: (account: MappingCredential, awb: string, alternates: string[]) => Promise<unknown>
    keyOf: (account: MappingCredential) => string
    recent?: unknown
    logger?: unknown
  }) => Promise<{ matched?: { username?: string } | null }>
}

/**
 * The row's sub-order number, when it is a string.
 *
 * Narrowed rather than stringified: this field has held an object on rows
 * written by older imports, and `String(…)` would offer the probe
 * "[object Object]" as an identifier to search for.
 */
const subOrderOf = (doc: ClaimDocument): string => {
  const value = (doc as { subOrderNumber?: unknown }).subOrderNumber

  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Finds the seller account a claim belongs to, when the row does not name one.
 *
 * WHY THE CLAIM DOES THIS AT ALL. A row with no account used to be refused —
 * by the server before dispatch, and here by `requireClaimAccount` whenever the
 * company has more than one login on the platform. But this app can simply ASK:
 * the account-mapping probe behind Map Username and Refill Data opens each
 * login and puts the AWB to it, and exactly one of them holds the return. That
 * is a question, not a guess, which is the difference between filling this in
 * and picking a seller at random.
 *
 * So the backend now routes an account-less claim HERE rather than refusing it
 * (see autoClaimDispatch), and this is the half that makes that worth doing.
 *
 * AND THE ACCOUNT IS RARELY THE ONLY BLANK. The search that names it answers
 * the rest — Meesho's returns row carries the sub-order number, AJIO's the POB
 * and the seller SKU, Myntra's the forward AWB — so the platform's own Refill
 * resolver runs for every field it offers while the session is open. Filing a
 * claim missing the identifier its form is keyed on fails at the marketplace a
 * minute later; asking now costs one more call on a browser already signed in.
 *
 * ACCOUNTS HOLDING A LIVE SESSION ARE ASKED FIRST, and one whose sign-in needs
 * a one-time code nobody is here to fetch is not asked at all — see
 * `mappingAccounts`, which is where all three of these runs get their list.
 *
 * WRITTEN BACK BEFORE FILING, through the same endpoints Map Username and
 * Refill Data use. Every one is fill-blank at the backend, so this can never
 * overwrite what the row already carries — and a claim filed on values the row
 * does not show is one nobody can trace afterwards.
 *
 * Costs a browser per login, which is why it only ever runs for a claim that
 * would otherwise not run at all.
 *
 * Exported for its test: it is the one step here with rules of its own, and the
 * alternative is proving them through a whole claim run.
 */
export const refillClaimBeforeFiling = async (
  claim: QueuedClaim,
  doc: ClaimDocument,
  token: string
): Promise<string | null> => {
  const awb = String(doc.AWBNumber ?? claim.awbNumber ?? '').trim()

  if (!awb) return null
  // The row already names one. Nothing here is about a claim somebody filled
  // in — `requireClaimAccount` reads it off the document as it always has.
  if (claimAccountUsername(claim.platform, doc)) return null
  // Nykaa. One login owns every ticket and no row carries an account, so there
  // is no blank here — only `requireClaimAccount`'s ordinary answer.
  if (companyWideAccount(claim.platform)) return null

  // Live sessions first, and no account whose sign-in needs a code nobody is
  // here to fetch — see mappingAccounts.
  const accounts = await mappingAccounts(claim.platform)

  if (accounts.length === 0) return null

  /**
   * ONE LOGIN IS NOT A QUESTION. Every claim on the platform belongs to it —
   * the create form's dropdown auto-selects it for exactly that reason — so
   * probing would be a browser session spent on a foregone conclusion. It is
   * still WRITTEN BACK and still refilled: the row is missing the account and
   * whatever came with it either way.
   */
  const sole = accounts.length === 1 ? (accounts[0]?.username ?? '') : ''

  // Nothing to open. A platform with no probe cannot be asked, and inventing
  // an answer for it is the thing this exists to avoid.
  if (!sole && !probeOpener(claim.platform)) return null

  if (sole) {
    logger.info(
      `[claim-account] ${claim.platform} ${claim.cmsId}: no account on the row — ` +
        `the company has one ${claim.platform} login (${sole})`
    )
  } else {
    logger.info(
      `[claim-account] ${claim.platform} ${claim.cmsId}: no account on the row — ` +
        `asking ${accounts.length} logins which one holds ${awb}`
    )
  }

  const { mapAwbToAccount } = loadCore<MappingEngine>('common/accountMapping')
  const pool = new ProbePool(claim.platform)
  /** Sessions the refill opens, closed with the probes below. */
  const contexts = new Map<string, unknown>()

  try {
    const result = sole
      ? null
      : await mapAwbToAccount({
          awb,
          // Meesho keys on the sub-order number, and a row whose AWB has gone
          // stale is still placeable by it.
          alternates: [subOrderOf(doc)].filter(Boolean),
          accounts,
          probe: async (account, wanted, alternates) =>
            (await pool.probe(account)).ask(wanted, alternates),
          keyOf: account => account.username,
          logger
        })

    const username = sole || (result?.matched?.username?.trim() ?? '')

    if (!username) {
      logger.info(
        `[claim-account] ${claim.platform} ${claim.cmsId}: ${awb} is on none of the company's logins`
      )

      return null
    }

    // Recorded before the claim is filed, so the row shows the account it was
    // filed under even if the filing then fails.
    const applied = await apiRequest<unknown>('/cms/account-map-apply', {
      method: 'POST',
      token,
      body: { cmsId: claim.cmsId, username }
    })

    if (!applied.success) {
      // The account is still the right one to file under — the write-back is
      // what failed, and refusing the claim over it would waste the probe.
      logger.warn(
        `[claim-account] ${claim.platform} ${claim.cmsId}: mapped to ${username} but the ` +
          `write-back failed (${applied.error.message}) — filing under it anyway`
      )
    } else {
      logger.info(`[claim-account] ${claim.platform} ${claim.cmsId}: mapped to ${username}`)
    }

    // ONTO THE DOCUMENT THE RUNNER IS ABOUT TO READ. The write above reached
    // the server; the runner reads the copy fetched before any of this, and
    // would otherwise fail a claim whose account had just been found.
    stampClaimAccount(claim.platform, doc, username)

    /**
     * AND THE REST OF THE BLANKS, through the account just established.
     *
     * A row that arrived without an account arrived without whatever else
     * nobody had filled in — the sub-order number Snapdeal's and Meesho's forms
     * are keyed on, AJIO's POB and seller SKU, Myntra's forward AWB. The search
     * that named the account answers those too, so they are taken now rather
     * than failed on at the marketplace a minute later. Never fatal: the account alone
     * may be all this claim was missing.
     */
    await refillClaimFields({
      platform: claim.platform,
      cmsId: claim.cmsId,
      doc,
      awb,
      username,
      token,
      contexts
    }).catch(error => {
      logger.warn(
        `[claim-refill] ${claim.platform} ${claim.cmsId}: could not refill the other fields — ` +
          (error instanceof Error ? error.message : String(error))
      )

      return []
    })

    return username
  } catch (error) {
    // A mapping that could not run leaves the claim exactly as it was: the
    // caller's own "no account" failure is the one worth reporting.
    logger.warn(
      `[claim-account] ${claim.platform} ${claim.cmsId}: could not map an account — ` +
        (error instanceof Error ? error.message : String(error))
    )

    return null
  } finally {
    await pool.closeAll()
    await closeRefillContexts(contexts)
  }
}

/**
 * The ticket check that runs after a failure, and what it writes.
 *
 * A gateway answers 502 after the marketplace has committed the case; a
 * read-back fails on a claim filed a minute earlier; a run dies between filing
 * and recording. Each leaves a row marked Failed against a ticket that EXISTS —
 * and the operator's next move, filing it again, is the one thing that must not
 * happen.
 *
 * So the marketplace is asked, on the platforms that can answer from what the
 * claim already knows (see TICKET_LOOKUPS, and the last step of every sequence
 * in the core's common/claimSteps). A ticket found here is recorded, with its
 * status where the marketplace reports one; found nothing, or could not ask,
 * and the original failure stands untouched.
 *
 * Deliberately quiet about its OWN failures: this is a second opinion on a
 * claim that has already gone wrong, and an error here must not replace the
 * error that actually matters.
 */
const salvageTicket = async (
  claim: QueuedClaim,
  doc: ClaimDocument | null,
  username: string | null,
  token: string
): Promise<Result<ProcessResult> | null> => {
  const lookup = ticketLookup(claim.platform)

  if (!lookup || !doc || !username) return null

  try {
    const found = await lookup({ claim, doc, username })

    if (!found) {
      logger.info(
        `[salvage] ${claim.platform} ${claim.cmsId}: no ticket exists — the failure stands`
      )

      return null
    }

    logger.info(
      `[salvage] ${claim.platform} ${claim.cmsId}: ticket ${found.ticketId} exists ` +
        `(${found.marketplaceStatus ?? 'no status'}) — recording it instead of the failure`
    )

    // The ticket first, exactly as the success path does it: a ticket that
    // exists at the marketplace and not in TrackVid is what makes somebody file
    // a second one.
    const report = await apiRequest<unknown>('/cms/update-ticket', {
      method: 'PUT',
      token,
      body: { _id: claim.cmsId, ticket: found.ticketId, source: 'desktop' }
    })

    if (!report.success) {
      logger.warn(
        `[salvage] ticket ${found.ticketId} could not be saved: ${report.error.message}`
      )

      return null
    }

    if (found.cmsStatus) {
      const synced = await apiRequest<unknown>('/cms/update-status', {
        method: 'POST',
        token,
        body: {
          _id: claim.cmsId,
          status: found.cmsStatus,
          reason: 'Read back from the marketplace after a failed submit'
        }
      })

      if (!synced.success) {
        logger.warn(
          `[salvage] could not set ${claim.cmsId} to "${found.cmsStatus}": ${synced.error.message}`
        )
      }
    }

    await setStatus(claim.cmsId, 'succeeded', { ticketId: found.ticketId })
    await endRun(claim.cmsId, 'Success', { ticketNumber: found.ticketId })

    return ok({
      cmsId: claim.cmsId,
      ticketId: found.ticketId,
      message: `Ticket ${found.ticketId} exists at the marketplace — recorded after a failed submit`,
      cmsStatus: found.cmsStatus
    })
  } catch (error) {
    logger.warn(
      `[salvage] ${claim.platform} ${claim.cmsId}: could not check for a ticket — ` +
        `${error instanceof Error ? error.message : String(error)}`
    )

    return null
  }
}

/** The script error a claim carries when submit is switched off on this machine. */
const DISABLE_SUBMIT_ERROR = 'MAIN_VITE_DISABLE_SUBMIT is disable'

const fileClaim = async (
  claim: Awaited<ReturnType<typeof listClaims>>[number],
  token: string
): Promise<Result<ProcessResult>> => {
  const cmsId = claim.cmsId
  /**
   * Kept out here for the catch: the ticket check that runs after a failure
   * needs the document and the account the run had resolved, and re-reading
   * them there would be a second chance to fail for a different reason.
   */
  let claimDoc: ClaimDocument | null = null
  let claimAccount: string | null = null

  /**
   * Routed here? Checked before anything else — a claim the server owns must
   * not be filed from this machine as well.
   *
   * UNLESS THE BACKEND SAID SO EXPLICITLY. A dispatched claim arrives with the
   * decision attached (`routedHere`), and re-deriving it here is how a claim
   * ends up owned by nobody: the dispatch hands it over — because the platform
   * has no server runner, or because the row has no account and only this side
   * can find one — and this app reads `desktopExecution` for itself, disagrees,
   * and declines. The row then sits on "Queued" with no attempts and nothing
   * to explain it.
   *
   * The check still applies to a claim this app went and FETCHED — the Claims
   * page, the nightly run — where nobody has decided anything yet.
   */
  if (!claim.routedHere && !(await runsHere(claim.platform, 'claim'))) {
    const message =
      `${claim.platform} claims run on the server for this company. ` +
      'Turn on desktop execution in Monitor to process them here.'

    /**
     * RECORDED, not merely refused.
     *
     * This was the one refusal in this function that returned without writing
     * anything to the local row, and the consequence was a queue that could
     * never empty: the backend dispatches an AJIO claim to this machine, the
     * routing says AJIO runs on the server, every drain refuses it, and the
     * record stays on `received` forever — which the Background work panel
     * reports as "queued". Five of them sat there from the minute they arrived
     * with no reason attached to any of them.
     *
     * LOCAL ONLY. No `endRun`: the SERVER owns this claim and is going to file
     * it, so telling the backend it failed here would be false and would spend
     * one of the row's attempts on a machine that never touched it.
     */
    await setStatus(cmsId, 'failed', { error: message })

    return fail('VALIDATION_ERROR', message)
  }

  /**
   * SUBMIT IS SWITCHED OFF ON THIS MACHINE (`MAIN_VITE_DISABLE_SUBMIT=true`).
   *
   * Stopped before anything runs — no browser, no sign-in, no uploads — and
   * recorded as a FAILED ATTEMPT, not put back as untouched: the backend
   * charges one attempt for `Failed` and shows the reason as the script error,
   * so an operator looking at the row can see exactly why nothing was filed.
   *
   * After the routing check on purpose: a claim the server owns is the
   * server's, and failing it from here would spend its attempt for nothing.
   */
  if (env.disableSubmit) {
    const message = DISABLE_SUBMIT_ERROR

    logger.warn(`[claim] ${claim.platform} ${cmsId} not processed — ${message}`)
    await setStatus(cmsId, 'failed', { error: message })
    await endRun(cmsId, 'Failed', { error: message })

    return fail('DRY_RUN', message)
  }

  // WHICH flow, not just whether. `desktopExecution` above decided that this
  // machine owns the claim; `apiBasedAutomation` decides how it files it, and
  // the two flows are not interchangeable — an account whose claims the API
  // rejects files perfectly well through the portal's UI, and vice versa. This
  // used to be a lookup by platform alone, so the setting was read on the
  // server and ignored here.
  const chosen = (await usesApiFlow(claim.platform, 'claim')) ? 'api' : 'script'
  const resolved = resolveClaimRunner(claim.platform, chosen)

  if (!resolved) {
    const message = `Processing ${claim.platform} claims here is not supported yet`

    await setStatus(cmsId, 'failed', { error: message })

    return fail('VALIDATION_ERROR', message)
  }

  const { runner, flow, substituted } = resolved

  if (substituted) {
    // Said out loud, because it is a real difference from what the company
    // configured — just a smaller one than not filing the claim at all.
    logger.warn(
      `[claim] ${claim.platform} is set to the ${chosen} flow, which this app does not have — ` +
        `filing with the ${flow} flow instead, the only one it has for ${claim.platform}`
    )
  }

  logger.info(`[claim] ${claim.platform} ${claim.cmsId} — ${flow} flow`)

  // Put the core into DESKTOP mode before any runner touches it.
  //
  // Every master-import runner did this and no claim runner did, so claims ran
  // with the core still configured as the automation server. Three things were
  // wrong at once, and only the first was visible:
  //
  //   • no `useDirectConnection()` — so the Myntra login took the Bright Data
  //     path and died on `Cannot find module 'proxy-chain'`, a server-only
  //     package. This machine is already on a residential connection, which is
  //     the only thing that proxy exists to borrow.
  //   • no `disableSessionPersistence()` — so a login would have tried to write
  //     its session straight to Mongo, which this app must never reach.
  //   • none of the env values the core reads were published.
  //
  // Done HERE, at the one boundary every claim passes through, so a runner
  // added later cannot forget it — the same reasoning as the process log.
  await prepareCoreWithBrowser(
    message => logger.info(`[${claim.platform}/${cmsId}] ${message}`),
    claim.platform
  )

  await setStatus(cmsId, 'running')
  // Local tick starts and the backend is told once. From here on the row is
  // recoverable: if this process dies, the next startup finds it still marked
  // running and resets it — see claimLiveness.service.
  await beginRun(cmsId)

  try {
    const response = await apiRequest<ClaimDocument | null>('/cms/find-by-awb', {
      method: 'POST',
      token,
      body: { awb: claim.awbNumber, platform: claim.platform }
    })

    if (!response.success) throw new Error(response.error.message)
    if (!response.data) throw new Error(`No claim found for AWB ${claim.awbNumber}`)

    // TEMPORARY DIAGNOSTIC — remove once desktop claims are proven end to end.
    //
    // Two failures in a row came from reading a field that was not there:
    // `doc.account.username` (never returned by /cms/find-by-awb) and then a
    // session store the company document does not write to. Both were only
    // visible as "no account" / "no session", which named the symptom and not
    // the cause. This prints what the document ACTUALLY carries, so the next
    // one names itself.
    const doc = response.data as Record<string, unknown>

    claimDoc = response.data
    // Only a string is worth printing — anything else is not an account name,
    // and stringifying it would log "[object Object]".
    const text = (value: unknown): string => (typeof value === 'string' && value ? value : '-')
    const nested = (key: string): string =>
      text((doc[key] as Record<string, unknown> | undefined)?.username)

    logger.info(
      `[claim-doc] ${cmsId} ${claim.platform} account fields — ` +
        `ajio_account_email=${text(doc.ajio_account_email)} ` +
        `meesho_account_email=${text(doc.meesho_account_email)} ` +
        `snapdeal_account_username=${text(doc.snapdeal_account_username)} ` +
        `myntraClaimDetails.username=${nested('myntraClaimDetails')} ` +
        `nykaaClaimDetails.username=${nested('nykaaClaimDetails')} ` +
        `otherClaimDetails.username=${nested('otherClaimDetails')}`
    )

    // THE SAME RULE AS THE BATCH, applied where the account is finally known.
    //
    // A socket-dispatched claim never passes through `processClaims`, so its
    // pre-flight does not see it — and the account only exists once the
    // document has been read. Refused here rather than attempted: a dead
    // session cannot file anything, and the attempt would cost the row one of
    // its three tries to learn what the probe already knew.
    // The row's own account first (`refillClaimBeforeFiling` declines a claim
    // that names one), then the marketplace, then the company's credentials —
    // which is where `requireClaimAccount`'s own sole-login fallback lives.
    const account =
      (await refillClaimBeforeFiling(claim, response.data, token)) ??
      (await requireClaimAccount(claim.platform, response.data).catch(() => null))

    claimAccount = account
    const stale = account
      ? await inactiveAccounts([{ platform: claim.platform, username: account }])
      : []

    if (stale.length > 0) {
      const message = describeBlocked(stale)

      logger.warn(`[claim] ${cmsId} refused: ${message}`)
      await setStatus(cmsId, 'failed', { error: message })
      await endRun(cmsId, 'Not Started', { error: message })

      return fail('VALIDATION_ERROR', message)
    }

    const result = await runWithSessionRetry(claim, response.data, runner)

    // Report the ticket before marking success locally: a ticket raised at the
    // marketplace but never written back is the worst outcome, because the next
    // run would raise a second one.
    if (result.ticketId) {
      const report = await apiRequest<unknown>('/cms/update-ticket', {
        method: 'PUT',
        token,
        // `source` is what stops this landing in TrackVid as a hand-typed
        // ticket: the endpoint is the one a person uses, and it records every
        // other caller as "manual". This claim was filed by the app.
        body: { _id: claim.cmsId, ticket: result.ticketId, source: 'desktop' }
      })

      if (!report.success) {
        const message = `Dispute ${result.ticketId} was raised but could not be saved: ${report.error.message}`

        await setStatus(cmsId, 'failed', { error: message, ticketId: result.ticketId })
        // "Help Center Failed", not "Failed": the dispute EXISTS at the
        // marketplace and only the write-back was lost. Reporting a plain
        // failure would invite a retry that raised a second ticket for the
        // same AWB. The ticket id rides along as the backstop write.
        await endRun(cmsId, 'Help Center Failed', {
          ticketNumber: result.ticketId,
          error: message
        })

        return fail('INTERNAL_ERROR', message)
      }
    }

    // The marketplace's own view of the ticket, when the runner read one back.
    //
    // AFTER the ticket write-back and never instead of it: the ticket id is the
    // thing that must not be lost, and a status write that failed first would
    // have taken the id down with it. A failure here is logged, not fatal — the
    // claim is filed, and the status-sync job corrects the label on its next
    // pass.
    if (result.cmsStatus) {
      const synced = await apiRequest<unknown>('/cms/update-cms-status', {
        method: 'PUT',
        token,
        body: { _id: claim.cmsId, status: result.cmsStatus, reason: 'Read back from the marketplace' }
      })

      if (synced.success) {
        logger.info(`Claim ${cmsId} status set to "${result.cmsStatus}" from the marketplace`)
      } else {
        logger.warn(`Could not set claim ${cmsId} to "${result.cmsStatus}": ${synced.error.message}`)
      }
    }

    await setStatus(cmsId, 'succeeded', {
      ...(result.ticketId ? { ticketId: result.ticketId } : {})
    })
    await endRun(cmsId, 'Success', {
      ...(result.ticketId ? { ticketNumber: result.ticketId } : {})
    })
    logger.info(`Processed claim ${cmsId}: ${result.message}`)

    return ok(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // DISABLE_SUBMIT stopped it deliberately. Not a failure: everything up to
    // the marketplace ran, and the row must go back to being claimable rather
    // than be recorded as broken — a dry run that left rows looking failed
    // would be worse than no dry run at all.
    if ((error as { code?: string })?.code === 'CLAIM_SUBMIT_DISABLED') {
      const note =
        'Dry run — DISABLE_SUBMIT is on, so the claim was prepared but never filed. ' +
        'Everything up to the marketplace submit ran for real.'

      logger.info(`Claim ${cmsId}: ${note}`)

      await setStatus(cmsId, 'failed', { error: note })
      await endRun(cmsId, 'Not Started', { error: note })

      return fail('DRY_RUN', note)
    }

    logger.error(`Claim ${cmsId} failed: ${message}`)

    /**
     * A FAILED CLAIM IS NOT ALWAYS AN UNFILED ONE.
     *
     * A gateway answers 502 after the marketplace has committed the case; a
     * read-back fails on a claim filed a minute earlier; a run dies between
     * filing and recording. Each leaves a row marked Failed against a ticket
     * that exists — and the operator's next move, filing it again, is the one
     * thing that must not happen.
     *
     * So the marketplace is asked, on the platforms that can answer from what
     * the claim already knows. A ticket found here is recorded and the row is a
     * success; found nothing, or could not ask, and the failure stands exactly
     * as it did. This is the last step of the claim — see the core's
     * common/claimSteps.
     */
    const salvaged = await salvageTicket(claim, claimDoc, claimAccount, token)

    if (salvaged) return salvaged

    // A changed password is the one failure here an operator can fix, and it
    // will not resolve itself on a retry. Flagging the credential is what puts
    // it in front of them — otherwise the row just fails again tomorrow, and
    // the Sessions page still shows the account as verified.
    await unverifyOnBadCredentials(claim, error, token)

    // A failure the runner has said is FINAL — the claim cannot be filed at
    // all, so letting it burn its remaining attempts would only produce the
    // same message twice more. Reported so the backend moves the row to
    // "Failed to Proceed" now.
    const terminal = (error as { terminal?: boolean })?.terminal === true

    // `endRun` FIRST. Everything above it in this catch block can throw — a
    // local store write, an API call, a credential flag — and a throw inside a
    // catch leaves the function with the backend still on Running. Telling the
    // backend before touching anything local means the row cannot be stranded
    // by the bookkeeping that follows it.
    await endRun(cmsId, 'Failed', { error: message, ...(terminal ? { terminal } : {}) })
    await setStatus(cmsId, 'failed', { error: message })

    return fail('INTERNAL_ERROR', message)
  } finally {
    // However this function leaves — including a throw from inside the catch
    // above — the backend is never left believing the claim is still running.
    // A no-op on every path that already reported.
    await settleIfUnreported(cmsId)
  }
}


/**
 * The status tabs for every platform this app shows, from the core's registry.
 *
 * Returned as a map in one call rather than per platform: it is a few hundred
 * bytes of static data and the renderer switches platform tabs constantly, so a
 * round trip per switch would be pure latency for no freshness.
 */
export const claimStatusTabs = (platforms: string[]): Result<Record<string, ClaimStatusTab[]>> => {
  const { claimStatusTabs: tabsFor } = loadCore<{
    claimStatusTabs: (platform: string) => ClaimStatusTab[]
  }>('common/claimStatuses')

  const map: Record<string, ClaimStatusTab[]> = {}

  for (const platform of platforms) map[platform] = tabsFor(platform)

  return ok(map)
}
