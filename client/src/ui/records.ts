import { trackName, type NewRecord } from '@saniuta/shared';

// The leaderboard news after a run, without Phaser (client/test/records.test.ts).

/**
 * "★ Record nou pe Valea Lupului! Locul 3 ★" for this player, "Ana: în top pe Valea Lupului, locul 2"
 * for the others (this player first, then by place); '' when nobody set one.
 */
export function recordsLine(records: readonly NewRecord[], me: string): string {
  const parts = [...records]
    .sort((a, b) => Number(b.playerId === me) - Number(a.playerId === me) || a.place - b.place)
    .map((r) => {
      const track = trackName(r.trackId);
      if (r.playerId === me) return `${r.kind === 'top' ? 'Ai intrat în top' : 'Record nou'} pe ${track}! Locul ${r.place}`;
      return `${r.name}: ${r.kind === 'top' ? 'în top' : 'record nou'} pe ${track}, locul ${r.place}`;
    });
  return parts.length > 0 ? `★ ${parts.join('  ·  ')} ★` : '';
}
