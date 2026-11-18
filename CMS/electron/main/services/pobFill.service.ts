import { dialog } from 'electron'
import { basename, dirname, extname, join } from 'node:path'
import type { Result } from '@shared/types/result'
import type { PobFillSummary } from '@shared/types/bulkSpf'
import { fail, ok } from '@shared/types/result'
import { awbLookup, type BackupMatch } from './masterBackup.store'
import { claimCredentials } from './claimSession.service'
import { credentialsFor, orderedPobIds } from './company.service'
import { leasedSession } from './browserLease.service'
import { loadCore } from '@main/automations/common/coreLoader'
import { openSignedInAjioPage } from '@main/automations/platforms/ajio/common/signedInPage'
import { withAutomationLock } from './automationLock'
import { logger } from './logger'

/**
 * Fill the POB ID on a bulk-claim sheet that only has return AWBs.
 *
 * WHY IT EXISTS. Every AJIO return lookup is scoped to a POB, and a bulk-claim
 * row without one is bucketed `missingPob` and never attempted. An operator
 * starting out has the AWB from the courier and nothing else — the POB is an
 * AJIO-internal id they have no way to know. This takes the sheet they can
 * make and returns the sheet the claim needs.
 *
 * TWO SOURCES, CHEAPEST FIRST:
 *
 *   1. this machine's AJIO return backup, which already indexes AWB → POB.
 *      No login, no network, instant — and it answers for every return the
 *      nightly sync has downloaded, which on a working installation is most
 *      of them.
 *   2. a live sweep of each AJIO account's return report, for the rows the
 *      backup did not have.
 *
 * THE SWEEP IS PER ACCOUNT, NOT PER ROW. The manage-returns endpoint answers
 * one POB at a time, so asking it per AWB is POBs × windows × rows — eighteen
 * thousand requests for a 60-POB account and a 100-row sheet. The report
 * endpoint takes every POB in one body and carries `pobId` on each row, so one
 * sweep builds an index that answers the whole sheet. See
 * `buildReturnPobIndex`.
 *
 * ACCOUNTS ARE TRIED IN TURN and the sweep stops as soon as every row is
 * filled: a company with six AJIO logins does not pay for all six when the
 * first one holds the returns.
 */

interface SheetRow {
  rtNumber: string
  awb: string
  sku: string
  pobId: string
  note: string
}

interface BulkExcel {
  readRows: (
    path: string,
    options?: { claimType?: string; eanAsSku?: boolean }
  ) => { rows: { awb?: string; ron?: string; sku?: string; pobid?: string }[] }
  writeFilledSheet: (outputPath: string, rows: SheetRow[]) => string
}

interface AjioPobSync {
  syncPobIds: (
    page: unknown,
    userId: string,
    options: { enterpriseLevel?: boolean; logger?: unknown }
  ) => Promise<{ pobIds: string[] }>
}

interface AjioReportView {
  buildReturnPobIndex: (
    page: unknown,
    input: { pobIds: string[]; days?: number; userLogger?: unknown }
  ) => Promise<
    Map<
      string,
      { pobId: string; returnOrderNo: string; returnAwbNo: string; sellerSku: string; ean: string }
    >
  >
  /** The live manage-returns list, asked per POB — the fallback for what the sweep missed. */
  findReturnPob: (
    page: unknown,
    input: {
      returnOrderNo?: string
      returnAwb?: string
      pobIds: string[]
      days?: number
      userLogger?: unknown
    }
  ) => Promise<{ pobId: string; returnOrderNo: string; returnAwbNo: string } | null>
}

const excel = (): BulkExcel =>
  loadCore<BulkExcel>('platforms/ajio/claim-management/api-based-flow/bulkSpfExcel')

/** Where the filled copy goes: beside the original, named so it cannot be confused with it. */
const filledPathFor = (source: string): string =>
  join(dirname(source), `${basename(source, extname(source))}.pob-filled.xlsx`)

/**
 * Sweep one account's returns into the index, for the rows still unfilled.
 *
 * Returns the number of rows it managed to fill. Throwing is reserved for
 * "this account could not be asked at all" — the caller moves to the next one
 * rather than abandoning the sheet.
 */
