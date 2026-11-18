/**
 * The claim statuses a row may be SELECTED at, for filing from this machine.
 *
 * Filing is for claims that have not reached the marketplace yet. Every other
 * status on the Claims page — In Review, Approved, Rejected, Customer Replied,
 * Resolved — describes a claim that already exists there, and filing one again
 * raises a SECOND ticket for the same return. That is the one action on that
 * screen nobody can undo.
 *
 * So the checkbox column is hidden outside these two rather than merely
 * ignored: a control that looks usable is an invitation to use it.
 *
 * "All" is deliberately absent. It mixes claimable rows with already-filed
 * ones, and a Select-all there would tick both.
 *
 * In `shared` rather than beside the page because it is a rule about claims,
 * not about a table — the main process can enforce the same thing without a
 * second copy of the list.
 */
export const SELECTABLE_STATUSES: readonly string[] = ['Failed to Proceed', 'Pending']

/**
 * What a claim's Script Error says when the nightly run passed it over because
 * the marketplace account it needs has no usable session.
 *
 * NOT A FAILURE, and deliberately worded so nobody reads it as one. The claim
 * was never put to the marketplace: the 04:00 run finds the account's session
 * dead, files nothing for it, and moves on to the accounts that can work — the
 * alternative being a sign-in window opening in the middle of the night with
 * nobody there to type the one-time code.
 *
 * It costs NO ATTEMPT. The report carries `skipped: true`, which is what stops
 * TrackVid-BE charging one (see desktopClaimStatus.controller) — three quiet
 * nights behind an expired session must not retire a perfectly fileable row to
 * Failed to Proceed without anything ever having been tried.
 *
 * In `shared` because the renderer recognises it too: a row carrying this is
 * waiting on a session, not on somebody debugging a claim.
 */
export const SKIPPED_SESSION_EXPIRED = 'CE1: Skipped due to session expired'


export const isSelectableStatus = (status: string): boolean =>
  SELECTABLE_STATUSES.includes(status)

/**
 * The statuses a ticket number may be typed in at, by hand.
 *
 * `/cms/update-ticket` sets the claim to In Review WHATEVER it was. From
 * Pending or Failed to Proceed that is the point — the claim was filed by hand
 * and now waits on the marketplace. From In Review it changes nothing but the
 * number. From Approved, Rejected or Paid it would drag a settled claim back to
 * In Review, so those rows offer no editor at all.
 */
export const TICKET_EDITABLE_STATUSES: readonly string[] = [...SELECTABLE_STATUSES, 'In Review']

export const canEditTicket = (status: string): boolean => TICKET_EDITABLE_STATUSES.includes(status)

/** The longest ticket number accepted — longer is a paste of something else. */
export const MAX_TICKET_LENGTH = 100

/**
 * Which status tab is actually shown, given the operator's choice and the tabs
 * this platform has.
 *
 * Switching platform does NOT clear the choice. It used to — `setStatus('All')`
 * on every platform click — so an operator working through Pending claims lost
 * their place each time they moved between marketplaces, which is most of what
 * that page is for.
 *
 * The choice only gives way when the new platform genuinely has no such tab:
 * AJIO has "Un Attended" and "Resolved", Myntra has "Paid", and neither means
 * anything to Meesho. Then "All" is shown — but the choice is KEPT in state, so
 * switching back restores it rather than making them find it again.
 *
 * Derived rather than written from an effect: writing state there renders once
 * with a filter the new platform never emits, and an empty table reads as
 * missing data before the correction lands.
 */
export const resolveActiveStatus = (
  status: string,
  tabs: readonly { value: string }[]
): string => (tabs.some(tab => tab.value === status) ? status : 'All')

/* ------------------------------------------------------------------------- *
 * Which ROWS may be selected, on a tab that already allows selecting at all.
 * ------------------------------------------------------------------------- */

/**
 * The fields a selectability decision reads. `CmsRow` satisfies it
 * structurally, so callers pass the row itself rather than re-packing it.
 */
