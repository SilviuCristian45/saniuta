import {
  BOT_EASY,
  BOT_HARD,
  BOT_MEDIUM,
  FP,
  INPUT_MAX,
  JUMP_MIN_SPEED,
  MAX_SNOWBALLS,
  PILE_RADIUS,
  SLED_RADIUS,
  SURFACE_DEEP,
  SURFACE_ICE,
} from './constants';
import { angleDiff, clamp, hash32, iatan2, idiv, percent } from './fixed';
import { sortedPlayers } from './match';
import { airTicksFor, grounded, speedOf } from './physics';
import { centerAt, halfWidthAt, itemsBetween, surfaceAt, type Track } from './track';
import { countdownSeconds, currentTrack } from './sim';
import { TUNING } from './tuning';
import type { GameState, PlayerState, SledInput } from './types';

// Bots: one decision procedure for every level; the levels only differ in the numbers below.
// Every decision looks a stretch down the track, scores a few lines across it (obstacles in the
// way, ice, deep snow, ramps, piles, how far it has to swerve) and steers for the best one.
// Decisions are pure functions of the state: random choices are hashes of the state (RNG word,
// round, decision, slot) and never advance the RNG, so the client's prediction replays them exactly.

export interface BotParams {
  /** Ticks between decisions (reaction time); the last input is held in between. */
  interval: number;
  /** How far down the track it looks: a fixed stretch plus this many ticks at its current speed. */
  lookahead: number;
  lookTicks: number;
  /** Lines across the track it considers. */
  lanes: number;
  /** Extra room it wants between its line and an obstacle. */
  clearance: number;
  /** Line costs for crossing ice / deep snow, and bonuses for a ramp / a pile (when it has room). */
  iceCost: number;
  deepCost: number;
  rampBonus: number;
  pileBonus: number;
  /** Line cost for running into a slower sled ahead (0: does not look out for them). */
  sledCost: number;
  /** Knows a jump clears what is behind a ramp. */
  jumpsOver: boolean;
  /** Brakes when no line is clear. */
  brakes: boolean;
  /** Percent of decisions with a rival in reach that throw a snowball. */
  throwChance: number;
  /** A rival is in reach within this distance down the track... */
  throwRange: number;
  /** ...and within this angle (steps) of the heading. */
  throwAlign: number;
  /** Percent of decisions that go wrong (steer the other way, let go, brake for nothing). */
  mistake: number;
  /** Random aim error, +- angle steps. */
  aimNoise: number;
}

export const BOT_PARAMS: Record<number, BotParams> = {
  [BOT_EASY]: {
    interval: 6,
    lookahead: 170 * FP,
    lookTicks: 12,
    lanes: 7,
    clearance: 4 * FP,
    iceCost: 0,
    deepCost: 80,
    rampBonus: 0,
    pileBonus: 40,
    sledCost: 0,
    jumpsOver: false,
    brakes: false,
    throwChance: 15,
    throwRange: 160 * FP,
    throwAlign: 40,
    mistake: 7,
    aimNoise: 35,
  },
  [BOT_MEDIUM]: {
    interval: 5,
    lookahead: 150 * FP,
    lookTicks: 15,
    lanes: 7,
    clearance: 6 * FP,
    iceCost: 150,
    deepCost: 400,
    rampBonus: 80,
    pileBonus: 120,
    sledCost: 300,
    jumpsOver: true,
    brakes: false,
    throwChance: 40,
    throwRange: 220 * FP,
    throwAlign: 28,
    mistake: 6,
    aimNoise: 20,
  },
  [BOT_HARD]: {
    interval: 3,
    lookahead: 180 * FP,
    lookTicks: 18,
    lanes: 11,
    clearance: 8 * FP,
    iceCost: 250,
    deepCost: 700,
    rampBonus: 200,
    pileBonus: 250,
    sledCost: 600,
    jumpsOver: true,
    brakes: true,
    throwChance: 80,
    throwRange: 280 * FP,
    throwAlign: 20,
    mistake: 1,
    aimNoise: 6,
  },
};

export type BotIntent = 'wait' | 'down' | 'line' | 'blocked';

export interface BotThought {
  input: SledInput;
  intent: BotIntent;
  targetX: number;
  targetY: number;
  /** The rival it threw at ('' = none). */
  targetId: string;
}

/** Steering gain floor: an angle error (steps) of at least this is needed for full steer. */
const MIN_FULL_STEER_ERROR = 24;
/** Ticks a sled keeps sliding along its velocity before a new turn takes hold. */
const TURN_TICKS = 5;
/** A line through an obstacle costs this much (more than anything else can add up to). */
const BLOCKED = 10000;
/**
 * Each of three points of a line past the snowbank (a line that cuts a bend). The bank only bounces
 * the sled back and costs speed, while an obstacle overturns it: three of these stay below one
 * obstacle, so with no clean line around a tight bend the bot takes the bank, never the tree.
 */
const SNOWBANK = 3000;
/** A slower sled ahead is looked at where it will be when this one catches up, at most this many ticks on. */
const CATCH_UP_TICKS = 40;

