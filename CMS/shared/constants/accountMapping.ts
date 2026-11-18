import { platformKey } from '@shared/utils/platformKey'

/**
 * Which marketplaces a claim's account can be worked out from its AWB.
 *
 * The renderer needs this to decide whether "Map Username" belongs on the
 * screen at all, and the renderer cannot see the main process's registry —
 * `ACCOUNT_PROBES` maps platform names to imported functions, which is not a
 * thing that survives a trip over IPC. So the list is stated here and the two
 * are held together by a test rather than by hope.
 *
 * NYKAA IS ABSENT ON PURPOSE: it has no per-row account. The company's one
 * Nykaa login files every claim, so a mapping run would ask that account about
 * rows already destined for it and write back what was already true.
 *
 * Amazon and "Other" are tabs on the claims grid, not platforms this app
 * automates, so they are absent for that reason instead.
 */
export const ACCOUNT_MAPPABLE_PLATFORMS: readonly string[] = [
  'ajio',
  'delhivery',
  'flipkart',
  'meesho',
  'myntra',
  'snapdeal',
  'tatacliq',
  'xbees'
]

export const isAccountMappable = (platform: string): boolean =>
  ACCOUNT_MAPPABLE_PLATFORMS.includes(platformKey(platform))

/* ------------------------------------------------------------------------- *
 * Which ROWS a bulk tool can work on.
 *
 * Both tools are armed before they run: pressing the button turns it into
 * "Run …" and puts the table into a selection the operator drives. So the grid
 * has to know what each tool can touch, and it must agree with the backend —
 * which applies the same rule to whatever ids it is sent. A checkbox offering a
 * row the server will drop is a promise the run cannot keep.
 * ------------------------------------------------------------------------- */

/** The fields either rule reads. `CmsRow` satisfies it structurally. */
export interface MappableRow {
  platform: string
  status: string
  username: string
  pobId: string
  subOrderNumber: string
}

/**
 * Statuses either tool may touch — the two master sync allows, for the same
 * reason. Every later status means the claim is already with the marketplace,
 * and back-filling identifiers into a filed claim makes the row disagree with
 * the ticket.
 */
const TOUCHABLE_STATUSES = new Set(['Pending', 'Failed to Proceed'])

const blank = (value: string): boolean => {
  const trimmed = value.trim()

  return trimmed.length === 0 || PLACEHOLDER_VALUES.has(trimmed.toLowerCase())
}

/**
 * Master-data import writes cells with `String(cell)`, so a file missing a
 * column stores the literal text "undefined" — truthy, and a plain emptiness
 * check would call the row complete and skip the one thing it is missing.
 */
const PLACEHOLDER_VALUES = new Set(['undefined', 'null', '-', '--', '---', 'n/a', 'na'])

/**
 * Map Username can place this row.
 *
 * Missing the account, OR missing the second identifier its platform needs —
 * AJIO's place of business, Meesho's sub-order number. Either one on its own
 * makes the claim unfileable, so either one on its own is work to do. A row
 * that has everything is not offered: there is nothing for the run to write,
 * and ticking it would only make the count lie.
 */
export interface MapSelectionOptions {
  /**
   * Developer mode: offer rows that already have everything, so a mapping run
   * can be used to RE-CHECK them.
   *
   * The reason is Meesho's sub-order number. A row can carry one that is simply
   * wrong — the ORDER number rather than the sub-order, or one imported against
   * another order — and nothing on the claims page can tell: the cell is
   * filled, so the row is complete by every rule here, and it fails only at
   * filing time with a message that names neither field. Re-running the map is
   * how the marketplace's own answer gets compared with it.
   *
   * Still bounded by TOUCHABLE_STATUSES, and the account is fill-blank on
   * write — a re-check can correct the second identifier and can never move a
   * claim to a different seller.
   */
  verifyMapped?: boolean
}

export const isAccountMapEligible = (
  row: MappableRow,
  { verifyMapped = false }: MapSelectionOptions = {}
): boolean => {
  const platform = platformKey(row.platform)

  if (!isAccountMappable(platform)) return false
  if (!TOUCHABLE_STATUSES.has(row.status)) return false

  if (blank(row.username)) return true
  if (platform === 'ajio') return blank(row.pobId) || verifyMapped
  if (platform === 'meesho') return blank(row.subOrderNumber) || verifyMapped

  // Nothing to re-check on the rest: their probe answers with the account and
  // nothing else, and the account is never overwritten.
  return false
}

/**
 * Bulk SKU can read this row's return.
 *
 * STRICTER, and in a way that orders the two tools: reading a return needs an
 * account to sign in as and a POB to search under, and those are exactly what
 * Map Username fills in. So a row is eligible here only once mapping has done
 * its work — map the accounts, then sweep the SKUs.
 *
 * AJIO alone: it is the only platform with an endpoint that answers what a
 * return AWB holds.
 */
export const isSkuSweepEligible = (row: MappableRow): boolean =>
  platformKey(row.platform) === 'ajio' &&
  TOUCHABLE_STATUSES.has(row.status) &&
  !blank(row.username) &&
  !blank(row.pobId)
