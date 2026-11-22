import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

// SQLite through node:sqlite (built into Node 22: nothing native to bundle, works in the esbuild bundle).
// Extracted from bumper-cars/server/src/leaderboard.ts; the leaderboard tables, queries and cache stay
// in the game's own module, which calls openDb(path, MIGRATIONS).

/**
 * Brings the schema up to date, one transaction per step; schema_version holds how many have run.
 * Never edit a released step: append a new one. Throws on a schema newer than this code.
 */
export function migrate(db: DatabaseSync, migrations: readonly string[]): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  let row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  if (!row) {
    db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
    row = { version: 0 };
  }
  if (row.version > migrations.length) {
    throw new Error(`schema ${row.version} is newer than this server (${migrations.length})`);
  }
  for (let v = row.version; v < migrations.length; v++) {
    transaction(db, () => {
      db.exec(migrations[v]!);
      db.prepare('UPDATE schema_version SET version = ?').run(v + 1);
    });
  }
  return migrations.length;
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Opens and migrates the database at `path` (':memory:' for tests). Any failure is logged and gives
 * null: the game runs on without the feature, it never crashes because of the database.
 */
export function openDb(path: string, migrations: readonly string[]): DatabaseSync | null {
  let db: DatabaseSync | undefined;
  try {
    // Loaded at runtime: Node 22.12 only has node:sqlite with --experimental-sqlite (22.13+ always does).
    const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite') | undefined;
    if (!sqlite) throw new Error('node:sqlite is not available (Node < 22.13 without --experimental-sqlite)');
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    db = new sqlite.DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 2000; PRAGMA foreign_keys = ON;');
    migrate(db, migrations);
    return db;
  } catch (err) {
    console.error(`Database disabled: cannot open ${path}:`, err);
    try {
      db?.close();
    } catch {
      // already closed
    }
    return null;
  }
}