function paramsFor(p: PlayerState): BotParams {
  return BOT_PARAMS[p.botLevel] ?? BOT_PARAMS[BOT_MEDIUM]!;
}

/** Squared distance from point (px, py) to the segment (ax, ay)-(bx, by). */
function segmentDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const sx = bx - ax;
  const sy = by - ay;
  const len2 = sx * sx + sy * sy;
  const t = len2 === 0 ? 0 : clamp(idiv(((px - ax) * sx + (py - ay) * sy) * 1000, len2), 0, 1000);
  const cx = ax + idiv(sx * t, 1000) - px;
  const cy = ay + idiv(sy * t, 1000) - py;
  return cx * cx + cy * cy;
}

/** The x of the segment (ax, ay)-(bx, by) at height y. */
function xAt(ax: number, ay: number, bx: number, by: number, y: number): number {
  return by === ay ? ax : ax + idiv((bx - ax) * (y - ay), by - ay);
}

/**
 * The way a sled actually goes for a target: it keeps sliding along its velocity for a few ticks
 * (all the way to the landing when in the air) before the turn takes hold, then heads for it.
 */
interface Path {
  ax: number;
  ay: number;
  /** Where the turn takes hold. */
  px: number;
  py: number;
  tx: number;
  ty: number;
}

function pathDist2(path: Path, x: number, y: number): number {
  return Math.min(segmentDist2(x, y, path.ax, path.ay, path.px, path.py), segmentDist2(x, y, path.px, path.py, path.tx, path.ty));
}

/** The x of the path at height y. */
function pathXAt(path: Path, y: number): number {
  return y <= path.py ? xAt(path.ax, path.ay, path.px, path.py, y) : xAt(path.px, path.py, path.tx, path.ty, y);
}

/** What riding the path costs. Lower is better. */
function lineCost(state: GameState, track: Track, me: PlayerState, params: BotParams, path: Path): number {
  let cost = 0;
  const speed = speedOf(me);
  const { tx, ty } = path;
  // A ramp on the line: a bonus, and (for those who know) what lies just behind it is jumped.
  let jumpFrom = 0;
  let jumpTo = 0;
  for (const i of itemsBetween(track, track.rowRamps, me.y, ty)) {
    const r = track.ramps[i]!;
    const x = pathXAt(path, r.y0);
    if (x < r.x0 || x > r.x1) continue;
    cost -= params.rampBonus;
    if (params.jumpsOver && speed >= JUMP_MIN_SPEED) {
      jumpFrom = r.y0;
      jumpTo = r.y1 + idiv(airTicksFor(speed) * speed * 8, 10);
    }
  }
  for (const i of itemsBetween(track, track.rowObstacles, me.y - SLED_RADIUS, ty + SLED_RADIUS)) {
    const o = track.obstacles[i]!;
    if (jumpTo > 0 && o.y > jumpFrom && o.y < jumpTo) continue;
    const reach = o.r + SLED_RADIUS + params.clearance;
    if (pathDist2(path, o.x, o.y) < reach * reach) {
      // Nearer obstacles are worse: there is less time to fix the line later.
      cost += BLOCKED + idiv((ty - o.y) * 10, FP);
    }
  }
  // A line that cuts a bend runs into the snowbank.
  for (let q = 1; q <= 3; q++) {
    const y = path.py + idiv((ty - path.py) * q, 4);
    const x = path.px + idiv((tx - path.px) * q, 4);
    if (Math.abs(x - centerAt(track, y)) > halfWidthAt(track, y) - SLED_RADIUS) cost += SNOWBANK;
  }
  for (const q of [2, 4]) {
    const s = surfaceAt(track, path.px + idiv((tx - path.px) * q, 4), path.py + idiv((ty - path.py) * q, 4));
    if (s === SURFACE_ICE) cost += params.iceCost;
    else if (s === SURFACE_DEEP) cost += params.deepCost;
  }
  if (me.snowballs < MAX_SNOWBALLS && params.pileBonus > 0) {
    const reach = PILE_RADIUS + SLED_RADIUS;
    for (const i of itemsBetween(track, track.rowPiles, me.y, ty)) {
      if (state.pileTimers[i] !== 0) continue;
      const pile = track.piles[i]!;
      if (pathDist2(path, pile.x, pile.y) < reach * reach) {
        cost -= params.pileBonus;
        break;
      }
    }
  }
  // A slower sled ahead on the line: bumping into it costs both of them speed (in a bunched field
  // that adds up to seconds), so go round it, where it will be by the time this sled gets there.
  if (params.sledCost > 0) {
    const reach = 2 * SLED_RADIUS + params.clearance;
    for (const o of sortedPlayers(state)) {
      if (o.id === me.id || !o.racing || o.finished || !grounded(o)) continue;
      const dy = o.y - me.y;
      const closing = me.vy - o.vy;
      if (dy <= 0 || dy > ty - me.y || closing <= 0) continue;
      const k = Math.min(idiv(dy, closing), CATCH_UP_TICKS);
      if (pathDist2(path, o.x + o.vx * k, o.y + o.vy * k) < reach * reach) cost += params.sledCost;
    }
  }
  // Swerving costs speed: prefer lines close to where the sled is going anyway.
  cost += idiv(Math.abs(tx - path.px), 2 * FP);
  return cost;
}

