import {
  AIR_PER_SPEED,
  BALL_HIT_KEEP_PCT,
  BALL_SPEED,
  BRAKE,
  CRASH_MIN_SPEED,
  CRASH_TICKS,
  FRICTION_DEEP,
  FRICTION_ICE,
  FRICTION_SNOW,
  GRAVITY,
  GRIP_DEEP,
  GRIP_ICE,
  GRIP_SNOW,
  LAND_BOOST,
  MAX_SPEED,
  PUSH_ACCEL,
  PUSH_MAX_SPEED,
  RESTITUTION,
  TURN_DRAG,
  TURN_RATE,
} from './constants';

// The riding-feel constants the simulation reads, gathered in one object so the local ?tune panel
// can change them live. Everything else (server, online clients, tests) keeps DEFAULT_TUNING:
// client and server must step with identical numbers, so only a local game may touch TUNING.

export interface Tuning {
  gravity: number;
  maxSpeed: number;
  frictionSnow: number;
  frictionIce: number;
  frictionDeep: number;
  gripSnow: number;
  gripIce: number;
  gripDeep: number;
  turnRate: number;
  turnDrag: number;
  pushAccel: number;
  pushMaxSpeed: number;
  brake: number;
  crashMinSpeed: number;
  crashTicks: number;
  airPerSpeed: number;
  landBoost: number;
  ballSpeed: number;
  ballHitKeepPct: number;
  restitution: number;
}

export const DEFAULT_TUNING: Readonly<Tuning> = Object.freeze({
  gravity: GRAVITY,
  maxSpeed: MAX_SPEED,
  frictionSnow: FRICTION_SNOW,
  frictionIce: FRICTION_ICE,
  frictionDeep: FRICTION_DEEP,
  gripSnow: GRIP_SNOW,
  gripIce: GRIP_ICE,
  gripDeep: GRIP_DEEP,
  turnRate: TURN_RATE,
  turnDrag: TURN_DRAG,
  pushAccel: PUSH_ACCEL,
  pushMaxSpeed: PUSH_MAX_SPEED,
  brake: BRAKE,
  crashMinSpeed: CRASH_MIN_SPEED,
  crashTicks: CRASH_TICKS,
  airPerSpeed: AIR_PER_SPEED,
  landBoost: LAND_BOOST,
  ballSpeed: BALL_SPEED,
  ballHitKeepPct: BALL_HIT_KEEP_PCT,
  restitution: RESTITUTION,
});

/** Live values used by the simulation. Integers only. */
export const TUNING: Tuning = { ...DEFAULT_TUNING };

/** Applies integer values (others ignored); pass DEFAULT_TUNING to reset. */
export function setTuning(values: Partial<Tuning>): void {
  for (const key of Object.keys(DEFAULT_TUNING) as (keyof Tuning)[]) {
    const v = values[key];
    if (typeof v === 'number' && Number.isInteger(v)) TUNING[key] = v;
  }
}

export interface GameTuningOptions {
  /** A room on the server: client and server must step with the same numbers. */
  online: boolean;
  /** ?tune in the URL. */
  tune: boolean;
  /** Values an earlier ?tune session saved in this browser (null when there are none). */
  saved: Partial<Tuning> | null;
}

/**
 * Called whenever a game starts. Every game starts from DEFAULT_TUNING; the saved ?tune values
 * are applied on top only for a local game with ?tune in the URL. Online they never apply.
 */
export function applyGameTuning(opts: GameTuningOptions): void {
  setTuning(DEFAULT_TUNING);
  if (!opts.online && opts.tune && opts.saved) setTuning(opts.saved);
}
