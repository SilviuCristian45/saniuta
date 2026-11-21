import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type GameServer } from '../src/app';

// Server tests use port 2571 (2570 is the dev/production port).
const TEST_PORT = 2571;
let server: GameServer;

beforeAll(async () => {
  server = createServer();
  await server.listen(TEST_PORT, '127.0.0.1');
});

afterAll(async () => {
  await server.colyseus.gracefullyShutdown(false);
});

describe('http', () => {
  it('GET /health answers ok', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
