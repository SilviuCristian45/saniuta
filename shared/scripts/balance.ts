// Bots-only tournament over many seeds: points, run wins, finishes, times, crashes and snowball hits
// per bot level, plus how long runs take, on one track or all of them.
//   npm run balance -- --matches 20 --lineup usor,usor,mediu,mediu,greu,greu [--track 0|1|2|3|all] [--powerups on|off] [--set gravity=32,turnRate=13]
import { parseArgs } from 'node:util';
import {
  BOT_EASY,
  BOT_HARD,
  BOT_LEVEL_NAMES,
  BOT_MEDIUM,
  TRACK_IDS,
  TUNING,
  addPlayer,
  createGameState,
  runTick,
  setTrack,
  setTuning,
  startMatch,
  ticksToMs,
  trackName,
} from '../src';

const LEVELS: Record<string, number> = { usor: BOT_EASY, mediu: BOT_MEDIUM, greu: BOT_HARD };
const { values } = parseArgs({
  options: {
    matches: { type: 'string', default: '20' },
    lineup: { type: 'string', default: 'usor,usor,mediu,mediu,greu,greu' },
    track: { type: 'string', default: 'all' },
    set: { type: 'string', default: '' }, // TUNING overrides: key=value,key=value
    powerups: { type: 'string', default: 'on' },
  },
});
if (values.set) {
  const overrides = Object.fromEntries(values.set.split(',').map((kv) => kv.split('=')).map(([k, v]) => [k!.trim(), Number(v)]));
  for (const key of Object.keys(overrides)) if (!(key in TUNING)) throw new Error(`cheie TUNING necunoscută: ${key}`);
  setTuning(overrides);
  console.log(`TUNING: ${JSON.stringify(overrides)}`);
}
const lineup = values.lineup.split(',').map((s) => {
  const level = LEVELS[s.trim()];
  if (level === undefined) throw new Error(`Nivel necunoscut: "${s}"`);
  return level;
});
const tracks = values.track === 'all' ? TRACK_IDS : [Number(values.track)];
const count = [0, 0, 0];
for (const l of lineup) count[l]!++;

for (const trackId of tracks) {
  const points = [0, 0, 0];
  const wins = [0, 0, 0];
  const finishes = [0, 0, 0];
  const runs = [0, 0, 0];
  const time = [0, 0, 0];
  const crashes = [0, 0, 0];
  const hits = [0, 0, 0];
  const used = [0, 0, 0];
  let winnerTicks = 0;
  let rounds = 0;
  for (let m = 0; m < Number(values.matches); m++) {
    const state = createGameState({ code: 'BAL', seed: `balance-${trackId}-${m}` });
    lineup.forEach((level, i) => addPlayer(state, `b${i}`, `b${i}`, true, level));
    state.hostId = 'b0';
    state.roundsTotal = 3;
    setTrack(state, 'b0', trackId);
    state.powerUps = values.powerups !== 'off';
    startMatch(state, 'b0');
    while (state.phase !== 'finished') {
      for (const e of runTick(state, [])) {
        if (e.type === 'finish' && e.place === 1) winnerTicks += e.ticks;
        if (e.type !== 'roundEnd') continue;
        rounds++;
        for (const id of e.order) {
          const p = state.players[id]!;
          runs[p.botLevel]!++;
          if (p.finished) {
            finishes[p.botLevel]!++;
            time[p.botLevel]! += p.finishTicks;
          }
        }
      }
    }
    for (const p of Object.values(state.players)) {
      points[p.botLevel]! += p.points;
      wins[p.botLevel]! += p.wins;
      crashes[p.botLevel]! += p.crashes;
      hits[p.botLevel]! += p.hits;
      used[p.botLevel]! += p.powerUpsUsed;
    }
  }
  console.log(`\n${trackName(trackId)}: ${rounds} manșe, câștigătorul în medie ${(ticksToMs(winnerTicks / rounds) / 1000).toFixed(1)} s`);
  for (let l = 0; l < 3; l++) {
    if (!count[l]) continue;
    const per = (v: number) => (v / count[l]! / Number(values.matches)).toFixed(1).padStart(5);
    const avg = finishes[l] ? (ticksToMs(time[l]! / finishes[l]!) / 1000).toFixed(1) : '-';
    const pct = runs[l] ? Math.round((100 * finishes[l]!) / runs[l]!) : 0;
    console.log(
      `  ${BOT_LEVEL_NAMES[l]!.padEnd(6)} puncte ${per(points[l]!)}  victorii ${per(wins[l]!)}  ajunge ${String(pct).padStart(3)}%  timp ${avg.padStart(5)} s  răsturnări ${per(crashes[l]!)}  nimeriți ${per(hits[l]!)}  power-up-uri ${per(used[l]!)}   (per bot, per meci)`,
    );
  }
}
