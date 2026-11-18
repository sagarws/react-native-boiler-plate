import type { CmsCounts, CmsListPage, CmsListQuery, CmsRow } from '@shared/types/cmsList'
import { documentHasEvidence } from '@shared/constants/claims'
import { fail, ok, type Result } from '@shared/types/result'
import { loadCore } from '../automations/common/coreLoader'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { withOfflineCache } from './offlineCache'

/**
 * The company's claims, read live from the same endpoints the web CMS uses.
 *
 * `POST /cms` returns a $facet — `[{ metadata: [...], cms: [...] }]` — and its
 * platform filter is a raw `$in` against the stored value, so it is
 * case-sensitive: "Ajio" matches and "ajio" returns nothing. The counts endpoint
 * lowercases instead. Both quirks are absorbed here so no caller has to know
 * which spelling a given endpoint wants.
 */

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * The marketplace account this row is filed from.
 *
 * Delegated to the core's `claimAccountUsername`, NOT re-derived here. This
 * file used to carry its own list — `ajio_account_email`, then Meesho's, then
 * Snapdeal's — and stopped there, so a Flipkart, Delhivery, Xbees, Myntra or
 * Nykaa claim showed an empty Username column no matter what was stored on it.
 * Worse than cosmetic: the row-selection gate reads that column, so a Flipkart
 * claim with a perfectly good account could not be ticked.
 *
 * The core's map is the same knowledge TrackVid-BE groups by before handing
 * claims to a runner, which is precisely why there must not be a second copy of
 * it. One list, five nested field names, no chance of a platform being
 * forgotten in one place and not the other.
 */
interface ClaimAccount {
  claimAccountUsername: (platform: string, doc: unknown) => string | null
}

export const usernameOf = (row: Record<string, unknown>): string => {
  const { claimAccountUsername } = loadCore<ClaimAccount>('common/claimAccount')

  return claimAccountUsername(text(row.eCommercePlatform), row) ?? ''
}

/**
 * A stored amount as a number, or null. Written as a number by the status
 * syncs, but a string from an older write reads the same; anything that is not
 * a finite, positive figure is "no amount", not zero.
 */
const amountOf = (value: unknown): number | null => {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN

  return Number.isFinite(amount) && amount > 0 ? amount : null
}

const toRow = (raw: Record<string, unknown>): CmsRow => ({
  id: text(raw._id),
  platform: text(raw.eCommercePlatform),
  ticket: text(raw.ticketNumber) || text(raw.temp_ticket),
  returnAwb: text(raw.AWBNumber),
  forwardAwb: text(raw.forwardAWB),
  sellerSku: text(raw.seller_sku) || text(raw.sellerSKU),
  pobId: text(raw.pobid),
  status: text(raw.status),
  scriptStatus: text(raw.scriptProcessingStatus) || 'Not Started',
  attempts: typeof raw.processCount === 'number' ? raw.processCount : 0,
  // Absent on every row written before the field existed, and absent means
  // "never refilled" — not "stop", which would freeze the whole back catalogue.
  refillAttempts: typeof raw.refillAttempt === 'number' ? raw.refillAttempt : 0,
  scriptError: text(raw.scriptProcessingError),
  scannedNumber: text(raw.scannedNumber),
  customerOrderNumber: text(raw.customerOrderNumber),
  subOrderNumber: text(raw.subOrderNumber),
  driveStatus: text(raw.driveStatus),
  brand: text(raw.order_Brand),
  username: usernameOf(raw),
  accountType: text(raw.accountType),
  forwardOrderDate: text(raw.forwardOrderDate),
  feedName: text(raw.feedName) || text((raw.feed as { name?: unknown })?.name),
  createdAt: text(raw.createdAt),
  /**
   * ANSWERED HERE, because this is the only place the whole document is.
   *
   * The list already returns every evidence slot — `barcodeImage`,
   * `receivedProductImage_1..3`, `reverseWayBillImage`, `returnVideoLink` and
   * the rest — so whether a claim has what its marketplace demands is knowable
   * before anybody ticks it, instead of after a browser has opened, a session
   * has been spent and the flow has thrown EVIDENCE_MISSING.
   */
  hasEvidence: documentHasEvidence(text(raw.eCommercePlatform), raw),
  amount: amountOf(raw.compensationAmount),
  rejectReason: text(raw.rejectReason)
})

interface FacetResponse {
  metadata?: { total?: number; totalPage?: number; page?: number; limit?: number }[]
  cms?: Record<string, unknown>[]
}

