// The one place that reaches into @colyseus/sdk's internals (pinned to 0.18.10 in package.json).
// The SDK retries a dropped connection with growing pauses (up to 5 s) and has no public way to say
// "try now"; a page coming back from the background wants exactly that. Everything here is checked
// first: if a future SDK renames or changes these internals, retryReconnectionNow does nothing and the
// SDK's normal schedule applies (client/test/sdkReconnect.test.ts fails then, so an update shows it).

/** The internals used, as they are in @colyseus/sdk 0.18.10 (Room.mjs). */
interface RoomInternals {
  retryTimeout?: ReturnType<typeof setTimeout>;
  retryReconnection?: () => void;
  reconnectionToken?: unknown;
  reconnection?: { retryCount?: unknown; isReconnecting?: unknown };
  connection?: { reconnect?: unknown; transport?: { ws?: { readyState?: unknown } } };
}

/** WebSocket.CONNECTING, without needing a WebSocket global. */
const CONNECTING = 0;

/** Whether this SDK build still has the internals retryReconnectionNow relies on. */
export function hasReconnectInternals(room: unknown): boolean {
  const r = room as RoomInternals;
  return typeof r?.retryReconnection === 'function' && typeof r.reconnection?.retryCount === 'number' && typeof r.reconnection.isReconnecting === 'boolean';
}

/**
 * While the SDK is reconnecting: a fresh set of attempts, the first one started right here (unless one
 * is under way). Synchronously, not through a timer: Chrome holds back the timers of a page that has
 * just come back from the background (its background budget), so even the SDK's shortest pause
 * (0.2 s) could turn into seconds with the game frozen. Returns whether it intervened; never throws.
 */
export function retryReconnectionNow(room: unknown): boolean {
  try {
    if (!hasReconnectInternals(room)) return false;
    const r = room as Required<Pick<RoomInternals, 'retryReconnection'>> & RoomInternals & { reconnection: { retryCount: number; isReconnecting: boolean } };
    if (!r.reconnection.isReconnecting) return false;
    r.reconnection.retryCount = 0;
    if (r.connection?.transport?.ws?.readyState === CONNECTING) return false; // an attempt is under way
    clearTimeout(r.retryTimeout);
    const reconnect = r.connection?.reconnect;
    const token = typeof r.reconnectionToken === 'string' ? r.reconnectionToken.split(':')[1] : undefined;
    if (typeof reconnect !== 'function' || !token) {
      r.retryReconnection(); // the SDK's own next attempt, after its shortest pause
      return true;
    }
    // What the SDK's retry timer does when it fires (Room.retryReconnection); a failure lands in the
    // SDK's onclose, which schedules the next attempt as usual.
    r.reconnection.retryCount = 1;
    try {
      reconnect.call(r.connection, { reconnectionToken: token, skipHandshake: true });
    } catch {
      r.retryReconnection();
    }
    return true;
  } catch {
    return false; // the SDK's own schedule goes on
  }
}
