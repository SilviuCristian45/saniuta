import type { DatabaseSync } from 'node:sqlite';
import {
  FIXED_TRACK_IDS,
  LEADERBOARD_MIN_HUMANS,
  LEADERBOARD_SIZE,
  nameKey,
  sanitizeName,
  ticksToMs,
  type GameState,
  type LeaderboardEntry,
  type NewRecord,
} from '@saniuta/shared';
import { openDb, transaction } from './sqlite';

// All-time leaderboard in SQLite (node:sqlite, built into Node 22: nothing native to bundle).
// Every counted online run is kept (runs + times); the leaderboard is a query over them: on each
// fixed track, each nickname's best time, the fastest first (ties: whoever set it first).

/** Server-side cache of the top rows; a saved run clears it at once. */
const TOP_CACHE_MS = 30_000;

/**
 * Schema steps, applied in order at startup; schema_version holds how many have run.
 * Never edit a released step: append a new one.
 */
export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE runs (
     id INTEGER PRIMARY KEY,
     room TEXT NOT NULL,
     track_id INTEGER NOT NULL,
     ended_at TEXT NOT NULL, -- ISO 8601, UTC
     humans INTEGER NOT NULL, -- humans who played this run for real
     bots INTEGER NOT NULL
   );
   CREATE TABLE times (
     id INTEGER PRIMARY KEY,
     run_id INTEGER NOT NULL REFERENCES runs(id),
     track_id INTEGER NOT NULL,
     name TEXT NOT NULL,
     name_key TEXT NOT NULL, -- sanitized, lowercased nickname: one leaderboard row per name_key and track
     ticks INTEGER NOT NULL -- run time in simulation ticks (30 per second), from HAI! to the line
   );
   CREATE INDEX times_track_key ON times(track_id, name_key);`,
];

export interface FinishTime {
  playerId: string;
  name: string;
  ticks: number;
}

/** What a counted run leaves in the database. */
export interface RunResult {
  room: string;
  trackId: number;
  endedAt: Date;
  humans: number;
  bots: number;
  /** Humans who played for real, still in the room, and crossed the line. */
  times: FinishTime[];
}

/**
 * The result of a run that just ended, or null if it does not count: a random track, power-ups on, fewer than
 * LEADERBOARD_MIN_HUMANS humans who played it for real, or nobody of them crossed the line.
 */
export function runResult(
  state: Readonly<GameState>,
  endedAt: Date,
  /** "Played for real" this run (the room's activity rule): a sled left to slide on its own does not count. */
  playedForReal: (playerId: string) => boolean,
): RunResult | null {
  // Power-ups change the times (wax, giant snowballs): only runs without them are comparable.
  if (!FIXED_TRACK_IDS.includes(state.trackId) || state.powerUps) return null;
  const racers = Object.values(state.players).filter((p) => p.racing || p.left);
  const active = racers.filter((p) => !p.isBot && playedForReal(p.id));
  if (active.length < LEADERBOARD_MIN_HUMANS) return null;
  const times = active
    .filter((p) => !p.left && p.finished && p.finishTicks > 0)
    .map((p) => ({ playerId: p.id, name: p.name, ticks: p.finishTicks }));
  if (times.length === 0) return null;
  return {
    room: state.code,
    trackId: state.trackId,
    endedAt,
    humans: active.length,
    bots: racers.filter((p) => p.isBot).length,
    times,
  };
}

/** On one track, each nickname's best time with its place and run count; the ORDER BY clauses are the ranking rule. */
const BEST = `
  WITH best AS (
    SELECT t.id, t.name, t.name_key, t.ticks, r.ended_at,
           ROW_NUMBER() OVER (PARTITION BY t.name_key ORDER BY t.ticks, r.ended_at, t.id) AS nth,
           COUNT(*) OVER (PARTITION BY t.name_key) AS runs
    FROM times t JOIN runs r ON r.id = t.run_id
    WHERE t.track_id = ?
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY ticks, ended_at, id) AS place
    FROM best WHERE nth = 1
  )`;

export class Leaderboard {
  private cache: { expires: number; tracks: Record<string, LeaderboardEntry[]> } | null = null;

  constructor(private readonly db: DatabaseSync) {}

  /**
   * Saves a counted run. Returns the players whose time is now their best on that track and who
   * either entered the top LEADERBOARD_SIZE ('top') or beat a best time they already had ('record').
   */
  record(result: RunResult): NewRecord[] {
    const keys = [...new Set(result.times.map((t) => nameKey(t.name)))];
    const before = new Map(this.places(result.trackId, keys).map((row) => [row.name_key, row.place]));

    const inserted = new Map<number, FinishTime>();
    transaction(this.db, () => {
      const run = this.db
        .prepare('INSERT INTO runs (room, track_id, ended_at, humans, bots) VALUES (?, ?, ?, ?, ?)')
        .run(result.room, result.trackId, result.endedAt.toISOString(), result.humans, result.bots);
      const insert = this.db.prepare('INSERT INTO times (run_id, track_id, name, name_key, ticks) VALUES (?, ?, ?, ?, ?)');
      for (const t of result.times) {
        // Names come sanitized from the room already; again here, so the table never holds anything else.
        const row = insert.run(run.lastInsertRowid, result.trackId, sanitizeName(t.name), nameKey(t.name), t.ticks);
        inserted.set(Number(row.lastInsertRowid), t);
      }
    });
    this.cache = null;

    const records: NewRecord[] = [];
    for (const row of this.places(result.trackId, keys)) {
      // Only a time from this run that is now the nickname's best counts.
      const t = inserted.get(row.id);
      if (!t) continue;
      const was = before.get(row.name_key);
      const base = { playerId: t.playerId, name: t.name, trackId: result.trackId, place: row.place };
      const entered = row.place <= LEADERBOARD_SIZE && (was === undefined || was > LEADERBOARD_SIZE);
      if (entered) records.push({ ...base, kind: 'top' });
      else if (was !== undefined) records.push({ ...base, kind: 'record' });
    }
    return records.sort((a, b) => a.place - b.place);
  }

  /** The top LEADERBOARD_SIZE of every fixed track (by track id as a string), cached for TOP_CACHE_MS. */
  top(now = Date.now()): Record<string, LeaderboardEntry[]> {
    if (this.cache && now < this.cache.expires) return this.cache.tracks;
    const tracks: Record<string, LeaderboardEntry[]> = {};
    const query = this.db.prepare(`${BEST} SELECT place, name, ticks, runs, ended_at FROM ranked ORDER BY place LIMIT ?`);
    for (const trackId of FIXED_TRACK_IDS) {
      const rows = query.all(trackId, LEADERBOARD_SIZE) as { place: number; name: string; ticks: number; runs: number; ended_at: string }[];
      tracks[String(trackId)] = rows.map((r) => ({ place: r.place, name: r.name, ms: ticksToMs(r.ticks), runs: r.runs, setAt: r.ended_at }));
    }
    this.cache = { expires: now + TOP_CACHE_MS, tracks };
    return tracks;
  }

  close(): void {
    this.db.close();
  }

  /** The best time (row id) and place on a track of each of these nicknames that has one. */
  private places(trackId: number, keys: string[]): { id: number; name_key: string; place: number }[] {
    return this.db
      .prepare(`${BEST} SELECT id, name_key, place FROM ranked WHERE name_key IN (SELECT value FROM json_each(?))`)
      .all(trackId, JSON.stringify(keys)) as { id: number; name_key: string; place: number }[];
  }
}

/** Opens (and migrates) the database at `path`, ':memory:' for tests; null (logged) means no leaderboard. */
export function openLeaderboard(path: string): Leaderboard | null {
  const db = openDb(path, MIGRATIONS);
  return db ? new Leaderboard(db) : null;
}

let active: Leaderboard | null = null;

/** The leaderboard rooms save to and GET /leaderboard reads (null = none). */
export function currentLeaderboard(): Leaderboard | null {
  return active;
}

export function useLeaderboard(leaderboard: Leaderboard | null): void {
  active = leaderboard;
}
