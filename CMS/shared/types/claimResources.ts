/**
 * What to do with a video too large for the marketplace this claim is filed on.
 *
 * `fit`      re-encode a copy that fits the cap, so the download can be
 *            uploaded by hand without being refused at the form.
 * `original` leave it exactly as the row holds it — full quality, and too
 *            large for the form if it was too large to begin with.
 *
 * The operator is asked because both answers are right for different jobs:
 * filing the claim needs a file the portal accepts, and sending the evidence to
 * anyone else — a courier dispute, an internal review — wants the real thing.
 */
export type VideoSizeChoice = 'fit' | 'original'

/** One claim the operator asked to download the evidence for. */
export interface ClaimResourceRequest {
  cmsId: string
  /** Stored casing is fine — the lookup lowercases. */
  platform: string
  awbNumber: string
  /**
   * Only consulted when the platform states an upload cap and the row's video
   * is over it. Defaults to `original`: touching a file nobody asked to have
   * touched is the worse default.
   */
  video?: VideoSizeChoice
}

export interface ClaimResourceResult {
  /** Where the zip was written. */
  path: string
  /** Files inside it, text files included. */
  fileCount: number
  /**
   * Evidence the row lists but that could not be downloaded. The zip is still
   * written — half the evidence is more use to someone filing by hand than an
   * error — and `MISSING.txt` inside it names each one.
   */
  missing: string[]
  /**
   * What happened to a video that was over the marketplace's cap. Absent when
   * there was no video, or it already fitted, or the operator asked for the
   * original.
   *
   * Reported so the toast can say it: an operator who asked for a file that
   * fits needs to know whether they got one, and a re-encode that could not
   * get under the cap is exactly the case where they would otherwise find out
   * at the claim form.
   */
  video?: {
    /** Bytes before and after. Equal when nothing was re-encoded. */
    from: number
    to: number
    fitted: boolean
    /** Why it was left alone, when it was. */
    reason?: string
  }
}
