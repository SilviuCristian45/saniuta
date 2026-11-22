// Resuming an online game after a reload of the tab. The server keeps a dropped player's seat for
// 15 s; the reconnection token (plus the room code, to tell an invite to another room apart) is kept
// in sessionStorage, so it survives a reload but not a new tab, and is dropped on a consented leave.

const TOKEN_KEY = 'saniuta.reconnect';

export interface SavedSeat {
  token: string;
  /** The room code ('' if unknown). */
  code: string;
}

/** The part of the Storage API used here (sessionStorage in the browser, a fake in tests). */
export type SeatStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** sessionStorage, or null where it is not available (private mode, blocked site data). */
export function sessionSeatStorage(): SeatStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadSeat(storage: SeatStorage | null): SavedSeat | null {
  try {
    const raw = storage?.getItem(TOKEN_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<SavedSeat>;
    if (typeof saved.token !== 'string' || !saved.token) return null;
    return { token: saved.token, code: typeof saved.code === 'string' ? saved.code : '' };
  } catch {
    return null;
  }
}

export function saveSeat(storage: SeatStorage | null, seat: SavedSeat | null): void {
  try {
    if (seat) storage?.setItem(TOKEN_KEY, JSON.stringify(seat));
    else storage?.removeItem(TOKEN_KEY);
  } catch {
    // reloading the tab just won't resume the room
  }
}

/** What the page does on load. */
export type StartupRoute =
  | { kind: 'normal' }
  /** Reconnect to the saved room right away (intro and name skipped). */
  | { kind: 'resume' }
  /** A ?room= link to another room while this tab still has a game: ask first. */
  | { kind: 'switch'; from: string; to: string };

/**
 * `seatCode` is the saved room's code (null when there is nothing to resume), `invite` the valid
 * code of a ?room= link. A link to the same room just resumes it.
 */
export function startupRoute(seatCode: string | null, invite: string | undefined): StartupRoute {
  if (seatCode === null) return { kind: 'normal' };
  if (invite !== undefined && invite !== seatCode) return { kind: 'switch', from: seatCode, to: invite };
  return { kind: 'resume' };
}
