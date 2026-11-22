// Small in-memory counters for the per-IP limits (one Node process, so no shared store is needed).
// Every map is bounded: a flood of new addresses evicts old entries instead of growing memory.

export interface Rate {
  /** Requests allowed at once. */
  burst: number;
  /** Refill speed once the burst is spent. */
  perMinute: number;
}

/** Keys tracked per limiter before the oldest are evicted. */
const MAX_KEYS = 10_000;

/** Token bucket per key: `burst` tokens, refilled at `perMinute`. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    readonly rate: Rate,
    private readonly maxKeys = MAX_KEYS,
  ) {}

  /** Takes a token; false when the key has none left. */
  take(key: string, now = Date.now()): boolean {
    const bucket = this.bucket(key, now);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** Whether the key has a token left, without taking it. */
  has(key: string, now = Date.now()): boolean {
    return this.bucket(key, now).tokens >= 1;
  }

  /** Whole seconds until the key has a token again (for Retry-After). */
  retryAfter(key: string, now = Date.now()): number {
    const missing = 1 - this.bucket(key, now).tokens;
    return missing <= 0 ? 0 : Math.ceil((missing * 60) / this.rate.perMinute);
  }

  private bucket(key: string, now: number): { tokens: number; at: number } {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) this.evict(now);
      bucket = { tokens: this.rate.burst, at: now };
      this.buckets.set(key, bucket);
      return bucket;
    }
    const refill = ((now - bucket.at) * this.rate.perMinute) / 60_000;
    bucket.tokens = Math.min(this.rate.burst, bucket.tokens + refill);
    bucket.at = now;
    return bucket;
  }

  /** Drops the buckets that are full again (forgetting them changes nothing), else the oldest. */
  private evict(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.tokens + ((now - bucket.at) * this.rate.perMinute) / 60_000 >= this.rate.burst) this.buckets.delete(key);
    }
    if (this.buckets.size >= this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
  }
}

/** Things currently open per key (WebSocket connections). */
export class Counts {
  private readonly counts = new Map<string, number>();

  get(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  add(key: string): void {
    this.counts.set(key, this.get(key) + 1);
  }

  remove(key: string): void {
    const n = this.get(key) - 1;
    if (n > 0) this.counts.set(key, n);
    else this.counts.delete(key);
  }
}

/** At most `limit` uses per key per UTC day (leaderboard saves). Forgotten on restart. */
export class DailyQuota {
  private day = '';
  private readonly used = new Map<string, number>();

  constructor(readonly limit: number) {}

  has(key: string, now = new Date()): boolean {
    this.roll(now);
    return (this.used.get(key) ?? 0) < this.limit;
  }

  use(key: string, now = new Date()): void {
    this.roll(now);
    this.used.set(key, (this.used.get(key) ?? 0) + 1);
  }

  private roll(now: Date): void {
    const day = now.toISOString().slice(0, 10);
    if (day === this.day) return;
    this.day = day;
    this.used.clear();
  }
}
