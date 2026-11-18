/** "Wed, 18 Nov · 9:30 am" in the device locale. */
export function formatWhen(at: number): string {
  const d = new Date(at);
  const day = d.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

/** "in 3 d 4 h", "in 2 h 5 m", "in 12 m", "now". */
export function formatIn(ms: number): { d: number; h: number; m: number } {
  const mins = Math.max(0, Math.ceil(ms / 60_000));
  return {
    d: Math.floor(mins / 1440),
    h: Math.floor((mins % 1440) / 60),
    m: mins % 60,
  };
}
