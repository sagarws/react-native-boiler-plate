/**
 * Fixed-window rate limiter per key (an IP, or an IP + link). Old windows are
 * swept so memory stays bounded however many addresses show up.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** true = allowed (and counted). */
  take(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) {
      if (this.hits.size > 50_000) this.sweep(now);
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (h.count >= this.limit) return false;
    h.count += 1;
    return true;
  }

  /** Seconds until `key` may try again. */
  retryAfter(key: string, now = Date.now()): number {
    const h = this.hits.get(key);
    return h ? Math.max(1, Math.ceil((h.resetAt - now) / 1000)) : 1;
  }

  sweep(now = Date.now()): void {
    for (const [k, h] of this.hits) if (h.resetAt <= now) this.hits.delete(k);
  }
}
