import { describe, expect, it } from 'vitest';
import {
  BOT_EASY,
  BOT_HARD,
  BOT_MEDIUM,
  DOWNHILL,
  FIXED_TRACK_IDS,
  addPlayer,
  botThink,
  cloneState,
  createGameState,
  currentTrack,
  runTick,
  setTrack,
  startMatch,
} from '../src';
import { makeRace, px } from './helpers';

describe('bots', () => {
  it.each(FIXED_TRACK_IDS)('a hard bot gets down track %i well inside the time limit', (trackId) => {
    const state = createGameState({ code: 'B', seed: `solo-${trackId}` });
    addPlayer(state, 'h', 'Host');
    addPlayer(state, 'b', 'Bot', true, BOT_HARD);
    state.roundsTotal = 3;
    setTrack(state, 'h', trackId);
    startMatch(state, 'h');
    // The human stays at the start, the bot races alone.
    for (let i = 0; i < 120 * 30 && !state.players.b!.finished; i++) runTick(state, []);
    expect(state.players.b!.finished).toBe(true);
    expect(state.players.b!.finishTicks).toBeLessThan(110 * 30);
  });

  it('thinking is pure: it changes neither the state nor the RNG', () => {
    const state = makeRace([{ id: 'h' }, { id: 'b', isBot: true, botLevel: BOT_MEDIUM }]);
    for (let i = 0; i < 200; i++) runTick(state, []);
    const before = JSON.stringify(state);
    const a = botThink(state, 'b');
    const b = botThink(cloneState(state), 'b');
    expect(JSON.stringify(state)).toBe(before);
    expect(a).toEqual(b);
  });

  it('kicks off at HAI! and throws at a rival right ahead', () => {
    const state = createGameState({ code: 'B', seed: 1 });
    addPlayer(state, 'h', 'Host');
    addPlayer(state, 'b', 'Bot', true, BOT_HARD);
    startMatch(state, 'h');
    expect(botThink(state, 'b')!.input.throttle).toBe(100);

    const race = makeRace([{ id: 'h' }, { id: 'b', isBot: true, botLevel: BOT_HARD }]);
    const track = currentTrack(race);
    const y = track.startY + px(200);
    const x = race.players.b!.x;
    Object.assign(race.players.b!, { x, y, heading: DOWNHILL, vy: px(6), snowballs: 3 });
    Object.assign(race.players.h!, { x, y: y + px(80), vy: px(6) });
    // Over a few decisions a hard bot (80% per decision) throws.
    let threw = false;
    for (let i = 0; i < 12 && !threw; i++) {
      race.tick++;
      threw = botThink(race, 'b')!.input.fire;
    }
    expect(threw).toBe(true);
  });

  it('levels differ: easy reacts slower and makes more mistakes', async () => {
    const { BOT_PARAMS } = await import('../src');
    expect(BOT_PARAMS[BOT_EASY]!.interval).toBeGreaterThan(BOT_PARAMS[BOT_HARD]!.interval);
    expect(BOT_PARAMS[BOT_EASY]!.mistake).toBeGreaterThan(BOT_PARAMS[BOT_MEDIUM]!.mistake);
    expect(BOT_PARAMS[BOT_HARD]!.throwChance).toBeGreaterThan(BOT_PARAMS[BOT_EASY]!.throwChance);
  });
});
