/**
 * Shapes shared by every Create Claim "return AWB → the rest of the claim" lookup.
 *
 * Asked of ONE account, with the session it already holds. Signing in is not
 * this lookup's job — it runs while an operator is typing, and a login there
 * would hold the form hostage to a browser and possibly an emailed code. A dead
 * session is an answer ("expired"), reported per account, not something to fix.
 */

/** What one account knew about a return AWB. */
export interface ReturnAwbDetails {
  /** The forward leg's AWB, when the marketplace names it. */
  forwardAwb: string | null
  /** The marketplace's SKU id for the line. */
  sku: string | null
  /**
   * The item's listed price, where the marketplace returns one (Myntra's
   * `styleInfo.styleBasic.price` on the claim row). Prefills the disputed
   * amount of a partial return. Absent on platforms whose lookup lacks it.
   */
  price?: number | null
  /**
   * Meesho's sub-order number (`sub_order_num`, e.g. `345023881081112704_1`) —
   * the key every Meesho claim is filed under. Absent elsewhere.
   */
  subOrderNumber?: string | null
  /**
   * The marketplace's order id (Flipkart's "OD…"), saved in the claim's
   * `customerOrderNumber`. On Flipkart, `subOrderNumber` carries the order
   * item id. Absent elsewhere.
   */
  orderId?: string | null
  /** The return's carrier as the marketplace names it (Meesho's `carrier_name`). */
  logisticsPartner?: string | null
}

/**
 * Resolves with the details, or with `null` when this account does not hold
 * the AWB. Throws for anything else — a dead session, a refusal, a timeout —
 * because "not mine" and "could not ask" have different fixes.
 */
export type ReturnAwbLookup = (input: { awb: string; username: string }) => Promise<ReturnAwbDetails | null>
