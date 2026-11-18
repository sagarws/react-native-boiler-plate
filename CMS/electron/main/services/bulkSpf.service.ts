import { app, dialog, shell } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type {
  BulkClaimType,
  BulkSpfBucketCounts,
  BulkSpfPlan,
  BulkSpfPlanRow,
  BulkSpfResultRow,
  BulkSpfRun,
  BulkSpfSummary,
  BulkSpfUpload
} from '@shared/types/bulkSpf'
import { attemptOf } from '@shared/types/bulkSpf'
import { BULK_SPF_EVENTS } from '@shared/constants/channels'
import { fail, ok, type Result } from '@shared/types/result'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { getSession } from './session.store'
import { readCompany } from './company.store'
import { storedSession } from './sessionReuse.service'
import { credentialsFor, type CredentialRecord } from './company.service'
import { withAutomationLock } from './automationLock'
import { broadcast } from '../ipc/broadcast'
import { readRun, writeRun } from './bulkSpf.store'
import { createBulkJob, reopenBulkJob, reportBulkJob } from './bulkSpfJob.service'
import { reportClaimActivity } from './claimActivity.service'
import { archiveFromRun, writeJobArchive } from './bulkSpfArchive.store'
import { logger } from './logger'
import { automationsHalted } from './schedulerPause.store'
import { logSignInRefused, SIGN_IN_REFUSED, signInAllowed } from './signInPolicy'
import { rememberSessionRejected } from './sessionRejection.store'
import { isRetryableRow, isRetryScope, type BulkRetryScope } from '@shared/utils/bulkRetry'

/**
 * The AJIO NDR/DDR bulk claim, run from this machine — straight from the sheet.
 *
 * NO MASTER DATA. The sheet is AJIO's own return report (or the template shaped
 * like it) and carries everything a claim needs: the Return AWB, the article's
 * SKU and the POB the return lives under. The upload slot a file arrives in is
 * the claim type, and the claim type picks the email template, the AJIO
 * sub-issue and the evidence image (core `bulkSpfTemplates`).
 *
 * What the master-data lookup used to add, and where it comes from now:
 *   - which AJIO login files it   the POB. Each AJIO credential carries the POBs
 *                                 Monitor's "Sync POBs" found under it, so a row
 *                                 goes to the account that holds its POB.
 *   - not filing twice            AJIO. `raiseClaim` reads the return's existing
 *                                 tickets per article before raising one; a sheet
 *                                 row that already names a ticket is skipped.
 *   - status / claim-type checks  dropped — the operator's slot is the choice.
 *
 * Tickets are recorded in the results report and the Mattermost post. With no
 * master-data record behind a row there is nothing in TrackVid to write one to.
 *
 * WHAT IS NOT BULLMQ AND WHY NOT. BullMQ needs Redis, and there is no Redis on
 * an operator's laptop. The durability it gave — a job that survives a crash,
 * one worker at a time — comes from `bulkSpf.store` (atomic JSON writes) and
 * `withAutomationLock` instead.
 *
 * The automation server's own bulk claim still resolves through master data;
 * it uses `bucketRows`, and nothing here changes it.
 */

interface BulkRow {
  id: string
  awb: string
  ron: string
  sku: string
  claimType: string
  pobid: string
  ticketNumber: string
}

/** A sheet row the core read but did not return — a repeat of an earlier row, or one with no return number. */
interface DroppedRow {
  rowNumber: number
  ron: string
  awb: string
  sku: string
  claimType: string | null
  pobid: string
  ticketNumber: string
  kind: 'duplicate' | 'noId'
  /** Names the sheet row, and for a repeat the row it repeats. */
  reason: string
}

interface BulkSpfExcel {
  readRows: (
    path: string,
    options?: { claimType?: string; eanAsSku?: boolean }
  ) => {
    rows: BulkRow[]
    ids: string[]
    idHeader: string | null
    pobHeader: string | null
    byRon: boolean
    /** Optional: a core pinned before it existed drops those rows unreported. */
    dropped?: DroppedRow[]
  }
  writeResults: (options: { outputPath: string; rows: unknown[]; sourcePath?: string | null }) => string
  writeTemplate: (outputPath: string, options?: { columns?: string[] }) => string
  writeTicketReport: (
    outputPath: string,
    rows: {
      success: { awb: string; sku: string; ticketId: string }[]
      failed: { awb: string; sku: string; reason: string }[]
    }
  ) => string
  SHEET_ONLY_TEMPLATE_COLUMNS: string[]
}

/** A sheet row the core could not turn into a claim, and why. */
interface SheetRow {
  awb: string
  ron: string
  sku: string
  claimType: string
  pobid: string
  ticketNumber: string
}

/** The config shape `raiseClaim` takes — built by the core from a sheet row. */
export interface SheetClaimEntry {
  awbNumber: string
  return_order_no: string
  sku: string
  pobid: string
  claimType: string
  masterImportId: string
  [key: string]: unknown
}

interface BulkSpfBuckets {
  sheetClaimEntries: (rows: BulkRow[]) => {
    entries: SheetClaimEntry[]
    buckets: { alreadyClaimed: SheetRow[]; missingPob: SheetRow[]; unknownType: SheetRow[] }
  }
}

interface BulkGroup {
  credentials: { username: string; password: string; accountType?: string }
  companyId: string
  accountEmail: string
  configArr: SheetClaimEntry[]
}

