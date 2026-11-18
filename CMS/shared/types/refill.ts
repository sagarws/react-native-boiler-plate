/**
 * Refill Data — asking the marketplace for the blanks on a claim that exists.
 *
 * A row created from a scan or a feed carries an AWB and little else, and the
 * missing pieces are the ones that decide whether it can be filed: the account,
 * the identifier that account's claim form is keyed on, the forward leg's AWB,
 * and — once a ticket exists — where that ticket now stands. Every one of those
 * is knowable by asking, which is what a Refill run does.
 *
 * Which fields each platform can answer lives in the core
 * (`common/refillConfig.js`), mirrored for the renderer in
 * shared/constants/refill.ts and held together by a test.
 */

export type RefillField =
  | 'accountMapping'
  | 'forwardAwbNumber'
  | 'subOrderNumber'
  | 'sellerSku'
  | 'pobId'
  | 'statusChange'

/** What each field is called on screen, and what it is for. */
export interface RefillFieldLabel {
  field: RefillField
  label: string
  description: string
}

/** What one claim ended up with. */
export interface RefillRowResult {
  cmsId: string
  awbNumber: string
  /** Fields actually written, with the value written. */
  filled: Partial<Record<RefillField | 'compensationAmount', string>>
  /** Fields the marketplace answered for, where the row already had something else. */
  kept: { field: string; existing: string; fetched: string }[]
  outcome: 'filled' | 'nothing-to-do' | 'not-found' | 'failed'
  message: string
}

export interface RefillProgress {
  platform: string
  fields: RefillField[]
  total: number
  done: number
  filled: number
  untouched: number
  /**
   * Asked about, and nobody had it.
   *
   * ITS OWN COUNT, not part of `untouched`. "The row already holds what the
   * marketplace says" and "no account on this platform has ever heard of this
   * AWB" are opposite findings — the first needs nothing, the second needs
   * somebody to look at the row — and counting them together said the
   * reassuring one about both.
   */
  notFound: number
  failed: number
  /** The AWB being asked about now; null once the run is over. */
  current: string | null
  /** The last few rows, newest first. */
  recent: RefillRowResult[]
  running: boolean
}

export interface RefillSummary {
  platform: string
  fields: RefillField[]
  total: number
  filled: number
  untouched: number
  /**
   * Asked about, and nobody had it.
   *
   * ITS OWN COUNT, not part of `untouched`. "The row already holds what the
   * marketplace says" and "no account on this platform has ever heard of this
   * AWB" are opposite findings — the first needs nothing, the second needs
   * somebody to look at the row — and counting them together said the
   * reassuring one about both.
   */
  notFound: number
  failed: number
  /**
   * Left alone: the row has already had `MAX_REFILL_ATTEMPTS` refills.
   *
   * Its own count, not folded into `untouched`. "Nothing needed changing" and
   * "we stopped asking about this one" are opposite findings — the second is a
   * row waiting for a person — and reporting them together says the
   * reassuring one about both.
   */
  skipped: number
  rows: RefillRowResult[]
  /**
   * The run wrote the account without asking any marketplace, because the
   * company has exactly one login on this platform and the account was the
   * only thing asked for. Said plainly so nobody reads it as a lookup.
   */
  shortcut: boolean
}

/**
 * A finished Refill run, kept on this machine so the Jobs page can show what it
 * changed. The only record: the values land on the claims, and TrackVid never
 * hears about the run itself.
 */
export interface RefillJobArchive {
  jobId: string
  platform: string
  startedAt: string
  finishedAt: string
  status: 'done' | 'failed'
  fields: RefillField[]
  accounts: string[]
  total: number
  filled: number
  untouched: number
  notFound: number
  failed: number
  /** The account was written without asking — one login on the platform. */
  shortcut: boolean
  error: string | null
  rows: RefillRowResult[]
}

/** Which of Refill Data's two passes is running. */
export type RefillPhase = 'blanks' | 'status'

export type RefillPlatformState = 'waiting' | 'running' | 'done' | 'skipped'

/**
 * One marketplace's place in the pass that is running.
 *
 * `checked` / `changed` / `skipped` are this PLATFORM's totals for the pass —
 * the per-claim event carries the live detail for whichever one is running.
 */
export interface RefillPlatformProgress {
  platform: string
  state: RefillPlatformState
  /**
   * Claims NOT asked about, because the marketplace answered about them within
   * the last `CLAIM_STATUS_SYNC_DAYS`.
   *
   * ITS OWN NUMBER, deliberately separate from `skipped`. Skipped means the
   * marketplace was asked and had nothing to say; this means it was not asked,
   * because we already know. Folding them together would make a sweep that
   * dropped from 580 claims to 32 look like 548 wasted questions.
   */
  upToDate?: number
  /** Rows the pass has reached an answer for. */
  checked: number
  /** Rows where something was actually written. */
  changed: number
  /** Rows passed over — no AWB, past the blanks budget, or nothing to write. */
  skipped: number
  /** Why it was skipped, when it was. */
  note: string | null
}

/**
 * The shape of a whole pass, as it runs.
 *
 * SEPARATE FROM `RefillProgress`, which is one platform's claim-by-claim
 * progress and says nothing about the run around it. This is the other half:
 * which pass is going, every marketplace it will reach, and which one it is on.
 * Without it the card can show a platform working and nothing about the six
 * waiting behind it — and cannot say whether the blanks or the status pass is
 * the one doing it.
 */
export interface RefillPassProgress {
  running: boolean
  phase: RefillPhase | null
  platforms: RefillPlatformProgress[]
}
