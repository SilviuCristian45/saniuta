import type { ArraySchema, MapSchema } from '@colyseus/schema';
import { GAME_ARRAY_KEYS, GAME_STATE_KEYS, PLAYER_STATE_KEYS, type GameState } from '@saniuta/shared';
import { PlayerSchema, type RoomState } from './schema';

// Copies the authoritative GameState into the schema after every tick. Only values that
// differ are assigned, so a patch carries just what changed. The simulation never reads
// the schema: determinism lives entirely in GameState.

export function mirror(src: Readonly<GameState>, dst: RoomState): void {
  assign(dst, src, GAME_STATE_KEYS);
  for (const key of GAME_ARRAY_KEYS) syncArray(src[key], dst[key]);
  syncPlayers(src, dst.players);
}

function syncPlayers(src: Readonly<GameState>, dst: MapSchema<PlayerSchema>): void {
  for (const id of [...dst.keys()]) if (!src.players[id]) dst.delete(id);
  for (const p of Object.values(src.players)) {
    let view = dst.get(p.id);
    if (!view) {
      view = new PlayerSchema();
      assign(view, p, PLAYER_STATE_KEYS);
      dst.set(p.id, view);
    } else assign(view, p, PLAYER_STATE_KEYS);
  }
}

/** Same length and values, element by element (a new track changes the number of piles). */
function syncArray(src: readonly number[], dst: ArraySchema<number>): void {
  while (dst.length > src.length) dst.pop();
  src.forEach((value, i) => {
    if (i >= dst.length) dst.push(value);
    else if (dst[i] !== value) dst[i] = value;
  });
}

type Fields<K extends string> = { [P in K]: unknown };

/** Both sides must have every key; values are copied as-is (the schema field types mirror GameState). */
function assign<K extends string>(dst: Fields<K>, src: Readonly<Fields<K>>, keys: readonly K[]): void {
  for (const key of keys) {
    if (dst[key] !== src[key]) dst[key] = src[key];
  }
}
