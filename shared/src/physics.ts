import {
  AIR_DRAG,
  AIR_MAX_TICKS,
  AIR_MIN_TICKS,
  BUMP_EVENT_MIN,
  CRASH_BOUNCE,
  CRASH_FRICTION,
  DOWNHILL,
  EDGE_BOUNCE,
  EDGE_LOSS,
  FINISHED_FRICTION,
  GRACE_TICKS,
  INPUT_MAX,
  JUMP_MIN_SPEED,
  MAX_HEADING_OFFSET,
  SLED_MASS,
  SLED_RADIUS,
  SURFACE_DEEP,
  SURFACE_ICE,
} from './constants';
import { angleDiff, clamp, icos, idiv, isin, isqrt, TRIG_ONE, wrapAngle } from './fixed';
import { centerAt, halfWidthAt, nearby, slopeAt, surfaceAt, type Track } from './track';
import { TUNING } from './tuning';
import type { GameEvent, PlayerState } from './types';

// Sled physics in integers: a sled is a disc with a heading. Gravity pulls down the slope, the
// surface decides how much forward speed is lost (friction) and how much sideways sliding is
// killed (grip). Everything is truncated toward zero with idiv, never with bitwise operators.

export function speedOf(p: Readonly<PlayerState>): number {
  return isqrt(p.vx * p.vx + p.vy * p.vy);
}

/** Speed along the heading (negative when sliding backwards). */
export function forwardSpeed(p: Readonly<PlayerState>): number {
  return idiv(p.vx * icos(p.heading) + p.vy * isin(p.heading), TRIG_ONE);
}

/** On the snow: not in the air. */
export function grounded(p: Readonly<PlayerState>): boolean {
  return p.airTicks === 0;
}

/** Moves `v` toward zero by per-mille `k`, at least by 1, never past zero. */
function decay(v: number, k: number): number {
  if (v === 0 || k <= 0) return v;
  const d = Math.max(Math.abs(idiv(v * k, 1000)), 1);
  return v > 0 ? Math.max(v - d, 0) : Math.min(v + d, 0);
}

function frictionOf(surface: number): number {
  return surface === SURFACE_ICE ? TUNING.frictionIce : surface === SURFACE_DEEP ? TUNING.frictionDeep : TUNING.frictionSnow;
}

function gripOf(surface: number): number {
  return surface === SURFACE_ICE ? TUNING.gripIce : surface === SURFACE_DEEP ? TUNING.gripDeep : TUNING.gripSnow;
}

/** Scales the velocity down to `max` at once. */
function capSpeed(p: PlayerState, max: number): void {
  const sp = speedOf(p);
  if (sp <= max) return;
  p.vx = idiv(p.vx * max, sp);
  p.vy = idiv(p.vy * max, sp);
}

function move(p: PlayerState): void {
  p.x += p.vx;
  p.y += p.vy;
}

/**
 * One tick for a sled still racing: overturned, in the air, or riding (steering, gravity, kick,
 * brake, friction and grip), then the move. Collisions come after, in the sim.
 */
