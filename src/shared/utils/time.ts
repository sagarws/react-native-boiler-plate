/** Seconds → `M:SS`, or `H:MM:SS` once past an hour. */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Epoch ms → `YYYY-MM-DD HH:mm:ss` in device-local time.
 *
 * Fixed-width and free of locale formatting, so it reads identically on
 * every device — use it for logs and anything a human compares across devices.
 */
export function formatTimestamp(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * Seconds → `HH:MM:SS`, always fixed-width.
 *
 * Never collapses the hour field, so a running timer's digits don't shift
 * position as it ticks past an hour.
 */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(safe / 3600))}:${pad(
    Math.floor((safe % 3600) / 60),
  )}:${pad(safe % 60)}`;
}
