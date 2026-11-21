import { createServer as createHttpServer } from 'node:http';
import { createEndpoint, createRouter, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

// Stage 0: only /health. The race room, /rooms/:code, /leaderboard and the guard arrive in stage 4.
const health = createEndpoint('/health', { method: 'GET' }, async (ctx) =>
  ctx.json({ ok: true, uptime: Math.round(process.uptime()) }),
);

export interface GameServer {
  listen(port: number, host: string): Promise<void>;
  readonly colyseus: ReturnType<typeof defineServer>;
}

export function createServer(): GameServer {
  const http = createHttpServer();
  const colyseus = defineServer({
    transport: new WebSocketTransport({ server: http }),
    rooms: {},
    routes: createRouter({ health }),
    greet: false,
  });
  return {
    colyseus,
    async listen(port, host) {
      await colyseus.listen(port, host);
    },
  };
}
