import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_TICKS,
  FINISH_GRACE_TICKS,
  POINTS_BY_PLACE,
  RESULTS_TICKS,
  TRACK_LUPULUI,
  TRACK_RANDOM,
  addPlayer,
  centerAt,
  computeStandings,
  lateFinishPoints,
  countdownSeconds,
  createGameState,
  currentTrack,
  fixedTrackSeed,
  lastCallSeconds,
  runTick,
  setTrack,
  startMatch,
  ticksToMs,
  type GameEvent,
} from '../src';
import { makeRace, px, run } from './helpers';

describe('countdown', () => {
  it('3, 2, 1, HAI!: nobody moves before it, the held input carries over', () => {
    const state = createGameState({ code: 'C', seed: 1 });
    addPlayer(state, 'a', 'A');
    addPlayer(state, 'b', 'B');
    startMatch(state, 'a');
    const start = { ...state.players.a! };
    expect(countdownSeconds(state.roundTick)).toBe(3);
    const events: GameEvent[] = [];
    for (let i = 0; i < COUNTDOWN_TICKS; i++) events.push(...runTick(state, [{ playerId: 'a', seq: i + 1, steer: 0, throttle: 100, fire: true }]));
    expect(state.players.a!.y).toBe(start.y);
    expect(state.players.a!.throttle).toBe(100);
    expect(state.players.a!.firePressed).toBe(false);
    expect(events.some((e) => e.type === 'go')).toBe(false);
    const go = runTick(state, []);
    expect(go).toContainEqual({ type: 'go', round: 1 });
    expect(state.players.a!.y).toBeGreaterThan(start.y);
  });

  it('sleds line up side by side above the start line, in a seeded order', () => {
    const state = createGameState({ code: 'C', seed: 'order' });
    for (const id of ['a', 'b', 'c', 'd']) addPlayer(state, id, id);
    startMatch(state, 'a');
    const track = currentTrack(state);
    const xs = Object.values(state.players).map((p) => p.x);
    expect(new Set(xs).size).toBe(4);
    for (const p of Object.values(state.players)) expect(p.y).toBeLessThan(track.startY);
  });
});

