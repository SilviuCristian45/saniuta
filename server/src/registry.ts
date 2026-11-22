import type { RoomStatus } from '@saniuta/shared';

// Live rooms of this process, by code. The server runs as a single Node process,
// so this is the whole picture (no Redis/presence needed).

export interface RoomEntry {
  status(): RoomStatus;
}

const rooms = new Map<string, RoomEntry>();
/** The limit key (IP) each room was created from; rooms created outside Caddy have none. */
const owners = new Map<string, string>();

export function roomCount(): number {
  return rooms.size;
}

export function isCodeTaken(code: string): boolean {
  return rooms.has(code);
}

export function registerRoom(code: string, room: RoomEntry, ownerIp = ''): void {
  rooms.set(code, room);
  if (ownerIp) owners.set(code, ownerIp);
}

/** Live rooms created from this limit key. */
export function roomsOwnedBy(ownerIp: string): number {
  let n = 0;
  for (const owner of owners.values()) if (owner === ownerIp) n++;
  return n;
}

export function unregisterRoom(code: string): void {
  rooms.delete(code);
  owners.delete(code);
}

export function roomStatus(code: string): RoomStatus {
  return rooms.get(code)?.status() ?? 'missing';
}
