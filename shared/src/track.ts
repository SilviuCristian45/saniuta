import {
  FP,
  GIFT_RADIUS,
  OBSTACLE_ROCK,
  OBSTACLE_TREE,
  PILE_RADIUS,
  ROCK_RADIUS,
  SLED_RADIUS,
  SURFACE_DEEP,
  SURFACE_ICE,
  SURFACE_SNOW,
  TRACK_BUNICII,
  TRACK_LUPULUI,
  TRACK_NEBUNILOR,
  TRACK_RANDOM,
  TREE_RADIUS,
} from './constants';
import { clamp, idiv } from './fixed';
import { nextInt, seedFrom, type RngHolder } from './rng';

// The slope, generated from (trackId, seed) with its own RNG: the client and the server build the
// same track without sending it, and generating it never touches GameState.rng. The track is a
// list of rows ROW_LEN apart, each with a center x, a half width and a steepness; between rows
// everything is interpolated. Obstacles, ramps and piles are bucketed by the row of their center
// (their reach plus a sled's is under one row, so a query looks at the row and its neighbours).

/** Distance between track rows. */
export const ROW_LEN = 32 * FP;
/** The start line is at this row; sleds line up just above it. */
export const START_ROW = 6;
/** Rows after the start line with nothing on the track. */
const CLEAR_START_ROWS = 14;
/** Rows of run-out after the finish line (no obstacles: finished sleds slow down there). */
const RUNOUT_ROWS = 30;
/** Half width of the start area (6 sleds side by side). */
const START_HALF = 200 * FP;
/** Ramp size: across x along. */
const RAMP_HALF_WIDTH = 40 * FP;
const RAMP_DEPTH = 22 * FP;
/** Free space kept around a ramp's approach and around piles. */
const RAMP_CLEAR_X = 90 * FP;
const PILE_CLEAR = 40 * FP;
/** A line of gift boxes across the track roughly every this many rows, the first one this far down. */
const GIFT_EVERY_ROWS = 48;
const GIFT_FIRST_ROW = START_ROW + 30;
/** Boxes per line (spread across the track), and the room kept around each. */
const GIFTS_PER_LINE = 3;
const GIFT_CLEAR = 36 * FP;
/** Every stretch of the track keeps an opening at least this wide between obstacles. */
const MIN_OPENING = 6 * SLED_RADIUS;

export interface TrackDef {
  name: string;
  /** Fixed tracks always use this seed. */
  seed: string;
  /** Rows between the start and the finish line. */
  rows: number;
  halfMin: number;
  halfMax: number;
  /** Largest distance of the center from x = 0. */
  bendAmp: number;
  /** Largest center shift between two bend waypoints, in percent of the distance between them. */
  bendShiftPct: number;
  bendRowsMin: number;
  bendRowsMax: number;
  slopeMin: number;
  slopeMax: number;
  /** Percent of slope waypoints that are a steep drop of steepMax. */
  steepPct: number;
  steepMax: number;
  /** Percent of rows that get a tree / a rock. */
  treePct: number;
  rockPct: number;
  /** Smallest distance between two obstacles. */
  minGap: number;
  ramps: number;
  /** Percent of ramps with a rock right behind them (jump it or go around). */
  rampRockPct: number;
  icePatches: number;
  deepPatches: number;
  /** A snowball pile roughly every this many rows. */
  pileEvery: number;
}

