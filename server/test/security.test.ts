import { request, type IncomingHttpHeaders } from 'node:http';
import { createAuthContext } from '@colyseus/core';
import { ColyseusTestServer } from '@colyseus/testing';
import { CLOSE_LOBBY_IDLE, ERR_FORBIDDEN_ORIGIN, ERR_RATE_LIMITED, ERR_TOO_MANY_ROOMS, ROOM_NAME } from '@saniuta/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/app';
import { forwardedClientIp, ipKey } from '../src/clientIp';
import { MAX_ROOMS_PER_IP, MAX_WS_PER_IP, RATES } from '../src/config';
import { isAllowedOrigin, type Guard } from '../src/guard';
import { Counts, DailyQuota, RateLimiter } from '../src/limits';
import type { SaniutaRoom } from '../src/SaniutaRoom';

// The attacks of the skill's security checklist against a real server on 2571, and that each is
// refused. "Through Caddy" = from loopback with X-Forwarded-For, as Caddy sends it.

const TEST_PORT = 2571;
const BASE = `http://127.0.0.1:${TEST_PORT}`;

let colyseus: ColyseusTestServer;
let guard: Guard;

beforeAll(async () => {
  const server = createServer();
  guard = await server.listen(TEST_PORT, '127.0.0.1');
  colyseus = new ColyseusTestServer(server.colyseus);
});
afterAll(async () => {
  await colyseus.shutdown();
});
beforeEach(async () => {
  await colyseus.cleanup();
});

/** A fresh documentation address per test, so the limits of one test never leak into the next. */
let nextIp = 1;
const freshIp = () => `198.51.100.${nextIp++}`;

interface Answer {
  status: number;
  headers: Headers;
  body: { code?: number; error?: string; roomId?: string; status?: string } | null;
}

async function http(method: 'GET' | 'POST' | 'OPTIONS', path: string, headers: Record<string, string> = {}, body?: object): Promise<Answer> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? (JSON.parse(text) as Answer['body']) : null };
}

const viaCaddy = (ip: string, extra: Record<string, string> = {}) => ({ 'x-forwarded-for': ip, ...extra });
const createRoom = (headers: Record<string, string>) => http('POST', `/matchmake/create/${ROOM_NAME}`, headers, { name: 'Ana' });

/** A bare WebSocket handshake; resolves with 101 (left open until close()) or the refusal's status. */
function upgrade(headers: Record<string, string>): Promise<{ status: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const req = request(`${BASE}/`, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...headers,
      },
    });
    req.on('upgrade', (res, socket) => resolve({ status: res.statusCode ?? 0, close: () => socket.destroy() }));
    req.on('response', (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, close: () => undefined });
    });
    req.on('error', reject);
    req.end();
  });
}

