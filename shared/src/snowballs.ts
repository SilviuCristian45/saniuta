import {
  BALL_GIANT,
  BALL_RADIUS,
  BALL_SMALL,
  BALL_SLOTS,
  BALL_TICKS,
  GIANT_FRICTION,
  GIANT_HIT_KEEP_PCT,
  GIANT_MAX_SPEED,
  GIANT_PUSH,
  GIANT_RADIUS,
  GIANT_TICKS,
  MAX_SNOWBALLS,
  OBSTACLE_GIANT,
  PILE_RADIUS,
  PILE_RESPAWN_TICKS,
  POWER_SCARF,
  SLED_RADIUS,
  SPLAT_TICKS,
  THROW_COOLDOWN_TICKS,
} from './constants';
import { icos, idiv, isin, isqrt, TRIG_ONE } from './fixed';
import { decay, grounded, overturn } from './physics';
import { centerAt, halfWidthAt, nearby, slopeAt, type Track } from './track';
import { TUNING } from './tuning';
import type { GameEvent, GameState, PlayerState } from './types';

// Snowballs: picked up from piles on the track (at most MAX_SNOWBALLS carried), thrown forward,
// flying for BALL_TICKS in BALL_SLOTS flat state slots. A hit sled loses speed. The giant snowball
// (a power-up) shares the slots: it rolls down the slope and overturns the sleds it touches.

/** Empty flight slots (the state's ball arrays). */
export function clearBalls(state: GameState): void {
  state.ballX = new Array<number>(BALL_SLOTS).fill(0);
  state.ballY = new Array<number>(BALL_SLOTS).fill(0);
  state.ballVx = new Array<number>(BALL_SLOTS).fill(0);
  state.ballVy = new Array<number>(BALL_SLOTS).fill(0);
  state.ballTicks = new Array<number>(BALL_SLOTS).fill(0);
  state.ballOwner = new Array<number>(BALL_SLOTS).fill(0);
  state.ballKind = new Array<number>(BALL_SLOTS).fill(BALL_SMALL);
}

/** Every pile of the track there (start of a run). */
export function resetPiles(state: GameState, track: Track): void {
  state.pileTimers = new Array<number>(track.piles.length).fill(0);
}

/** Taken piles come back after PILE_RESPAWN_TICKS. */
export function tickPiles(state: GameState): void {
  for (let i = 0; i < state.pileTimers.length; i++) if (state.pileTimers[i]! > 0) state.pileTimers[i]!--;
}

/** A sled on the snow with room for more takes the piles it rides over. */
export function pickUpSnow(state: GameState, track: Track, p: PlayerState, events: GameEvent[]): void {
  if (!grounded(p) || p.crashTicks > 0) return;
  const reach = PILE_RADIUS + SLED_RADIUS;
  for (const i of nearby(track, track.rowPiles, p.y)) {
    if (p.snowballs >= MAX_SNOWBALLS) return;
    if (state.pileTimers[i] !== 0) continue;
    const pile = track.piles[i]!;
    const dx = p.x - pile.x;
    const dy = p.y - pile.y;
    if (dx * dx + dy * dy >= reach * reach) continue;
    state.pileTimers[i] = PILE_RESPAWN_TICKS;
    p.snowballs++;
    p.pickups++;
    events.push({ type: 'pickup', playerId: p.id, pile: i });
  }
}

/** A throw press (latched by applyInput): a snowball goes forward if there is one and a free slot. */
export function throwSnowball(state: GameState, p: PlayerState, events: GameEvent[]): void {
  if (p.throwCooldown > 0) p.throwCooldown--;
  if (!p.firePressed) return;
  p.firePressed = false;
  if (p.snowballs === 0 || p.throwCooldown > 0 || p.crashTicks > 0) return;
  const slot = state.ballTicks.indexOf(0);
  if (slot < 0) return;
  const cos = icos(p.heading);
  const sin = isin(p.heading);
  const ahead = SLED_RADIUS + BALL_RADIUS;
  state.ballX[slot] = p.x + idiv(ahead * cos, TRIG_ONE);
  state.ballY[slot] = p.y + idiv(ahead * sin, TRIG_ONE);
  state.ballVx[slot] = p.vx + idiv(TUNING.ballSpeed * cos, TRIG_ONE);
  state.ballVy[slot] = p.vy + idiv(TUNING.ballSpeed * sin, TRIG_ONE);
  state.ballTicks[slot] = BALL_TICKS;
  state.ballOwner[slot] = p.slot;
  state.ballKind[slot] = BALL_SMALL;
  p.snowballs--;
  p.throwCooldown = THROW_COOLDOWN_TICKS;
  events.push({ type: 'throw', playerId: p.id, ball: slot });
}

function freeSlot(state: GameState, i: number): void {
  state.ballX[i] = 0;
  state.ballY[i] = 0;
  state.ballVx[i] = 0;
  state.ballVy[i] = 0;
  state.ballTicks[i] = 0;
  state.ballOwner[i] = 0;
  state.ballKind[i] = BALL_SMALL;
}

/** The giant snowball leaves just ahead of the sled. Returns false when every slot is busy (the power-up is kept). */
export function launchGiant(state: GameState, p: PlayerState): boolean {
  const slot = state.ballTicks.indexOf(0);
  if (slot < 0) return false;
  const cos = icos(p.heading);
  const sin = isin(p.heading);
  const ahead = SLED_RADIUS + GIANT_RADIUS;
  state.ballX[slot] = p.x + idiv(ahead * cos, TRIG_ONE);
  state.ballY[slot] = p.y + idiv(ahead * sin, TRIG_ONE);
  state.ballVx[slot] = p.vx + idiv(GIANT_PUSH * cos, TRIG_ONE);
  state.ballVy[slot] = p.vy + idiv(GIANT_PUSH * sin, TRIG_ONE);
  state.ballTicks[slot] = GIANT_TICKS;
  state.ballOwner[slot] = p.slot;
  state.ballKind[slot] = BALL_GIANT;
  return true;
}

