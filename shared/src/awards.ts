import { sortedPlayers } from './match';
import type { GameState, PlayerState } from './types';

// Light-hearted titles shown under the podium at the end of a match (as in Bombe și Petarde).
// Names and wording live in the client; here only who earned what.

export type AwardId = 'fulgerul' | 'padurarul' | 'lunetistul' | 'cascadorul' | 'strangatorul' | 'neclintitul';

export interface Award {
  id: AwardId;
  /** Everyone tied for it, in slot order. */
  playerIds: string[];
  value: number;
}

interface Rule {
  id: AwardId;
  stat: (p: PlayerState) => number;
  most: boolean;
  /** Players considered; defaults to everyone in the match. */
  eligible?: (p: PlayerState) => boolean;
}

const RULES: readonly Rule[] = [
  // Fastest single run of the match.
  { id: 'fulgerul', stat: (p) => p.bestTicks, most: false, eligible: (p) => p.bestTicks > 0 },
  // Most trees and rocks hugged.
  { id: 'padurarul', stat: (p) => p.crashes, most: true },
  { id: 'lunetistul', stat: (p) => p.hits, most: true },
  { id: 'cascadorul', stat: (p) => p.jumps, most: true },
  { id: 'strangatorul', stat: (p) => p.pickups, most: true },
  // Never overturned; only those who rode to the end count.
  { id: 'neclintitul', stat: (p) => p.crashes, most: false, eligible: (p) => !p.left },
];

/**
 * The awards that apply: a "most" award needs a value above zero, and none is given when
 * every eligible player ties (it would single nobody out).
 */
export function computeAwards(state: Readonly<GameState>): Award[] {
  const awards: Award[] = [];
  const players = sortedPlayers(state as GameState);
  for (const rule of RULES) {
    const pool = players.filter(rule.eligible ?? (() => true));
    if (pool.length < 2) continue;
    const values = pool.map(rule.stat);
    const best = rule.most ? Math.max(...values) : Math.min(...values);
    if (rule.most && best <= 0) continue;
    const winners = pool.filter((p) => rule.stat(p) === best);
    if (winners.length === pool.length) continue;
    awards.push({ id: rule.id, playerIds: winners.map((p) => p.id), value: best });
  }
  return awards;
}
