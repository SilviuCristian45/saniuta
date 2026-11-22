import { sortedPlayers } from './match';
import type { GameState, PlayerState } from './types';

// Light-hearted titles shown under the podium at the end of a match (as in Bombe și Petarde).
// Names and wording live in the client; here only who earned what, from the match statistics the
// simulation keeps in PlayerState (deterministic, the same on every side).

export type AwardId = 'fulgerul' | 'lunetistul' | 'tinta' | 'cascadorul' | 'omDeZapada' | 'sanieDeOtel';

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
}

/** "The most of" awards: a value above zero, and not everyone tied (it would single nobody out). */
const MOST: readonly Rule[] = [
  // Highest speed reached in the whole match.
  { id: 'fulgerul', stat: (p) => p.topSpeed, most: true },
  // Most snowballs that hit someone.
  { id: 'lunetistul', stat: (p) => p.hits, most: true },
  // Hit by the most snowballs.
  { id: 'tinta', stat: (p) => p.hitsTaken, most: true },
  // Most time in the air.
  { id: 'cascadorul', stat: (p) => p.airTime, most: true },
  // Most times overturned on a tree or a rock.
  { id: 'omDeZapada', stat: (p) => p.crashes, most: true },
];

/** The awards that apply to this (finished) match. */
export function computeAwards(state: Readonly<GameState>): Award[] {
  const awards: Award[] = [];
  const players = sortedPlayers(state as GameState);
  if (players.length < 2) return awards;
  for (const rule of MOST) {
    const values = players.map(rule.stat);
    const best = Math.max(...values);
    if (best <= 0) continue;
    const winners = players.filter((p) => rule.stat(p) === best);
    if (winners.length === players.length) continue;
    awards.push({ id: rule.id, playerIds: winners.map((p) => p.id), value: best });
  }
  // An achievement rather than a contest: never overturned in the whole match, riding it to the end.
  const steel = players.filter((p) => !p.left && p.crashes === 0);
  if (steel.length > 0) awards.push({ id: 'sanieDeOtel', playerIds: steel.map((p) => p.id), value: 0 });
  return awards;
}