const fillFromAccount = async (
  username: string,
  pending: SheetRow[],
  days: number | undefined
): Promise<number> => {
  const stored = await credentialsFor('ajio').then(all =>
    all.find(entry => entry.username.trim().toLowerCase() === username.trim().toLowerCase())
  )
  const saved = orderedPobIds(stored?.pobIds ?? [])

  const credentials = await claimCredentials('ajio', username)
  const { buildReturnPobIndex, findReturnPob } = loadCore<AjioReportView>(
    'platforms/ajio/master-import/api-based-flow/reportView'
  )
  const { syncPobIds } = loadCore<AjioPobSync>('platforms/ajio/common/pobSync')

  const { page, context, release } = await leasedSession(`ajio:${username}`, async () => {
    const opened = await openSignedInAjioPage({ username, password: credentials.password })

    return { browser: opened.browser, page: opened.page, context: { sellerId: opened.sellerId } }
  })

  try {
    /*
     * THE POBs READ FROM AJIO, NOT FROM WHAT WAS LAST SYNCED.
     *
     * This is what made the fill answer "not found" for rows that are plainly
     * there: a return under `DV00334297` was never looked for, because the
     * stored list held only the DV003495xx/DV003531xx range. Monitor's Sync
     * POBs is the only thing that refreshes that list, and a POB added at AJIO
     * since the last sync is invisible until somebody notices and runs it.
     *
     * The page is already open and signed in, so asking AJIO costs one request
     * — far less than a sheet of rows reported missing for a POB nobody asked
     * about.
     *
     * UNIONED WITH THE STORED LIST, never replacing it: a live read that comes
     * back short (a page that failed mid-sweep) must not shrink the search.
     */
    let pobIds = saved

    try {
      const live = await syncPobIds(page, String(context?.sellerId ?? ''), {
        enterpriseLevel: stored?.isEnterpriseLevel === true,
        logger
      })
      const union = [...new Set([...live.pobIds, ...saved])]

      if (union.length > saved.length) {
        logger.info(
          `[pob-fill] ${username}: AJIO reports ${live.pobIds.length} POB(s); ` +
            `${union.length - saved.length} were not in the stored list — run Sync POBs to keep it current`
        )
      }

      /*
       * ALREADY ORDERED: `saved` came through `orderedPobIds` (most recently
       * used first), and the live ids that are new to us go after it. Sorting
       * again would need the POB records this list no longer carries, and the
       * useful half of that order — try the ones that answered recently first
       * — is preserved as it stands.
       */
      pobIds = union
    } catch (error) {
      logger.warn(`[pob-fill] ${username}: could not read POBs live — using the stored list`, error)
    }

    if (pobIds.length === 0) {
      logger.info(`[pob-fill] ${username}: no POBs at all — skipped`)

      return 0
    }

    const index = await buildReturnPobIndex(page, {
      pobIds,
      ...(days ? { days } : {}),
      userLogger: logger
    })

    let filled = 0

    for (const row of pending) {
      /*
       * EITHER IDENTIFIER. The index is keyed by both the return AWB and the
       * return order number, because the sheet's column is whatever the
       * operator had — and an RT number typed under the "Return AWB" heading
       * is common enough that refusing it would be pedantry, not safety.
       */
      const match =
        index.get(row.awb.toUpperCase()) ?? index.get(row.rtNumber.toUpperCase())

      if (!match?.pobId) continue

      // An RT-only sheet wants the AWB back as much as the POB.
      if (!row.awb) row.awb = match.returnAwbNo

      row.pobId = match.pobId
      row.note = `POB from ${username}`
      // Whatever the sheet did not carry, the report did. An RT-only sheet is
      // the common case, and the AWB is the column the claim reports under.
      if (!row.rtNumber) row.rtNumber = match.returnOrderNo
      if (!row.sku) row.sku = match.sellerSku || match.ean
      filled += 1
    }

    /*
     * THE LIVE LIST, FOR WHAT THE SWEEP COULD NOT PLACE.
     *
     * The report is a report: a return created yesterday is not in it yet, and
     * those are exactly the ones a bulk claim is usually about. This asks the
     * manage-returns list the seller portal itself renders — per POB, so it
     * costs POBs × windows for ONE row, which is why only the rows the sweep
     * missed pay for it.
     */
    const stillMissing = pending.filter(row => row.pobId === '')

    for (const row of stillMissing) {
      try {
        const hit = await findReturnPob(page, {
          ...(row.rtNumber ? { returnOrderNo: row.rtNumber } : {}),
          ...(row.awb ? { returnAwb: row.awb } : {}),
          pobIds,
          ...(days ? { days } : {}),
          userLogger: logger
        })

        if (!hit?.pobId) continue

        row.pobId = hit.pobId
        row.note = `POB from ${username} (live list)`
        if (!row.rtNumber) row.rtNumber = hit.returnOrderNo
        // The AWB is what an RT-only sheet came for.
        if (!row.awb) row.awb = hit.returnAwbNo
        filled += 1
      } catch (error) {
        logger.warn(`[pob-fill] ${username}/${row.rtNumber || row.awb}: live lookup failed`, error)
      }
    }

    logger.info(`[pob-fill] ${username}: filled ${filled} of ${pending.length} outstanding row(s)`)

    return filled
  } finally {
    await release()
  }
}

/**
 * @param payload.filePath the operator's sheet — Return AWB, and SKU if known
 * @param payload.days     how far back to sweep; the core's default otherwise
 */
