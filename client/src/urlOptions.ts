import { BOT_EASY, BOT_HARD, BOT_MEDIUM, DEFAULT_ROUNDS, MAX_PLAYERS, ROUND_OPTIONS, TRACK_IDS } from '@saniuta/shared';
import type { NetSimOptions } from './net/LagLine';

// Test options read from the page URL (see CLAUDE.md).

export const params = new URLSearchParams(window.location.search);

/** Test options that skip the intro and menus and start a local match at once. */
const QUICK_KEYS = ['bots', 'rounds', 'track', 'seed', 'botlevel', 'tune', 'debug'];
/** ?online (implied by ?lag, ?jitter and an invite ?room=) keeps the normal menus, so ?debug applies to online games. */
const keepMenus = ['online', 'lag', 'jitter', 'room'].some((key) => params.has(key));
export const quickStart = !keepMenus && QUICK_KEYS.some((key) => params.has(key));

/** ?debug: hitboxes, bot lines, tick/FPS, own speed and state. */
export const debug = params.has('debug');

/** ?tune: riding-feel sliders (local games only). */
export const tune = params.has('tune');

/** ?bots=1..5 (default 3). */
export const quickBots = clampInt(params.get('bots'), 1, MAX_PLAYERS - 1, 3);

/** ?rounds=3|5|7. */
export const quickRounds = ROUND_OPTIONS.includes(Number(params.get('rounds'))) ? Number(params.get('rounds')) : DEFAULT_ROUNDS;

/** ?track=0..3 (Pârtia Bunicii, Valea Lupului, Coborârea Nebunilor, aleatoare). */
export const quickTrack = TRACK_IDS.includes(Number(params.get('track'))) && params.get('track') !== null ? Number(params.get('track')) : 0;

/** ?seed=abc: the room's RNG (start order, random tracks). */
export const quickSeed = params.get('seed') ?? Math.random().toString(36).slice(2);

const LEVELS: Record<string, number> = { usor: BOT_EASY, mediu: BOT_MEDIUM, greu: BOT_HARD };

/** ?botlevel=usor|mediu|greu (default: the room default). */
export const quickBotLevel: number | undefined = LEVELS[params.get('botlevel') ?? ''];

function clampInt(raw: string | null, lo: number, hi: number, fallback: number): number {
  const v = Math.trunc(Number(raw));
  return raw === null || !Number.isFinite(v) ? fallback : Math.min(hi, Math.max(lo, v));
}

/** ?lag=120&jitter=30: added round trip and random extra delay (ms) for online games. */
export const netSim: NetSimOptions = { lagMs: msParam('lag'), jitterMs: msParam('jitter') };

function msParam(key: string): number {
  return clampInt(params.get(key), 0, 2000, 0);
}
