import { describe, expect, it } from 'vitest';
import {
  BUMP_EVENT_MIN,
  DOWNHILL,
  MAX_HEADING_OFFSET,
  angleDiff,
  INPUT_MAX,
  SLED_RADIUS,
  SURFACE_DEEP,
  SURFACE_ICE,
  TUNING,
  collideSleds,
  forwardSpeed,
  keepOnTrack,
  rideSled,
  speedOf,
  type GameEvent,
  type PlayerState,
  type Track,
} from '../src';
import { flatTrack, px, sled } from './helpers';

/** Rides one sled `ticks` times on a track with a held input. */
function ride(p: PlayerState, track: Track, ticks: number, input: Partial<Pick<PlayerState, 'steer' | 'throttle'>> = {}): GameEvent[] {
  const events: GameEvent[] = [];
  Object.assign(p, input);
  for (let i = 0; i < ticks; i++) {
    rideSled(p, track, events);
    keepOnTrack(p, track);
  }
  return events;
}

describe('riding', () => {
  it('gravity pulls a standing sled down the slope, faster where it is steep', () => {
    const gentle = sled();
    const steep = sled();
    ride(gentle, flatTrack({ slope: 80 }), 90);
    ride(steep, flatTrack({ slope: 150 }), 90);
    expect(gentle.vy).toBeGreaterThan(0);
    expect(gentle.vx).toBe(0);
    expect(speedOf(steep)).toBeGreaterThan(speedOf(gentle));
  });

  it('never goes past the top speed', () => {
    const p = sled();
    ride(p, flatTrack({ slope: 400, rows: 2000 }), 900);
    expect(speedOf(p)).toBeLessThanOrEqual(TUNING.maxSpeed);
    expect(speedOf(p)).toBeGreaterThan(TUNING.maxSpeed - 100);
  });

  it('steer right goes right, steer left goes left (screen directions)', () => {
    const right = sled({ vy: px(8) });
    const left = sled({ vy: px(8) });
    ride(right, flatTrack(), 20, { steer: INPUT_MAX });
    ride(left, flatTrack(), 20, { steer: -INPUT_MAX });
    expect(right.x).toBeGreaterThan(px(10));
    expect(left.x).toBeLessThan(-px(10));
  });

  it('a tight turn slows the sled down', () => {
    const straight = sled({ vy: px(10) });
    const carving = sled({ vy: px(10) });
    const track = flatTrack({ slope: 0 });
    ride(straight, track, 30);
    // Left and right in turns, so it stays pointed down the slope on average.
    for (let i = 0; i < 6; i++) ride(carving, track, 5, { steer: i % 2 === 0 ? INPUT_MAX : -INPUT_MAX });
    expect(speedOf(carving)).toBeLessThan(speedOf(straight) - px(1));
  });

  it('the heading stays within reach of downhill', () => {
    const p = sled();
    ride(p, flatTrack(), 120, { steer: INPUT_MAX });
    // Pointing ~105° away from downhill at most: it can traverse, never ride back up.
    expect(Math.abs(angleDiff(DOWNHILL, p.heading))).toBeLessThanOrEqual(MAX_HEADING_OFFSET);
  });

  it('kicking only helps while slow', () => {
    const slow = sled();
    const coast = sled();
    const track = flatTrack({ slope: 0 });
    ride(slow, track, 10, { throttle: INPUT_MAX });
    ride(coast, track, 10);
    expect(speedOf(slow)).toBeGreaterThan(speedOf(coast) + px(1));

    const fast = sled({ vy: TUNING.pushMaxSpeed + px(2) });
    const fastCoast = sled({ vy: TUNING.pushMaxSpeed + px(2) });
    ride(fast, track, 10, { throttle: INPUT_MAX });
    ride(fastCoast, track, 10);
    expect(fast.vy).toBe(fastCoast.vy);
  });

  it('braking slows the sled down', () => {
    const brake = sled({ vy: px(12) });
    const coast = sled({ vy: px(12) });
    ride(brake, flatTrack(), 20, { throttle: -INPUT_MAX });
    ride(coast, flatTrack(), 20);
    expect(speedOf(brake)).toBeLessThan(speedOf(coast) - px(3));
  });

  it('ice is slippery and fast, deep snow is slow', () => {
    const all = { y0: 0, y1: px(10000), lo: -1000, hi: 1000 };
    const snow = flatTrack();
    const ice = flatTrack({ patches: [{ kind: SURFACE_ICE, ...all }] });
    const deep = flatTrack({ patches: [{ kind: SURFACE_DEEP, ...all }] });
    const onSnow = sled();
    const onIce = sled();
    const inDeep = sled();
    ride(onSnow, snow, 120);
    ride(onIce, ice, 120);
    ride(inDeep, deep, 120);
    expect(speedOf(onIce)).toBeGreaterThan(speedOf(onSnow));
    expect(speedOf(inDeep)).toBeLessThan(speedOf(onSnow));

    // A sharp turn at speed: on ice the sled keeps sliding the old way (less speed along the heading).
    const turnSnow = sled({ vy: px(10) });
    const turnIce = sled({ vy: px(10) });
    ride(turnSnow, snow, 12, { steer: INPUT_MAX });
    ride(turnIce, ice, 12, { steer: INPUT_MAX });
    const slip = (p: PlayerState) => speedOf(p) - Math.abs(forwardSpeed(p));
    expect(slip(turnIce)).toBeGreaterThan(slip(turnSnow));
  });

  it('the snowbank at the edge keeps the sled on the track and costs speed', () => {
    const track = flatTrack({ half: px(100) });
    const p = sled({ x: px(80), vx: px(6), vy: px(6) });
    ride(p, track, 10);
    expect(p.x).toBeLessThanOrEqual(px(100) - SLED_RADIUS);
    expect(p.vx).toBeLessThanOrEqual(0);
  });
});

describe('sled collisions', () => {
  it('a sled riding into another shoves it and slows down', () => {
    const events: GameEvent[] = [];
    const a = sled({ id: 'a', slot: 0, x: 0, y: px(500), vy: px(10) });
    const b = sled({ id: 'b', slot: 1, x: 0, y: px(500) + 2 * SLED_RADIUS - px(2), vy: px(2) });
    collideSleds(a, b, events);
    expect(b.vy).toBeGreaterThan(px(2));
    expect(a.vy).toBeLessThan(px(10));
    // Momentum is kept (equal masses), give or take truncation.
    expect(Math.abs(a.vy + b.vy - px(12))).toBeLessThanOrEqual(2);
    expect(b.y - a.y).toBeGreaterThanOrEqual(2 * SLED_RADIUS - 1);
    expect(events.some((e) => e.type === 'bump' && e.force >= BUMP_EVENT_MIN)).toBe(true);
  });

  it('a sled in the air does not touch one on the snow', () => {
    const a = sled({ id: 'a', slot: 0, vy: px(10), airTicks: 10 });
    const b = sled({ id: 'b', slot: 1, y: px(1000) + px(5) });
    collideSleds(a, b, []);
    expect(b.vy).toBe(0);
  });
});
