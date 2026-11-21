import { RUN_TIME_LIMIT_TICKS, COUNTDOWN_TICKS } from './constants';
import { botAct } from './bot';
import { onlyBotsRacing, sortedPlayers } from './match';
import { applyInput, step } from './sim';
import type { GameEvent, GameState, PlayerInput } from './types';

// One tick exactly as every host of the simulation runs it (the browser's LocalTransport,
// the client's prediction replay and the Colyseus room), so they all behave the same.

/** The run time limit ends every run well before this. */
const MAX_SKIP_TICKS = RUN_TIME_LIMIT_TICKS + COUNTDOWN_TICKS + 1;

/** Applies this tick's inputs, lets the bots decide, then advances one tick. */
export function runTick(state: GameState, inputs: readonly PlayerInput[]): GameEvent[] {
  for (const input of inputs) applyInput(state, input);
  for (const p of sortedPlayers(state)) {
    if (!p.isBot || !p.racing || p.finished) continue;
    const input = botAct(state, p.id);
    if (input) applyInput(state, { ...input, playerId: p.id });
  }
  return step(state);
}

/**
 * Fast-forwards a run that only bots are still racing (no-op otherwise). The skipped effects would
 * all fire at once, so only the finishes and the outcome (roundEnd/matchEnd) are returned.
 */
export function skipBotRound(state: GameState): GameEvent[] {
  const outcome: GameEvent[] = [];
  if (!onlyBotsRacing(state)) return outcome;
  for (let i = 0; i < MAX_SKIP_TICKS && state.phase === 'playing'; i++) {
    for (const e of runTick(state, [])) {
      if (e.type === 'finish' || e.type === 'roundEnd' || e.type === 'matchEnd') outcome.push(e);
    }
  }
  return outcome;
}