export interface SelectableRow {
  platform: string
  /**
   * The CLAIM's status, not the script's.
   *
   * Read by the retry cap: three attempts on a Pending row is a promotion that
   * has not landed, not a claim that has given up.
   */
  status: string
  username: string
  /**
   * The return AWB — the one field EVERY platform's claim starts from.
   *
   * Required on all nine, with no exception: AJIO needs it or a return order
   * id, Myntra searches on it, Flipkart sends it as the tracking id, Snapdeal
   * and Meesho resolve the return with it, Delhivery asserts the shipment
   * exists under it, Tata CliQ refuses outright without one, and Nykaa's ticket
   * is indexed by it.
   */
  returnAwb: string
  pobId: string
  subOrderNumber: string
  driveStatus: string
  scriptStatus: string
  attempts: number
  /**
   * Whether the row carries any of the evidence its marketplace insists on.
   *
   * COMPUTED WHERE THE ROW IS BUILT, not here, because the answer is per
   * platform and lives in the document's own field names — see
   * EVIDENCE_SLOTS. This is the decision, already made.
   *
   * `undefined` on a caller that does not supply it, and treated as "not
   * known" rather than "missing": a rule that blocked on an absent field would
   * freeze every row on any screen that had not been taught to fill it in.
   */
  hasEvidence?: boolean
}

/**
 * The evidence slots each marketplace's claim will refuse without — named as
 * the CMS document names them, because that is what the list returns.
 *
 * WHY THE ROW MUST BE CHECKED AT ALL. Five platforms throw `EVIDENCE_MISSING`
 * from inside their claim flow, after a browser has opened, a session has been
 * spent and the return has been found. Every one of those is knowable from the
 * row before anybody ticks it.
 *
 * ONE ENTRY PER PLATFORM, AND ONLY WHERE THE FLOW ACTUALLY REFUSES. A platform
 * missing from this map is not an oversight to be filled in later:
 *
 *   ajio    files from the email template and its Drive links, which
 *           `driveLinksReady` already gates
 *   nykaa   has no evidence guard at all — it submits whatever it has
 *   others  are listed with the slots their flow checks, no more
 *
 * Over-listing is the dangerous direction: a slot added here that the flow
 * does not really need makes a filable claim untickable, and an operator
 * cannot argue with a disabled checkbox.
 *
 * The paths are the ones TrackVid-BE maps into the claim config
 * (`triggerPuppeteerForCms.ts`), so this list and the config it is predicting
 * are two readings of the same table. `a.b` walks one level.
 */
export const EVIDENCE_SLOTS: Record<string, readonly string[]> = {
  // barcode / product / waybill / video — the core throws EVIDENCE_MISSING
  // when all four are empty.
  meesho: [
    'barcodeImage',
    'receivedProductImage_1',
    'receivedProductImage_2',
    'receivedProductImage_3',
    'reverseWayBillImage',
    'returnVideoLink'
  ],
  // "no attachable images for this dispute" — images only; its video is soft.
  snapdeal: [
    'outerPackageImage_1',
    'outerPackageImage_2',
    'innerPackageImage_1',
    'innerPackageImage_2',
    'podImage_1',
    'podImage_2',
    'productImage_1',
    'productImage_2'
  ],
  // unboxingDoc — the packing images and the return video, together.
  delhivery: ['otherClaimDetails.packingImages', 'returnVideoLink'],
  // EVIDENCE_MISSING: "CMS provided no evidence images for this AWB".
  flipkart: ['otherClaimDetails.packingImages', 'otherClaimDetails.shippingLabelImage'],
  // Both are hard on Myntra: the shipping label AND at least one packing image.
  myntra: ['myntraClaimDetails.shippingLabelImage', 'myntraClaimDetails.packingImages']
}

/** The cap when the core's value cannot be read — what this was before it was configurable. */
const DEFAULT_CLAIM_ATTEMPTS = 3

