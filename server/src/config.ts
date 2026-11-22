import { TICK_RATE } from '@saniuta/shared';

/** Loopback only: Caddy is the public entry point. */
export const HOST = process.env.HOST ?? '127.0.0.1';
/** 2570 in dev and in production (saniuta.service); the server tests use 2571. */
export const PORT = Number(process.env.PORT ?? 2570);

/** Rooms alive at once; one more "Creează joc" is refused with "Serverul e plin" (1 GB VPS, shared). */
export const MAX_ROOMS = envInt('MAX_ROOMS', 20);

/** Seconds a dropped player keeps their place. */
export const RECONNECT_SECONDS = 15;

/** Messages per second (of any kind: 30 inputs, a ping, lobby clicks) above which a client is disconnected. */
export const MAX_MESSAGES_PER_SECOND = 2 * TICK_RATE;

// Per-IP limits. They only apply to requests that came through Caddy (from loopback, with
// X-Forwarded-For); anything else is logged and not limited. Sized for six friends behind one
// Wi-Fi (one address): they open one room, six connections, a few reconnections.

/** Rooms alive at once that were created from one address. */
export const MAX_ROOMS_PER_IP = envInt('MAX_ROOMS_PER_IP', 4);
/** Open WebSocket connections from one address. */
export const MAX_WS_PER_IP = envInt('MAX_WS_PER_IP', 24);
/** A lobby nobody starts is closed after this long (a room must not be held forever by an idle tab). */
export const LOBBY_IDLE_MINUTES = envInt('LOBBY_IDLE_MINUTES', 20);

/** Request rates per address: a burst, then a steady refill. */
export const RATES = {
  /** POST /matchmake/* (create, join by code, reconnect). */
  matchmake: { burst: 30, perMinute: 60 },
  /** POST /matchmake/create/*, on top of the above. */
  createRoom: { burst: 6, perMinute: 6 },
  /** WebSocket upgrades. */
  wsOpen: { burst: 30, perMinute: 60 },
  /** GET /rooms/:code. */
  roomStatus: { burst: 20, perMinute: 20 },
  /** GET /status (the deploy's public check). */
  status: { burst: 30, perMinute: 30 },
  /** Codes of rooms that do not exist (join, reconnect, /rooms/:code): makes guessing codes hopeless. */
  unknownCode: { burst: 20, perMinute: 4 },
  /** CSP violation reports written to the log, for the whole server. */
  cspReport: { burst: 20, perMinute: 20 },
} as const;

/** Pages allowed to call the server from a browser (CORS and the Origin of WebSocket upgrades). */
export const ALLOWED_ORIGINS: readonly string[] = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  : process.env.NODE_ENV === 'production'
    ? ['https://saniuta-la-vale.duckdns.org']
    : [];
/** Outside production, any http(s)://localhost / 127.0.0.1 / [::1] page is allowed too (the Vite dev server). */
export const ALLOW_LOCALHOST_ORIGINS = process.env.NODE_ENV !== 'production';

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
