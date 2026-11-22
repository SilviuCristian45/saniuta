import { describe, expect, it } from 'vitest';
import { BOT_EASY, BOT_HARD, BOT_MEDIUM, DEFAULT_TUNING, TRACK_RANDOM, TUNING, addPlayer, createGameState, hash32, runTick, setTrack, startMatch } from '../src';
import type { GameEvent, GameState, PlayerInput } from '../src';
import { numbersIn } from './helpers';

/** Two humans with scripted pseudo-random inputs plus three bots of every level. */
function newMatch(seed: string, trackId = 1): GameState {
  const state = createGameState({ code: 'DET', seed });
  addPlayer(state, 'h1', 'Ana');
  addPlayer(state, 'h2', 'Ion');
  addPlayer(state, 'b1', 'b1', true, BOT_EASY);
  addPlayer(state, 'b2', 'b2', true, BOT_MEDIUM);
  addPlayer(state, 'b3', 'b3', true, BOT_HARD);
  state.roundsTotal = 3;
  setTrack(state, 'h1', trackId);
  startMatch(state, 'h1');
  return state;
}

function humanInputs(state: GameState): PlayerInput[] {
  const t = state.tick;
  return ['h1', 'h2'].map((id, i) => {
    const h = hash32(Math.floor(t / 10), i);
    return { playerId: id, seq: t + 1, steer: (h % 201) - 100, throttle: ((h >>> 8) % 161) - 60, fire: (h >>> 16) % 23 === 0 };
  });
}

function play(state: GameState, ticks: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks && state.phase !== 'finished'; i++) events.push(...runTick(state, humanInputs(state)));
  return events;
}

describe('determinism', () => {
  it('the simulation runs with the default tuning (only the local ?tune panel may change it)', () => {
    expect(TUNING).toEqual(DEFAULT_TUNING);
  });

  it('same seed and inputs give a byte-identical state and identical events', () => {
    const a = newMatch('seed-1');
    const b = newMatch('seed-1');
    const ea = play(a, 6000);
    const eb = play(b, 6000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(ea)).toBe(JSON.stringify(eb));
    for (const kind of ['crash', 'jump', 'pickup', 'throw', 'finish', 'roundEnd'] as const) {
      expect(ea.some((e) => e.type === kind), kind).toBe(true);
    }
  });

  it('a random track is the same on both sides too', () => {
    const a = newMatch('seed-r', TRACK_RANDOM);
    const b = newMatch('seed-r', TRACK_RANDOM);
    play(a, 4000);
    play(b, 4000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a state that went through JSON (like the network) continues exactly like the original', () => {
    const a = newMatch('seed-2');
    play(a, 1500);
    const b = JSON.parse(JSON.stringify(a)) as GameState;
    play(a, 2000);
    play(b, 2000);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('different seeds play out differently', () => {
    const a = newMatch('seed-a');
    const b = newMatch('seed-b');
    play(a, 900);
    play(b, 900);
    expect(JSON.stringify(a.players)).not.toBe(JSON.stringify(b.players));
  });

  it('every number in the state stays a safe integer, even with fractional inputs', () => {
    const state = newMatch('seed-int');
    for (let i = 0; i < 5000 && state.phase !== 'finished'; i++) {
      const inputs = humanInputs(state).map((inp) => ({ ...inp, steer: inp.steer + 0.37, throttle: inp.throttle - 0.61 }));
      runTick(state, inputs);
      if (i % 50 === 0) expect(numbersIn(state).filter(([, v]) => !Number.isSafeInteger(v))).toEqual([]);
    }
    expect(numbersIn(state).filter(([, v]) => !Number.isSafeInteger(v))).toEqual([]);
  });

  it('never holds -0, which the network turns into 0 (the client would no longer match the server)', () => {
    const state = newMatch('seed-zero');
    for (let i = 0; i < 6000 && state.phase !== 'finished'; i++) {
      // Inputs that truncate to -0 too: -0 itself (JSON keeps it) and small negative fractions.
      const inputs = humanInputs(state).map((inp, k) => (i % 7 === k ? { ...inp, steer: -0.4, throttle: -0 } : inp));
      runTick(state, inputs);
      const negativeZeros = numbersIn(state).filter(([, v]) => Object.is(v, -0));
      if (negativeZeros.length > 0) expect({ tick: state.tick, negativeZeros }).toEqual({ tick: state.tick, negativeZeros: [] });
    }
  });
});
