import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Room } from '@colyseus/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasReconnectInternals, retryReconnectionNow } from '../src/net/sdkReconnect';

// sdkReconnect.ts reaches into @colyseus/sdk's Room. These tests run the real SDK: after an SDK update
// that renames or changes those internals they fail, instead of the "retry now on coming back" quietly
// doing nothing in production.

const CLOSED = 3;
const CONNECTING = 0;

/** A real SDK room after a dropped connection, with the socket layer replaced by a recorder. */
function droppedRoom() {
  const room = new Room('saniuta');
  const attempts: unknown[] = [];
  const internals = room as unknown as { reconnectionToken: string; connection: unknown; handleReconnection(code: number, reason: string): void };
  internals.reconnectionToken = 'ABCDEF:token';
  room.reconnection.minUptime = 0;
  const ws = { readyState: CLOSED };
  internals.connection = { reconnect: (params: unknown) => attempts.push(params), transport: { ws } };
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  internals.handleReconnection(1006, ''); // what the SDK does when the socket drops
  return { room, attempts, ws };
}

describe('retrying a dropped connection at once (SDK internals)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('pins the SDK version these internals were checked against', () => {
    const pinned = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> }).dependencies['@colyseus/sdk'];
    const installed = (createRequire(import.meta.url)('@colyseus/sdk/package.json') as { version: string }).version;
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/); // exact, no ^ or ~
    expect(installed).toBe(pinned);
  });

  it('finds the internals in this SDK', () => {
    expect(hasReconnectInternals(new Room('saniuta'))).toBe(true);
  });

  it("replaces the SDK's long back-off wait by an attempt now", () => {
    const { room, attempts } = droppedRoom();
    vi.advanceTimersByTime(1000); // the first attempt (0.2 s after the drop) runs; it fails offline
    attempts.length = 0;
    // Several failed attempts later (the page was hidden meanwhile): the SDK waits 5 s for the next one.
    room.reconnection.retryCount = 6;
    (room as unknown as { retryReconnection(): void }).retryReconnection();
    vi.advanceTimersByTime(1000);
    expect(attempts).toHaveLength(0);

    expect(retryReconnectionNow(room)).toBe(true);
    // Started right away, without waiting for any timer (a page just back from the background gets its
    // timers late): the same attempt the SDK's retry timer would make.
    expect(attempts).toEqual([{ reconnectionToken: 'token', skipHandshake: true }]);
    expect(room.reconnection.retryCount).toBe(1); // a fresh set of attempts
    vi.advanceTimersByTime(10_000);
    expect(attempts).toHaveLength(1); // the old 5 s timer was cancelled
  });

  it('a failed attempt goes back to the SDK schedule, from the shortest pause', () => {
    const { room, attempts } = droppedRoom();
    vi.advanceTimersByTime(1000);
    attempts.length = 0;
    room.reconnection.retryCount = 6;
    expect(retryReconnectionNow(room)).toBe(true);
    expect(attempts).toHaveLength(1);
    // The socket fails (still offline): the SDK's onclose path asks for the next attempt.
    (room as unknown as { handleReconnection(code: number, reason: string): void }).handleReconnection(1006, '');
    vi.advanceTimersByTime(450);
    expect(attempts).toHaveLength(2); // 0.4 s later, not 5 s
  });

  it('falls back to the SDK retry if starting the attempt throws', () => {
    const { room, attempts } = droppedRoom();
    vi.advanceTimersByTime(1000);
    attempts.length = 0;
    let fail = true;
    (room as unknown as { connection: { reconnect: (p: unknown) => void } }).connection.reconnect = (p) => {
      if (fail) {
        fail = false;
        throw new Error('socket');
      }
      attempts.push(p);
    };
    expect(retryReconnectionNow(room)).toBe(true);
    expect(attempts).toHaveLength(0);
    vi.advanceTimersByTime(450);
    expect(attempts).toHaveLength(1);
  });

  it('leaves an attempt that is under way alone', () => {
    const { room, attempts, ws } = droppedRoom();
    vi.advanceTimersByTime(300); // the first attempt starts
    expect(attempts).toHaveLength(1);
    ws.readyState = CONNECTING;
    expect(retryReconnectionNow(room)).toBe(false);
    vi.advanceTimersByTime(300);
    expect(attempts).toHaveLength(1);
  });

  it('does nothing when the SDK is not reconnecting', () => {
    expect(retryReconnectionNow(new Room('saniuta'))).toBe(false);
  });

  it('falls back to the normal schedule, without throwing, if the internals are missing or break', () => {
    expect(retryReconnectionNow({})).toBe(false);
    expect(retryReconnectionNow(null)).toBe(false);
    expect(retryReconnectionNow({ retryReconnection: 'x', reconnection: { retryCount: 0, isReconnecting: true } })).toBe(false);
    const broken = {
      reconnection: { retryCount: 3, isReconnecting: true },
      retryReconnection: () => {
        throw new Error('changed');
      },
    };
    expect(retryReconnectionNow(broken)).toBe(false);
  });
});