describe('finishing', () => {
  it('those still on the way get half the points of their place, rounded down, at least 1', () => {
    expect([1, 2, 3, 4, 5, 6].map(lateFinishPoints)).toEqual([5, 3, 2, 1, 1, 1]);
  });

  it('the ones not down in time are placed by distance and scored half', () => {
    const state = makeRace([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
    const track = currentTrack(state);
    const c = centerAt(track, track.finishY);
    Object.assign(state.players.a!, { x: c, y: track.finishY - px(2), vy: px(10) });
    Object.assign(state.players.b!, { x: c - px(60), y: track.startY + px(900) });
    Object.assign(state.players.c!, { x: c + px(60), y: track.startY + px(3000) });
    Object.assign(state.players.d!, { x: c, y: track.startY });
    // The others brake all the way, so they are still far up when the 15 s are over.
    const brake = { throttle: -100 };
    const events = run(state, FINISH_GRACE_TICKS + 2, { b: brake, c: brake, d: brake });
    expect(events.find((e) => e.type === 'roundEnd')).toEqual({ type: 'roundEnd', round: 1, order: ['a', 'c', 'b', 'd'] });
    expect(['a', 'c', 'b', 'd'].map((id) => state.players[id]!.points)).toEqual([10, 3, 2, 1]);
  });

  it('places score 10/7/5/3/2/1; the others get 15 s after the first, then the run ends', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].slice(0, 6);
    const state = makeRace(ids.map((id) => ({ id })));
    const track = currentTrack(state);
    // Five sleds right above the line (a ahead), f far up the track.
    ids.slice(0, 5).forEach((id, i) => Object.assign(state.players[id]!, { y: track.finishY - px(5 + 30 * i), vy: px(10), x: centerAt(track, track.finishY) + px(-100 + 45 * i) }));
    state.players.f!.y = track.startY;
    const events = run(state, 20);
    const finishes = events.filter((e) => e.type === 'finish');
    expect(finishes.map((e) => e.type === 'finish' && e.playerId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(ids.slice(0, 5).map((id) => state.players[id]!.points)).toEqual(POINTS_BY_PLACE.slice(0, 5));
    expect(state.players.a!.wins).toBe(1);
    expect(events.filter((e) => e.type === 'lastCall')).toHaveLength(1);
    expect(lastCallSeconds(state)).toBeLessThanOrEqual(15);
    expect(state.phase).toBe('playing');

    const rest = run(state, FINISH_GRACE_TICKS);
    const end = rest.find((e) => e.type === 'roundEnd');
    expect(end).toEqual({ type: 'roundEnd', round: 1, order: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(state.players.f!.finished).toBe(false);
    expect(state.players.f!.place).toBe(6);
    expect(state.players.f!.points).toBe(1); // half of 1, at least 1
    expect(state.phase).toBe('results');
    expect(state.players.a!.bestTicks).toBe(state.players.a!.finishTicks);
    expect(ticksToMs(30)).toBe(1000);
  });

  it('when everyone is down the run ends at once, and after the results the next run starts', () => {
    const state = makeRace([{ id: 'a' }, { id: 'b' }]);
    const track = currentTrack(state);
    state.players.a!.y = track.finishY - px(2);
    state.players.b!.y = track.finishY - px(1);
    Object.assign(state.players.a!, { vy: px(10) });
    Object.assign(state.players.b!, { vy: px(10), x: state.players.b!.x });
    const events = run(state, 2);
    expect(events.find((e) => e.type === 'roundEnd')).toEqual({ type: 'roundEnd', round: 1, order: ['b', 'a'] });
    expect(events.some((e) => e.type === 'lastCall')).toBe(false);
    const next = run(state, RESULTS_TICKS);
    expect(next).toContainEqual({ type: 'roundStart', round: 2 });
    expect(state.phase).toBe('playing');
    expect(Object.values(state.players).every((p) => !p.finished && p.y < currentTrack(state).startY)).toBe(true);
  });

  it('a match of 3 runs ends with the standings by points', () => {
    const state = makeRace([{ id: 'a' }, { id: 'b' }], { rounds: 3 });
    let matchEnd: GameEvent | undefined;
    for (let round = 1; round <= 3; round++) {
      const track = currentTrack(state);
      // b wins the first two, a the last.
      const winner = round < 3 ? 'b' : 'a';
      const loser = winner === 'a' ? 'b' : 'a';
      state.players[winner]!.y = track.finishY - px(1);
      state.players[winner]!.vy = px(10);
      state.players[loser]!.y = track.finishY - px(60);
      state.players[loser]!.vy = px(10);
      const events = run(state, 30);
      matchEnd = events.find((e) => e.type === 'matchEnd');
      if (round < 3) run(state, RESULTS_TICKS + COUNTDOWN_TICKS);
    }
    expect(state.phase).toBe('finished');
    expect(state.players.b!.points).toBe(10 + 10 + 7);
    expect(state.players.a!.points).toBe(7 + 7 + 10);
    expect(matchEnd).toEqual({ type: 'matchEnd', standings: ['b', 'a'] });
    expect(computeStandings(state)).toEqual(['b', 'a']);
  });
});

describe('tracks per run', () => {
  it('a fixed track is the same every run; the random one changes', () => {
    const fixedState = makeRace([{ id: 'a' }, { id: 'b' }], { trackId: TRACK_LUPULUI });
    expect(fixedState.trackSeed).toBe(fixedTrackSeed(TRACK_LUPULUI));

    const state = createGameState({ code: 'R', seed: 'random' });
    addPlayer(state, 'a', 'A');
    addPlayer(state, 'b', 'B');
    expect(setTrack(state, 'a', TRACK_RANDOM)).toBe(true);
    expect(setTrack(state, 'b', 0)).toBe(false); // host only
    expect(setTrack(state, 'a', 9)).toBe(false);
    startMatch(state, 'a');
    const first = state.trackSeed;
    const track = currentTrack(state);
    state.roundTick = COUNTDOWN_TICKS;
    for (const p of Object.values(state.players)) Object.assign(p, { y: track.finishY - px(1), vy: px(5) });
    run(state, 2 + RESULTS_TICKS);
    expect(state.round).toBe(2);
    expect(state.trackSeed).not.toBe(first);
  });
});
