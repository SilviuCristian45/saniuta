import type { LeaderboardEntry, LeaderboardResponse } from '@saniuta/shared';
import { serverHttpUrl } from './rooms';

// The all-time leaderboard, read from the server (GET /leaderboard, cached there for ~30 s).

const TIMEOUT_MS = 8000;

/** Every fixed track's top rows (by track id as a string), or null when the server or its database cannot be reached. */
export async function fetchLeaderboard(): Promise<Record<string, LeaderboardEntry[]> | null> {
  const url = serverHttpUrl('/leaderboard');
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as LeaderboardResponse;
    return body.available && body.tracks && typeof body.tracks === 'object' ? body.tracks : null;
  } catch {
    return null;
  }
}

const dateTimeFormat = new Intl.DateTimeFormat('ro-RO', {
  timeZone: 'Europe/Bucharest',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** "20.11.2026, 21:05" in Romanian time (the server stores UTC). */
export function formatRecordDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : dateTimeFormat.format(date);
}

/** mm:ss.cc for a time in milliseconds (the leaderboard's precision). */
export function formatRecordTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cc = Math.floor((ms % 1000) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cc).padStart(2, '0')}`;
}