export function rideSled(p: PlayerState, track: Track, events: GameEvent[]): void {
  if (p.splatTicks > 0) p.splatTicks--;
  if (p.crashTicks > 0) {
    p.vx = decay(p.vx, CRASH_FRICTION);
    p.vy = decay(p.vy, CRASH_FRICTION);
    move(p);
    p.crashTicks--;
    if (p.crashTicks === 0) {
      // Back on the sled, pointing down the slope again.
      p.graceTicks = GRACE_TICKS;
      p.heading = DOWNHILL;
    }
    return;
  }
  if (p.graceTicks > 0) p.graceTicks--;

  if (p.airTicks > 0) {
    // No steering and no friction in the air, only a little drag.
    p.vx = decay(p.vx, AIR_DRAG);
    p.vy = decay(p.vy, AIR_DRAG);
    move(p);
    p.airTicks--;
    p.airTime++;
    if (p.airTicks === 0) {
      p.airTotal = 0;
      p.vx += idiv(TUNING.landBoost * icos(p.heading), TRIG_ONE);
      p.vy += idiv(TUNING.landBoost * isin(p.heading), TRIG_ONE);
      capSpeed(p, TUNING.maxSpeed);
      events.push({ type: 'land', playerId: p.id });
    }
    return;
  }

  // Steering, within MAX_HEADING_OFFSET of straight downhill. Steer > 0 turns toward +x (the
  // screen's right): with y down the screen, that lowers the heading.
  const offset = clamp(angleDiff(DOWNHILL, p.heading - idiv(p.steer * TUNING.turnRate, INPUT_MAX)), -MAX_HEADING_OFFSET, MAX_HEADING_OFFSET);
  p.heading = wrapAngle(DOWNHILL + offset);

  // Gravity pulls straight down the slope, harder where it is steep.
  p.vy += idiv(TUNING.gravity * slopeAt(track, p.y), 100);

  const cos = icos(p.heading);
  const sin = isin(p.heading);
  let fwd = idiv(p.vx * cos + p.vy * sin, TRIG_ONE);
  let side = idiv(-p.vx * sin + p.vy * cos, TRIG_ONE);

  // "Sus": kicking with the feet only helps while slow (and not with snow in the face).
  if (p.throttle > 0 && p.splatTicks === 0 && fwd < TUNING.pushMaxSpeed) {
    fwd = Math.min(fwd + idiv(p.throttle * TUNING.pushAccel, INPUT_MAX), Math.max(fwd, TUNING.pushMaxSpeed));
  }
  const surface = surfaceAt(track, p.x, p.y);
  const brake = p.throttle < 0 ? idiv(-p.throttle * TUNING.brake, INPUT_MAX) : 0;
  const turnDrag = idiv(Math.abs(p.steer) * TUNING.turnDrag, INPUT_MAX);
  fwd = decay(fwd, frictionOf(surface) + turnDrag + brake);
  side = decay(side, gripOf(surface) + brake);

  p.vx = idiv(fwd * cos - side * sin, TRIG_ONE);
  p.vy = idiv(fwd * sin + side * cos, TRIG_ONE);
  capSpeed(p, TUNING.maxSpeed);
  move(p);
}

/** A sled past the finish line: it coasts to a stop in the run-out, nothing else. */
export function rideFinished(p: PlayerState): void {
  p.airTicks = 0;
  p.airTotal = 0;
  p.crashTicks = 0;
  if (p.splatTicks > 0) p.splatTicks--;
  p.vx = decay(p.vx, FINISHED_FRICTION);
  p.vy = decay(p.vy, FINISHED_FRICTION);
  move(p);
}

/** The snowbanks along both edges (and the top and the end of the track) keep sleds on it. */
export function keepOnTrack(p: PlayerState, track: Track): void {
  const c = centerAt(track, p.y);
  const reach = halfWidthAt(track, p.y) - SLED_RADIUS;
  const dx = p.x - c;
  if (dx > reach || dx < -reach) {
    p.x = c + (dx > 0 ? reach : -reach);
    if ((dx > 0 && p.vx > 0) || (dx < 0 && p.vx < 0)) p.vx = -idiv(p.vx * EDGE_BOUNCE, 100);
    p.vx = idiv(p.vx * (100 - EDGE_LOSS), 100);
    p.vy = idiv(p.vy * (100 - EDGE_LOSS), 100);
  }
  if (p.y < SLED_RADIUS) {
    p.y = SLED_RADIUS;
    if (p.vy < 0) p.vy = 0;
  }
  if (p.y > track.endY) {
    p.y = track.endY;
    if (p.vy > 0) p.vy = 0;
  }
}

/**
 * Trees and rocks, for a sled on the snow: always pushed out of them; hitting one hard enough
 * overturns the sled (unless it is already down or just got up), otherwise it slides along.
 */
