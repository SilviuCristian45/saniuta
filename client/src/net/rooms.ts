import { DEFAULT_ROUNDS, DEFAULT_TRACK } from '@saniuta/shared';
import type { GameTransport } from './GameTransport';
import { LocalTransport } from './LocalTransport';

// Where the menu gets its rooms from. The offline room runs the simulation in the browser with
// bots. Online rooms (the Colyseus server) come in stage 4: until then they fail with a message
// that offers the offline game.

/** Bots in a fresh offline room, so Start works right away. */
const OFFLINE_START_BOTS = 3;

/** A failed create/join, with a message for the menu. `offline` offers the offline game instead. */
export class RoomError extends Error {
  constructor(
    message: string,
    readonly offline = false,
  ) {
    super(message);
  }
}

const NOT_YET = 'Jocul online nu e gata încă. Poți juca offline cu boți.';

/** Whether this build talks to a server ("Creează joc" / "Intră la un prieten" go online). */
export const onlineEnabled = false;

export function createOfflineRoom(name: string): Promise<GameTransport> {
  return Promise.resolve(
    new LocalTransport({
      name,
      bots: OFFLINE_START_BOTS,
      rounds: DEFAULT_ROUNDS,
      trackId: DEFAULT_TRACK,
      seed: Math.random().toString(36).slice(2),
      autoStart: false,
    }),
  );
}

export function createRoom(_name: string): Promise<GameTransport> {
  return Promise.reject(new RoomError(NOT_YET, true));
}

export function joinRoom(_code: string, _name: string): Promise<GameTransport> {
  return Promise.reject(new RoomError(NOT_YET, true));
}
