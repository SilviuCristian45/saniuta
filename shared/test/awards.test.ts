import { describe, expect, it } from 'vitest';
import { computeAwards } from '../src';
import { makeRace } from './helpers';

describe('awards', () => {
  it('names the best at each stat, skips ties and zeros', () => {
    const state = makeRace([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    Object.assign(state.players.a!, { bestTicks: 1900, crashes: 4, hits: 2, jumps: 3 });
    Object.assign(state.players.b!, { bestTicks: 2100, crashes: 0, hits: 2, jumps: 1 });
    Object.assign(state.players.c!, { bestTicks: 0, crashes: 1, hits: 0, jumps: 3 });
    const awards = Object.fromEntries(computeAwards(state).map((a) => [a.id, a.playerIds]));
    expect(awards.fulgerul).toEqual(['a']);
    expect(awards.padurarul).toEqual(['a']);
    expect(awards.lunetistul).toEqual(['a', 'b']);
    expect(awards.cascadorul).toEqual(['a', 'c']);
    expect(awards.neclintitul).toEqual(['b']);
    expect(awards.strangatorul).toBeUndefined(); // nobody picked anything up
  });
});