export function hitObstacles(p: PlayerState, track: Track, events: GameEvent[]): void {
  for (const i of nearby(track, track.rowObstacles, p.y)) {
    const o = track.obstacles[i]!;
    let dx = p.x - o.x;
    let dy = p.y - o.y;
    const minDist = o.r + SLED_RADIUS;
    const d2 = dx * dx + dy * dy;
    if (d2 >= minDist * minDist) continue;
    let dist = isqrt(d2);
    if (dist === 0) {
      dx = 0;
      dy = -1;
      dist = 1;
    }
    const nx = idiv(dx * TRIG_ONE, dist);
    const ny = idiv(dy * TRIG_ONE, dist);
    p.x = o.x + idiv(nx * minDist, TRIG_ONE);
    p.y = o.y + idiv(ny * minDist, TRIG_ONE);
    const approach = -idiv(p.vx * nx + p.vy * ny, TRIG_ONE);
    if (approach <= 0) continue;
    // Velocity along the obstacle's surface (the part into it removed).
    const tx = p.vx + idiv(approach * nx, TRIG_ONE);
    const ty = p.vy + idiv(approach * ny, TRIG_ONE);
    if (approach >= TUNING.crashMinSpeed && p.crashTicks === 0 && p.graceTicks === 0) {
      const back = idiv(approach * CRASH_BOUNCE, 100);
      p.vx = idiv(tx, 2) + idiv(back * nx, TRIG_ONE);
      p.vy = idiv(ty, 2) + idiv(back * ny, TRIG_ONE);
      p.crashTicks = TUNING.crashTicks;
      p.airTicks = 0;
      p.steer = 0;
      p.firePressed = false;
      p.crashes++;
      events.push({ type: 'crash', playerId: p.id, x: o.x - idiv(nx * o.r, TRIG_ONE), y: o.y - idiv(ny * o.r, TRIG_ONE), obstacle: o.kind });
    } else {
      p.vx = tx;
      p.vy = ty;
    }
  }
}

/** Air time for a take-off at this speed. */
export function airTicksFor(speed: number): number {
  return clamp(idiv(speed * TUNING.airPerSpeed, 1000), AIR_MIN_TICKS, AIR_MAX_TICKS);
}

/** A fast sled on the snow whose center is on a ramp takes off. */
export function tryJump(p: PlayerState, track: Track, events: GameEvent[]): void {
  if (p.airTicks > 0 || p.crashTicks > 0) return;
  const speed = speedOf(p);
  if (speed < JUMP_MIN_SPEED) return;
  for (const i of nearby(track, track.rowRamps, p.y)) {
    const r = track.ramps[i]!;
    if (p.x < r.x0 || p.x > r.x1 || p.y < r.y0 || p.y > r.y1) continue;
    p.airTicks = airTicksFor(speed);
    p.airTotal = p.airTicks;
    p.jumps++;
    events.push({ type: 'jump', playerId: p.id });
    return;
  }
}

/** Sleds that can touch: both on the snow or both in the air, neither finished. */
export function canCollide(a: Readonly<PlayerState>, b: Readonly<PlayerState>): boolean {
  return !a.finished && !b.finished && grounded(a) === grounded(b);
}

/**
 * Two sleds shove each other: equal masses, restitution TUNING.restitution, plus positional
 * separation. Callers go through pairs in slot order so the result is deterministic.
 */
export function collideSleds(a: PlayerState, b: PlayerState, events: GameEvent[]): void {
  if (!canCollide(a, b)) return;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const minDist = 2 * SLED_RADIUS;
  const d2 = dx * dx + dy * dy;
  if (d2 >= minDist * minDist) return;
  let dist = isqrt(d2);
  if (dist === 0) {
    // Exactly on top of each other: push apart along x, lower slot to the left.
    dx = 1;
    dy = 0;
    dist = 1;
  }
  const nx = idiv(dx * TRIG_ONE, dist);
  const ny = idiv(dy * TRIG_ONE, dist);
  const overlap = minDist - dist;
  const pushA = idiv(overlap, 2);
  const pushB = overlap - pushA;
  a.x -= idiv(pushA * nx, TRIG_ONE);
  a.y -= idiv(pushA * ny, TRIG_ONE);
  b.x += idiv(pushB * nx, TRIG_ONE);
  b.y += idiv(pushB * ny, TRIG_ONE);

  const closing = idiv((a.vx - b.vx) * nx + (a.vy - b.vy) * ny, TRIG_ONE);
  if (closing <= 0) return;
  // Equal masses: each one gets half of (1 + e) × closing along the normal.
  const dv = idiv((100 + TUNING.restitution) * closing, 200);
  a.vx -= idiv(dv * nx, TRIG_ONE);
  a.vy -= idiv(dv * ny, TRIG_ONE);
  b.vx += idiv(dv * nx, TRIG_ONE);
  b.vy += idiv(dv * ny, TRIG_ONE);
  const impulse = dv * SLED_MASS;
  if (impulse >= BUMP_EVENT_MIN) {
    events.push({ type: 'bump', a: a.id, b: b.id, x: a.x + idiv(SLED_RADIUS * nx, TRIG_ONE), y: a.y + idiv(SLED_RADIUS * ny, TRIG_ONE), force: impulse });
  }
}