interface BulkSpfRunner {
  authenticatePage: (
    page: unknown,
    options: { credentials: unknown; sessionRecord?: unknown; logger?: unknown }
  ) => Promise<{ sellerId: string; reused: boolean }>
  reauthenticatePage: (
    page: unknown,
    options: { credentials: unknown; logger?: unknown }
  ) => Promise<{ sellerId: string; reused: boolean }>
  runAccountGroup: (
    page: unknown,
    group: BulkGroup,
    options: {
      sellerId: string
      delayMs?: number
      onResult?: (row: BulkSpfResultRow) => Promise<void> | void
      logger?: unknown
      reauthenticate?: () => Promise<{ sellerId: string }>
    }
  ) => Promise<BulkSpfResultRow[]>
  failGroup: (group: BulkGroup, reason: string) => BulkSpfResultRow[]
  summarise: (rows: BulkSpfResultRow[]) => BulkSpfSummary
}

interface BrowserRuntime {
  loadPuppeteer: () => {
    launch: (options: Record<string, unknown>) => Promise<{
      newPage: () => Promise<unknown>
      close: () => Promise<void>
    }>
  } | null
  resolveExecutablePath: (fallback?: string) => string | undefined
}

/** Between claims. The server paces at five seconds; nothing here is in more of a hurry. */
const CLAIM_DELAY_MS = 5000

/** Well inside TrackVid's two-minute stale-job timeout. */
const JOB_HEARTBEAT_MS = 30_000

/** Narrows the renderer's payload, so the upload it produces is typed rather than asserted. */
const isClaimType = (value: string): value is BulkClaimType => value === 'NDR' || value === 'DDR'

/** A string, or nothing. The company document is `Record<string, unknown>`. */
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const emptyBuckets = (): BulkSpfBucketCounts => ({
  claimable: 0,
  alreadyClaimed: 0,
  missingPob: 0,
  unknownType: 0,
  noAccount: 0,
  notSelected: 0,
  duplicate: 0,
  noReturnNumber: 0
})

const emptySummary = (): BulkSpfSummary => ({
  total: 0,
  success: 0,
  failed: 0,
  helpCenterFailed: 0,
  notClaimable: 0,
  dryRun: 0,
  skipped: 0,
  pending: 0
})

/*
 * `eanAsSku` on every read: an operator's own sheet often lists one row per
 * article under a bare "EAN" column. Unread, that column left the rows keyed by
 * return number alone — a five-article return collapsed to one row, which AJIO
 * then refused as ambiguous, and the other four never reached the report.
 */
const excel = (): BulkSpfExcel =>
  loadCore<BulkSpfExcel>('platforms/ajio/claim-management/api-based-flow/bulkSpfExcel')

const buckets = (): BulkSpfBuckets =>
  loadCore<BulkSpfBuckets>('platforms/ajio/claim-management/api-based-flow/bulkSpfBuckets')

const runner = (): BulkSpfRunner =>
  loadCore<BulkSpfRunner>('platforms/ajio/claim-management/api-based-flow/bulkSpfRunner')

/** Where a run's report lives. Under userData so it survives an app update. */
const reportDirectory = (): string => join(app.getPath('userData'), 'bulk-spf')

let running = false

const publish = async (run: BulkSpfRun): Promise<void> => {
  await writeRun(run)
  broadcast(BULK_SPF_EVENTS.progress, run)
}

/**
 * Opens a native file dialog and reads how many rows the chosen sheet holds.
 *
 * The dialog lives in the main process because `File.path` is gone from modern
 * Electron renderers — a renderer can read a file's bytes but not learn where
 * it is, and the core reads the workbook from a path.
 */
export const chooseBulkFile = async (payload: unknown): Promise<Result<BulkSpfUpload>> => {
  const claimType = text((payload as { claimType?: unknown })?.claimType).toUpperCase()

  if (!isClaimType(claimType)) {
    return fail('VALIDATION_ERROR', 'Choose NDR or DDR')
  }

  const chosen = await dialog.showOpenDialog({
    title: `Choose the ${claimType} spreadsheet`,
    properties: ['openFile'],
    filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xls'] }]
  })

  const filePath = chosen.filePaths[0]

  if (chosen.canceled || !filePath) return fail('VALIDATION_ERROR', 'No file chosen')

  try {
    const { rows, pobHeader } = excel().readRows(filePath, { claimType, eanAsSku: true })

    // Checked at upload, not at submit: with no master data behind the sheet,
    // the POB is the only way to know which AJIO login owns a return.
    if (!pobHeader) {
      return fail(
        'VALIDATION_ERROR',
        'That sheet has no "POB ID" column. Claims are filed straight from the sheet, so each row needs its POB — press "Fill POB ID" to look them up from the return AWBs, or download the template to see the columns.'
      )
    }

    if (rows.length === 0) {
      return fail(
        'VALIDATION_ERROR',
        'That sheet has no return numbers in it. Download the template to see the columns it needs.'
      )
    }

    return ok({
      claimType,
      filePath,
      fileName: filePath.split(/[\\/]/).pop() ?? filePath,
      rowCount: rows.length
    })
  } catch (error) {
    // A missing column is the usual cause, and the core's message names the
    // headers it did find — which is what tells an operator what to fix.
    return fail('VALIDATION_ERROR', error instanceof Error ? error.message : String(error))
  }
}

