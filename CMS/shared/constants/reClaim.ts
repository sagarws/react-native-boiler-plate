/**
 * How a re-claim run is cut up.
 *
 * ONE NUMBER, SHARED, because it means the same thing in three places and they
 * have to agree: the run disputes this many tickets before it checkpoints, the
 * modal shows this many rows on a page, and the progress an operator reads is
 * phrased in these units. Two copies would drift and the page an operator was
 * watching would stop matching the batch the run was on.
 *
 * FIFTY IS ABOUT THE RENDERER, NOT MYNTRA. The run is paced at roughly five
 * seconds a ticket whatever this is set to; what 3,003 rows broke was the
 * table, which drew every one of them with a button and a checkbox apiece.
 */
export const RE_CLAIM_BATCH_SIZE = 50

/** Which batch a zero-based row index falls in, 1-based. */
export const batchOf = (index: number): number => Math.floor(index / RE_CLAIM_BATCH_SIZE) + 1

/** How many batches a run of `total` tickets is cut into. */
export const batchCountFor = (total: number): number =>
  total > 0 ? Math.ceil(total / RE_CLAIM_BATCH_SIZE) : 0