export const TRACK_DEFS: Record<number, TrackDef> = {
  [TRACK_BUNICII]: {
    name: 'Pârtia Bunicii',
    seed: 'partia-bunicii',
    rows: 600,
    halfMin: 150 * FP,
    halfMax: 210 * FP,
    bendAmp: 160 * FP,
    bendShiftPct: 40,
    bendRowsMin: 18,
    bendRowsMax: 30,
    slopeMin: 85,
    slopeMax: 115,
    steepPct: 0,
    steepMax: 115,
    treePct: 9,
    rockPct: 3,
    minGap: 110 * FP,
    ramps: 4,
    rampRockPct: 0,
    icePatches: 2,
    deepPatches: 3,
    pileEvery: 14,
  },
  [TRACK_LUPULUI]: {
    name: 'Valea Lupului',
    seed: 'valea-lupului',
    rows: 640,
    halfMin: 120 * FP,
    halfMax: 180 * FP,
    bendAmp: 260 * FP,
    bendShiftPct: 65,
    bendRowsMin: 14,
    bendRowsMax: 26,
    slopeMin: 80,
    slopeMax: 130,
    steepPct: 20,
    steepMax: 150,
    treePct: 12,
    rockPct: 6,
    minGap: 95 * FP,
    ramps: 6,
    rampRockPct: 40,
    icePatches: 5,
    deepPatches: 5,
    pileEvery: 16,
  },
  [TRACK_NEBUNILOR]: {
    name: 'Coborârea Nebunilor',
    seed: 'coborarea-nebunilor',
    rows: 680,
    halfMin: 95 * FP,
    halfMax: 150 * FP,
    bendAmp: 340 * FP,
    bendShiftPct: 75,
    bendRowsMin: 11,
    bendRowsMax: 22,
    slopeMin: 85,
    slopeMax: 145,
    steepPct: 30,
    steepMax: 170,
    treePct: 15,
    rockPct: 7,
    minGap: 85 * FP,
    ramps: 8,
    rampRockPct: 70,
    icePatches: 9,
    deepPatches: 6,
    pileEvery: 18,
  },
};

export const RANDOM_TRACK_NAME = 'Pârtie aleatoare';

/** The name shown for a track id. */
export function trackName(trackId: number): string {
  return TRACK_DEFS[trackId]?.name ?? RANDOM_TRACK_NAME;
}

/** The seed a run on a fixed track always uses. */
export function fixedTrackSeed(trackId: number): number {
  return seedFrom(TRACK_DEFS[trackId]!.seed);
}

export interface Obstacle {
  kind: number; // OBSTACLE_TREE | OBSTACLE_ROCK
  x: number;
  y: number;
  r: number;
}

