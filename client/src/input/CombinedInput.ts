import { NO_INPUT, type InputSource, type RideInput } from './InputSource';

/** Several devices at once (a tablet with a keyboard): the first one in use steers, any of them can throw or use a power-up. */
export class CombinedInput implements InputSource {
  constructor(private readonly sources: InputSource[]) {}

  poll(): RideInput {
    let ride: RideInput | null = null;
    let fire = false;
    let use = false;
    for (const source of this.sources) {
      const input = source.poll();
      if (!input) continue;
      fire ||= input.fire;
      use ||= input.use;
      ride ??= input;
    }
    return { ...(ride ?? NO_INPUT), fire, use };
  }

  releaseAll(): void {
    for (const source of this.sources) source.releaseAll();
  }

  destroy(): void {
    for (const source of this.sources) source.destroy();
  }
}
