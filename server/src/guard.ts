import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { ERR_FORBIDDEN_ORIGIN, ERR_RATE_LIMITED } from '@saniuta/shared';
import { forwardedClientIp, IP_HEADER, ipKey } from './clientIp';
import { ALLOW_LOCALHOST_ORIGINS, ALLOWED_ORIGINS, MAX_WS_PER_IP, RATES } from './config';
import { Counts, RateLimiter, type Rate } from './limits';
import { isCodeTaken } from './registry';

// The one gate every HTTP request and WebSocket upgrade passes before Colyseus sees it:
// who is asking (IP_HEADER, from Caddy's X-Forwarded-For), which page is asking (Origin), and how
// often. Installed around the listeners Colyseus put on the HTTP server (installGuard).

export interface GuardOptions {
  maxWsPerIp: number;
  rates: Record<keyof typeof RATES, Rate>;
  allowedOrigins: readonly string[];
  allowLocalhostOrigins: boolean;
}

export const DEFAULT_GUARD_OPTIONS: GuardOptions = {
  maxWsPerIp: MAX_WS_PER_IP,
  rates: RATES,
  allowedOrigins: ALLOWED_ORIGINS,
  allowLocalhostOrigins: ALLOW_LOCALHOST_ORIGINS,
};

/** This machine, or (dev only too) a phone on the same Wi-Fi opening the Vite server by its LAN address. */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

/** Whether a page on `origin` may call the server (requests without an Origin are not from a page on another site). */
export function isAllowedOrigin(origin: string, options: Pick<GuardOptions, 'allowedOrigins' | 'allowLocalhostOrigins'>): boolean {
  return options.allowedOrigins.includes(origin) || (options.allowLocalhostOrigins && LOCAL_ORIGIN.test(origin));
}

/** Time between two "not through Caddy" warnings. */
const WARN_EVERY_MS = 10 * 60_000;
/** Largest CSP report read. */
const CSP_REPORT_MAX_BYTES = 8 * 1024;

type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;
type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

export interface Guard {
  /** WebSocket connections open per limit key (tests). */
  readonly sockets: Counts;
}

/**
 * Moves the HTTP server's current request and upgrade listeners (Colyseus' router, matchmaker and
 * WebSocket transport) behind the guard. Call it after the server listens: Colyseus binds its
 * routes only then.
 */