export const listCms = async (payload: unknown): Promise<Result<CmsListPage>> => {
  const query = (payload ?? {}) as CmsListQuery

  // Keyed by the query, so page 2 of Ajio does not overwrite page 1 of Meesho.
  // An operator who went offline mid-browse keeps every page they had loaded.
  const key = `cms:list:${query.platform ?? 'all'}:${query.status ?? 'all'}:${query.search ?? ''}:${query.page ?? 1}:${query.limit ?? 25}`

  return withOfflineCache(key, () => fetchCms(payload))
}

const fetchCms = async (payload: unknown): Promise<Result<CmsListPage>> => {
  const query = (payload ?? {}) as CmsListQuery
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 25))

  const response = await fetchCmsFacet(query)

  if (!response.success) return response

  const facet = response.data?.[0] ?? {}
  const meta = facet.metadata?.[0] ?? {}

  return ok({
    rows: (facet.cms ?? []).map(toRow),
    total: meta.total ?? 0,
    page: meta.page ?? page,
    limit: meta.limit ?? limit,
    totalPages: meta.totalPage ?? 0
  })
}

/**
 * One page of claims as the server stores them — every field, not the row.
 *
 * For Export, which needs the form fields `toRow` flattens away. Same request
 * as the list, so a page exported is exactly the page that was on screen.
 * Never cached: an export must not write out what was true an hour ago.
 */
export const fetchCmsDocuments = async (
  query: CmsListQuery
): Promise<Result<Record<string, unknown>[]>> => {
  const response = await fetchCmsFacet(query)

  return response.success ? ok(response.data?.[0]?.cms ?? []) : response
}

const fetchCmsFacet = async (query: CmsListQuery): Promise<Result<FacetResponse[]>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to load claims')

  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 25))

  return apiRequest<FacetResponse[]>('/cms', {
    method: 'POST',
    token,
    body: {
      page,
      limit,
      // These three are read with `.length` on the server, so an absent value
      // is a crash rather than "no filter".
      feedId: [],
      brand: [],
      eCommercePlatform: query.platform ? [query.platform] : [],
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { search: query.search } : {}),
      // Same window the admin panel sends, so the two agree on the counts.
      ...(query.startDate ? { startDate: query.startDate } : {}),
      ...(query.endDate ? { endDate: query.endDate } : {})
    }
  })
}

/**
 * Tab counts.
 *
 * Platform counts come from an unfiltered call so the platform tabs stay stable
 * as the operator moves between them; status counts are scoped to the selected
 * platform, which is what makes "Pending 16" mean "16 pending Ajio claims".
 */
export const cmsCounts = async (payload: unknown): Promise<Result<CmsCounts>> => {
  const query = (payload ?? {}) as CmsListQuery
  const platform = query.platform ?? 'all'

  // The window is part of the cache key: the same platform over a different
  // range is a different answer, and serving one for the other is how the tab
  // counts and the table disagree.
  // Everything that changes the answer belongs in the key. Serving a cached
  // count for a different filter is exactly how the tabs and the table came
  // apart in the first place.
  const key = [
    'cms:counts',
    platform,
    query.status ?? '',
    query.search ?? '',
    query.startDate ?? '',
    query.endDate ?? ''
  ].join(':')

  return withOfflineCache(key, () => fetchCounts(payload))
}

const fetchCounts = async (payload: unknown): Promise<Result<CmsCounts>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to load claims')

  const query = (payload ?? {}) as CmsListQuery

  // ONE call, with the SAME payload the admin panel sends.
  //
  // This used to be two calls with a shape of its own — one unscoped for the
  // platform tabs, one scoped for the status tabs — and the two panels then
  // disagreed about how much work existed: Ajio read 4 there and 62 here, over
  // an identical date range. The endpoint returns both count sets from a single
  // response, and the panel reads them that way, so anything this app sends
  // differently is a difference in the numbers.
  //
  // Every field below is one the panel sends (TrackVid-FE `CMS.tsx`,
  // `countsPayload`). Two matter more than they look:
  //
  //   status         the panel narrows the counts by the active status tab, so
  //                  omitting it produced different status totals
  //   search         same — a filtered table with unfiltered tabs is worse than
  //                  either, because the tab promises rows the table will not
  //                  show
  const body: Record<string, unknown> = {
    feedId: [],
    brand: [],
    eCommercePlatform: query.platform ? [query.platform] : [],
    ...(query.status && query.status !== 'All' ? { status: query.status } : {}),
    ...(query.search ? { search: query.search } : {}),
    ...(query.startDate ? { startDate: query.startDate } : {}),
    ...(query.endDate ? { endDate: query.endDate } : {})
  }

  const counts = await apiRequest<{
    platformCounts?: Record<string, number>
    statusCounts?: Record<string, number>
  }>('/cms/counts', { method: 'POST', token, body })

  if (!counts.success) return counts

  return ok({
    platformCounts: counts.data?.platformCounts ?? {},
    statusCounts: counts.data?.statusCounts ?? {}
  })
}
