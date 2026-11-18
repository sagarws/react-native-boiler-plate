/**
 * Every recording on a mirror-enabled desk runs for at least twelve seconds.
 *
 * TrackVid-App (5138857): Flipkart's VMS will not end a clip shorter than about
 * ten seconds of ITS clock, and their clock starts ~1.7 s after ours, so twelve
 * seconds of our clock clears their minimum with margin and the packer always
 * sees the same count. Applied to every order on such a desk, every platform —
 * one rule a packer can follow. Unchanged for desks without the mirror.
 *
 * A scan inside the minimum is REFUSED at the top of the scan handler, before
 * anything is touched, with a countdown message; Stop is disabled with a
 * visible countdown. It fails open: no start time, no refusal.
 */
export const MIN_CLIP_MS = 12_000

/** Milliseconds left before this order may end. Zero when it may end now. */
export const minimumRemainingMs = (applies: boolean, startedAt: number | null, now: number): number => {
  if (!applies || startedAt === null) return 0
  return Math.max(0, MIN_CLIP_MS - (now - startedAt))
}

export const remainingSeconds = (ms: number): number => Math.ceil(ms / 1000)

export const scanRefusedMessage = (secs: number): string =>
  `Scan skipped — wait ${secs} more second${secs === 1 ? '' : 's'}, then scan again`

/** The log line for a refused scan: names the refused barcode and the order that blocked it. */
export const scanRefusedLogLine = (refused: string, recordingAwb: string, secs: number): string =>
  `[${refused || 'unknown AWB'}] Scan refused — ${recordingAwb || 'another order'} ` +
  `is still recording (${secs}s left of its 12-second minimum).`

export const stopHoldHint = (secs: number): string =>
  `Every recording runs for at least 12 seconds. Stop becomes available in ${secs}s.`
