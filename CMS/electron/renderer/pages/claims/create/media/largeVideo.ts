/**
 * The size above which a claim video gets a "this will take a while" toast.
 *
 * A claim video goes to the server exactly as chosen, and the server
 * re-encodes it before it answers — so a long phone video means minutes with
 * nothing on screen but a spinner. Small videos come back in seconds and need
 * no warning; past this size the wait is long enough that an operator would
 * otherwise take the spinner for a hang and leave the form.
 *
 * Counted in MiB, because that is what Windows Explorer labels "MB" — an
 * operator comparing with the file's properties sees the same number.
 */
export const LARGE_VIDEO_BYTES = 30 * 1024 * 1024

/** The one-line toast for `file`, or null when it is small enough to need none. */
export const largeVideoNotice = (file: { size: number }): string | null => {
  if (file.size <= LARGE_VIDEO_BYTES) return null

  const mb = Math.round(file.size / (1024 * 1024))

  return `Large video (${mb} MB) — uploading may take several minutes. Keep this page open.`
}
