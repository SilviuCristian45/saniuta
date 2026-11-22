import { COUNTDOWN_TICKS, DOWNHILL, FP, ROW_LEN, START_ROW, addPlayer, createGameState, runTick, setTrack, startMatch } from '../src';
import type { GameEvent, GameState, Obstacle, Patch, Pile, PlayerState, Ramp, SledInput, Track } from '../src';

export const px = (n: number) => n * FP;

export type SledSetup = Partial<PlayerState> & { id: string };

/**
 * A run in progress right after the countdown (the next step is the first racing tick) on a real
 * track, with the given sleds placed exactly. Sleds default to standing still where startRound put them.
 */
export function makeRace(sleds: SledSetup[], opts: { seed?: string; rounds?: number; trackId?: number; powerUps?: boolean } = {}): GameState {
  const state = createGameState({ code: 'TEST', seed: opts.seed ?? 'test' });
  for (const s of sleds) addPlayer(state, s.id, s.name ?? s.id, s.isBot ?? false, s.botLevel);
  state.hostId = sleds[0]!.id;
  state.roundsTotal = opts.rounds ?? 3;
  setTrack(state, sleds[0]!.id, opts.trackId ?? 0);
  if (opts.powerUps !== undefined) state.powerUps = opts.powerUps;
  startMatch(state, sleds[0]!.id);
  for (const s of sleds) Object.assign(state.players[s.id]!, s);
  state.roundTick = COUNTDOWN_TICKS;
  return state;
}

/** Steps `ticks` times with the same held input for the given players; collects all events. */
export function run(state: GameState, ticks: number, inputs: Record<string, Partial<SledInput>> = {}): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const list = Object.entries(inputs).map(([playerId, inp]) => ({
      playerId,
      seq: state.tick + 1,
      steer: inp.steer ?? 0,
      throttle: inp.throttle ?? 0,
      fire: inp.fire ?? false,
      use: inp.use ?? false,
    }));
    events.push(...runTick(state, list));
  }
  return events;
}

export interface FlatTrackOptions {
  rows?: number;
  half?: number;
  slope?: number;
  obstacles?: Obstacle[];
  ramps?: Ramp[];
  patches?: Patch[];
  piles?: Pile[];
  gifts?: Pile[];
}

/** A straight synthetic track (center x = 0) for exact physics tests, bucketed like a generated one. */
export function flatTrack(opts: FlatTrackOptions = {}): Track {
  const rowCount = opts.rows ?? 200;
  const track: Track = {
    trackId: 0,
    seed: 0,
    name: 'test',
    rowCount,
    center: new Array<number>(rowCount).fill(0),
    half: new Array<number>(rowCount).fill(opts.half ?? px(200)),
    slope: new Array<number>(rowCount).fill(opts.slope ?? 100),
    startY: START_ROW * ROW_LEN,
    finishY: (rowCount - 20) * ROW_LEN,
    endY: (rowCount - 1) * ROW_LEN,
    obstacles: opts.obstacles ?? [],
    ramps: opts.ramps ?? [],
    patches: opts.patches ?? [],
    piles: opts.piles ?? [],
    gifts: opts.gifts ?? [],
    rowObstacles: [],
    rowRamps: [],
    rowPatches: [],
    rowPiles: [],
    rowGifts: [],
  };
  for (let r = 0; r < rowCount; r++) {
    track.rowObstacles.push([]);
    track.rowRamps.push([]);
    track.rowPatches.push([]);
    track.rowPiles.push([]);
    track.rowGifts.push([]);
  }
  const row = (y: number) => Math.floor(y / ROW_LEN);
  track.obstacles.forEach((o, i) => track.rowObstacles[row(o.y)]!.push(i));
  track.ramps.forEach((r, i) => track.rowRamps[row(Math.trunc((r.y0 + r.y1) / 2))]!.push(i));
  track.piles.forEach((p, i) => track.rowPiles[row(p.y)]!.push(i));
  track.gifts.forEach((g, i) => track.rowGifts[row(g.y)]!.push(i));
  track.patches.forEach((p, i) => {
    for (let r = row(p.y0); r < Math.min(rowCount, row(p.y1 - 1) + 1); r++) track.rowPatches[r]!.push(i);
  });
  return track;
}

/** A bare sled for physics tests: standing at (x, y) facing downhill. */
export function sled(over: Partial<PlayerState> = {}): PlayerState {
  const state = createGameState({ code: 'S', seed: 1 });
  addPlayer(state, 's', 'S');
  return Object.assign(state.players.s!, { racing: true, x: 0, y: px(1000), heading: DOWNHILL }, over);
}

/** Every number anywhere in the value, with its path. */
export function numbersIn(value: unknown, path = 'state'): [string, number][] {
  if (typeof value === 'number') return [[path, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => numbersIn(v, `${path}.${k}`));
  }
  return [];
}
