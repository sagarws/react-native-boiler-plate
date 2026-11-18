/**
 * The live CMS list, mirroring what the web app's Manage SPF Claims page shows.
 *
 * The desktop app reads the same records from the same endpoint, so an operator
 * who has never processed anything here still sees the company's full history
 * rather than an empty screen.
 */

/** One claim row, flattened from the CMS document the API returns. */
export interface CmsRow {
  id: string
  platform: string
  ticket: string
  returnAwb: string
  /** `forwardAWB` on the claim. Empty when none was recorded. */
  forwardAwb: string
  sellerSku: string
  pobId: string
  status: string
  scriptStatus: string
  attempts: number
  /**
   * How many times Refill Data has worked this row (`refillAttempt` on the
   * claim). Its own budget — see MAX_REFILL_ATTEMPTS — so a row that has burned
   * its FILING attempts can still be refilled, and vice versa.
   */
  refillAttempts: number
  scriptError: string
  scannedNumber: string
  customerOrderNumber: string
  /** Meesho's per-item order id. Its claim form is searched by this, so a row without one cannot be filed. */
  subOrderNumber: string
  /**
   * AJIO evidence upload state: "pending"/"failed" mean the S3 → Drive link
   * conversion has not finished, so the links a claim would attach do not exist
   * yet. Absent on rows that predate the field, which is treated as ready.
   */
  driveStatus: string
  brand: string
  username: string
  accountType: string
  forwardOrderDate: string
  feedName: string
  createdAt: string
  /**
   * Whether the row carries the evidence its marketplace will demand.
   *
   * Computed in the row builder from the document's own slots — see
   * EVIDENCE_SLOTS. Five platforms throw EVIDENCE_MISSING from inside the
   * claim flow, which is far too late: the row knew all along.
   */
  hasEvidence: boolean
  /**
   * The compensation the marketplace paid on this claim, in rupees
   * (`compensationAmount` on the document). NULL when none is recorded — not
   * yet paid, or paid before the amount was written back — which is not ₹0.
   */
  amount: number | null
  /**
   * Why the marketplace rejected the claim (`rejectReason` on the document).
   * Empty when none is recorded. Filled by the bulk status upload (AJIO's
   * Ticket Remarks, Myntra's rejectionReason), a status set by hand with a
   * reason, and a Refill status check on Myntra, Flipkart and Delhivery — the
   * marketplaces whose status responses carry one.
   */
  rejectReason: string
}

export interface CmsListQuery {
  /** Stored casing, e.g. "Ajio" — the endpoint matches it exactly. */
  platform?: string
  status?: string
  search?: string
  page?: number
  limit?: number
  /**
   * `yyyy-MM-dd`, inclusive. The admin panel always sends a window — its own
   * default is the last seven days — and this app sent none, so the same
   * account showed 1365 Myntra claims here and 35 there. Two screens
   * disagreeing about how much work exists is worse than either number.
   */
  startDate?: string
  endDate?: string
}

export interface CmsListPage {
  rows: CmsRow[]
  total: number
  page: number
  limit: number
  totalPages: number
}

/** Tab counts. Platform counts are company-wide; status counts follow the platform tab. */
export interface CmsCounts {
  platformCounts: Record<string, number>
  statusCounts: Record<string, number>
}

/** The backend's `cms:drive:status` push, as the list consumes it. */
export interface CmsDriveStatusEvent {
  cmsId: string
  driveStatus: 'pending' | 'uploaded' | 'failed'
}

/** A field the server will set across many claims, as /cms/bulk-field-options describes it. */
export interface BulkFieldOption {
  key: string
  label: string
  /** Whether this field may be CLEARED — most may; a status may not. */
  allowEmpty: boolean
  /** The vocabulary, where the field has one. A picker, not a text box. */
  options?: string[]
}

export interface BulkUpdateResult {
  /** Rows the update reached. */
  matched: number
  /** Rows it actually changed — the rest already held the value. */
  modified: number
  /** Platforms whose rows were left alone, and why there was nothing to write. */
  skipped: string[]
  field: string
  value: string
}

/** One claim's ticket number, written by hand. */
export interface TicketUpdateInput {
  cmsId: string
  ticket: string
  /** The row's status as shown — the edit is refused outside `canEditTicket`. */
  status: string
}

export interface TicketUpdateResult {
  cmsId: string
  ticket: string
  /** What the server left the claim at — In Review. */
  status: string
}
