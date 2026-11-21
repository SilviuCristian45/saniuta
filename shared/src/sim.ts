import {
  COUNTDOWN_TICKS,
  FINISH_GRACE_TICKS,
  INPUT_MAX,
  POINTS_BY_PLACE,
  RESULTS_TICKS,
  RUN_TIME_LIMIT_TICKS,
  TICK_RATE,
} from './constants';
import { clamp } from './fixed';
import { computeStandings, sortedPlayers, startRound } from './match';
import { canCollide, collideSleds, grounded, hitObstacles, keepOnTrack, rideFinished, rideSled, tryJump } from './physics';
import { clearBalls, pickUpSnow, throwSnowball, tickPiles, updateBalls } from './snowballs';
import { getTrack, type Track } from './track';
import type { GameEvent, GameState, PlayerInput, PlayerState } from './types';

/** Whole seconds left in the "3, 2, 1" countdown (0 once HAI! has been shown). */
export function countdownSeconds(roundTick: number): number {
  return Math.max(0, Math.ceil((COUNTDOWN_TICKS - roundTick) / TICK_RATE));
}

/** Ticks of racing so far this run (the countdown excluded). */
export function raceTicks(roundTick: number): number {
  return Math.max(0, roundTick - COUNTDOWN_TICKS);
}

/** Seconds left for the others once someone finished (null before that), for the HUD. */
export function lastCallSeconds(state: Readonly<GameState>): number | null {
  if (state.firstFinishTick === 0) return null;
  return Math.max(0, Math.ceil((FINISH_GRACE_TICKS - (state.roundTick - state.firstFinishTick)) / TICK_RATE));
}

/** Run time in milliseconds, for display and the leaderboard. */
export function ticksToMs(ticks: number): number {
  return Math.round((ticks * 1000) / TICK_RATE);
}

/** The current run's track. */
export function currentTrack(state: Readonly<GameState>): Track {
  return getTrack(state.trackId, state.trackSeed);
}

/** Normalizes one untrusted axis value to an integer in [-INPUT_MAX, INPUT_MAX]. */
function axis(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(Math.trunc(v), -INPUT_MAX, INPUT_MAX) : 0;
}

/**
 * The only way players affect the game: steer and throttle are held until the next input, a throw
 * press is latched and consumed on the next tick. Inputs of sleds not racing (or finished) still
 * advance lastSeq so the client can drop them from its prediction buffer.
 */
export function applyInput(state: GameState, input: PlayerInput): void {
  const p = state.players[input.playerId];
  if (!p) return;
  if (typeof input.seq === 'number' && Number.isInteger(input.seq)) p.lastSeq = input.seq;
  if (!p.racing || p.finished) return;
  p.steer = axis(input.steer);
  p.throttle = axis(input.throttle);
  if (input.fire === true) p.firePressed = true;
}

/** Advances the simulation by one fixed tick. Returns what happened, for sound/effects. */
export function step(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  state.tick++;

  if (state.phase === 'results') {
    state.phaseTimer--;
    if (state.phaseTimer <= 0) {
      state.round++;
      startRound(state);
      events.push({ type: 'roundStart', round: state.round });
    }
    return events;
  }
  if (state.phase !== 'playing') return events;

  state.roundTick++;
  const racers = sortedPlayers(state).filter((p) => p.racing);
  // During the countdown held input is kept for HAI!, but nobody moves and throws are dropped.
  if (state.roundTick <= COUNTDOWN_TICKS) {
    for (const p of racers) p.firePressed = false;
    return events;
  }
  const race = raceTicks(state.roundTick);
  if (race === 1) events.push({ type: 'go', round: state.round });

  const track = currentTrack(state);
  tickPiles(state);
  for (const p of racers) {
    if (p.finished) {
      rideFinished(p);
      continue;
    }
    throwSnowball(state, p, events);
    rideSled(p, track, events);
  }
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      if (canCollide(racers[i]!, racers[j]!)) collideSleds(racers[i]!, racers[j]!, events);
    }
  }
  const crossed: PlayerState[] = [];
  for (const p of racers) {
    if (!p.finished && grounded(p)) {
      hitObstacles(p, track, events);
      tryJump(p, track, events);
      pickUpSnow(state, track, p, events);
    }
    keepOnTrack(p, track);
    if (!p.finished && p.y >= track.finishY) crossed.push(p);
  }
  // Crossing on the same tick: the one further past the line was faster.
  crossed.sort((a, b) => b.y - a.y || a.slot - b.slot);
  for (const p of crossed) finish(state, p, race, events);
  if (crossed.length > 0 && state.firstFinishTick === state.roundTick && racers.some((p) => !p.finished)) {
    events.push({ type: 'lastCall' });
  }
  updateBalls(state, track, racers, events);

  const going = racers.filter((p) => !p.finished);
  if (
    going.length === 0 ||
    (state.firstFinishTick > 0 && state.roundTick - state.firstFinishTick >= FINISH_GRACE_TICKS) ||
    race >= RUN_TIME_LIMIT_TICKS
  ) {
    endRun(state, events);
  }
  return events;
}

function finish(state: GameState, p: PlayerState, race: number, events: GameEvent[]): void {
  p.finished = true;
  p.finishTicks = race;
  p.place = ++state.finishedCount;
  p.points += POINTS_BY_PLACE[p.place - 1] ?? 0;
  if (p.place === 1) p.wins++;
  if (p.bestTicks === 0 || race < p.bestTicks) p.bestTicks = race;
  p.steer = 0;
  p.throttle = 0;
  p.firePressed = false;
  events.push({ type: 'finish', playerId: p.id, place: p.place, ticks: race });
  if (p.place === 1) state.firstFinishTick = state.roundTick;
}

/** Places for those who did not finish (by how far down they got), then results or the end of the match. */
function endRun(state: GameState, events: GameEvent[]): void {
  const racers = sortedPlayers(state).filter((p) => p.racing);
  const late = racers.filter((p) => !p.finished).sort((a, b) => b.y - a.y || a.slot - b.slot);
  late.forEach((p, i) => {
    p.place = state.finishedCount + i + 1;
  });
  for (const p of Object.values(state.players)) {
    p.steer = 0;
    p.throttle = 0;
    p.firePressed = false;
  }
  clearBalls(state);
  const order = racers.sort((a, b) => a.place - b.place).map((p) => p.id);
  events.push({ type: 'roundEnd', round: state.round, order });

  if (state.round >= state.roundsTotal) {
    state.phase = 'finished';
    events.push({ type: 'matchEnd', standings: computeStandings(state) });
  } else {
    state.phase = 'results';
    state.phaseTimer = RESULTS_TICKS;
  }
}
