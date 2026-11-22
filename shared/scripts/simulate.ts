// Runs a bots-only match headless and prints the outcome, to check the simulation without the client.
//   npm run sim -- --bots usor,mediu,greu,greu --rounds 3 --track 1 --seed abc [--powerups off] --verbose
import { parseArgs } from 'node:util';
import {
  BOT_EASY,
  BOT_HARD,
  BOT_LEVEL_NAMES,
  BOT_MEDIUM,
  addPlayer,
  computeStandings,
  createGameState,
  currentTrack,
  runTick,
  setRounds,
  setTrack,
  startMatch,
  ticksToMs,
  trackName,
  type GameState,
} from '../src';

const LEVELS: Record<string, number> = { usor: BOT_EASY, mediu: BOT_MEDIUM, greu: BOT_HARD };

const { values } = parseArgs({
  options: {
    bots: { type: 'string', default: 'usor,mediu,greu' },
    rounds: { type: 'string', default: '3' },
    track: { type: 'string', default: '0' }, // 0 Bunicii, 1 Lupului, 2 Nebunilor, 3 aleatoare
    seed: { type: 'string', default: 'carpati' },
    verbose: { type: 'boolean', short: 'v', default: false },
    powerups: { type: 'string', default: 'on' },
  },
});

const levels = values.bots.split(',').map((s) => {
  const level = LEVELS[s.trim().toLowerCase()];
  if (level === undefined) throw new Error(`Nivel necunoscut: "${s}" (usor, mediu, greu)`);
  return level;
});
if (levels.length < 2 || levels.length > 6) throw new Error('Între 2 și 6 boți.');

const state: GameState = createGameState({ code: 'CLI', seed: values.seed });
levels.forEach((level, i) => addPlayer(state, `b${i + 1}`, `${BOT_LEVEL_NAMES[level]} #${i + 1}`, true, level));
// Bots never become host on their own; here one acts as host so the lobby functions accept the setup.
state.hostId = 'b1';
if (!setRounds(state, 'b1', Number(values.rounds))) throw new Error('Manșe: 3, 5 sau 7.');
if (!setTrack(state, 'b1', Number(values.track))) throw new Error('Pârtia: 0..3.');
state.powerUps = values.powerups !== 'off';
startMatch(state, 'b1');

const name = (id: string) => state.players[id]?.name ?? '-';
const secs = (ticks: number) => (ticksToMs(ticks) / 1000).toFixed(2);

const t0 = performance.now();
while (state.phase !== 'finished') {
  const round = state.round;
  const track = currentTrack(state);
  for (const e of runTick(state, [])) {
    if (values.verbose && e.type === 'crash') console.log(`  ${name(e.playerId)} s-a răsturnat`);
    if (values.verbose && e.type === 'splat' && e.playerId) console.log(`  ${name(e.byId)} l-a nimerit pe ${name(e.playerId)}`);
    if (values.verbose && e.type === 'power') console.log(`  ${name(e.playerId)} folosește power-up-ul ${e.power}`);
    if (e.type === 'roundEnd') {
      console.log(`Manșa ${round} (${track.name}, ${Math.round(track.finishY / 256)} px):`);
      for (const id of e.order) {
        const p = state.players[id]!;
        const time = p.finished ? `${secs(p.finishTicks)} s` : 'n-a ajuns';
        console.log(`  ${p.place}. ${p.name.padEnd(10)} ${time.padStart(10)}  răsturnări ${p.crashes}  sărituri ${p.jumps}  nimeriți ${p.hits}`);
      }
    }
  }
}
const ms = performance.now() - t0;

console.log(`\nClasament (${trackName(state.trackId)}):`);
computeStandings(state).forEach((id, i) => {
  const p = state.players[id]!;
  console.log(`${i + 1}. ${p.name.padEnd(10)} ${String(p.points).padStart(3)} p  victorii ${p.wins}  cel mai bun ${secs(p.bestTicks)} s`);
});
console.log(`\n${state.tick} tick-uri simulate în ${ms.toFixed(0)} ms`);
