import { describe, expect, it } from 'vitest';
import { BOT_EASY, BOT_HARD, BOT_MEDIUM, FIXED_TRACK_IDS, addPlayer, createGameState, runTick, setTrack, startMatch } from '../src';

// Bots of every level on the same slope, over fixed seeds: harder bots must come out ahead.
// Retune BOT_PARAMS against this (scripts/balance.ts prints the same numbers over more matches).

describe('bot balance', () => {
  it.each(FIXED_TRACK_IDS)('Greu > Mediu > Ușor in points and run wins on track %i', (trackId) => {
    const points = [0, 0, 0];
    const wins = [0, 0, 0];
    for (let m = 0; m < 4; m++) {
      const state = createGameState({ code: 'BAL', seed: `balance-${trackId}-${m}` });
      [BOT_EASY, BOT_EASY, BOT_MEDIUM, BOT_MEDIUM, BOT_HARD, BOT_HARD].forEach((level, i) => addPlayer(state, `b${i}`, `b${i}`, true, level));
      state.hostId = 'b0';
      state.roundsTotal = 3;
      setTrack(state, 'b0', trackId);
      startMatch(state, 'b0');
      while (state.phase !== 'finished') runTick(state, []);
      for (const p of Object.values(state.players)) {
        points[p.botLevel]! += p.points;
        wins[p.botLevel]! += p.wins;
      }
    }
    expect(points[BOT_HARD]).toBeGreaterThan(points[BOT_MEDIUM]!);
    expect(points[BOT_MEDIUM]).toBeGreaterThan(points[BOT_EASY]!);
    expect(wins[BOT_HARD]).toBeGreaterThanOrEqual(wins[BOT_MEDIUM]!);
  }, 60000);
});
