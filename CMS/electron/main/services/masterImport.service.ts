import type { MasterImportRow, MasterResyncResult } from '@shared/types/masterImport'
import { fail, ok, type Result } from '@shared/types/result'
import { getPlatform } from '@trackvid/automation-core/common/platforms'
import { apiRequest } from './httpClient'
import { getAccessToken, getSession } from './session.store'
import { sessionHealth } from './platformSession.service'
import { scheduleState } from './importScheduler.service'
import { runsHere, usesApiFlow } from './automationRouting.service'
import { logger } from './logger'
import { masterImportRunner } from '../automations/masterImportRegistry'
import { credentialSecret } from './credentialSecret.service'
import {
  logProcessClosed,
  logProcessFailed,
  logProcessStarted,
  processName
} from '../automations/common/processLog'

/**
 * The master-import table: one row per credential that can be imported.
 *
 * Assembled from data the app already holds rather than a new endpoint — the
 * credential list carries each login's own `masterDataSync`, and the schedule
 * carries the per-platform times. Both are cached offline, so this table keeps
 * working when the backend does not.
 *
 * Two conditions, both required:
 *
 *   1. the platform HAS a master import — four of the eight do, and a row for
 *      Flipkart would offer a Resync that could never run;
 *   2. the company has routed that import to the desktop
 *      (`settings.desktopExecution.<platform>.masterImport`).
 *
 * The second is the company saying "this machine is responsible for this
 * platform's import". Without it the server runs the import on its own
 * schedule, and offering a Resync here would mean two places starting the same
 * job — the same reasoning that stops the desktop app filing a claim the server
 * owns.
 */

export const masterImportRows = async (): Promise<Result<MasterImportRow[]>> => {
  const health = await sessionHealth()

  if (!health.success) return health

  // Which platforms HAVE a master import comes from the registry, not from the
  // scheduler.
  //
  // The scheduler's `schedulablePlatforms` is only populated once it has read
  // the company settings, which happens after sign-in and can fail. Depending
  // on it meant an empty table whenever that read had not landed — and the
  // table then claimed "no platform has a master import", which is a different
  // and untrue statement. The registry always knows.
  //
  // Scheduler state is still used for the TIMES, where an empty answer is
  // honest: no schedule read yet means no time to show.
  const schedule = scheduleState()
  const rows: MasterImportRow[] = []

  for (const entry of health.data) {
    const platform = getPlatform(entry.platform)

    if (!(platform?.automations ?? []).includes('masterImport')) continue

    for (const credential of entry.credentials) {
      rows.push({
        platform: entry.platform,
        platformLabel: platform?.label ?? entry.platform,
        credentialId: credential.credentialId,
        username: credential.username,
        syncTime: schedule.syncTimes[entry.platform] ?? null,
        // Null means never synced. Deliberately still a ROW: an account that
        // has never imported is the one most likely to need a resync, and
        // hiding it until it has synced once is exactly backwards.
        lastSyncAt: credential.masterDataSync
      })
    }
  }

  return ok(rows)
}

/**
 * Runs a master import on this machine, one credential at a time.
 *
 * Sequential because each one drives a browser and downloads a report; two at
 * once would compete for the screen and for the portal's rate limits.
 */
