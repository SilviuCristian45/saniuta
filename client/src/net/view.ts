import { angleDiff, BALL_GIANT, BALL_SLOTS, GIANT_TICKS, type GameState, type PlayerState } from '@saniuta/shared';

// Where things are drawn this frame. The simulation moves in whole ticks; transports blend
// between ticks (and online, between server states) so sleds glide at any frame rate.

/** Simulation units (sub-units, angle steps), fractional. */
export interface Pose {
  x: number;
  y: number;
  heading: number;
}

export interface BallPose {
  slot: number;
  x: number;
  y: number;
  /** Fraction of the flight done (0..1), for the arc it is drawn on (a giant snowball rolls on the snow). */
  flight: number;
  giant: boolean;
}

export interface RenderView {
  /** Every sled of the current state. */
  poses: ReadonlyMap<string, Pose>;
  /** Snowballs in flight. */
  balls: readonly BallPose[];
}

export const EMPTY_VIEW: RenderView = { poses: new Map(), balls: [] };

export function poseOf(p: Readonly<PlayerState>): Pose {
  return { x: p.x, y: p.y, heading: p.heading };
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, heading: a.heading + angleDiff(a.heading, b.heading) * t };
}

/** A new run puts every sled back at the start: no gliding from the old spots. */
export function isRoundReset(prev: Readonly<GameState>, next: Readonly<GameState>): boolean {
  return next.round !== prev.round || next.phase !== prev.phase || next.roundTick < prev.roundTick;
}

export interface BallSnap {
  x: number;
  y: number;
  ticks: number;
  giant: boolean;
}

export function ballsOf(state: Readonly<GameState>): BallSnap[] {
  return Array.from({ length: BALL_SLOTS }, (_, i) => ({
    x: state.ballX[i] ?? 0,
    y: state.ballY[i] ?? 0,
    ticks: state.ballTicks[i] ?? 0,
    giant: state.ballKind[i] === BALL_GIANT,
  }));
}

/** The flight fraction of a ball with `ticks` left (BALL_TICKS at the throw). */
export function flightOf(ticks: number, total: number): number {
  return Math.min(1, Math.max(0, 1 - ticks / total));
}

/** The poses of the last two ticks, drawn in between (LocalTransport). */
export class TickBlend {
  private prev = new Map<string, Pose>();
  private cur = new Map<string, Pose>();
  private prevBalls: BallSnap[] = [];
  private curBalls: BallSnap[] = [];
  private last: GameState | null = null;

  constructor(private readonly ballTicks: number) {}

  /** Called after the state may have moved on; only a new tick shifts the poses. */
  push(state: Readonly<GameState>): void {
    if (this.last && state.tick === this.last.tick) return;
    const fresh = !this.last || state.tick - this.last.tick > 1 || isRoundReset(this.last, state);
    this.prev = this.cur;
    this.cur = new Map();
    for (const p of Object.values(state.players)) this.cur.set(p.id, poseOf(p));
    if (fresh) this.prev = this.cur;
    this.prevBalls = fresh ? ballsOf(state) : this.curBalls;
    this.curBalls = ballsOf(state);
    this.last = { ...state, players: {} };
  }

  view(alpha: number): RenderView {
    const poses = new Map<string, Pose>();
    for (const [id, cur] of this.cur) poses.set(id, lerpPose(this.prev.get(id) ?? cur, cur, alpha));
    return { poses, balls: blendBalls(this.prevBalls, this.curBalls, alpha, this.ballTicks) };
  }
}

/**
 * Live balls drawn between two snapshots; a ball that was just thrown (no earlier position) is drawn
 * where it is. `total`: a snowball's flight ticks (a giant one lasts GIANT_TICKS).
 */
export function blendBalls(prev: readonly BallSnap[], cur: readonly BallSnap[], alpha: number, total: number): BallPose[] {
  const out: BallPose[] = [];
  cur.forEach((b, slot) => {
    if (b.ticks === 0) return;
    const a = prev[slot];
    const from = a && a.ticks === b.ticks + 1 && a.giant === b.giant ? a : b;
    out.push({
      slot,
      x: from.x + (b.x - from.x) * alpha,
      y: from.y + (b.y - from.y) * alpha,
      flight: flightOf(b.ticks + (1 - alpha), b.giant ? GIANT_TICKS : total),
      giant: b.giant,
    });
  });
  return out;
}