/**
 * Reads the core's MAX_CLAIM_ATTEMPTS: null for no cap, otherwise the cap.
 *
 * "unlimited" (any case) means no cap. A positive whole number is the cap.
 * Anything else — a typo, zero, a fraction, a missing export — falls back to
 * DEFAULT_CLAIM_ATTEMPTS rather than to no cap: a mistyped value must not
 * quietly let an unattended run retry a broken claim for ever.
 */
export const claimAttemptLimit = (raw: unknown): number | null => {
  if (typeof raw === 'string' && raw.trim().toLowerCase() === 'unlimited') return null

  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw

  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_CLAIM_ATTEMPTS
}

/**
 * How many times a Failed to Proceed claim may be filed before it is left for a
 * person — or null, for no cap at all.
 *
 * OWNED BY THE CORE (common/constants.js), inlined at build time, so this app
 * and the core agree on one number. With a cap, a row that has failed that
 * many times is taken to fail for a reason the next run will not change.
 */
export const MAX_CLAIM_ATTEMPTS: number | null = claimAttemptLimit(__MAX_CLAIM_ATTEMPTS__)

/**
 * Master-data import writes cells with `String(cell)`, so a file missing a
 * column yields the literal text "undefined" — truthy, and a plain emptiness
 * check would wave it through into a claim the marketplace rejects.
 */
const PLACEHOLDER_VALUES = new Set(['undefined', 'null', '-', '--', '---', 'n/a', 'na'])

const filled = (value: string): boolean => {
  const trimmed = value.trim()

  return trimmed.length > 0 && !PLACEHOLDER_VALUES.has(trimmed.toLowerCase())
}

const platformOf = (row: SelectableRow): string => row.platform.trim().toLowerCase()

/**
 * Nykaa signs in with the company's own integration rather than a per-claim
 * marketplace account, so a Nykaa row carries no username and needs none.
 */
const ACCOUNT_OPTIONAL_PLATFORMS = new Set(['nykaa'])

export interface SelectionOptions {
  /**
   * Lift the retry cap — and ONLY the retry cap — for a claim that reached it.
   *
   * Developer mode's escape hatch, named after TrackVid-BE's own override on
   * the server dispatch (`allowCappedRetry` in runReturnScript), which lifts
   * exactly the same gate. Every other rule still applies: a running claim, a
   * missing account or a missing POB ID is not something a retry can get past.
   */
  allowCappedRetry?: boolean
}

/** Returns why the row cannot be ticked, or null when it can. */
type Rule = (row: SelectableRow, options: SelectionOptions) => string | null

const notRunning: Rule = row =>
  row.scriptStatus === 'Running'
    ? 'This claim is being filed right now. Filing it again would raise a second ticket for the same return.'
    : null

/**
 * The retry cap, which only bites once the claim has actually given up.
 *
 * A row that has burned three attempts is supposed to BE "Failed to Proceed" —
 * the backend promotes it there when the cap is reached. So the cap and the
 * status say the same thing, and blocking on the count alone was blocking on
 * the wrong one of the two: a Pending row showing three attempts is a row whose
 * promotion has not landed, and refusing to let an operator touch it left them
 * with a claim they could neither run nor clear.
 *
 * Gated on the status instead. Pending stays selectable however many attempts
 * it carries; Failed to Proceed at the cap is the state that means "stop
 * re-queueing this and go and look at it". With no cap (the core's
 * "unlimited"), this never refuses.
 */
const withinRetryLimit: Rule = (row, { allowCappedRetry = false }) =>
  !allowCappedRetry &&
  MAX_CLAIM_ATTEMPTS !== null &&
  row.status === 'Failed to Proceed' &&
  row.attempts >= MAX_CLAIM_ATTEMPTS
    ? `Reached the retry limit — ${row.attempts} attempts (max ${MAX_CLAIM_ATTEMPTS}). Fix what is failing before running it again.`
    : null

