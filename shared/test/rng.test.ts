import { describe, expect, it } from 'vitest';
import { nextInt, seedFrom } from '../src';

describe('rng', () => {
  it('same seed gives the same sequence', () => {
    const a = { rng: seedFrom('Pârtia Bunicii') };
    const b = { rng: seedFrom('Pârtia Bunicii') };
    const seqA = Array.from({ length: 20 }, () => nextInt(a, 1000));
    const seqB = Array.from({ length: 20 }, () => nextInt(b, 1000));
    expect(seqA).toEqual(seqB);
    expect(a.rng).toBe(b.rng);
  });
});