/** Whether a ball at (x, y) of this radius is in a tree or a rock. */
function inObstacle(track: Track, x: number, y: number, radius: number): boolean {
  return nearby(track, track.rowObstacles, y).some((j) => {
    const o = track.obstacles[j]!;
    const r = o.r + radius;
    const dx = o.x - x;
    const dy = o.y - y;
    return dx * dx + dy * dy < r * r;
  });
}

/**
 * The giant snowball rolls: gravity down the slope, a little friction, the snowbanks bounce it back.
 * It overturns every sled on the snow it rolls over (the thrower never), and breaks on a tree or a
 * rock, or rolls out past the finish line.
 */
function rollGiant(state: GameState, track: Track, racers: readonly PlayerState[], i: number, events: GameEvent[]): void {
  let vx = decay(state.ballVx[i]!, GIANT_FRICTION);
  let vy = decay(state.ballVy[i]! + idiv(TUNING.gravity * slopeAt(track, state.ballY[i]!), 100), GIANT_FRICTION);
  const speed = isqrt(vx * vx + vy * vy);
  if (speed > GIANT_MAX_SPEED) {
    vx = idiv(vx * GIANT_MAX_SPEED, speed);
    vy = idiv(vy * GIANT_MAX_SPEED, speed);
  }
  let x = state.ballX[i]! + vx;
  const y = state.ballY[i]! + vy;
  const c = centerAt(track, y);
  const reach = halfWidthAt(track, y) - GIANT_RADIUS;
  if (Math.abs(x - c) > reach) {
    x = x > c ? c + reach : c - reach;
    if ((x > c && vx > 0) || (x < c && vx < 0)) vx = -idiv(vx, 2);
  }
  state.ballX[i] = x;
  state.ballY[i] = y;
  state.ballVx[i] = vx;
  state.ballVy[i] = vy;
  state.ballTicks[i]!--;
  const owner = state.ballOwner[i]!;
  const thrower = racers.find((p) => p.slot === owner);
  const hitReach = GIANT_RADIUS + SLED_RADIUS;
  for (const p of racers) {
    if (p.slot === owner || p.finished || !grounded(p) || p.crashTicks > 0 || p.graceTicks > 0) continue;
    const dx = p.x - x;
    const dy = p.y - y;
    if (dx * dx + dy * dy >= hitReach * hitReach) continue;
    if (!overturn(p, x + idiv(dx, 2), y + idiv(dy, 2), OBSTACLE_GIANT, events)) continue;
    p.vx = idiv(p.vx * GIANT_HIT_KEEP_PCT, 100);
    p.vy = idiv(p.vy * GIANT_HIT_KEEP_PCT, 100);
    p.hitsTaken++;
    if (thrower) thrower.hits++;
  }
  if (inObstacle(track, x, y, GIANT_RADIUS)) {
    events.push({ type: 'splat', playerId: '', byId: thrower?.id ?? '', x, y, big: true });
    freeSlot(state, i);
  } else if (state.ballTicks[i] === 0 || y > track.finishY) {
    freeSlot(state, i);
  }
}

/**
 * Snowballs in flight move, then hit the first sled they touch (not the thrower, not one in the
 * air or overturned), or break on a tree, a rock or the snowbank. `racers` in slot order.
 */
export function updateBalls(state: GameState, track: Track, racers: readonly PlayerState[], events: GameEvent[]): void {
  const reach = SLED_RADIUS + BALL_RADIUS;
  for (let i = 0; i < BALL_SLOTS; i++) {
    if (state.ballTicks[i] === 0) continue;
    if (state.ballKind[i] === BALL_GIANT) {
      rollGiant(state, track, racers, i, events);
      continue;
    }
    const x = state.ballX[i]! + state.ballVx[i]!;
    const y = state.ballY[i]! + state.ballVy[i]!;
    state.ballX[i] = x;
    state.ballY[i] = y;
    state.ballTicks[i]!--;
    const owner = state.ballOwner[i]!;

    const victim = racers.find((p) => {
      if (p.slot === owner || p.finished || !grounded(p) || p.crashTicks > 0) return false;
      const dx = p.x - x;
      const dy = p.y - y;
      return dx * dx + dy * dy < reach * reach;
    });
    if (victim && victim.scarfTicks > 0) {
      // The magic scarf: the snowball falls apart on it.
      events.push({ type: 'shield', playerId: victim.id, power: POWER_SCARF, x, y });
      freeSlot(state, i);
      continue;
    }
    if (victim) {
      victim.vx = idiv(victim.vx * TUNING.ballHitKeepPct, 100);
      victim.vy = idiv(victim.vy * TUNING.ballHitKeepPct, 100);
      victim.splatTicks = SPLAT_TICKS;
      victim.hitsTaken++;
      const thrower = racers.find((p) => p.slot === owner);
      if (thrower) thrower.hits++;
      events.push({ type: 'splat', playerId: victim.id, byId: thrower?.id ?? '', x, y, big: false });
      freeSlot(state, i);
      continue;
    }
    const broke = Math.abs(x - centerAt(track, y)) > halfWidthAt(track, y) || inObstacle(track, x, y, BALL_RADIUS);
    if (broke) {
      events.push({ type: 'splat', playerId: '', byId: '', x, y, big: false });
      freeSlot(state, i);
    } else if (state.ballTicks[i] === 0) {
      freeSlot(state, i); // dropped into the snow
    }
  }
}