const runLocally = async (
  platform: string,
  credentialIds: string[],
  rows: { platform: string; credentialId: string; username?: string }[],
  runner: NonNullable<ReturnType<typeof masterImportRunner>>
): Promise<MasterResyncResult[]> => {
  const session = getSession()
  const token = getAccessToken()
  const results: MasterResyncResult[] = []

  for (const credentialId of credentialIds) {
    const username = rows.find((row) => row.credentialId === credentialId)?.username ?? ''
    // One line each as the run opens and closes, so a terminal scrolling past
    // shows where a process began and whether it ended — see RULES.md.
    const label = processName(platform, 'master import', username)

    logProcessStarted(label)

    try {
      const secret = await credentialSecret(platform, username)

      if (!secret.success) throw new Error(secret.error.message)
      if (!session) throw new Error('Sign in to run a master import')

      const outcomes = await runner(
        {
          companyId: session.user.companyId,
          // The upload is filed against a TrackVid profile; the signed-in
          // operator is the one running it.
          trackVidEmail: session.user.email,
          username,
          password: secret.data.password,
          credentialId
        },
        // The runners narrate every step through this — which report they are
        // requesting, why they signed in rather than reusing a session, how
        // long until the next check. It was not passed at all, so every one of
        // those lines was computed and thrown away, and an import that behaved
        // unexpectedly left nothing to read afterwards.
        (message) => logger.info(`[${platform}/${username}] ${message}`)
      )

      const failed = outcomes.filter((outcome) => !outcome.ok)

      // Stamp the sync date, as the automation server does straight after its
      // own upload. Without this a desktop import loads the data and leaves
      // "Last sync" reading weeks old — it looks like nothing happened.
      //
      // Only when EVERY report type succeeded: a partial import has not brought
      // the account up to date, and marking it as though it had would hide the
      // gap from the next run and from whoever reads the column.
      if (failed.length === 0 && token) {
        const stamped = await apiRequest<unknown>('/cms/master-sync/date', {
          method: 'PUT',
          token,
          body: { platform, credentialIds: [credentialId] }
        })

        // Bookkeeping, not the import. The server treats a failed stamp the
        // same way — "run still considered successful" — so this must not turn
        // a completed import into a reported failure.
        if (!stamped.success) {
          logger.warn(
            `Imported ${platform} for ${username} but could not update its last-sync date: ${stamped.error.message}`
          )
        }
      }

      const message =
        failed.length > 0
          ? failed.map((outcome) => `${outcome.importType}: ${outcome.message}`).join('; ')
          : ''

      // A partly-failed import is not a close. Reporting it as one would make
      // the only line most people read say the opposite of what happened.
      if (message) logProcessFailed(label, message)
      else logProcessClosed(label)

      results.push({
        platform,
        credentialId,
        ok: failed.length === 0,
        ...(message ? { message } : {})
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      logProcessFailed(label, message)

      results.push({ platform, credentialId, ok: false, message })
    }
  }

  return results
}

export const resyncMasterImport = async (payload: unknown): Promise<Result<MasterResyncResult[]>> => {
  const input = (payload ?? {}) as {
    rows?: { platform: string; credentialId: string; username?: string }[]
  }
  const rows = Array.isArray(input.rows) ? input.rows : []

  if (rows.length === 0) return fail('VALIDATION_ERROR', 'Select at least one account to resync')

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to resync master data')

  const byPlatform = new Map<string, string[]>()
  const results: MasterResyncResult[] = []

  for (const row of rows) {
    const platform = String(row.platform || '').toLowerCase().trim()
    const credentialId = String(row.credentialId || '').trim()

    if (!platform || !credentialId) continue

    // Routing is resolved per platform below, not here. A platform that is NOT
    // routed to this machine is not an error — it runs on the automation
    // server, which is the whole point of having two paths. Refusing it here
    // meant Resync failed for every platform the company had not moved to the
    // desktop, with a message that read like a bug in their configuration.
    byPlatform.set(platform, [...(byPlatform.get(platform) ?? []), credentialId])
  }

  for (const [platform, credentialIds] of byPlatform) {
    // Where, then how. `desktopExecution` decides which machine runs the
    // import; `apiBasedAutomation` decides whether it talks to the portal's
    // APIs or drives its UI. Both are company settings, and both are cached, so
    // this answers the same way offline as on.
    const local = await runsHere(platform, 'masterImport')
    const flow = (await usesApiFlow(platform, 'masterImport')) ? 'api' : 'script'

    // No flow is refused up front. Whether a pairing can run here is one
    // question — does the registry have a runner for it — and the branches
    // below answer it the same way for the API and script flows alike.
    const runner = local ? masterImportRunner(platform, flow) : null

    if (local && runner) {
      results.push(...(await runLocally(platform, credentialIds, rows, runner)))
      continue
    }

    if (local) {
      // Routed to the desktop, but this platform/flow has no runner here.
      //
      // This must NOT fall through to the server. The server deliberately
      // refuses desktop-routed configs — partitionByRouting sets them aside as
      // "routed to desktop app" and passes them to neither runner — so handing
      // it the job produces a cheerful "queued" and then nothing at all. A
      // silent no-op is the worst outcome available: it looks like success.
      //
      // desktopExecution: true means this machine owns the import. If it cannot
      // run it, that is a gap to report, not to route around.
      for (const credentialId of credentialIds) {
        results.push({
          platform,
          credentialId,
          ok: false,
          message:
            `${platform} master import is routed to this machine (desktopExecution), but the ` +
            `${flow}-based import is not built here yet. The server will not run it either — it ` +
            'skips anything routed to the desktop. Turn desktopExecution off for this platform to ' +
            'run it on the server meanwhile.'
        })
      }
      logger.error(
        `${platform} master import routed here with no ${flow} runner — refusing rather than ` +
          'handing it to a server that will skip it'
      )
      continue
    }

    const response = await apiRequest<unknown>('/cms/master-sync', {
      method: 'POST',
      token,
      body: { platform, credentialIds },
      // An import is queued, not awaited — the server answers 202 once it has
      // accepted the work. Still generous: it reads the company and its
      // credentials before replying.
      timeoutMs: 60_000
    })

    for (const credentialId of credentialIds) {
      results.push({
        platform,
        credentialId,
        ok: response.success,
        ...(response.success ? {} : { message: response.error.message })
      })
    }

    if (response.success) logger.info(`Queued a ${platform} master import for ${credentialIds.length} credential(s)`)
    else logger.error(`Could not queue the ${platform} master import`, response.error)
  }

  return ok(results)
}
