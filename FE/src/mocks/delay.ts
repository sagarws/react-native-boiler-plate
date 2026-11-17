/** Small fake network delay so loading states are visible (mock layer only). */
export function delay(ms = 350): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Deep copy so screens never mutate the mock "database" directly. */
export function clone<T>(value: T): T {
  return structuredClone(value);
}

let counter = 1000;
/** Mongo-like 24-hex id for new mock records. */
export function newId(): string {
  counter += 1;
  return (Date.now().toString(16) + counter.toString(16)).padEnd(24, "0").slice(0, 24);
}

/** Simple paging helper for mock list endpoints. */
export function paginate<T>(rows: T[], page: number, limit: number): { data: T[]; total: number; page: number; limit: number } {
  const start = Math.max(0, (page - 1) * limit);
  return { data: rows.slice(start, start + limit), total: rows.length, page, limit };
}

/** ISO date `days` ago (negative = future), for building sample data. */
export function daysAgo(days: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, (days * 7) % 60, 0, 0);
  return d.toISOString();
}

/** Deterministic pseudo random generator for repeatable sample data. */
export function seeded(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