async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('M3: the client address cannot be spoofed', () => {
  const headers: IncomingHttpHeaders = {
    'x-real-ip': '6.6.6.6',
    'x-client-ip': '7.7.7.7',
    'x-forwarded-for': '8.8.8.8, 203.0.113.9', // the client sent 8.8.8.8, Caddy appended the real address
  };

  it("before: Colyseus' own context.ip believes the client's header", () => {
    expect(createAuthContext({ headers: new Headers(headers as Record<string, string>), remoteAddress: '127.0.0.1' }).ip).toBe('6.6.6.6');
  });

  it("now: only the entry Caddy added counts, and only from loopback", () => {
    expect(forwardedClientIp(headers, '127.0.0.1')).toBe('203.0.113.9');
    expect(forwardedClientIp(headers, '::ffff:127.0.0.1')).toBe('203.0.113.9');
    expect(forwardedClientIp(headers, '203.0.113.50')).toBeNull(); // not through Caddy
    expect(forwardedClientIp({ 'x-real-ip': '6.6.6.6' }, '127.0.0.1')).toBeNull(); // Vite proxy, tests, curl on the VPS
    expect(forwardedClientIp({ 'x-forwarded-for': 'not-an-ip' }, '127.0.0.1')).toBeNull();
  });

  it('counts IPv6 clients by their /64 and IPv4-mapped addresses as IPv4', () => {
    expect(ipKey('203.0.113.9')).toBe('203.0.113.9');
    expect(ipKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:db8:1:2:bbbb:cccc:dddd:eeee')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });

  it('a new X-Real-IP or X-Saniuta-IP on every request does not escape the per-address limit', async () => {
    const ip = freshIp();
    for (let i = 0; i < MAX_ROOMS_PER_IP; i++) {
      expect((await createRoom(viaCaddy(ip, { 'x-real-ip': `10.0.0.${i}`, 'x-saniuta-ip': `10.1.0.${i}` }))).status).toBe(200);
    }
    const refused = await createRoom(viaCaddy(ip, { 'x-real-ip': '10.0.0.99', 'x-saniuta-ip': '10.1.0.99' }));
    expect(refused.body?.code).toBe(ERR_TOO_MANY_ROOMS);
  });

  it('a request that did not come through Caddy is not limited, even with a forged guard header', async () => {
    for (let i = 0; i < MAX_ROOMS_PER_IP + 2; i++) {
      expect((await createRoom({ 'x-saniuta-ip': '10.9.9.9' })).status).toBe(200);
    }
  });
});

describe('C1: one address cannot fill the server with rooms', () => {
  it(`allows ${MAX_ROOMS_PER_IP} rooms per address, refuses the next, and other addresses still get theirs`, async () => {
    const ip = freshIp();
    const codes: string[] = [];
    for (let i = 0; i < MAX_ROOMS_PER_IP; i++) {
      const res = await createRoom(viaCaddy(ip));
      expect(res.status).toBe(200);
      codes.push(res.body!.roomId!);
    }
    expect((await createRoom(viaCaddy(ip))).body?.code).toBe(ERR_TOO_MANY_ROOMS);
    expect((await createRoom(viaCaddy(freshIp()))).status).toBe(200);

    // A room that closes gives its place back.
    await colyseus.getRoomById<SaniutaRoom>(codes[0]!).disconnect();
    expect((await createRoom(viaCaddy(ip))).status).toBe(200);
  });

  it(`refuses creating faster than ${RATES.createRoom.burst} rooms at once from one address (HTTP 429)`, async () => {
    const ip = freshIp();
    for (let i = 0; i < RATES.createRoom.burst; i++) expect((await createRoom(viaCaddy(ip))).status).not.toBe(429);
    const refused = await createRoom(viaCaddy(ip));
    expect(refused.status).toBe(429);
    expect(refused.body?.code).toBe(ERR_RATE_LIMITED);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('M2: per-address limits, Origin and CORS', () => {
  it(`keeps ${MAX_WS_PER_IP} WebSockets open from one address (six friends and their reloads), refuses one more`, async () => {
    const ip = freshIp();
    const open = await Promise.all(Array.from({ length: MAX_WS_PER_IP }, () => upgrade(viaCaddy(ip))));
    expect(open.every((s) => s.status === 101)).toBe(true);
    expect((await upgrade(viaCaddy(ip))).status).toBe(429);
    const neighbour = await upgrade(viaCaddy(freshIp()));
    expect(neighbour.status).toBe(101);

    // Closed connections free their places.
    [...open, neighbour].forEach((s) => s.close());
    await until(() => guard.sockets.get(ip) === 0);
    const again = await upgrade(viaCaddy(ip));
    expect(again.status).toBe(101);
    again.close();
  });

  it('refuses a flood of matchmaking requests from one address (HTTP 429)', async () => {
    const room = (await createRoom(viaCaddy(freshIp()))).body!.roomId!;
    const ip = freshIp();
    let last: Answer | undefined;
    // (the room fills after six; the requests beyond still count)
    for (let i = 0; i <= RATES.matchmake.burst; i++) last = await http('POST', `/matchmake/joinById/${room}`, viaCaddy(ip), { name: `P${i}` });
    expect(last!.status).toBe(429);
    expect(last!.body?.code).toBe(ERR_RATE_LIMITED);
  });

  it('answers the public /status with nothing but ok, and refuses a flood of it', async () => {
    const ip = freshIp();
    const first = await http('GET', '/status', viaCaddy(ip));
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true });
    for (let i = 1; i < RATES.status.burst; i++) expect((await http('GET', '/status', viaCaddy(ip))).status).toBe(200);
    expect((await http('GET', '/status', viaCaddy(ip))).status).toBe(429);
  });

  it('refuses a flood of /leaderboard', async () => {
    const ip = freshIp();
    for (let i = 0; i < RATES.leaderboard.burst; i++) expect((await http('GET', '/leaderboard', viaCaddy(ip))).status).toBe(200);
    expect((await http('GET', '/leaderboard', viaCaddy(ip))).status).toBe(429);
  });

  it('refuses a flood of /rooms/:code', async () => {
    const real = (await createRoom(viaCaddy(freshIp()))).body!.roomId!;
    const ip = freshIp();
    for (let i = 0; i < RATES.roomStatus.burst; i++) expect((await http('GET', `/rooms/${real}`, viaCaddy(ip))).status).toBe(200);
    expect((await http('GET', `/rooms/${real}`, viaCaddy(ip))).status).toBe(429);
  });

  it('refuses pages on other sites: WebSocket upgrades, matchmaking and preflights', async () => {
    const evil = { origin: 'https://evil.example' };
    expect((await upgrade(evil)).status).toBe(403);
    const create = await createRoom(evil);
    expect(create.status).toBe(403);
    expect(create.body?.code).toBe(ERR_FORBIDDEN_ORIGIN);
    expect((await http('OPTIONS', `/matchmake/create/${ROOM_NAME}`, evil)).status).toBe(403);
  });

  it('answers its own pages with CORS for that origin only, never with credentials', async () => {
    const res = await http('GET', '/health', { origin: 'http://localhost:5175' });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5175');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    const noOrigin = await http('GET', '/health');
    expect(noOrigin.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('allows only the production site in production; localhost and the LAN (a phone on the same Wi-Fi) only in dev', () => {
    const production = { allowedOrigins: ['https://saniuta-la-vale.duckdns.org'], allowLocalhostOrigins: false };
    const dev = { allowedOrigins: [], allowLocalhostOrigins: true };
    expect(isAllowedOrigin('https://saniuta-la-vale.duckdns.org', production)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5175', production)).toBe(false);
    expect(isAllowedOrigin('http://192.168.1.20:5175', production)).toBe(false);
    expect(isAllowedOrigin('https://saniuta-la-vale.duckdns.org.evil.example', production)).toBe(false);
    expect(isAllowedOrigin('http://localhost:5175', dev)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:4173', dev)).toBe(true);
    expect(isAllowedOrigin('http://192.168.1.20:5175', dev)).toBe(true);
    expect(isAllowedOrigin('http://10.0.0.7:5175', dev)).toBe(true);
    expect(isAllowedOrigin('http://172.20.1.2:5175', dev)).toBe(true);
    expect(isAllowedOrigin('http://172.40.1.2:5175', dev)).toBe(false);
    expect(isAllowedOrigin('http://192.168.1.20.evil.example', dev)).toBe(false);
    expect(isAllowedOrigin('http://localhost.evil.example', dev)).toBe(false);
  });

  it('takes CSP reports without echoing anything back', async () => {
    const res = await fetch(`${BASE}/csp-report`, {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: JSON.stringify({ 'csp-report': { 'violated-directive': 'img-src', 'blocked-uri': 'https://x.example/a.png', 'document-uri': 'https://saniuta-la-vale.duckdns.org/' } }),
    });
    expect(res.status).toBe(204);
  });
});

describe('M1: nobody gets into a room without its code', () => {
  it('refuses join and joinOrCreate, which used to drop the caller into any open lobby', async () => {
    const host = await createRoom({});
    expect(host.status).toBe(200);
    const room = colyseus.getRoomById<SaniutaRoom>(host.body!.roomId!);
    for (const method of ['join', 'joinOrCreate']) {
      const res = await http('POST', `/matchmake/${method}/${ROOM_NAME}`, {}, { name: 'Intrus' });
      expect(res.status).not.toBe(200);
      expect(res.body?.roomId).toBeUndefined();
    }
    expect(room['_listing'].private).toBe(true);
    // With the code it works.
    expect((await http('POST', `/matchmake/joinById/${room.roomId}`, {}, { name: 'Ion' })).status).toBe(200);
  });
});

describe('D2 + m1: room codes cannot be guessed or predicted', () => {
  it(`stops answering about codes after ${RATES.unknownCode.burst} unknown ones from one address, even for a real code`, async () => {
    const real = (await createRoom(viaCaddy(freshIp()))).body!.roomId!;
    const ip = freshIp();
    // Before, every guess got an answer: an oracle for scanning all 31^6 codes.
    for (let i = 0; i < RATES.unknownCode.burst / 2; i++) {
      expect((await http('GET', `/rooms/ZZZZ${i % 10}${i % 9}`, viaCaddy(ip))).body?.status).toBe('missing');
      expect((await http('POST', `/matchmake/joinById/ZZZY${i % 10}${i % 9}`, viaCaddy(ip), { name: 'X' })).status).not.toBe(200);
    }
    // Now the guesses are spent: no answer either way, so a hit cannot be told from a miss.
    for (const path of [`/rooms/${real}`, '/rooms/ZZZZZZ']) {
      const res = await http('GET', path, viaCaddy(ip));
      expect(res.status).toBe(429);
      expect(res.body?.code).toBe(ERR_RATE_LIMITED);
    }
    expect((await http('POST', `/matchmake/joinById/${real}`, viaCaddy(ip), { name: 'X' })).status).toBe(429);
    expect((await http('POST', `/matchmake/reconnect/${real}`, viaCaddy(ip), {})).status).toBe(429);
    // Another address, and real codes, are unaffected.
    expect((await http('POST', `/matchmake/joinById/${real}`, viaCaddy(freshIp()), { name: 'Ion' })).status).toBe(200);
  });

  it('lets friends mistype a few codes without being locked out', async () => {
    const real = (await createRoom(viaCaddy(freshIp()))).body!.roomId!;
    const ip = freshIp();
    // A typo in the menu costs two guesses (the join, then /rooms/:code for the message).
    for (let i = 0; i < 5; i++) {
      await http('POST', `/matchmake/joinById/QQQQQ${i}`, viaCaddy(ip), { name: 'Ion' });
      await http('GET', `/rooms/QQQQQ${i}`, viaCaddy(ip));
    }
    expect((await http('POST', `/matchmake/joinById/${real}`, viaCaddy(ip), { name: 'Ion' })).status).toBe(200);
  });

  it('draws room codes and seeds from crypto, not Math.random', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../src/SaniutaRoom.ts', import.meta.url), 'utf8');
    expect(source.replace(/\/\/.*$/gm, '')).not.toMatch(/Math\.random/); // comments aside
    const codes = new Set<string>();
    for (let i = 0; i < 4; i++) codes.add((await createRoom({})).body!.roomId!);
    expect(codes.size).toBe(4);
  });
});

describe('D4: a lobby nobody starts is closed', () => {
  it('sends everyone back to the menu with CLOSE_LOBBY_IDLE and frees the room', async () => {
    const client = await colyseus.sdk.create(ROOM_NAME, { name: 'Ana' });
    const room = colyseus.getRoomById<SaniutaRoom>(client.roomId);
    let closedWith = 0;
    client.onLeave((code) => (closedWith = code));
    room.lobbyIdleMs = 150;
    room.armLobbyTimer();
    await until(() => closedWith !== 0);
    expect(closedWith).toBe(CLOSE_LOBBY_IDLE);
  });

  it('leaves a started match alone', async () => {
    const client = await colyseus.sdk.create(ROOM_NAME, { name: 'Ana' });
    const room = colyseus.getRoomById<SaniutaRoom>(client.roomId);
    room.lobbyIdleMs = 150;
    room.armLobbyTimer();
    client.send('addBot');
    await room.waitForNextMessage();
    client.send('start');
    await room.waitForNextMessage();
    await new Promise((r) => setTimeout(r, 300));
    expect(room['game'].phase).not.toBe('lobby');
    expect(client.connection.isOpen).toBe(true);
  });
});

describe('limits', () => {
  it('a rate limiter spends its burst, then refills at its rate', () => {
    const limiter = new RateLimiter({ burst: 2, perMinute: 60 });
    expect(limiter.take('a', 0)).toBe(true);
    expect(limiter.take('a', 0)).toBe(true);
    expect(limiter.take('a', 0)).toBe(false);
    expect(limiter.retryAfter('a', 0)).toBe(1);
    expect(limiter.take('b', 0)).toBe(true);
    expect(limiter.take('a', 1000)).toBe(true);
  });

  it('keeps a bounded number of addresses', () => {
    const limiter = new RateLimiter({ burst: 1, perMinute: 1 }, 3);
    for (const k of ['a', 'b', 'c', 'd']) limiter.take(k, 0);
    expect(limiter['buckets'].size).toBeLessThanOrEqual(3);
  });

  it('a daily quota starts over on the next UTC day', () => {
    const quota = new DailyQuota(1);
    const day1 = new Date('2026-11-20T23:59:00Z');
    expect(quota.has('a', day1)).toBe(true);
    quota.use('a', day1);
    expect(quota.has('a', day1)).toBe(false);
    expect(quota.has('a', new Date('2026-11-21T00:01:00Z'))).toBe(true);
  });

  it('counts open things and forgets keys at zero', () => {
    const counts = new Counts();
    counts.add('a');
    counts.add('a');
    counts.remove('a');
    expect(counts.get('a')).toBe(1);
    counts.remove('a');
    expect(counts['counts'].size).toBe(0);
  });
});