/** Writes the blank template wherever the operator asks for it. */
export const downloadBulkTemplate = async (): Promise<Result<{ path: string }>> => {
  const chosen = await dialog.showSaveDialog({
    title: 'Save the bulk claim template',
    defaultPath: join(app.getPath('downloads'), 'ajio-bulk-claim-template.xlsx'),
    filters: [{ name: 'Spreadsheets', extensions: ['xlsx'] }]
  })

  if (chosen.canceled || !chosen.filePath) return fail('VALIDATION_ERROR', 'Cancelled')

  try {
    const sheet = excel()

    sheet.writeTemplate(chosen.filePath, { columns: sheet.SHEET_ONLY_TEMPLATE_COLUMNS })

    return ok({ path: chosen.filePath })
  } catch (error) {
    return fail('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
  }
}

/** The current (or last) run, for a modal that mounted after it began. */
export const bulkRunStatus = async (): Promise<Result<BulkSpfRun | null>> => ok(await readRun())

export const openBulkReport = async (): Promise<Result<null>> => {
  const run = await readRun()

  if (!run?.reportPath) return fail('VALIDATION_ERROR', 'There is no report yet')

  shell.showItemInFolder(run.reportPath)

  return ok(null)
}

/** Posts the report to Mattermost, if this company has one configured. */
const announce = async (run: BulkSpfRun, accounts: string[]): Promise<void> => {
  const stored = await readCompany()
  const settings = (stored?.company?.settings ?? {}) as {
    mattermost?: { url?: string; botToken?: string; channelId?: string }
  }
  const config = settings.mattermost

  if (!config?.url || !config.botToken || !config.channelId) {
    logger.info('[bulk-spf] no Mattermost settings on this company — skipping the post')

    return
  }

  const { postMattermostFile } = loadCore<{
    postMattermostFile: (options: Record<string, unknown>) => Promise<{ ok: boolean }>
  }>('common/mattermostNotifier')

  const s = run.summary
  const failedRows = run.rows.filter(
    row => row.result === 'Failed' || row.result === 'Help Center Failed'
  )

  const companyName = text(stored?.company?.name) || 'this company'

  let message = `#### 🧾 AJIO Bulk SPF Claim — ${companyName}\n`

  message += `Filed from the desktop app by ${getSession()?.user?.email ?? 'an operator'}.\n`
  message += `**Accounts:** ${accounts.join(', ') || '—'}\n`
  message += `**Attempted:** ${run.claimable}  |  **Rows:** ${run.rows.length}\n`

  // After a retry this post is the combined result of every attempt, not just
  // the last one — say so, or the counts read as the retry's alone.
  if ((run.attempts ?? 1) > 1) {
    message += `**Attempts:** ${run.attempts} (combined result — last retry re-filed ${run.retrying ?? 0})\n`
  }
  message += `✅ Success: **${s.success}**  |  ❌ Failed: **${s.failed}**  |  🚫 Not Claimable: **${s.notClaimable}**  |  ⏭️ Skipped: **${s.skipped}**\n`

  if (failedRows.length) {
    message += `\n**Failed:**\n`
    message += failedRows
      .slice(0, 20)
      .map(row => `- ${row.awb}${row.sku ? ` / ${row.sku}` : ''} — ${row.result}${row.error ? `: ${row.error.slice(0, 80)}` : ''}`)
      .join('\n')

    if (failedRows.length > 20) message += `\n… and ${failedRows.length - 20} more (see attached).`
  }

  message += `\n\n📎 Full report attached.`

  await postMattermostFile({
    baseUrl: config.url,
    token: config.botToken,
    channelId: config.channelId,
    message,
    filePath: run.reportPath,
    logger
  })
}

/**
 * Reads the uploads, resolves them, and files everything claimable.
 *
 * Returns as soon as the preview is ready — the claims themselves run detached
 * and report through `BULK_SPF_EVENTS.progress`, because a run of any size
 * outlasts any sensible IPC timeout.
 */
const skippedRow = (row: SheetRow, reason: string, final = false): BulkSpfResultRow => ({
  awb: row.awb || row.ron,
  sku: row.sku,
  claimType: row.claimType,
  pobid: row.pobid,
  orderStatus: '',
  result: 'Skipped',
  reason,
  ticketNumber: row.ticketNumber,
  error: '',
  timestamp: new Date().toISOString(),
  ...(final ? { final: true } : {})
})

const droppedSheetRow = (row: DroppedRow): SheetRow => ({
  awb: row.awb,
  ron: row.ron,
  sku: row.sku,
  claimType: row.claimType ?? '',
  pobid: row.pobid,
  ticketNumber: row.ticketNumber
})

/**
 * The placeholder a finished claim replaces. `awb` must be exactly what the
 * core's `resultRow` writes (`entry.awbNumber`), or `recordRows` never matches
 * the two and the row sits on Pending for ever.
 */
/*
 * NEVER PASS THIS TO `.map` BY NAME. `Array.map` calls its callback with
 * `(element, index)`, and the index lands in `attempt` — which is how a first
 * Submit reported rows as "Attempt 16 … 57" with no retry ever pressed: each
 * row's position in its account group, written as its attempt count. Always
 * `entry => pendingRow(entry)`.
 */
const pendingRow = (entry: SheetClaimEntry, attempt = 1): BulkSpfResultRow => ({
  attempt,
  awb: entry.awbNumber,
  sku: entry.sku,
  claimType: entry.claimType,
  pobid: entry.pobid,
  orderStatus: '',
  result: 'Pending',
  reason: '',
  ticketNumber: '',
  error: '',
  timestamp: new Date().toISOString()
})

const asSheetRow = (entry: SheetClaimEntry): SheetRow => ({
  awb: entry.awbNumber,
  ron: entry.return_order_no,
  sku: entry.sku,
  claimType: entry.claimType,
  pobid: entry.pobid,
  ticketNumber: ''
})

/**
 * One article's identity across the review and the submit: claim type, AWB,
 * SKU. The claim type is part of it because the same article can arrive in
 * both the NDR and the DDR sheet, and those are two claims.
 */
export const planKey = (claimType: string, awb: string, sku: string): string => `${claimType}::${awb}::${sku}`

const entryKey = (entry: SheetClaimEntry): string => planKey(entry.claimType, entry.awbNumber, entry.sku)

const rowKey = (row: BulkSpfResultRow): string => planKey(row.claimType, row.awb, row.sku)

/**
 * The key of the entry's return with no article named — what a run that did
 * not recognise the sheet's article column filed the whole return under.
 */
const returnKey = (entry: SheetClaimEntry): string => planKey(entry.claimType, entry.awbNumber, '')

/** POB ids compare trimmed and case-insensitively — sheets and AJIO disagree on case. */
const pobKey = (pob: string): string => pob.trim().toUpperCase()

/**
 * Sends every entry to the AJIO login whose synced POB list holds its POB.
 *
 * Pure, and exported for tests. One account per POB: if two logins list the
 * same POB, the first credential wins — filing from either is valid, and one
 * account per return keeps the run to one sign-in per account.
 *
 * An entry whose POB no credential lists cannot be filed from this machine; it
 * comes back in `unassigned` rather than being guessed onto an account, because
 * AJIO searches a return under its POB and the wrong login finds nothing.
 */
export const assignAccounts = (
  entries: SheetClaimEntry[],
  credentials: Pick<CredentialRecord, 'username' | 'password' | 'accountType' | 'pobIds'>[],
  companyId: string
): { groups: BulkGroup[]; unassigned: SheetClaimEntry[] } => {
  const owner = new Map<string, (typeof credentials)[number]>()

  for (const credential of credentials) {
    for (const pob of credential.pobIds) {
      const key = pobKey(pob.id)

      if (key && !owner.has(key)) owner.set(key, credential)
    }
  }

  const groups = new Map<string, BulkGroup>()
  const unassigned: SheetClaimEntry[] = []

  for (const entry of entries) {
    const credential = owner.get(pobKey(entry.pobid))

    if (!credential) {
      unassigned.push(entry)
      continue
    }

    const email = credential.username.trim().toLowerCase()
    const group =
      groups.get(email) ??
      {
        credentials: {
          username: credential.username,
          password: credential.password,
          ...(credential.accountType ? { accountType: credential.accountType } : {})
        },
        companyId,
        accountEmail: email,
        configArr: []
      }

    group.configArr.push(entry)
    groups.set(email, group)
  }

  return { groups: [...groups.values()], unassigned }
}

/**
 * Keeps only the claimable entries whose key the operator ticked in the review.
 *
 * Applied to the account groups — what `fileClaims` actually files — so the
 * numbers on screen and the claims raised cannot disagree. Pure, exported for
 * tests.
 */
export const keepSelected = (
  groups: BulkGroup[],
  selectedKeys: readonly string[]
): { groups: BulkGroup[]; notSelected: SheetClaimEntry[] } => {
  const keep = new Set(selectedKeys)

  return keepWhere(groups, entry => keep.has(entryKey(entry)))
}

const keepWhere = (
  groups: BulkGroup[],
  wanted: (entry: SheetClaimEntry) => boolean
): { groups: BulkGroup[]; notSelected: SheetClaimEntry[] } => {
  const notSelected: SheetClaimEntry[] = []

  const kept = groups
    .map(group => ({
      ...group,
      configArr: group.configArr.filter(entry => {
        if (wanted(entry)) return true
        notSelected.push(entry)

        return false
      })
    }))
    .filter(group => group.configArr.length > 0)

  return { groups: kept, notSelected }
}

/**
 * The entries of a re-read sheet that a retry files. Pure, exported for tests.
 *
 * An entry whose own row is in the run is retried when that row is retryable
 * (`isRetryableRow`). An entry with no row of its own is retried when its
 * return's article-less row is: a run that did not recognise the sheet's
 * article column filed a multi-article return as ONE row, which AJIO refused as
 * ambiguous, and its other articles were never in the run at all. Retrying that
 * row files every article the sheet names, each as its own row.
 */
export const retrySelection = (
  groups: BulkGroup[],
  rows: readonly BulkSpfResultRow[],
  scope: BulkRetryScope = 'both'
): BulkGroup[] => {
  const live = rows.filter(row => !row.final)
  const own = new Map(live.map(row => [rowKey(row), row]))
  const returns = new Set(live.filter(row => !row.sku && isRetryableRow(row, scope)).map(rowKey))

  return keepWhere(groups, entry => {
    const row = own.get(entryKey(entry))

    return row ? isRetryableRow(row, scope) : returns.has(returnKey(entry))
  }).groups
}

/** Both counts of the dropped sheet rows, for the bucket line. */
const droppedCounts = (dropped: readonly DroppedRow[]): Pick<BulkSpfBucketCounts, 'duplicate' | 'noReturnNumber'> => ({
  duplicate: dropped.filter(row => row.kind === 'duplicate').length,
  noReturnNumber: dropped.filter(row => row.kind === 'noId').length
})

interface Plan {
  uploads: BulkSpfUpload[]
  groups: BulkGroup[]
  unassigned: SheetClaimEntry[]
  sheetBuckets: ReturnType<BulkSpfBuckets['sheetClaimEntries']>['buckets']
  /** Sheet rows read but not returned — reported, never lost. */
  dropped: DroppedRow[]
}

const NO_ACCOUNT_REASON = (pobid: string): string =>
  `No AJIO login on this machine holds POB ${pobid} — run "Sync POBs" in Monitor, then retry`

/**
 * Steps 1–3 of a run — read the sheets, build the claims, match each POB to a
 * login — with nothing filed. Shared by the Selected Proceed review and Submit,
 * so the rows an operator ticks are sorted by exactly the code that files them.
 */
const buildPlan = async (payload: unknown): Promise<Result<Plan>> => {
  const uploads = ((payload as { uploads?: unknown })?.uploads ?? []) as BulkSpfUpload[]

  if (!Array.isArray(uploads) || uploads.length === 0) {
    return fail('VALIDATION_ERROR', 'Upload at least one file')
  }

  const company = await readCompany()
  const companyId = text(company?.company?._id)

  if (!companyId) return fail('VALIDATION_ERROR', 'Sync this company before running a bulk claim')

  // 1. Read every sheet, stamping each row with the slot it came from.
  const rows: BulkRow[] = []
  const dropped: DroppedRow[] = []

  for (const upload of uploads) {
    const read = excel().readRows(upload.filePath, { claimType: upload.claimType, eanAsSku: true })

    rows.push(...read.rows)
    dropped.push(...(read.dropped ?? []))
  }

  if (rows.length === 0) return fail('VALIDATION_ERROR', 'Those files hold no return numbers')

  // 2. Rows → claim entries. The claim type (slot) picks the template.
  const { entries, buckets: sheetBuckets } = buckets().sheetClaimEntries(rows)

  // 3. Entries → the AJIO login that holds each POB.
  const credentials = (await credentialsFor('ajio')).filter(c => c.username)
  const { groups, unassigned } = assignAccounts(entries, credentials, companyId)

  return ok({ uploads, groups, unassigned, sheetBuckets, dropped })
}

/**
 * Selected Proceed: every row of the uploads, sorted, for the operator to tick.
 * Read-only — nothing is filed and no job is created.
 */
export const planBulkRun = async (payload: unknown): Promise<Result<BulkSpfPlan>> => {
  const built = await buildPlan(payload)

  if (!built.success) return built

  const { groups, unassigned, sheetBuckets, dropped } = built.data

  const planRow = (row: SheetRow, account: string, reason: string): BulkSpfPlanRow => ({
    key: planKey(row.claimType, row.awb || row.ron, row.sku),
    awb: row.awb || row.ron,
    sku: row.sku,
    claimType: row.claimType,
    pobid: row.pobid,
    account,
    claimable: reason === '',
    reason
  })

  const rows: BulkSpfPlanRow[] = [
    ...groups.flatMap(group => group.configArr.map(entry => planRow(asSheetRow(entry), group.accountEmail, ''))),
    ...unassigned.map(entry => planRow(asSheetRow(entry), '', NO_ACCOUNT_REASON(entry.pobid))),
    ...sheetBuckets.alreadyClaimed.map(row => planRow(row, '', `Already claimed (ticket ${row.ticketNumber} in the sheet)`)),
    ...sheetBuckets.missingPob.map(row => planRow(row, '', 'No POB ID in the sheet')),
    ...sheetBuckets.unknownType.map(row => planRow(row, '', `Unknown claim type "${row.claimType}"`)),
    // A repeat shares its original's key, so its sheet row number keeps it its own.
    ...dropped.map(row => {
      const plan = planRow(droppedSheetRow(row), '', row.reason)

      return { ...plan, key: `${plan.key}#row${row.rowNumber}` }
    })
  ]

  return ok({
    rows,
    buckets: {
      ...emptyBuckets(),
      claimable: groups.reduce((sum, group) => sum + group.configArr.length, 0),
      alreadyClaimed: sheetBuckets.alreadyClaimed.length,
      missingPob: sheetBuckets.missingPob.length,
      unknownType: sheetBuckets.unknownType.length,
      noAccount: unassigned.length,
      ...droppedCounts(dropped)
    }
  })
}

/**
 * Reads the uploads and files every claimable row — or, from the Selected
 * Proceed review, only the keys the operator ticked.
 *
 * Returns as soon as the rows are sorted and the job is created. The claims run
 * detached in the background and report through `BULK_SPF_EVENTS.progress`,
 * because a run of any size outlasts any sensible IPC timeout.
 */
export const startBulkRun = async (payload: unknown): Promise<Result<BulkSpfRun>> => {
  if (running) return fail('VALIDATION_ERROR', 'A bulk claim is already running')
  if (await automationsHalted()) {
    return fail('CONFLICT', 'Automations are switched off — switch them on to start a bulk claim.')
  }

  // Present only when the run comes from the Selected Proceed review. Absent,
  // every claimable row is filed.
  const rawKeys = (payload as { selectedKeys?: unknown })?.selectedKeys
  let selectedKeys: string[] | null = null

  if (rawKeys !== undefined) {
    if (!Array.isArray(rawKeys) || rawKeys.some(key => typeof key !== 'string')) {
      return fail('VALIDATION_ERROR', 'The selection is not a list of claims')
    }
    if (rawKeys.length === 0) return fail('VALIDATION_ERROR', 'Select at least one claim to file')

    selectedKeys = rawKeys as string[]
  }

  const built = await buildPlan(payload)

  if (!built.success) return built

  const { uploads, unassigned, sheetBuckets, dropped } = built.data
  // The sheets are read again here rather than trusting the review's copy, so a
  // key that no longer sorts as claimable is simply not filed.
  const selection = selectedKeys
    ? keepSelected(built.data.groups, selectedKeys)
    : { groups: built.data.groups, notSelected: [] }
  const { groups, notSelected } = selection
  const claimable = groups.reduce((sum, group) => sum + group.configArr.length, 0)

  const counts: BulkSpfBucketCounts = {
    ...emptyBuckets(),
    claimable,
    alreadyClaimed: sheetBuckets.alreadyClaimed.length,
    missingPob: sheetBuckets.missingPob.length,
    unknownType: sheetBuckets.unknownType.length,
    noAccount: unassigned.length,
    notSelected: notSelected.length,
    ...droppedCounts(dropped)
  }

  // EVERY sheet row ends up in the report: filed, or skipped with the reason.
  // `final` marks the skips no retry can change — see BulkSpfResultRow.final.
  const skipped: BulkSpfResultRow[] = [
    ...sheetBuckets.alreadyClaimed.map(row => skippedRow(row, `Already claimed (ticket ${row.ticketNumber} in the sheet)`, true)),
    ...sheetBuckets.missingPob.map(row => skippedRow(row, 'No POB ID in the sheet')),
    ...sheetBuckets.unknownType.map(row => skippedRow(row, `Unknown claim type "${row.claimType}"`)),
    ...unassigned.map(entry => skippedRow(asSheetRow(entry), NO_ACCOUNT_REASON(entry.pobid))),
    ...notSelected.map(entry => skippedRow(asSheetRow(entry), 'Not selected in the review', true)),
    ...dropped.map(row => skippedRow(droppedSheetRow(row), row.reason, true))
  ]

  const { mkdirSync } = await import('fs')

  mkdirSync(reportDirectory(), { recursive: true })

  const id = randomUUID()
  let run: BulkSpfRun = {
    id,
    jobRecorded: false,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    uploads,
    buckets: counts,
    claimable,
    done: 0,
    summary: emptySummary(),
    rows: [...skipped, ...firstPassRows(groups)],
    reportPath: join(reportDirectory(), `ajio-bulk-claim-${id}.xlsx`),
    accounts: groups.map(group => group.accountEmail),
    error: null,
    attempts: 1
  }

  run = { ...run, summary: runner().summarise(run.rows) }

  // 4. The job and the report exist BEFORE anything is filed. A crash after the
  //    first claim then still leaves a history entry and a file saying what
  //    happened.
  run = { ...run, jobRecorded: await createBulkJob(run) }
  await publish(run)
  flushReport(run)

  if (claimable === 0) {
    const finished: BulkSpfRun = { ...run, status: 'done', finishedAt: new Date().toISOString() }

    await publish(finished)
    await reportBulkJob(finished, true)
    await writeJobArchive(archiveFromRun(finished))

    return ok(finished)
  }

  // Detached: the claims outlast any IPC call. The modal and the corner panel
  // follow the events.
  void fileClaims(run, groups)

  return ok(run)
}

/**
 * The placeholder rows a first Submit starts with — every one on attempt 1.
 * Pure, exported for tests.
 */
export const firstPassRows = (groups: readonly { configArr: readonly SheetClaimEntry[] }[]): BulkSpfResultRow[] =>
  groups.flatMap(group => group.configArr.map(entry => pendingRow(entry)))

/**
 * The review/submit key of every row a retry of `scope` would re-file
 * (`isRetryableRow`). Pure, exported for tests.
 */
export const retryableKeys = (rows: readonly BulkSpfResultRow[], scope: BulkRetryScope = 'both'): string[] =>
  rows.filter(row => isRetryableRow(row, scope)).map(rowKey)

/**
 * The run as a retry starts it: the rows being re-filed go back to Pending, and
 * every other row — the successes above all — is left exactly as it was. That is
 * what keeps the result combined: the retry overwrites only its own rows.
 *
 * A retried article with no row of its own replaces its return's article-less
 * row (see `retrySelection`) — one row per article, in that row's place.
 * Pure, exported for tests.
 */
export const resetForRetry = (run: BulkSpfRun, retried: readonly SheetClaimEntry[], accounts: string[]): BulkSpfRun => {
  const byKey = new Map(retried.map(entry => [entryKey(entry), entry]))
  const present = new Set(run.rows.filter(row => !row.final).map(rowKey))
  const split = new Map<string, SheetClaimEntry[]>()

  for (const entry of retried) {
    if (present.has(entryKey(entry))) continue
    split.set(returnKey(entry), [...(split.get(returnKey(entry)) ?? []), entry])
  }

  const rows = run.rows.flatMap((row): BulkSpfResultRow[] => {
    if (row.final) return [row]

    const entry = byKey.get(rowKey(row))

    // Re-filed: one more attempt than the row had — the history counts every try.
    if (entry) return [{ ...pendingRow(entry, attemptOf(row) + 1), pobid: row.pobid || entry.pobid || '' }]

    const articles = row.sku ? undefined : split.get(rowKey(row))

    if (!articles) return [row]
    split.delete(rowKey(row))

    return articles.map(article => pendingRow(article, attemptOf(row) + 1))
  })

  // A result with no row to land on would vanish, so anything left gets one.
  rows.push(...[...split.values()].flat().map(entry => pendingRow(entry)))

  return {
    ...run,
    status: 'running',
    finishedAt: null,
    error: null,
    rows,
    done: rows.filter(row => row.result !== 'Pending' && row.result !== 'Skipped').length,
    // Rows filed or being filed — progress is measured against it, and a
    // split return makes it larger than the first pass's.
    claimable: rows.filter(row => row.result !== 'Skipped').length,
    accounts: [...new Set([...run.accounts, ...accounts])],
    attempts: (run.attempts ?? 1) + 1,
    retrying: retried.length
  }
}

const SCOPE_WORDS: Record<BulkRetryScope, string> = {
  failed: 'failed',
  skipped: 'skipped',
  both: 'failed or skipped'
}

/**
 * Retry: files the last run's failed and/or skipped rows again — the operator
 * picks which in the Retry popup — INTO THAT RUN.
 *
 * Same job id, same report file, same TrackVid job, same archive entry — so the
 * operator reads one result for the whole job, however many attempts it took,
 * never a separate report per try. A row filed on the second attempt simply
 * turns from Failed or Skipped to Success; one still unfileable keeps its row
 * and its reason.
 *
 * The rows are rebuilt from the run's original uploads by the same code that
 * filed them the first time (`buildPlan`), so a retry signs in and raises a
 * claim exactly as Submit does. Not double-filing is still the core's:
 * `raiseClaim` reads a return's existing tickets before raising one.
 */
export const retryFailedBulkRun = async (payload?: unknown): Promise<Result<BulkSpfRun>> => {
  const rawScope = (payload as { scope?: unknown } | undefined)?.scope ?? 'both'

  if (!isRetryScope(rawScope)) return fail('VALIDATION_ERROR', 'Choose Failed, Skipped or Both to retry')

  const scope = rawScope
  const words = SCOPE_WORDS[scope]

  if (running) return fail('VALIDATION_ERROR', 'A bulk claim is already running')
  if (await automationsHalted()) {
    return fail('CONFLICT', 'Automations are switched off — switch them on to retry.')
  }

  const previous = await readRun()

  if (!previous) return fail('VALIDATION_ERROR', 'There is no bulk claim to retry')

  // FROM THE BACKGROUND PROCESS PAGE the operator names the job. A retry files
  // from the run this machine holds — the most recent one, whose sheet paths it
  // kept — so any other job is refused rather than retried as the wrong run.
  const askedFor = (payload as { jobId?: unknown } | undefined)?.jobId

  if (typeof askedFor === 'string' && askedFor && askedFor !== previous.id) {
    return fail(
      'VALIDATION_ERROR',
      'Only the most recent bulk claim can be retried — its uploaded sheets are the ones this machine still holds.'
    )
  }
  if (previous.status === 'running' || previous.status === 'preparing') {
    return fail('VALIDATION_ERROR', 'That bulk claim is still running')
  }

  if (retryableKeys(previous.rows, scope).length === 0) {
    return fail('VALIDATION_ERROR', `Nothing in that run is ${words} — there is nothing to retry`)
  }

  let built: Awaited<ReturnType<typeof buildPlan>>

  try {
    built = await buildPlan({ uploads: previous.uploads })
  } catch (error) {
    // The usual cause: the sheet was moved or deleted since the run.
    const reason = error instanceof Error ? error.message : String(error)

    return fail(
      'VALIDATION_ERROR',
      `Could not re-read the uploaded sheet — a retry files from the original file, so put it back where it was. (${reason})`
    )
  }

  if (!built.success) return built

  const groups = retrySelection(built.data.groups, previous.rows, scope)
  const retried = groups.flatMap(group => group.configArr)

  if (retried.length === 0) {
    return fail(
      'VALIDATION_ERROR',
      `None of the ${words} rows can be filed from this machine now — each still has its reason in the report (a POB on no AJIO login here, no POB in the sheet). Run "Sync POBs" in Monitor or fix the sheet, then retry.`
    )
  }

  const reset = resetForRetry(
    previous,
    retried,
    groups.map(group => group.accountEmail)
  )
  const run: BulkSpfRun = { ...reset, summary: runner().summarise(reset.rows) }

  logger.info(`[bulk-spf] job ${run.id}: attempt ${run.attempts} — re-filing ${retried.length} ${words} claim(s)`)

  await reopenBulkJob(run)
  await publish(run)
  flushReport(run)

  // Detached, like Submit: the claims outlast any IPC call.
  void fileClaims(run, groups)

  return ok(run)
}

const flushReport = (run: BulkSpfRun): void => {
  if (!run.reportPath) return

  try {
    excel().writeResults({ outputPath: run.reportPath, rows: run.rows })
  } catch (error) {
    logger.warn('[bulk-spf] could not write the report', error)
  }
}

/** Drives every account group. Never throws — the run's own status carries the outcome. */
const fileClaims = async (initial: BulkSpfRun, groups: BulkGroup[]): Promise<void> => {
  running = true

  let run = initial

  // Successes already on the run when this pass began — a "Retry failed" pass
  // keeps the first pass's rows. What this pass adds is the end minus this.
  const successBefore = initial.summary.success

  // TrackVid marks a job STALE after two minutes without word, and one AJIO
  // claim can take longer than that. So the heartbeat is on a clock, not on
  // results — and it carries the current counts, which is the job's progress.
  const heartbeat = setInterval(() => {
    void reportBulkJob(run)
  }, JOB_HEARTBEAT_MS)

  try {
    await prepareCoreWithBrowser(undefined, 'ajio')

    const runtime = loadCore<BrowserRuntime>('common/browserRuntime')
    const { isHeadless } = loadCore<{ isHeadless: (platform?: string) => boolean }>('common/headless')
    const flow = runner()
    const puppeteer = runtime.loadPuppeteer()

    if (!puppeteer) throw new Error('No browser available for the AJIO bulk claim')

    // One automation drives a browser at a time. A claim dispatched by the
    // socket during this run waits rather than opening a second Chrome against
    // the same AJIO session.
    let halted = false

    await withAutomationLock('bulk-spf', async () => {
      for (const group of groups) {
        /*
         * BETWEEN ACCOUNTS, the only boundary this run owns: one account's
         * claims are filed inside the shared core, which takes no stop signal.
         * Switched off, the account in hand finishes and the rest are left.
         */
        if (await automationsHalted()) {
          halted = true
          break
        }

        const browser = await puppeteer.launch({
          headless: isHeadless('ajio'),
          executablePath: runtime.resolveExecutablePath(),
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1440,900'
          ]
        })

        try {
          const page = await browser.newPage()

          /*
           * THE SAVED SESSION, AND NOTHING ELSE.
           *
           * This used to fall back to a password login whenever the saved
           * session did not pass its in-page check — and to sign in AGAIN every
           * time AJIO rejected the session mid-run. Both bypassed the rule every
           * other automation follows: only the session login (Login update,
           * Re-capture, Verify) signs in. So the password is withheld from the
           * core unless sign-in is explicitly allowed, and a session that cannot
           * be used fails the account's claims with a reason, stamped so the
           * Login update re-captures it.
           */
          const username = group.credentials.username
          const mayAuthenticate = signInAllowed('ajio')
          const credentials = mayAuthenticate ? group.credentials : { ...group.credentials, password: '' }
          let sellerId: string

          try {
            const record = await storedSession('ajio', username)

            if (!record && !mayAuthenticate) {
              throw new Error('no AJIO login is saved on this machine for this account')
            }

            const authenticated = await flow.authenticatePage(page, {
              credentials,
              sessionRecord: record,
              logger
            })

            sellerId = authenticated.sellerId
          } catch (error) {
            // Every claim for this account fails together, each with its own
            // row — the session is what they all depended on.
            const raw = error instanceof Error ? error.message : String(error)
            const reason = mayAuthenticate
              ? `Login failed: ${raw}`
              : `${SIGN_IN_REFUSED} — the saved AJIO login could not be used (${raw}). Re-capture it on the Login page`

            if (!mayAuthenticate) {
              logSignInRefused('ajio', username)
              await rememberSessionRejected('ajio', username, 'Bulk claim could not use the saved login').catch(
                () => undefined
              )
            }

            logger.error(`[bulk-spf] ${username}: ${reason}`)
            run = await recordRows(run, flow.failGroup(group, reason))

            continue
          }

          await flow.runAccountGroup(page, group, {
            sellerId,
            delayMs: CLAIM_DELAY_MS,
            logger,
            // A run of hundreds can outlive an AJIO session. Signing in again
            // here is the session login's job, not this run's — so without
            // permission there is no re-login: the core fails the account's
            // remaining claims as "session expired", and the account is stamped
            // below so the Login update re-captures it.
            ...(mayAuthenticate
              ? { reauthenticate: () => flow.reauthenticatePage(page, { credentials, logger }) }
              : {}),
            onResult: async row => {
              run = await recordRows(run, [row])

              // The first "session expired" row is the moment to flag it.
              const rowError = (row as { error?: unknown }).error

              if (!mayAuthenticate && typeof rowError === 'string' && /session expired/i.test(rowError)) {
                await rememberSessionRejected('ajio', username, 'AJIO rejected the saved login during a bulk claim').catch(
                  () => undefined
                )
              }
            }
          })
        } finally {
          // A browser left open holds a profile lock, and the next account
          // would launch alongside it rather than instead of it.
          await browser.close().catch(() => undefined)
        }
      }
    })

    run = halted
      ? {
          ...run,
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error: 'Stopped — Automations were switched off before every account was filed'
        }
      : { ...run, status: 'done', finishedAt: new Date().toISOString() }
  } catch (error) {
    run = {
      ...run,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    }
    logger.error('[bulk-spf] run stopped', error)
  } finally {
    clearInterval(heartbeat)
    running = false
    // A row the run never reached is not left Pending — a finished job has no
    // pending work. It is Skipped, saying why, and Retry → Skipped takes it.
    run = settlePending(run, run.error ? `Not filed — ${run.error}` : 'Not filed — the run ended before reaching it')
    run = { ...run, summary: runner().summarise(run.rows) }
    await publish(run)
    flushReport(run)
    // The job's final word: status, counts, and every AWB that was not filed —
    // to TrackVid; and its tickets, to this machine's archive.
    await reportBulkJob(run, true)
    await writeJobArchive(archiveFromRun(run))
    // The NDR/DDR column of the Accounts page: tickets AJIO accepted in THIS
    // pass only, so a retry never counts the first pass's tickets twice.
    await reportClaimActivity({ ndrDdrClaims: run.summary.success - successBefore })

    // Non-fatal on purpose: a report that could not be announced is still a
    // report, and the claims are already filed either way.
    try {
      await announce(run, run.accounts)
    } catch (error) {
      logger.warn('[bulk-spf] could not post the report to Mattermost', error)
    }
  }
}