export const fillPobIds = async (payload: unknown): Promise<Result<PobFillSummary>> => {
  const { filePath: given, days } = (payload ?? {}) as { filePath?: unknown; days?: unknown }

  /*
   * ITS OWN DIALOG, not the upload one.
   *
   * `chooseBulkFile` refuses a sheet with no POB column — correctly, because a
   * claim cannot be filed without one. That is precisely the sheet this
   * function exists to accept, so it opens its own picker.
   */
  let filePath = typeof given === 'string' ? given.trim() : ''

  if (!filePath) {
    const chosen = await dialog.showOpenDialog({
      title: 'Choose the sheet to fill POB IDs on',
      properties: ['openFile'],
      filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xls'] }]
    })

    filePath = chosen.canceled ? '' : (chosen.filePaths[0] ?? '')

    if (!filePath) return fail('VALIDATION_ERROR', 'No file chosen')
  }

  let parsed: { rows: { awb?: string; ron?: string; sku?: string; pobid?: string }[] }

  try {
    // The filled copy goes back into the bulk claim, so it is read the same way.
    parsed = excel().readRows(filePath, { eanAsSku: true })
  } catch (error) {
    return fail('VALIDATION_ERROR', error instanceof Error ? error.message : String(error))
  }

  const rows: SheetRow[] = parsed.rows.map(row => ({
    rtNumber: String(row.ron ?? '').trim(),
    awb: String(row.awb ?? '').trim(),
    sku: String(row.sku ?? '').trim(),
    pobId: String(row.pobid ?? '').trim(),
    note: ''
  }))

  if (rows.length === 0) return fail('VALIDATION_ERROR', 'That sheet has no rows.')

  // Either identifier is enough to look a row up; only a row with neither is
  // beyond help.
  const identified = (row: SheetRow): boolean => row.awb !== '' || row.rtNumber !== ''

  for (const row of rows) {
    if (!identified(row)) row.note = 'No return AWB or RT number on this row'
  }

  /*
   * THE BACKUP FIRST, for every row. It costs one local read and typically
   * answers most of the sheet, which is the difference between a sweep that
   * opens one browser and one that opens six.
   */
  const fromBackup = await awbLookup('return').catch(
    (): Map<string, BackupMatch> => new Map()
  )
  let backupFilled = 0

  for (const row of rows) {
    if (row.pobId || !row.awb) continue
    // The backup is indexed by AWB only, so an RT-numbered row skips straight
    // to the live sweep, where the index answers either spelling.

    const match = fromBackup.get(row.awb.toUpperCase())

    if (!match?.pobId) continue

    row.pobId = match.pobId
    row.note = 'POB from this machine’s backup'
    if (!row.sku) row.sku = match.sellerSku
    backupFilled += 1
  }

  const outstanding = (): SheetRow[] => rows.filter(row => identified(row) && row.pobId === '')

  let liveFilled = 0

  if (outstanding().length > 0) {
    const accounts = (await credentialsFor('ajio'))
      .map(credential => credential.username.trim())
      .filter(username => username.length > 0)

    await withAutomationLock('ajio-pob-fill', async () => {
      for (const username of accounts) {
        const pending = outstanding()

        // Every row answered — no reason to sign in to the rest.
        if (pending.length === 0) break

        try {
          liveFilled += await fillFromAccount(username, pending, typeof days === 'number' ? days : undefined)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)

          logger.warn(`[pob-fill] ${username} could not be swept — ${message}`)
        }
      }

      return ok(true)
    })
  }

  for (const row of outstanding()) {
    row.note = row.note || 'Not found on any AJIO account in the window searched'
  }

  const filled = rows.filter(row => row.pobId !== '').length

  /*
   * THE OPERATOR CHOOSES WHERE IT GOES.
   *
   * Writing beside the original was fine for a first cut and wrong in
   * practice: the sheet usually arrives in Downloads, and a filled copy left
   * there under a name nobody picked is one more file to hunt for before the
   * upload. The dialog opens on the filled name so Enter is still the fast
   * path.
   *
   * CANCEL IS NOT A FAILURE. The lookup has already run — and on a sheet that
   * needed AJIO that was minutes of browser time — so cancelling the save is
   * reported as a cancel, not as a run that failed.
   */
  const suggested = filledPathFor(filePath)
  const chosen = await dialog.showSaveDialog({
    title: 'Save the filled sheet',
    defaultPath: suggested,
    filters: [{ name: 'Spreadsheets', extensions: ['xlsx'] }]
  })

  const outputPath = chosen.canceled ? '' : (chosen.filePath ?? '')

  if (!outputPath) {
    logger.info(`[pob-fill] ${basename(filePath)}: ${filled} row(s) filled, save cancelled`)

    return fail('VALIDATION_ERROR', 'Save cancelled')
  }

  try {
    excel().writeFilledSheet(outputPath, rows)
  } catch (error) {
    return fail('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
  }

  logger.info(
    `[pob-fill] ${basename(filePath)}: ${filled} of ${rows.length} row(s) have a POB ` +
      `(${backupFilled} from the backup, ${liveFilled} from AJIO)`
  )

  return ok({
    total: rows.length,
    filled,
    fromBackup: backupFilled,
    fromAjio: liveFilled,
    missing: rows.length - filled,
    outputPath
  })
}
