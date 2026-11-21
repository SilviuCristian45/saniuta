import { describe, expect, it } from 'vitest';
import {
  BOT_EASY,
  BOT_HARD,
  BOT_NAMES,
  MAX_PLAYERS,
  TRACK_NEBUNILOR,
  addBot,
  addPlayer,
  backToLobby,
  createGameState,
  leavePlayer,
  nameKey,
  onlyBotsRacing,
  removeBot,
  sanitizeName,
  setBotLevel,
  setDefaultBotLevel,
  setRounds,
  setTrack,
  skipBotRound,
  startMatch,
} from '../src';
import { makeRace } from './helpers';

describe('lobby and match lifecycle', () => {
  it('first human is host; the room fills at 6', () => {
    const state = createGameState({ code: 'L', seed: 1 });
    for (let i = 0; i < MAX_PLAYERS; i++) expect(addPlayer(state, `p${i}`, `P${i}`).ok).toBe(true);
    expect(state.hostId).toBe('p0');
    expect(addPlayer(state, 'late', 'Late')).toEqual({ ok: false, reason: 'full' });
  });

  it('only the host adds bots (mountain names, current level), picks rounds and the track, and starts', () => {
    const state = createGameState({ code: 'L', seed: 1 });
    addPlayer(state, 'h', 'Host');
    addPlayer(state, 'g', 'Guest');
    expect(addBot(state, 'g', 'x').ok).toBe(false);
    expect(setDefaultBotLevel(state, 'h', BOT_EASY)).toBe(true);
    const r = addBot(state, 'h', 'bot1');
    expect(r.ok && r.player.name).toBe(BOT_NAMES[0]);
    expect(state.players.bot1!.botLevel).toBe(BOT_EASY);
    expect(setBotLevel(state, 'h', 'bot1', BOT_HARD)).toBe(true);
    expect(setRounds(state, 'g', 5)).toBe(false);
    expect(setRounds(state, 'h', 4)).toBe(false);
    expect(setRounds(state, 'h', 7)).toBe(true);
    expect(setTrack(state, 'g', TRACK_NEBUNILOR)).toBe(false);
    expect(setTrack(state, 'h', TRACK_NEBUNILOR)).toBe(true);
    expect(startMatch(state, 'g')).toBe(false);
    expect(startMatch(state, 'h')).toBe(true);
    expect(state.trackId).toBe(TRACK_NEBUNILOR);
    expect(addPlayer(state, 'late', 'Late')).toEqual({ ok: false, reason: 'in-progress' });
    expect(removeBot(state, 'h')).toBe(false); // not in the lobby any more
    expect(setTrack(state, 'h', 0)).toBe(false);
  });

  it('host leaving passes the role to the next human, never a bot', () => {
    const state = createGameState({ code: 'L', seed: 1 });
    addPlayer(state, 'h', 'Host');
    addBot(state, 'h', 'bot1');
    addPlayer(state, 'g', 'Guest');
    leavePlayer(state, 'h');
    expect(state.hostId).toBe('g');
    expect(state.players.h).toBeUndefined();
  });

  it('leaving mid-match takes the sled off the slope but keeps the score until the lobby', () => {
    const state = makeRace([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    state.players.b!.points = 7;
    leavePlayer(state, 'b');
    expect(state.players.b!.racing).toBe(false);
    expect(state.players.b!.left).toBe(true);
    expect(state.players.b!.points).toBe(7);
    state.phase = 'finished';
    expect(backToLobby(state, 'a')).toBe(true);
    expect(state.players.b).toBeUndefined();
    expect(state.phase).toBe('lobby');
  });

  it('a run only bots are still racing can be skipped to its end', () => {
    const state = makeRace([{ id: 'h' }, { id: 'b1', isBot: true }, { id: 'b2', isBot: true }]);
    expect(onlyBotsRacing(state)).toBe(false);
    state.players.h!.finished = true;
    expect(onlyBotsRacing(state)).toBe(true);
    const events = skipBotRound(state);
    expect(events.some((e) => e.type === 'roundEnd')).toBe(true);
    expect(state.phase).toBe('results');
  });

  it('nicknames are cleaned up, unique in the room and keyed case-insensitively', () => {
    expect(sanitizeName('  Ana   Maria  ')).toBe('Ana Maria');
    expect(sanitizeName('Ştefan')).toBe('Ștefan');
    expect(sanitizeName('​ㅤ')).toBe('Jucător');
    expect(nameKey('ŞTEFAN')).toBe(nameKey('ștefan'));
    const state = createGameState({ code: 'L', seed: 1 });
    addPlayer(state, 'a', 'Ana');
    addPlayer(state, 'b', 'ana');
    expect(state.players.b!.name).toBe('ana 2');
  });
});
