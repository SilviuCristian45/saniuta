import { createServer as createHttpServer } from 'node:http';
import { createEndpoint, createRouter, defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { isValidRoomCode, normalizeRoomCode, ROOM_NAME } from '@saniuta/shared';
import { MAX_ROOMS } from './config';
import { DEFAULT_GUARD_OPTIONS, installGuard, isAllowedOrigin, type Guard, type GuardOptions } from './guard';
import { roomCount, roomStatus } from './registry';
import { SaniutaRoom } from './SaniutaRoom';

const health = createEndpoint('/health', { method: 'GET' }, async (ctx) =>
  ctx.json({ ok: true, rooms: roomCount(), maxRooms: MAX_ROOMS, uptime: Math.round(process.uptime()) }),
);

/**
 * Public "the game server is up" through Caddy (/colyseus/status), for push.ps1 and caddy-update.sh:
 * /health stays internal (it tells the room count), this says nothing but that.
 */
const status = createEndpoint('/status', { method: 'GET' }, async (ctx) => {
  ctx.setHeader('Cache-Control', 'no-store');
  return ctx.json({ ok: true });
});

/** Why a join by code failed: Colyseus reports both a full and a running room as "locked". */
const roomInfo = createEndpoint('/rooms/:code', { method: 'GET' }, async (ctx) => {
  const code = normalizeRoomCode(ctx.params.code);
  return ctx.json({ status: isValidRoomCode(code) ? roomStatus(code) : 'missing' });
});

export interface GameServer {
  listen(port: number, host: string): Promise<Guard>;
  /** The Colyseus server (tests drive it with @colyseus/testing). */
  readonly colyseus: ReturnType<typeof defineServer>;
}

export function createServer(guardOptions: GuardOptions = DEFAULT_GUARD_OPTIONS): GameServer {
  // Matchmaking by code only: no `join`/`joinOrCreate`, which would pick any open room without its code.
  matchMaker.controller.exposedMethods = ['create', 'joinById', 'reconnect'];
  // CORS only for the game's own pages, and never with credentials (the game has no cookies).
  matchMaker.controller.DEFAULT_CORS_HEADERS = {
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Max-Age': '86400',
    // no Allow-Origin by default, no Allow-Credentials ever
  } as typeof matchMaker.controller.DEFAULT_CORS_HEADERS;
  matchMaker.controller.getCorsHeaders = (headers: Headers): Record<string, string> => {
    const origin = headers.get('origin');
    return origin && isAllowedOrigin(origin, guardOptions) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
  };

  const http = createHttpServer();
  const colyseus = defineServer({
    transport: new WebSocketTransport({ server: http }),
    rooms: { [ROOM_NAME]: defineRoom(SaniutaRoom) },
    routes: createRouter({ health, status, roomInfo }),
    greet: false,
  });
  return {
    colyseus,
    async listen(port, host) {
      await colyseus.listen(port, host);
      // Colyseus has bound its routes now; the guard goes in front of them.
      return installGuard(http, guardOptions);
    },
  };
}