/**
 * Every row still Pending, as Skipped with `reason`. Pure, exported for tests;
 * the summary is the caller's to recompute.
 */
export const settlePending = (run: BulkSpfRun, reason: string): BulkSpfRun => {
  if (!run.rows.some(row => row.result === 'Pending')) return run

  const timestamp = new Date().toISOString()

  return {
    ...run,
    rows: run.rows.map(row =>
      row.result === 'Pending' ? { ...row, result: 'Skipped' as const, reason, timestamp } : row
    )
  }
}

/**
 * Folds finished rows into the run, replacing their Pending placeholders.
 *
 * Written to disk and pushed to the modal after EVERY article rather than at
 * the end: the run is measured in hours, and an operator watching a progress
 * bar that only moves when it finishes is watching nothing.
 */
const recordRows = async (run: BulkSpfRun, incoming: BulkSpfResultRow[]): Promise<BulkSpfRun> => {
  // AWB + SKU + claim type: the same article can arrive in both the NDR and the
  // DDR sheet, and those are two rows with two outcomes.
  const key = (row: BulkSpfResultRow): string => `${row.awb}::${row.sku}::${row.claimType}`
  const replaced = new Map(incoming.map(row => [key(row), row]))
  // The core's result rows carry no POB; keep the placeholder's for the history.
  // Never a `final` row: a repeat of a sheet row shares its key, and must keep
  // saying it is a repeat rather than take the result filed under the original.
  const rows = run.rows.map(row => {
    const next = row.final ? undefined : replaced.get(key(row))

    // The core's result row carries no attempt: the placeholder's is the one
    // this filing was — kept, so the history says which try produced it.
    return next ? { ...next, pobid: next.pobid ?? row.pobid ?? '', attempt: attemptOf(row) } : row
  })
  const done = rows.filter(row => row.result !== 'Pending' && row.result !== 'Skipped').length

  const next: BulkSpfRun = {
    ...run,
    rows,
    done,
    summary: runner().summarise(rows)
  }

  await publish(next)
  flushReport(next)

  return next
}