const hasAccount: Rule = row =>
  ACCOUNT_OPTIONAL_PLATFORMS.has(platformOf(row)) || filled(row.username)
    ? null
    : `No ${row.platform || 'marketplace'} account on this claim — there is no login to file it with. Import the master data carrying the account, then retry.`

const hasPobId: Rule = row =>
  filled(row.pobId)
    ? null
    : 'POB ID missing — AJIO rejects a claim without it. Import the master data carrying this AWB’s POB ID, then retry.'

/**
 * AJIO evidence is uploaded to S3 first and converted to Drive links after;
 * "pending" and "failed" mean the links the claim attaches do not exist yet.
 * Anything else — including a row that predates the field — is ready.
 */
const driveLinksReady: Rule = row =>
  row.driveStatus === 'pending' || row.driveStatus === 'failed'
    ? 'Evidence links are still being prepared for this AJIO claim. Refresh once the upload finishes.'
    : null

const hasSubOrderNumber: Rule = row =>
  filled(row.subOrderNumber)
    ? null
    : 'Sub-order number missing — the Meesho claim form is searched by it, so the claim cannot be filed. Import the master data carrying it, then retry.'

/**
 * The AWB, which every platform's claim begins from.
 *
 * THE ONE REQUIREMENT COMMON TO ALL NINE, and it was the one nobody checked. A
 * row whose return AWB is blank — or carries the literal "undefined" a
 * master-data import writes for a missing column — could be ticked, sent to
 * Create Ticket, and would then fail deep inside whichever marketplace it
 * belonged to, each in its own words:
 *
 *   ajio       "need a returnOrderId or awbNumber in configEntry"
 *   myntra     "fetchNewClaim: searchId is required"
 *   flipkart   "getOrderSearch: trackingId is required"
 *   snapdeal   SE1: Invalid Awb number
 *   meesho     ME3: Invalid AWB number
 *   delhivery  AWB_NOT_FOUND
 *   tatacliq   "No return AWB to claim against"
 *   xbees      the dispute search finds nothing
 *   nykaa      files a ticket with an empty AWB field and no complaint at all
 *
 * Nine failures, eight spellings, one cause — and on Nykaa no failure at all,
 * which is worse: a ticket raised against nothing. Caught once, here, before
 * the row can be ticked.
 */
const hasReturnAwb: Rule = row =>
  filled(row.returnAwb)
    ? null
    : 'No return AWB on this claim — every marketplace searches for the return by it, so there is nothing to file against. Import the master data carrying it, then retry.'

/**
 * Does this slot hold anything?
 *
 * The document stores a file as `{ fileKey, createdAt }`, a list of them as an
 * array, and a link as a plain string — so "filled" is three shapes, and an
 * object with no `fileKey` is an EMPTY slot rather than a present one. BE's own
 * mapping filters on `fileKey` before building a URL for exactly this reason:
 * `getObjectURL(undefined)` returns a truthy ".../undefined".
 */
const slotFilled = (value: unknown): boolean => {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return filled(value)
  if (Array.isArray(value)) return value.some(slotFilled)
  if (typeof value === 'object') {
    const key = (value as { fileKey?: unknown }).fileKey

    return typeof key === 'string' && filled(key)
  }

  return false
}

/**
 * Whether a claim document carries the evidence its platform will demand.
 *
 * Exported so the row builder can answer it once, where the document is, and
 * the rule below can stay a rule. A platform with no entry needs none, and
 * says so by returning true rather than by being special-cased at the call
 * site.
 */
export const documentHasEvidence = (platform: string, doc: Record<string, unknown>): boolean => {
  const slots = EVIDENCE_SLOTS[platform.trim().toLowerCase()]

  if (!slots) return true

  return slots.some(path => {
    const value = path
      .split('.')
      .reduce<unknown>(
        (node, key) =>
          node && typeof node === 'object'
            ? (node as Record<string, unknown>)[key]
            : undefined,
        doc
      )

    return slotFilled(value)
  })
}

