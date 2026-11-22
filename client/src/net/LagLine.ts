// ?lag=120&jitter=30: a simulated slow network for online games. Each direction gets half of
// the added round trip plus up to `jitter` ms at random; order is kept, as on a WebSocket.

export interface NetSimOptions {
  /** Added round trip, ms. */
  lagMs: number;
  /** Extra random delay per message and direction, up to this many ms. */
  jitterMs: number;
}

export const NO_NET_SIM: NetSimOptions = { lagMs: 0, jitterMs: 0 };

export class LagLine<T> {
  private readonly queue: { at: number; item: T }[] = [];

  constructor(private readonly opts: NetSimOptions) {}

  get active(): boolean {
    return this.opts.lagMs > 0 || this.opts.jitterMs > 0;
  }

  push(item: T, now: number): void {
    const delay = this.opts.lagMs / 2 + Math.random() * this.opts.jitterMs;
    const at = Math.max(now + delay, this.queue.at(-1)?.at ?? 0);
    this.queue.push({ at, item });
  }

  /** Everything due by `now`, in order. */
  take(now: number): T[] {
    const due: T[] = [];
    while (this.queue.length > 0 && this.queue[0]!.at <= now) due.push(this.queue.shift()!.item);
    return due;
  }
}
