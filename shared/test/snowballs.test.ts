import { describe, expect, it } from 'vitest';
import {
  BALL_SLOTS,
  BALL_TICKS,
  DOWNHILL,
  MAX_SNOWBALLS,
  OBSTACLE_TREE,
  PILE_RESPAWN_TICKS,
  SPLAT_TICKS,
  TREE_RADIUS,
  TUNING,
  clearBalls,
  createGameState,
  pickUpSnow,
  resetPiles,
  speedOf,
  throwSnowball,
  tickPiles,
  updateBalls,
  type GameEvent,
  type GameState,
  type PlayerState,
  type Track,
} from '../src';
import { flatTrack, px, sled } from './helpers';

function world(track: Track): GameState {
  const state = createGameState({ code: 'SB', seed: 1 });
  clearBalls(state);
  resetPiles(state, track);
  return state;
}

/** One tick of snowball handling for these sleds (slot order), sleds standing still. */
function tick(state: GameState, track: Track, sleds: PlayerState[], events: GameEvent[]): void {
  tickPiles(state);
  for (const p of sleds) throwSnowball(state, p, events);
  for (const p of sleds) pickUpSnow(state, track, p, events);
  updateBalls(state, track, sleds, events);
}

describe('piles', () => {
  it('riding over piles gives snowballs, at most three, and a taken pile comes back later', () => {
    const piles = [0, 1, 2, 3].map((i) => ({ x: 0, y: px(1000 + i * 5) }));
    const track = flatTrack({ piles });
    const state = world(track);
    const p = sled({ y: px(1005) });
    const events: GameEvent[] = [];
    pickUpSnow(state, track, p, events);
    expect(p.snowballs).toBe(MAX_SNOWBALLS);
    expect(p.pickups).toBe(MAX_SNOWBALLS);
    expect(events.filter((e) => e.type === 'pickup')).toHaveLength(MAX_SNOWBALLS);
    expect(state.pileTimers.filter((t) => t === 0)).toHaveLength(1);
    for (let i = 0; i < PILE_RESPAWN_TICKS; i++) tickPiles(state);
    expect(state.pileTimers.every((t) => t === 0)).toBe(true);
  });

  it('a sled in the air does not pick anything up', () => {
    const track = flatTrack({ piles: [{ x: 0, y: px(1000) }] });
    const state = world(track);
    const p = sled({ airTicks: 5 });
    pickUpSnow(state, track, p, []);
    expect(p.snowballs).toBe(0);
  });
});

describe('throwing', () => {
  it('a throw sends one snowball forward and hits the sled ahead, which loses speed', () => {
    const track = flatTrack();
    const state = world(track);
    const me = sled({ id: 'me', slot: 0, snowballs: 2, heading: DOWNHILL, firePressed: true });
    const foe = sled({ id: 'foe', slot: 1, y: px(1080), vy: px(3) });
    const events: GameEvent[] = [];
    tick(state, track, [me, foe], events);
    expect(me.snowballs).toBe(1);
    expect(events.filter((e) => e.type === 'throw')).toHaveLength(1);
    expect(state.ballVy[0]).toBe(TUNING.ballSpeed);
    for (let i = 0; i < BALL_TICKS && !events.some((e) => e.type === 'splat'); i++) {
      foe.y += foe.vy; // the target keeps riding
      tick(state, track, [me, foe], events);
    }
    const splat = events.find((e) => e.type === 'splat');
    expect(splat).toMatchObject({ playerId: 'foe', byId: 'me' });
    expect(speedOf(foe)).toBe(Math.trunc((px(3) * TUNING.ballHitKeepPct) / 100));
    expect(foe.splatTicks).toBe(SPLAT_TICKS);
    expect(me.hits).toBe(1);
    expect(state.ballTicks.every((t) => t === 0)).toBe(true);
  });

  it('no snowball, no throw; a press is not kept for later', () => {
    const track = flatTrack();
    const state = world(track);
    const me = sled({ firePressed: true });
    const events: GameEvent[] = [];
    tick(state, track, [me], events);
    expect(events).toEqual([]);
    expect(me.firePressed).toBe(false);
  });

  it('the thrower is never hit by its own snowball, one in the air is not either', () => {
    const track = flatTrack();
    const state = world(track);
    const me = sled({ id: 'me', slot: 0, snowballs: 1, firePressed: true, vy: px(20) });
    const flying = sled({ id: 'f', slot: 1, y: px(1040), airTicks: 30 });
    const events: GameEvent[] = [];
    for (let i = 0; i < 10; i++) {
      me.y += me.vy;
      tick(state, track, [me, flying], events);
    }
    expect(events.some((e) => e.type === 'splat' && e.playerId)).toBe(false);
  });

  it('a snowball breaks on a tree', () => {
    const track = flatTrack({ obstacles: [{ kind: OBSTACLE_TREE, x: 0, y: px(1080), r: TREE_RADIUS }] });
    const state = world(track);
    const me = sled({ snowballs: 1, firePressed: true });
    const events: GameEvent[] = [];
    for (let i = 0; i < 10; i++) tick(state, track, [me], events);
    expect(events.find((e) => e.type === 'splat')).toMatchObject({ playerId: '', byId: '' });
  });

  it(`at most ${BALL_SLOTS} snowballs fly at once; the thrower keeps one it could not throw`, () => {
    const track = flatTrack({ rows: 600 });
    const state = world(track);
    const sleds = Array.from({ length: BALL_SLOTS + 1 }, (_, i) => sled({ id: `s${i}`, slot: i, x: px(-180 + i * 40), snowballs: 1, firePressed: true }));
    tick(state, track, sleds, []);
    expect(state.ballTicks.filter((t) => t > 0)).toHaveLength(BALL_SLOTS);
    expect(sleds.at(-1)!.snowballs).toBe(1);
  });
});