/** The rival to throw at: on the snow, ahead, close and nearly in line with the heading. */
function throwTarget(state: GameState, me: PlayerState, params: BotParams): PlayerState | undefined {
  let best: PlayerState | undefined;
  let bestDist = params.throwRange + 1;
  for (const p of sortedPlayers(state)) {
    if (p.id === me.id || !p.racing || p.finished || !grounded(p) || p.crashTicks > 0) continue;
    const dx = p.x - me.x;
    const dy = p.y - me.y;
    if (dy <= 0 || dy >= bestDist) continue;
    if (Math.abs(angleDiff(me.heading, iatan2(dy, dx))) > params.throwAlign) continue;
    best = p;
    bestDist = dy;
  }
  return best;
}

/** The full decision, plus what the bot is trying to do (for the debug overlay). Pure. */
export function botThink(state: GameState, id: string): BotThought | null {
  const me = state.players[id];
  if (!me || !me.racing || me.finished || state.phase !== 'playing') return null;
  const params = paramsFor(me);
  // Kicking off at HAI!: the held input from the countdown is what the sled starts with.
  if (countdownSeconds(state.roundTick) > 0) {
    return { input: { seq: 0, steer: 0, throttle: INPUT_MAX, fire: false }, intent: 'wait', targetX: me.x, targetY: me.y, targetId: '' };
  }
  const track = currentTrack(state);
  const decision = Math.trunc(state.tick / params.interval);
  const roll = (salt: number) => percent(state.rng, state.round, decision, me.slot, salt);
  const speed = speedOf(me);

  // Look far ahead; where every far line is blocked (a tight bend), look half as far, then a quarter
  // (the next gap only: around a tight bend no straight line reaches far without cutting the bank).
  const far = params.lookahead + speed * params.lookTicks;
  let bestCost = Infinity;
  let tx = me.x;
  let ty = me.y + far;
  const slide = me.airTicks > 0 ? me.airTicks : TURN_TICKS;
  const px = me.x + me.vx * slide;
  const py = me.y + me.vy * slide;
  for (const look of [far, idiv(far, 2), idiv(far, 4)]) {
    const y = Math.min(me.y + look, track.endY);
    const c = centerAt(track, y);
    const reach = halfWidthAt(track, y) - 2 * SLED_RADIUS;
    for (let k = 0; k < params.lanes; k++) {
      const x = c + idiv(reach * (2 * k - (params.lanes - 1)), params.lanes - 1);
      const cost = lineCost(state, track, me, params, { ax: me.x, ay: me.y, px, py, tx: x, ty: y });
      if (cost < bestCost) {
        bestCost = cost;
        tx = x;
        ty = y;
      }
    }
    if (bestCost < BLOCKED) break;
  }
  const intent: BotIntent = bestCost >= BLOCKED ? 'blocked' : 'line';

  const noise = params.aimNoise > 0 ? (hash32(state.rng, decision, me.slot, 7) % (2 * params.aimNoise + 1)) - params.aimNoise : 0;
  const desired = iatan2(ty - me.y, tx - me.x) + noise;
  // Steer just enough to close the error by the next decision (full steer turns turnRate a tick),
  // so slow deciders do not swing from side to side. The heading has to go up for a target to the
  // left: steer < 0 (steer > 0 lowers the heading).
  const fullSteerError = Math.max(TUNING.turnRate * params.interval, MIN_FULL_STEER_ERROR);
  let steer = clamp(-idiv(angleDiff(me.heading, desired) * INPUT_MAX, fullSteerError) || 0, -INPUT_MAX, INPUT_MAX);
  let throttle = speed < TUNING.pushMaxSpeed ? INPUT_MAX : 0;
  if (intent === 'blocked' && params.brakes && speed > TUNING.pushMaxSpeed) throttle = -INPUT_MAX;

  let fire = false;
  let target: PlayerState | undefined;
  if (me.snowballs > 0 && me.throwCooldown === 0 && (target = throwTarget(state, me, params))) fire = roll(5) < params.throwChance;

  if (roll(2) < params.mistake) {
    if (roll(3) % 2 === 0) steer = -steer || 0; // never -0
    else steer = 0;
  }
  return { input: { seq: 0, steer, throttle, fire }, intent, targetX: tx, targetY: ty, targetId: fire && target ? target.id : '' };
}

/** What the game loop applies for a bot this tick: a new input on decision ticks, null in between. */
export function botAct(state: GameState, id: string): SledInput | null {
  const me = state.players[id];
  if (!me) return null;
  if (state.tick % paramsFor(me).interval !== 0) return null;
  return botThink(state, id)?.input ?? null;
}

/** Level names as the lobby shows them. */
export const BOT_LEVEL_NAMES: Record<number, string> = { [BOT_EASY]: 'Ușor', [BOT_MEDIUM]: 'Mediu', [BOT_HARD]: 'Greu' };
