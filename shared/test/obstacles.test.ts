import { describe, expect, it } from 'vitest';
import {
  GRACE_TICKS,
  INPUT_MAX,
  JUMP_MIN_SPEED,
  OBSTACLE_ROCK,
  OBSTACLE_TREE,
  ROCK_RADIUS,
  SLED_RADIUS,
  TREE_RADIUS,
  TUNING,
  hitObstacles,
  keepOnTrack,
  rideSled,
  speedOf,
  tryJump,
  type GameEvent,
  type PlayerState,
  type Track,
} from '../src';
import { flatTrack, px, sled } from './helpers';

/** The sim's order for one sled: ride, then obstacles, ramps and the snowbank. */
function tick(p: PlayerState, track: Track, events: GameEvent[]): void {
  rideSled(p, track, events);
  if (p.airTicks === 0) {
    hitObstacles(p, track, events);
    tryJump(p, track, events);
  }
  keepOnTrack(p, track);
}

function ride(p: PlayerState, track: Track, ticks: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) tick(p, track, events);
  return events;
}

const tree = (y: number, x = 0) => ({ kind: OBSTACLE_TREE, x, y, r: TREE_RADIUS });

describe('trees and rocks', () => {
  it('riding into a tree overturns the sled for about a second', () => {
    const track = flatTrack({ obstacles: [tree(px(1100))] });
    const p = sled({ vy: px(10) });
    const events = ride(p, track, 15);
    expect(events.filter((e) => e.type === 'crash')).toHaveLength(1);
    expect(p.crashes).toBe(1);
    expect(p.crashTicks).toBeGreaterThan(0);
    // Pushed out of the tree, not through it.
    expect(p.y).toBeLessThan(px(1100));
    // Overturned: steering does nothing.
    const heading = p.heading;
    p.steer = INPUT_MAX;
    ride(p, track, 3);
    expect(p.heading).toBe(heading);
    // Back up within ~1 s, pointing down the slope, briefly unable to overturn again.
    ride(p, track, TUNING.crashTicks);
    expect(p.crashTicks).toBe(0);
    expect(p.graceTicks).toBeGreaterThan(0);
    expect(p.graceTicks).toBeLessThanOrEqual(GRACE_TICKS);
  });

  it('brushing past slowly only slides along it', () => {
    const track = flatTrack({ obstacles: [{ kind: OBSTACLE_ROCK, x: 0, y: px(1030), r: ROCK_RADIUS }], slope: 0 });
    const p = sled({ x: px(10), vy: TUNING.crashMinSpeed - 200 });
    const events = ride(p, track, 20);
    expect(events.some((e) => e.type === 'crash')).toBe(false);
    expect(p.crashTicks).toBe(0);
  });

  it('just after getting up, the next tree only pushes the sled aside', () => {
    const track = flatTrack({ obstacles: [tree(px(1040))] });
    const p = sled({ vy: px(10), graceTicks: GRACE_TICKS });
    const events = ride(p, track, 6);
    expect(events.some((e) => e.type === 'crash')).toBe(false);
  });
});

describe('ramps', () => {
  const ramp = { x0: -px(40), x1: px(40), y0: px(1050), y1: px(1072) };

  it('a fast sled takes off, flies over a tree behind the ramp and lands with a boost', () => {
    const track = flatTrack({ ramps: [ramp], obstacles: [tree(px(1150))], slope: 0 });
    const p = sled({ vy: px(12) });
    const events: GameEvent[] = [];
    let air = 0;
    let steeredInAir = false;
    let landSpeedBefore = 0;
    for (let i = 0; i < 80; i++) {
      if (p.airTicks > 0) {
        air++;
        const h = p.heading;
        p.steer = INPUT_MAX;
        if (p.airTicks === 1) landSpeedBefore = speedOf(p);
        tick(p, track, events);
        if (p.airTicks > 0 && p.heading !== h) steeredInAir = true;
        p.steer = 0;
      } else {
        tick(p, track, events);
      }
      if (events.some((e) => e.type === 'land')) break;
    }
    expect(events.filter((e) => e.type === 'jump')).toHaveLength(1);
    expect(air).toBeGreaterThan(10);
    expect(steeredInAir).toBe(false);
    expect(events.some((e) => e.type === 'crash')).toBe(false);
    expect(p.y).toBeGreaterThan(px(1150) + TREE_RADIUS + SLED_RADIUS);
    expect(speedOf(p)).toBeGreaterThan(landSpeedBefore);
    expect(p.jumps).toBe(1);
  });

  it('a slow sled just rolls over the ramp', () => {
    const track = flatTrack({ ramps: [ramp], slope: 0 });
    const p = sled({ vy: JUMP_MIN_SPEED - 200 });
    const events = ride(p, track, 20);
    expect(events.some((e) => e.type === 'jump')).toBe(false);
    expect(p.airTicks).toBe(0);
  });
});