/** A ramp: an axis-aligned rectangle; a fast sled whose center enters it takes off. */
export interface Ramp {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * A stretch of ice or deep snow between two y values; across, it follows the track: lo/hi are
 * per-mille of the half width from the center (-1000 = left edge, 1000 = right edge).
 */
export interface Patch {
  kind: number; // SURFACE_ICE | SURFACE_DEEP
  y0: number;
  y1: number;
  lo: number;
  hi: number;
}

export interface Pile {
  x: number;
  y: number;
}

export interface Track {
  trackId: number;
  seed: number;
  name: string;
  /** Rows 0..rowCount-1. */
  rowCount: number;
  center: number[];
  half: number[];
  /** Steepness in percent: gravity along the slope is GRAVITY × slope / 100. */
  slope: number[];
  startY: number;
  finishY: number;
  /** The end of the run-out: nothing goes further. */
  endY: number;
  obstacles: Obstacle[];
  ramps: Ramp[];
  patches: Patch[];
  piles: Pile[];
  /** Gift boxes (power-ups); drawn and taken only when the room has power-ups on. */
  gifts: Pile[];
  rowObstacles: number[][];
  rowRamps: number[][];
  rowPatches: number[][];
  rowPiles: number[][];
  rowGifts: number[][];
}

/** Row of a y (clamped to the track). */
export function rowOf(track: Track, y: number): number {
  return clamp(Math.floor(y / ROW_LEN), 0, track.rowCount - 1);
}

/** A row value interpolated at y. */
function lerpRow(track: Track, values: number[], y: number): number {
  if (y <= 0) return values[0]!;
  const r = Math.floor(y / ROW_LEN);
  if (r >= track.rowCount - 1) return values[track.rowCount - 1]!;
  const a = values[r]!;
  return a + idiv((values[r + 1]! - a) * (y - r * ROW_LEN), ROW_LEN);
}

export function centerAt(track: Track, y: number): number {
  return lerpRow(track, track.center, y);
}

export function halfWidthAt(track: Track, y: number): number {
  return lerpRow(track, track.half, y);
}

export function slopeAt(track: Track, y: number): number {
  return lerpRow(track, track.slope, y);
}

/** Surface under a point: the first patch that covers it, otherwise packed snow. */
export function surfaceAt(track: Track, x: number, y: number): number {
  const list = track.rowPatches[rowOf(track, y)]!;
  if (list.length === 0) return SURFACE_SNOW;
  const half = halfWidthAt(track, y);
  const off = idiv((x - centerAt(track, y)) * 1000, Math.max(half, 1));
  for (const i of list) {
    const p = track.patches[i]!;
    if (y >= p.y0 && y < p.y1 && off >= p.lo && off <= p.hi) return p.kind;
  }
  return SURFACE_SNOW;
}

/** Indices in a row-bucketed list near y (the row of y and both neighbours), each once. */
export function nearby(track: Track, buckets: number[][], y: number): number[] {
  const r = rowOf(track, y);
  const out: number[] = [];
  for (let i = Math.max(0, r - 1); i <= Math.min(track.rowCount - 1, r + 1); i++) out.push(...buckets[i]!);
  return out;
}

/** Indices of items whose center row lies within [y0, y1] (for bots looking ahead). */
export function itemsBetween(track: Track, buckets: number[][], y0: number, y1: number): number[] {
  const out: number[] = [];
  for (let r = rowOf(track, y0); r <= rowOf(track, y1); r++) out.push(...buckets[r]!);
  return out;
}

// --- generation -------------------------------------------------------------------------------

const cache = new Map<string, Track>();
const CACHE_SIZE = 8;

/** The track for a run (generated once per (trackId, seed), then cached). Pure: same input, same track. */
export function getTrack(trackId: number, seed: number): Track {
  const key = `${trackId}:${seed}`;
  let track = cache.get(key);
  if (!track) {
    track = generateTrack(trackId, seed);
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
    cache.set(key, track);
  }
  return track;
}

/** Inclusive integer range. */
function randInt(rng: RngHolder, lo: number, hi: number): number {
  return lo + nextInt(rng, hi - lo + 1);
}

/** A random track's parameters: every number somewhere between the easy and the hard track. */
function randomDef(rng: RngHolder): TrackDef {
  const easy = TRACK_DEFS[TRACK_BUNICII]!;
  const hard = TRACK_DEFS[TRACK_NEBUNILOR]!;
  const t = randInt(rng, 200, 800); // per-mille toward the hard track
  const mix = (a: number, b: number) => a + idiv((b - a) * t, 1000);
  return {
    name: RANDOM_TRACK_NAME,
    seed: '',
    rows: mix(easy.rows, hard.rows),
    halfMin: mix(easy.halfMin, hard.halfMin),
    halfMax: mix(easy.halfMax, hard.halfMax),
    bendAmp: mix(easy.bendAmp, hard.bendAmp),
    bendShiftPct: mix(easy.bendShiftPct, hard.bendShiftPct),
    bendRowsMin: mix(easy.bendRowsMin, hard.bendRowsMin),
    bendRowsMax: mix(easy.bendRowsMax, hard.bendRowsMax),
    slopeMin: mix(easy.slopeMin, hard.slopeMin),
    slopeMax: mix(easy.slopeMax, hard.slopeMax),
    steepPct: mix(easy.steepPct, hard.steepPct),
    steepMax: mix(easy.steepMax, hard.steepMax),
    treePct: mix(easy.treePct, hard.treePct),
    rockPct: mix(easy.rockPct, hard.rockPct),
    minGap: mix(easy.minGap, hard.minGap),
    ramps: mix(easy.ramps, hard.ramps),
    rampRockPct: mix(easy.rampRockPct, hard.rampRockPct),
    icePatches: mix(easy.icePatches, hard.icePatches),
    deepPatches: mix(easy.deepPatches, hard.deepPatches),
    pileEvery: mix(easy.pileEvery, hard.pileEvery),
  };
}

/** Smoothstep between two values, t in per-mille: eases in and out of every bend. */
function smooth(a: number, b: number, t: number): number {
  const s = idiv(t * t * (3000 - 2 * t), 1_000_000);
  return a + idiv((b - a) * s, 1000);
}

/**
 * A value per row: constant `start` up to `from`, then smooth moves between waypoints placed every
 * gapMin..gapMax rows (each picked from the previous one), constant again from `to`.
 */
function waypointSeries(
  rng: RngHolder,
  rowCount: number,
  from: number,
  to: number,
  gapMin: number,
  gapMax: number,
  start: number,
  pick: (prev: number, gap: number) => number,
): number[] {
  const out = new Array<number>(rowCount).fill(start);
  let r0 = from;
  let v0 = start;
  while (r0 < to) {
    const gap = Math.min(randInt(rng, gapMin, gapMax), to - r0);
    const r1 = r0 + gap;
    const v1 = r1 >= to ? v0 : pick(v0, gap);
    for (let r = r0; r <= r1; r++) out[r] = smooth(v0, v1, idiv((r - r0) * 1000, gap));
    r0 = r1;
    v0 = v1;
  }
  for (let r = to; r < rowCount; r++) out[r] = v0;
  return out;
}

/** Builds a track from scratch (getTrack caches it; tests compare two fresh builds). */
export function generateTrack(trackId: number, seed: number): Track {
  const rng: RngHolder = { rng: seed };
  const def = trackId === TRACK_RANDOM ? randomDef(rng) : TRACK_DEFS[trackId] ?? TRACK_DEFS[TRACK_BUNICII]!;
  const finishRow = START_ROW + def.rows;
  const rowCount = finishRow + RUNOUT_ROWS + 1;
  const firstRow = START_ROW + CLEAR_START_ROWS;
  const lastRow = finishRow - 4;

  // Bends: the center wanders within ±bendAmp, never shifting faster than bendShiftPct allows.
  const center = waypointSeries(rng, rowCount, START_ROW + 4, finishRow - 6, def.bendRowsMin, def.bendRowsMax, 0, (prev, gap) => {
    const maxShift = idiv(gap * ROW_LEN * def.bendShiftPct, 100);
    const lo = Math.max(-def.bendAmp, prev - maxShift);
    const hi = Math.min(def.bendAmp, prev + maxShift);
    return randInt(rng, lo, hi);
  });
  // Width: wide at the start, narrowing into the track's own range.
  const half = waypointSeries(rng, rowCount, START_ROW + 2, finishRow - 2, 20, 40, START_HALF, () =>
    randInt(rng, def.halfMin, def.halfMax),
  );
  const slope = waypointSeries(rng, rowCount, START_ROW, finishRow, 15, 30, 100, () =>
    randInt(rng, 0, 99) < def.steepPct ? def.steepMax : randInt(rng, def.slopeMin, def.slopeMax),
  );

  const track: Track = {
    trackId,
    seed,
    name: def.name,
    rowCount,
    center,
    half,
    slope,
    startY: START_ROW * ROW_LEN,
    finishY: finishRow * ROW_LEN,
    endY: (rowCount - 1) * ROW_LEN,
    obstacles: [],
    ramps: [],
    patches: [],
    piles: [],
    gifts: [],
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
  const rowY = (r: number) => r * ROW_LEN + idiv(ROW_LEN, 2);
  /** A random x across row r, keeping `margin` from both edges. */
  const randomX = (r: number, margin: number) => {
    const reach = Math.max(0, half[r]! - margin);
    return center[r]! + randInt(rng, -reach, reach);
  };

  // Ramps first, spread over the course; their approach stays clear.
  const span = lastRow - firstRow;
  for (let i = 0; i < def.ramps; i++) {
    const part0 = firstRow + idiv(span * i, def.ramps);
    const part1 = firstRow + idiv(span * (i + 1), def.ramps);
    const r = randInt(rng, part0 + idiv(part1 - part0, 4), part1 - idiv(part1 - part0, 4));
    const x = randomX(r, RAMP_HALF_WIDTH + 30 * FP);
    const y = rowY(r);
    track.ramps.push({ x0: x - RAMP_HALF_WIDTH, x1: x + RAMP_HALF_WIDTH, y0: y - idiv(RAMP_DEPTH, 2), y1: y + idiv(RAMP_DEPTH, 2) });
    track.rowRamps[r]!.push(track.ramps.length - 1);
    // A rock right behind the ramp, where it is still on the track and leaves a way around.
    const rockY = rowY(r + 4);
    if (
      randInt(rng, 0, 99) < def.rampRockPct &&
      Math.abs(x - centerAt(track, rockY)) <= halfWidthAt(track, rockY) - ROCK_RADIUS - 6 * FP &&
      roomFor(track, x, rockY, ROCK_RADIUS, def.minGap)
    ) {
      addObstacle(track, OBSTACLE_ROCK, x, rockY);
    }
  }

  const nearRampApproach = (x: number, y: number) =>
    track.ramps.some((ramp) => {
      const rx = idiv(ramp.x0 + ramp.x1, 2);
      return y > ramp.y0 - 6 * ROW_LEN && y < ramp.y1 + ROW_LEN && Math.abs(x - rx) < RAMP_CLEAR_X;
    });

  // Trees and rocks, kept apart and never closing the way.
  for (let r = firstRow; r <= lastRow; r++) {
    for (const [kind, pct, radius] of [
      [OBSTACLE_TREE, def.treePct, TREE_RADIUS],
      [OBSTACLE_ROCK, def.rockPct, ROCK_RADIUS],
    ] as const) {
      if (randInt(rng, 0, 99) >= pct) continue;
      const x = randomX(r, radius + 6 * FP);
      const y = rowY(r);
      if (nearRampApproach(x, y)) continue;
      if (!roomFor(track, x, y, radius, def.minGap)) continue;
      addObstacle(track, kind, x, y);
    }
  }

  // Ice and deep snow: ice anywhere across, deep snow mostly along one edge.
  for (let i = 0; i < def.icePatches + def.deepPatches; i++) {
    const ice = i < def.icePatches;
    const len = ice ? randInt(rng, 6, 16) : randInt(rng, 8, 20);
    const r0 = randInt(rng, firstRow, Math.max(firstRow, lastRow - len));
    let lo: number;
    let hi: number;
    if (ice) {
      const width = randInt(rng, 500, 2000);
      lo = randInt(rng, -1000, 1000 - Math.min(width, 2000));
      hi = lo + width;
    } else if (randInt(rng, 0, 99) < 70) {
      const width = randInt(rng, 350, 600);
      const left = randInt(rng, 0, 1) === 0;
      lo = left ? -1000 : 1000 - width;
      hi = left ? -1000 + width : 1000;
    } else {
      const width = randInt(rng, 300, 600);
      lo = randInt(rng, -700, 700 - width);
      hi = lo + width;
    }
    const patch: Patch = { kind: ice ? SURFACE_ICE : SURFACE_DEEP, y0: r0 * ROW_LEN, y1: (r0 + len) * ROW_LEN, lo, hi };
    track.patches.push(patch);
    for (let r = r0; r < r0 + len; r++) track.rowPatches[r]!.push(track.patches.length - 1);
  }

  // Snowball piles, away from obstacles and ramps.
  for (let r = firstRow + 2; r <= lastRow; r += randInt(rng, def.pileEvery - 4, def.pileEvery + 4)) {
    const x = randomX(r, PILE_RADIUS + 10 * FP);
    const y = rowY(r);
    const blocked =
      nearby(track, track.rowObstacles, y).some((i) => {
        const o = track.obstacles[i]!;
        return Math.abs(o.x - x) < o.r + PILE_CLEAR && Math.abs(o.y - y) < o.r + PILE_CLEAR;
      }) || track.ramps.some((ramp) => y > ramp.y0 - PILE_CLEAR && y < ramp.y1 + PILE_CLEAR && x > ramp.x0 - PILE_CLEAR && x < ramp.x1 + PILE_CLEAR);
    if (blocked) continue;
    track.piles.push({ x, y });
    track.rowPiles[r]!.push(track.piles.length - 1);
  }

  // Gift boxes last (everything above stays exactly as it was before they existed): lines of a few
  // boxes across the track, so a bunched field does not all fight over one.
  const clearOf = (x: number, y: number, list: readonly { x: number; y: number }[], idx: number[], gap: number) =>
    idx.every((i) => Math.abs(list[i]!.x - x) >= gap || Math.abs(list[i]!.y - y) >= gap);
  for (let r = GIFT_FIRST_ROW; r <= lastRow; r += randInt(rng, GIFT_EVERY_ROWS - 8, GIFT_EVERY_ROWS + 8)) {
    const y = rowY(r);
    const reach = half[r]! - GIFT_RADIUS - 24 * FP;
    for (let k = 0; k < GIFTS_PER_LINE; k++) {
      const x = center[r]! + idiv(reach * (2 * k - (GIFTS_PER_LINE - 1)), GIFTS_PER_LINE);
      const obstaclesClear = nearby(track, track.rowObstacles, y).every((i) => {
        const o = track.obstacles[i]!;
        return Math.abs(o.x - x) >= o.r + GIFT_CLEAR || Math.abs(o.y - y) >= o.r + GIFT_CLEAR;
      });
      const rampsClear = track.ramps.every(
        (ramp) => y <= ramp.y0 - GIFT_CLEAR || y >= ramp.y1 + GIFT_CLEAR || x <= ramp.x0 - GIFT_CLEAR || x >= ramp.x1 + GIFT_CLEAR,
      );
      if (!obstaclesClear || !rampsClear || !clearOf(x, y, track.piles, nearby(track, track.rowPiles, y), GIFT_CLEAR)) continue;
      track.gifts.push({ x, y });
      track.rowGifts[r]!.push(track.gifts.length - 1);
    }
  }
  return track;
}

function addObstacle(track: Track, kind: number, x: number, y: number): void {
  track.obstacles.push({ kind, x, y, r: kind === OBSTACLE_TREE ? TREE_RADIUS : ROCK_RADIUS });
  track.rowObstacles[rowOf(track, y)]!.push(track.obstacles.length - 1);
}

/**
 * Whether an obstacle fits at (x, y): at least minGap from every obstacle nearby, and across its
 * whole height (with a sled's reach) the track still has an opening of MIN_OPENING somewhere.
 */
function roomFor(track: Track, x: number, y: number, radius: number, minGap: number): boolean {
  const close = itemsBetween(track, track.rowObstacles, y - minGap, y + minGap).map((i) => track.obstacles[i]!);
  for (const o of close) {
    const dx = o.x - x;
    const dy = o.y - y;
    if (dx * dx + dy * dy < minGap * minGap) return false;
  }
  const all = [...close, { kind: OBSTACLE_ROCK, x, y, r: radius }];
  const reach = radius + SLED_RADIUS;
  for (let yy = y - reach; yy <= y + reach; yy += 2 * FP) {
    if (openingAt(track, all, yy) < MIN_OPENING) return false;
  }
  return true;
}

/** The widest free gap across the track at y, between obstacles a sled would touch there. */
function openingAt(track: Track, obstacles: readonly Obstacle[], y: number): number {
  const c = centerAt(track, y);
  const h = halfWidthAt(track, y);
  const blocked = obstacles
    .filter((o) => Math.abs(o.y - y) < o.r + SLED_RADIUS)
    .map((o) => [o.x - o.r - SLED_RADIUS, o.x + o.r + SLED_RADIUS] as const)
    .sort((a, b) => a[0] - b[0]);
  let free = c - h;
  let widest = 0;
  for (const [a, b] of blocked) {
    widest = Math.max(widest, a - free);
    free = Math.max(free, b);
  }
  return Math.max(widest, c + h - free);
}
