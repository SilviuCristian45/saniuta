import { describe, expect, it } from 'vitest';
import { computeAwards, runTick, SPLAT_TICKS, startMatch } from '../src';
import { makeRace, run } from './helpers';

const byId = (state: Parameters<typeof computeAwards>[0]) => Object.fromEntries(computeAwards(state).map((a) => [a.id, a.playerIds]));

describe('awards', () => {
  it('names the best at each stat, skips ties of everyone and zeros', () => {
    const state = makeRace([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    Object.assign(state.players.a!, { topSpeed: 4000, crashes: 4, hits: 2, hitsTaken: 0, airTime: 90 });
    Object.assign(state.players.b!, { topSpeed: 3500, crashes: 0, hits: 2, hitsTaken: 3, airTime: 20 });
    Object.assign(state.players.c!, { topSpeed: 3900, crashes: 1, hits: 0, hitsTaken: 3, airTime: 90 });
    const awards = byId(state);
    expect(awards.fulgerul).toEqual(['a']);
    expect(awards.omDeZapada).toEqual(['a']);
    expect(awards.lunetistul).toEqual(['a', 'b']);
    expect(awards.tinta).toEqual(['b', 'c']);
    expect(awards.cascadorul).toEqual(['a', 'c']);
    expect(awards.sanieDeOtel).toEqual(['b']);
  });

  it('gives no "most" award that everyone ties for, and "Sanie de oțel" only without a single crash', () => {
    const state = makeRace([{ id: 'a' }, { id: 'b' }]);
    Object.assign(state.players.a!, { hits: 1, crashes: 2 });
    Object.assign(state.players.b!, { hits: 1, crashes: 1, left: true });
    const awards = byId(state);
    expect(awards.lunetistul).toBeUndefined();
    expect(awards.tinta).toBeUndefined();
    expect(awards.sanieDeOtel).toBeUndefined();
    expect(awards.omDeZapada).toEqual(['a']);
  });

  it('the simulation keeps the statistics: top speed, time in the air, snowball hits taken', () => {
    const state = makeRace([{ id: 'a' }, { id: 'b' }]);
    const a = state.players.a!;
    a.vy = 2000;
    a.airTicks = 10;
    a.airTotal = 10;
    run(state, 12);
    expect(a.topSpeed).toBeGreaterThanOrEqual(2000);
    expect(a.airTime).toBe(10);
    // A snowball hit counts for the victim (the thrower's `hits` has its own tests).
    const b = state.players.b!;
    const before = b.hitsTaken;
    const { ballX, ballY, ballVx, ballVy, ballTicks, ballOwner } = state;
    ballX[0] = b.x;
    ballY[0] = b.y;
    ballVx[0] = 0;
    ballVy[0] = 0;
    ballTicks[0] = 5;
    ballOwner[0] = a.slot;
    runTick(state, []);
    expect(b.hitsTaken).toBe(before + 1);
    expect(b.splatTicks).toBeGreaterThan(SPLAT_TICKS - 2);
  });

  it('a new match starts the statistics over', () => {
    const state = makeRace([{ id: 'a' }, { id: 'b' }]);
    Object.assign(state.players.a!, { topSpeed: 4000, airTime: 50, hitsTaken: 2 });
    state.phase = 'lobby';
    startMatch(state, 'a');
    expect(state.players.a).toMatchObject({ topSpeed: 0, airTime: 0, hitsTaken: 0 });
  });
});
