import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';

// Who is asking, for the per-IP limits. The server listens on loopback only and Caddy is its one
// public entry: Caddy sets X-Forwarded-For to the address of the connection it received, so the last
// entry of that header is the client's real address. Everything before it, X-Real-IP and
// X-Client-IP are whatever the client chose to send (Colyseus' own context.ip trusts the first of
// those, so it is never used here).

/**
 * Header the guard puts on every request that came through Caddy, with the client's limit key.
 * A value sent by the client under this name is always removed first.
 */
export const IP_HEADER = 'x-saniuta-ip';

export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.startsWith('::ffff:') ? address.slice(7) : address;
  return a === '::1' || a.startsWith('127.');
}

/**
 * The client's address as Caddy saw it, or null when the request did not come through Caddy:
 * not from loopback, or from loopback without X-Forwarded-For (the Vite dev proxy, tests, curl on the VPS).
 */
export function forwardedClientIp(headers: IncomingHttpHeaders, remoteAddress: string | undefined): string | null {
  if (!isLoopback(remoteAddress)) return null;
  const raw = headers['x-forwarded-for'];
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  const last = value?.split(',').pop()?.trim().replace(/%.*$/, '');
  return last && isIP(last) ? last : null;
}

/**
 * What the limits count by: an IPv4 address, or the /64 network of an IPv6 address (one home
 * connection usually gets a whole /64, so single addresses would be free to switch).
 */
export function ipKey(ip: string): string {
  if (isIP(ip) === 4) return ip;
  const groups = expandIPv6(ip);
  if (!groups) return ip;
  // ::ffff:1.2.3.4 is an IPv4 client
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}

/** The eight 16-bit groups of an IPv6 address (with a possible dotted IPv4 tail), or null. */
function expandIPv6(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null;
  let text = ip.toLowerCase();
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::') as [string, string | undefined];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const zeros = tail === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array<string>(zeros).fill('0'), ...right].map((g) => parseInt(g, 16));
}