/**
 * Evidence the marketplace will refuse the claim without.
 *
 * CAUGHT HERE RATHER THAN MID-FLIGHT. Five platforms throw `EVIDENCE_MISSING`
 * from inside the claim — after a browser has opened, a marketplace session has
 * been spent and the return has been located. The row already knows, and so
 * the checkbox can.
 *
 * SILENT WHEN THE CALLER DID NOT ANSWER. `hasEvidence` is optional, so a
 * screen that has not been taught to fill it in is not punished by having every
 * row frozen — a gate whose default is "block" fails in the direction nobody
 * can work around.
 */
const hasEvidence: Rule = row =>
  row.hasEvidence === false
    ? `No evidence on this claim — ${row.platform || 'this marketplace'} refuses a claim with no images or video attached. Add the evidence to the row, then retry.`
    : null

const ALWAYS: readonly Rule[] = [notRunning, withinRetryLimit, hasReturnAwb, hasAccount, hasEvidence]

/**
 * Extra requirements, by platform. A lookup rather than a chain of
 * `if (platform === …)`: adding a marketplace is one entry here.
 */
const PLATFORM_RULES: Record<string, readonly Rule[]> = {
  ajio: [hasPobId, driveLinksReady],
  meesho: [hasSubOrderNumber]
}

/**
 * Why this row cannot be selected for filing — null when it can be.
 *
 * The desktop checkbox has exactly one consumer, Create Ticket, so a row that
 * cannot be filed has no reason to be tickable. (The admin panel is looser on
 * POB ID for a reason that does not apply here: its checkbox also drives Master
 * Sync, the one action that repairs a POB-less row, so blocking selection there
 * would leave the operator no way to fix it. It filters those rows out at
 * dispatch instead.)
 *
 * Returns the reason rather than a boolean so the disabled checkbox can explain
 * itself on hover — a control that is dead with no explanation reads as a bug.
 */
export const selectionBlockReason = (
  row: SelectableRow,
  options: SelectionOptions = {}
): string | null => {
  for (const rule of [...ALWAYS, ...(PLATFORM_RULES[platformOf(row)] ?? [])]) {
    const reason = rule(row, options)

    if (reason) return reason
  }

  return null
}

export const isRowSelectable = (row: SelectableRow, options: SelectionOptions = {}): boolean =>
  selectionBlockReason(row, options) === null

/**
 * Platforms whose claim window ("TAT") the marketplace will answer for.
 *
 * Meesho does: its ticket form validates the window and refuses an out-of-date
 * claim in its own words, so a verdict here is the marketplace's, not ours.
 * Nothing is inferred from a delivery date plus a company setting — that would
 * be a guess, and Check TAT writes a terminal status on the strength of it.
 *
 * Read by the renderer to decide whether the button exists at all; the main
 * process keeps the implementations in CLAIM_TAT_CHECKS (automations/registry).
 * The two are checked against each other in tests/tatCheck.test.ts.
 */
export const TAT_CHECK_PLATFORMS: readonly string[] = ['meesho']

export const hasTatCheck = (platform: string): boolean =>
  TAT_CHECK_PLATFORMS.includes(platform.toLowerCase().trim())

/**
 * Platforms whose filed ticket can be opened from the Claims page — details,
 * attachments, the comment thread, and a reply (comment, files, or both).
 *
 * AJIO (help-centre ticket), Meesho (support ticket) and Snapdeal (query case):
 * each read and answered through the API its own portal's ticket window uses.
 * What a reply may attach is per platform — TICKET_REPLY_RULES. Read by
 * the renderer to decide whether the View icon exists; the main process keeps
 * the implementations in TICKET_THREADS (automations/registry). Checked against
 * each other in tests/tatCheck.test.ts.
 */
export const TICKET_THREAD_PLATFORMS: readonly string[] = ['ajio', 'meesho', 'nykaa', 'snapdeal']

export const hasTicketThread = (platform: string): boolean =>
  TICKET_THREAD_PLATFORMS.includes(platform.toLowerCase().trim())
