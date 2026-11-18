import type { RefillField, RefillFieldLabel } from '@shared/types/refill'
import { platformKey } from '@shared/utils/platformKey'

/**
 * How many times a Refill run may work one row before leaving it alone.
 *
 * Its own budget, separate from the claim's `MAX_CLAIM_ATTEMPTS` — and that
 * separation is the point: a row that has burned its FILING attempts is often
 * exactly the row whose blanks a refill would supply, so the two must not
 * consume each other.
 *
 * Three, because a refill that has asked the marketplace three times and come
 * back with nothing will not answer on the fourth — the AWB is wrong, or the
 * return sits on an account this company does not hold, and both need a person.
 * Every further ask is a browser session the nightly run could have spent on a
 * row it can actually fill.
 *
 * Counted on the CLAIM as `refillAttempt`, incremented once per row per run by
 * the app itself (POST /cms/refill-attempt).
 */
export const MAX_REFILL_ATTEMPTS = 3

/** Has this row used up its refill budget? Absent counts as none used. */
export const refillExhausted = (attempts: number | null | undefined): boolean =>
  (attempts ?? 0) >= MAX_REFILL_ATTEMPTS

/**
 * Which blanks Refill Data can fill, per platform.
 *
 * MIRRORS the core's `common/refillConfig.js`, which is the source of truth —
 * the renderer cannot load the core, and the dialog has to know what to offer
 * before anything runs. A test asserts the two agree, so a field added in one
 * place and forgotten in the other fails there rather than on screen.
 *
 * AJIO IS ANSWERED FROM DISK, not from AJIO. This machine already keeps a copy
 * of the seller portal's reports (Settings → AJIO master data backup), and a
 * return AWB is a row in it carrying the forward AWB, the seller SKU and the
 * POB. So its refill makes no network call and needs no login — but it can only
 * fill what has been backed up.
 *
 * NYKAA HAS ONE FIELD: the claim status. No per-claim account — the company's
 * single login owns every ticket — and no sub-order or forward AWB to repair.
 * What it has is a Zoho Desk ticket whose state moves after filing, which is
 * the one thing nobody can see from the row.
 */
export const REFILL_FIELDS: Record<string, RefillField[]> = {
  // The claim status is the one AJIO field that is NOT local: a ticket's state
  // lives with AJIO, not in the reports this machine backs up.
  ajio: ['accountMapping', 'forwardAwbNumber', 'sellerSku', 'pobId', 'statusChange'],
  myntra: ['accountMapping', 'forwardAwbNumber', 'statusChange'],
  meesho: ['accountMapping', 'subOrderNumber', 'statusChange'],
  snapdeal: ['accountMapping', 'subOrderNumber', 'statusChange'],
  flipkart: ['accountMapping', 'statusChange'],
  delhivery: ['accountMapping', 'statusChange'],
  // No status: the Early Refund QC row carries a CRM ticket NUMBER when one
  // exists — which answers "already claimed" — but nothing captured from the
  // portal reports where that ticket now stands.
  tatacliq: ['accountMapping', 'forwardAwbNumber'],
  nykaa: ['statusChange'],
  xbees: ['accountMapping']
}

/** What each field is called on screen. The description says what it repairs. */
export const REFILL_LABELS: Record<RefillField, RefillFieldLabel> = {
  accountMapping: {
    field: 'accountMapping',
    label: 'Account',
    description: 'Which marketplace login holds this AWB'
  },
  forwardAwbNumber: {
    field: 'forwardAwbNumber',
    label: 'Forward AWB',
    description: 'The outbound shipment this return came from'
  },
  subOrderNumber: {
    field: 'subOrderNumber',
    label: 'Sub-order number',
    description: 'What the claim form is searched by'
  },
  sellerSku: {
    field: 'sellerSku',
    label: 'Seller SKU',
    description: "The seller's own code for the article returned"
  },
  pobId: {
    field: 'pobId',
    label: 'POB ID',
    description: 'The place of business the return belongs to'
  },
  statusChange: {
    field: 'statusChange',
    label: 'Claim status',
    description: 'Where a filed ticket now stands, and what was paid'
  }
}

export const refillFieldsFor = (platform: string): RefillField[] =>
  // platformKey, not toLowerCase: the caller is usually holding the claims
  // grid's tab LABEL, and "Tata CliQ" lower-cased is not the key "tatacliq".
  REFILL_FIELDS[platformKey(platform)] ?? []

/** Is Refill Data offered on this platform at all? */
export const canRefill = (platform: string): boolean => refillFieldsFor(platform).length > 0

/**
 * Refill runs in two passes, and they ask different questions of different rows.
 *
 *   BLANKS  — everything a claim needs BEFORE it can be filed: the account, the
 *             POB, the sub-order number, the forward AWB, the seller SKU. Only
 *             empty fields are filled, and only `Pending` rows have these gaps.
 *
 *   STATUS  — where a ticket that was ALREADY FILED now stands, and what was
 *             paid. A Pending row has no ticket, so there is nothing to ask;
 *             the rows that need this are the ones the first pass never looks
 *             at, which is why the status was never refreshed at all.
 *
 * Splitting them is not cosmetic. One pass covered both, over `Pending` rows
 * only — so `statusChange` was asked for rows that had no ticket yet, and never
 * asked for the rows that had one.
 */
export const REFILL_BLANK_FIELDS: RefillField[] = [
  'accountMapping',
  'forwardAwbNumber',
  'subOrderNumber',
  'sellerSku',
  'pobId'
]

/** What the first pass asks this platform for. Empty means it is skipped. */
export const refillBlankFieldsFor = (platform: string): RefillField[] =>
  refillFieldsFor(platform).filter(field => field !== 'statusChange')

/** What the second pass asks for — the status alone, where the platform has one. */
export const refillStatusFieldsFor = (platform: string): RefillField[] =>
  refillFieldsFor(platform).filter(field => field === 'statusChange')

/** Does the Claims page offer Refill Data (the blanks) on this platform? */
export const canRefillBlanks = (platform: string): boolean =>
  refillBlankFieldsFor(platform).length > 0

/** Does the Claims page offer Status Change on this platform? */
export const canRefillStatus = (platform: string): boolean =>
  refillStatusFieldsFor(platform).length > 0

/**
 * Statuses the STATUS pass leaves alone.
 *
 * Written as an exclusion rather than a list of what to include, deliberately.
 * The claims grid already shows eight or nine statuses — In Review, In
 * Progress, Awaiting Agent Response, Customer Replied, Un Attended — and a
 * marketplace can start reporting another tomorrow. An include-list would
 * silently stop tracking it; an exclude-list picks it up.
 *
 *   Pending            no ticket has been filed, so there is nothing to ask
 *   Failed to Proceed  the same, and it is the queue for rows that need a person
 *   Approved           settled
 *   Rejected           settled
 */
export const REFILL_STATUS_SKIPPED: readonly string[] = [
  'Pending',
  'Failed to Proceed',
  'Approved',
  'Rejected'
]

/** Does this claim's status mean the second pass should ask about it? */
export const needsStatusRefill = (status: string | null | undefined): boolean =>
  typeof status === 'string' &&
  status.trim() !== '' &&
  !REFILL_STATUS_SKIPPED.includes(status.trim())