export function installGuard(server: Server, options: GuardOptions = DEFAULT_GUARD_OPTIONS): Guard {
  const limiters = Object.fromEntries(Object.entries(options.rates).map(([name, rate]) => [name, new RateLimiter(rate)])) as Record<
    keyof typeof RATES,
    RateLimiter
  >;
  const sockets = new Counts();
  let lastWarning = -Infinity;
  let loggedFirst = false;

  /** The request's limit key, written to IP_HEADER for the rooms; null (and a warning now and then) when not through Caddy. */
  const identify = (req: IncomingMessage): string | null => {
    delete req.headers[IP_HEADER];
    const ip = forwardedClientIp(req.headers, req.socket.remoteAddress);
    if (!ip) {
      const now = Date.now();
      if (now - lastWarning >= WARN_EVERY_MS) {
        lastWarning = now;
        console.warn(
          `Limite per IP oprite pentru cererile care nu vin prin Caddy (de la ${req.socket.remoteAddress ?? '?'}, fără X-Forwarded-For). Normal în dev și în teste.`,
        );
      }
      return null;
    }
    const key = ipKey(ip);
    req.headers[IP_HEADER] = key;
    if (!loggedFirst) {
      // Once per process, so the journal shows which address the limits really count by (last part hidden).
      loggedFirst = true;
      console.log(`Limite per IP active: primul client prin Caddy numărat ca ${maskKey(key)} (din X-Forwarded-For).`);
    }
    return key;
  };

  const originRefused = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin;
    return origin !== undefined && !isAllowedOrigin(origin, options);
  };

  const requestListeners = server.listeners('request') as RequestListener[];
  server.removeAllListeners('request');
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const key = identify(req);
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const method = req.method ?? 'GET';

    if (path === '/csp-report' && method === 'POST') return cspReport(req, res, limiters.cspReport);
    if (originRefused(req)) return reply(res, 403, { code: ERR_FORBIDDEN_ORIGIN, error: 'Origine nepermisă' });

    if (key) {
      const refused = (limiter: RateLimiter) => {
        if (limiter.take(key)) return false;
        reply(res, 429, { code: ERR_RATE_LIMITED, error: 'Prea multe cereri' }, { 'Retry-After': String(limiter.retryAfter(key)) });
        return true;
      };
      const matchmake = /^\/matchmake\/(\w+)\/([^/]+)$/.exec(path);
      if (method === 'POST' && matchmake) {
        const [, action, target] = matchmake as unknown as [string, string, string];
        if (refused(limiters.matchmake)) return;
        if (action === 'create' && refused(limiters.createRoom)) return;
        if ((action === 'joinById' || action === 'reconnect') && unknownCode(key, safeDecode(target))) return;
      } else if (method === 'GET' && path.startsWith('/rooms/')) {
        if (refused(limiters.roomStatus)) return;
        if (unknownCode(key, safeDecode(path.slice('/rooms/'.length)).trim().toUpperCase())) return;
      }

      /** Spends a token on a code no room has; true (and a 429) once guessing has used them all, whatever the code. */
      function unknownCode(limitKey: string, code: string): boolean {
        const guesses = limiters.unknownCode;
        if (!guesses.has(limitKey)) {
          reply(res, 429, { code: ERR_RATE_LIMITED, error: 'Prea multe coduri greșite' }, { 'Retry-After': String(guesses.retryAfter(limitKey)) });
          return true;
        }
        if (!isCodeTaken(code)) guesses.take(limitKey);
        return false;
      }
    }
    for (const listener of requestListeners) listener.call(server, req, res);
  });

  const upgradeListeners = server.listeners('upgrade') as UpgradeListener[];
  server.removeAllListeners('upgrade');
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const key = identify(req);
    if (originRefused(req)) return refuseUpgrade(socket, 403, 'Forbidden');
    if (key) {
      if (sockets.get(key) >= options.maxWsPerIp || !limiters.wsOpen.take(key)) return refuseUpgrade(socket, 429, 'Too Many Requests');
      sockets.add(key);
      socket.once('close', () => sockets.remove(key));
    }
    for (const listener of upgradeListeners) listener.call(server, req, socket, head);
  });

  return { sockets };
}

/** A limit key for the log: an IPv4 address without its last number (an IPv6 key is already only its /64). */
export function maskKey(key: string): string {
  return /^\d+\.\d+\.\d+\.\d+$/.test(key) ? key.replace(/\.\d+$/, '.x') : key;
}

/** decodeURIComponent that never throws (a malformed %-escape is just an unknown code). */
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function reply(res: ServerResponse, status: number, body: object, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function refuseUpgrade(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/**
 * Browsers post Content-Security-Policy violations here (Caddy: /colyseus/csp-report). One short line
 * per report goes to the journal, within a server-wide budget; the answer is always 204.
 */
function cspReport(req: IncomingMessage, res: ServerResponse, budget: RateLimiter): void {
  let body = '';
  let tooBig = false;
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    if (tooBig) return;
    body += chunk;
    if (body.length > CSP_REPORT_MAX_BYTES) tooBig = true;
  });
  req.on('end', () => {
    res.writeHead(204).end();
    if (tooBig || !budget.take('all')) return;
    try {
      const parsed = JSON.parse(body) as unknown;
      // report-uri sends { "csp-report": {...} }, the Reporting API an array of { body: {...} }.
      const reports = Array.isArray(parsed) ? parsed.map((r) => (r as { body?: unknown }).body) : [(parsed as Record<string, unknown>)['csp-report']];
      for (const r of reports.slice(0, 5)) {
        const v = (r ?? {}) as Record<string, unknown>;
        const field = (...names: string[]) => String(names.map((n) => v[n]).find((x) => x !== undefined) ?? '?').slice(0, 200);
        console.warn(
          `CSP: ${field('effectiveDirective', 'effective-directive', 'violated-directive')} a blocat ${field('blockedURL', 'blocked-uri')} pe ${field('documentURL', 'document-uri')} (${String(req.headers['user-agent'] ?? '').slice(0, 120)})`,
        );
      }
    } catch {
      // not JSON: ignored
    }
  });
  req.on('error', () => res.destroy());
}
