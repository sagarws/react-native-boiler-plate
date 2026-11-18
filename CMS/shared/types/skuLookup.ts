/**
 * Choosing a claim's seller SKU from the return's own articles.
 *
 * A claim cannot be filed without one: the AJIO flow refuses to pick an article
 * when the return has several and no SKU was given, because guessing files the
 * claim against the wrong item. Master data supplies it when master data has
 * the row — and these are the rows it does not.
 *
 * AJIO knows, so the app asks and lets a person choose.
 */

/** One article on the return. */
export interface ReturnArticle {
  /** What the claim row stores as its seller SKU. */
  sellerSku: string
  /**
   * The other identifiers AJIO carries. Shown because it returns the seller's
   * own SKU on a different one depending on the account — a picker listing only
   * `sellerSku` shows a blank row for those.
   */
  sterlingSkuId: string
  itemCode: string
  eanCode: string
  scanCode: string
  productName: string
  /** Null whenever AJIO's payload carries no picture for this article. */
  imageUrl: string | null
  quantity: number | null
  returnItemId: string
  /**
   * The identifier to actually store, and where it came from — null when the
   * article carries none of the five at all.
   *
   * AJIO does not always return a seller SKU: a real return came back with
   * `sellerSkuId` empty and the article identified by `sterlingSkuId`,
   * `itemCode`, `eanCode` and `scanCode` only. The claim matches a stored SKU
   * against all five, so any of them files correctly — refusing them would
   * leave that article unpickable and its claim unfileable.
   *
   * `unique: false` means the value also matches another article on this
   * return, which the claim would resolve to whichever comes first. Storable,
   * but the picker says so rather than pretending the choice was clean.
   */
  storable: { value: string; field: string; unique: boolean } | null
}

export interface ReturnArticles {
  returnOrderId: string
  orderId: string | null
  articles: ReturnArticle[]
}

/** One claim a bulk sweep will ask about. */
export interface SkuCandidate {
  cmsId: string
  awbNumber: string
  platform: string
  status: string
  pobId: string
  username: string
  accountType: string
  /** What the claim says today. Empty on the rows the sweep exists to fill. */
  currentSku: string
}

/** How far a sweep has got. Pushed, not polled — it opens a browser per account. */
export interface SkuSweepProgress {
  platform: string
  done: number
  total: number
  /** Rows AJIO answered for. */
  resolved: number
  /** Rows it could not answer for, with the reason in `misses`. */
  failed: number
  awbNumber: string
  running: boolean
  misses: { awbNumber: string; message: string }[]
}

/** One row of the review table the sweep produces. */
export interface SkuSweepRow {
  cmsId: string
  awbNumber: string
  /** What the claim says today. */
  currentSku: string
  articles: ReturnArticle[]
  /**
   * The SKU pre-selected for this row — the single article's, or the one that
   * matches what the claim already says. Null when the operator must choose.
   */
  suggested: string | null
  /**
   * The claim names a SKU that is on NONE of the return's articles.
   *
   * The interesting failure: the claim points at an item that is not on the
   * return, which either trips `selectReturnItem`'s gate or files against the
   * wrong thing. Flagged rather than silently replaced — a person decides.
   */
  mismatch: boolean
  /** Why AJIO could not be asked about this row. Null when it answered. */
  error: string | null
}

export interface SkuSweepResult {
  platform: string
  total: number
  resolved: number
  failed: number
  rows: SkuSweepRow[]
}
