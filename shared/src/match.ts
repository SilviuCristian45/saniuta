import {
  BOT_HARD,
  BOT_LEVELS,
  BOT_NAMES,
  DEFAULT_BOT_LEVEL,
  DEFAULT_ROUNDS,
  DEFAULT_TRACK,
  DOWNHILL,
  FP,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  ROUND_OPTIONS,
  TRACK_IDS,
  TRACK_RANDOM,
} from './constants';
import { idiv } from './fixed';
import { nextInt, seedFrom } from './rng';
import { clearBalls, resetPiles } from './snowballs';
import { centerAt, fixedTrackSeed, getTrack } from './track';
import type { GameEvent, GameState, PlayerState } from './types';

/** Sleds line up this far above the start line, this far apart. */
const START_BACK = 24 * FP;
const START_SPACING = 56 * FP;

export interface CreateOptions {
  code: string;
  seed: number | string;
}

export function createGameState(opts: CreateOptions): GameState {
  const state: GameState = {
    code: opts.code,
    phase: 'lobby',
    hostId: '',
    roundsTotal: DEFAULT_ROUNDS,
    botLevel: DEFAULT_BOT_LEVEL,
    trackId: DEFAULT_TRACK,
    trackSeed: fixedTrackSeed(DEFAULT_TRACK),
    round: 0,
    tick: 0,
    roundTick: 0,
    phaseTimer: 0,
    firstFinishTick: 0,
    finishedCount: 0,
    rng: seedFrom(opts.seed),
    joinCounter: 0,
    pileTimers: [],
    ballX: [],
    ballY: [],
    ballVx: [],
    ballVy: [],
    ballTicks: [],
    ballOwner: [],
    players: {},
  };
  clearBalls(state);
  return state;
}

/** Players ordered by slot; every per-player loop uses this order for determinism. */
export function sortedPlayers(state: GameState): PlayerState[] {
  return Object.values(state.players).sort((a, b) => a.slot - b.slot);
}

/** Letters that draw nothing (Hangul fillers, braille blank, Khmer inherent vowels, grapheme joiner). */
const BLANK_LETTERS = /[ᅟᅠㅤﾠ⠀឴឵͏]/gu;
/** Romanian is written with comma-below ș/ț; old keyboards type the cedilla look-alikes. */
const COMMA_BELOW: Record<string, string> = { ş: 'ș', Ş: 'Ș', ţ: 'ț', Ţ: 'Ț' };

/**
 * A nickname as everyone sees it: NFC, Romanian ș/ț, no control/format/private/unassigned characters
 * or letters that draw nothing, plain single spaces, at most two combining marks in a row (no zalgo),
 * at most MAX_NAME_LENGTH characters. Without a letter, digit or emoji left it becomes 'Jucător'.
 * Idempotent. The raw input is cut first, so a huge one costs nothing.
 */
export function sanitizeName(name: string): string {
  const text = name
    .slice(0, 16 * MAX_NAME_LENGTH)
    .normalize('NFC')
    .replace(/[şŞţŢ]/g, (c) => COMMA_BELOW[c]!)
    .replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '')
    .replace(BLANK_LETTERS, '')
    .replace(/\p{Zs}+/gu, ' ')
    .replace(/(\p{M}\p{M})\p{M}+/gu, '$1');
  const clean = [...text.trim()].slice(0, MAX_NAME_LENGTH).join('').trim();
  return /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(clean) ? clean : 'Jucător';
}

/** One leaderboard row per key: the sanitized nickname, lowercased ("Ştefan" and "ștefan" are the same player). */
export function nameKey(name: string): string {
  return sanitizeName(name).toLowerCase();
}

/** The name itself if no other player in the room has it (in any case), otherwise with the first free number: "Ana 2". */
function uniqueName(state: GameState, name: string): string {
  const taken = new Set(Object.values(state.players).map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = [...name].slice(0, MAX_NAME_LENGTH - suffix.length).join('').trim() + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export type JoinResult = { ok: true; player: PlayerState } | { ok: false; reason: 'in-progress' | 'full' | 'duplicate' };

/** Joins are only allowed in the lobby. The first human to join becomes host. */
export function addPlayer(state: GameState, id: string, name: string, isBot = false, botLevel = BOT_HARD): JoinResult {
  if (state.phase !== 'lobby') return { ok: false, reason: 'in-progress' };
  if (state.players[id]) return { ok: false, reason: 'duplicate' };
  const used = new Set(Object.values(state.players).map((p) => p.slot));
  if (used.size >= MAX_PLAYERS) return { ok: false, reason: 'full' };
  let slot = 0;
  while (used.has(slot)) slot++;
  const player: PlayerState = {
    id,
    name: uniqueName(state, sanitizeName(name)),
    slot,
    joinOrder: state.joinCounter++,
    isBot,
    botLevel,
    connected: true,
    left: false,
    racing: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    heading: DOWNHILL,
    steer: 0,
    throttle: 0,
    firePressed: false,
    lastSeq: 0,
    airTicks: 0,
    airTotal: 0,
    crashTicks: 0,
    graceTicks: 0,
    splatTicks: 0,
    snowballs: 0,
    throwCooldown: 0,
    finished: false,
    finishTicks: 0,
    place: 0,
    points: 0,
    wins: 0,
    bestTicks: 0,
    crashes: 0,
    hits: 0,
    hitsTaken: 0,
    jumps: 0,
    airTime: 0,
    topSpeed: 0,
    pickups: 0,
    idle: false,
  };
  state.players[id] = player;
  if (!state.hostId && !isBot) state.hostId = id;
  return { ok: true, player };
}

/** Adds a bot with a free mountain name, at the room's current bot level. Host-only, lobby-only. */
export function addBot(state: GameState, byId: string, botId: string): JoinResult | { ok: false; reason: 'not-host' } {
  if (byId !== state.hostId) return { ok: false, reason: 'not-host' };
  const taken = new Set(Object.values(state.players).map((p) => p.name));
  const name = BOT_NAMES.find((n) => !taken.has(n)) ?? 'Bot';
  return addPlayer(state, botId, name, true, state.botLevel);
}

/** The level for bots added from now on ("Nivel boți"). Host-only, lobby-only. */
export function setDefaultBotLevel(state: GameState, byId: string, level: number): boolean {
  if (byId !== state.hostId || state.phase !== 'lobby' || !BOT_LEVELS.includes(level)) return false;
  state.botLevel = level;
  return true;
}

/** Changes one bot's level. Host-only, lobby-only. */
export function setBotLevel(state: GameState, byId: string, botId: string, level: number): boolean {
  const bot = state.players[botId];
  if (byId !== state.hostId || state.phase !== 'lobby' || !bot?.isBot || !BOT_LEVELS.includes(level)) return false;
  bot.botLevel = level;
  return true;
}

/** Easy -> medium -> hard -> easy, for the lobby's one-click level tag. */
export function nextBotLevel(level: number): number {
  return BOT_LEVELS[(BOT_LEVELS.indexOf(level) + 1) % BOT_LEVELS.length]!;
}

/** Removes the most recently added bot. Host-only, lobby-only. */
export function removeBot(state: GameState, byId: string): boolean {
  if (byId !== state.hostId || state.phase !== 'lobby') return false;
  const bot = Object.values(state.players)
    .filter((p) => p.isBot)
    .sort((a, b) => b.joinOrder - a.joinOrder)[0];
  if (!bot) return false;
  removePlayer(state, bot.id);
  return true;
}

/** Removes a player; if the host leaves, the next human by join order takes over. */
export function removePlayer(state: GameState, id: string): void {
  if (!state.players[id]) return;
  delete state.players[id];
  if (state.hostId === id) state.hostId = nextHost(state);
}

/**
 * A player gone for good (tab closed, reconnection window expired). In the lobby they are
 * removed; mid-match their sled leaves the slope and they stay in the standings until the lobby.
 */
export function leavePlayer(state: GameState, id: string): GameEvent[] {
  const p = state.players[id];
  if (!p) return [];
  if (state.phase === 'lobby') {
    removePlayer(state, id);
    return [];
  }
  p.left = true;
  p.connected = false;
  p.racing = false;
  p.steer = 0;
  p.throttle = 0;
  p.firePressed = false;
  if (state.hostId === id) state.hostId = nextHost(state);
  return [];
}

/** The next host: the earliest-joined human still in the room, connected ones first. Never a bot. */
function nextHost(state: GameState): string {
  const next = Object.values(state.players)
    .filter((p) => !p.isBot && !p.left && p.id !== state.hostId)
    .sort((a, b) => Number(b.connected) - Number(a.connected) || a.joinOrder - b.joinOrder)[0];
  return next ? next.id : '';
}

/** Marks a player as temporarily disconnected (they keep their place for reconnection). */
export function setConnected(state: GameState, id: string, connected: boolean): void {
  const p = state.players[id];
  if (p) p.connected = connected;
}

export function setRounds(state: GameState, byId: string, rounds: number): boolean {
  if (byId !== state.hostId || state.phase !== 'lobby' || !ROUND_OPTIONS.includes(rounds)) return false;
  state.roundsTotal = rounds;
  return true;
}

/** Host, lobby: which track the match is raced on. */
export function setTrack(state: GameState, byId: string, trackId: number): boolean {
  if (byId !== state.hostId || state.phase !== 'lobby' || !TRACK_IDS.includes(trackId)) return false;
  state.trackId = trackId;
  if (trackId !== TRACK_RANDOM) state.trackSeed = fixedTrackSeed(trackId);
  return true;
}

export function canStart(state: GameState, byId: string): boolean {
  return byId === state.hostId && state.phase === 'lobby' && Object.keys(state.players).length >= MIN_PLAYERS_TO_START;
}

/** Host starts the match from the lobby: scores reset, run 1 begins. */
export function startMatch(state: GameState, byId: string): boolean {
  if (!canStart(state, byId)) return false;
  for (const p of Object.values(state.players)) {
    p.points = 0;
    p.wins = 0;
    p.bestTicks = 0;
    p.crashes = 0;
    p.hits = 0;
    p.hitsTaken = 0;
    p.jumps = 0;
    p.airTime = 0;
    p.topSpeed = 0;
    p.pickups = 0;
  }
  state.round = 1;
  startRound(state);
  return true;
}

/** "Încă un meci": host sends everyone back to the lobby of the same room. */
export function backToLobby(state: GameState, byId: string): boolean {
  if (byId !== state.hostId || state.phase !== 'finished') return false;
  state.phase = 'lobby';
  state.round = 0;
  clearBalls(state);
  for (const p of Object.values(state.players)) {
    if (p.left) delete state.players[p.id];
    else p.racing = false;
  }
  return true;
}

/**
 * A new run: the track (a new one for "Pârtie aleatoare"), every sled lined up above the start line
 * in a seeded order, the piles back, the countdown starts.
 */
export function startRound(state: GameState): void {
  state.phase = 'playing';
  state.roundTick = 0;
  state.phaseTimer = 0;
  state.firstFinishTick = 0;
  state.finishedCount = 0;
  state.trackSeed = state.trackId === TRACK_RANDOM ? nextInt(state, 2147483647) : fixedTrackSeed(state.trackId);
  const track = getTrack(state.trackId, state.trackSeed);
  resetPiles(state, track);
  clearBalls(state);

  const racers = sortedPlayers(state).filter((p) => !p.left);
  // Seeded shuffle of the start positions.
  const order = racers.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = nextInt(state, i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const y = track.startY - START_BACK;
  const c = centerAt(track, y);
  racers.forEach((p, i) => {
    p.x = c + idiv((2 * order[i]! + 1 - racers.length) * START_SPACING, 2);
    p.y = y;
  });
  for (const p of sortedPlayers(state)) {
    p.racing = !p.left;
    p.vx = 0;
    p.vy = 0;
    p.heading = DOWNHILL;
    p.steer = 0;
    p.throttle = 0;
    p.firePressed = false;
    p.airTicks = 0;
    p.airTotal = 0;
    p.crashTicks = 0;
    p.graceTicks = 0;
    p.splatTicks = 0;
    p.snowballs = 0;
    p.throwCooldown = 0;
    p.finished = false;
    p.finishTicks = 0;
    p.place = 0;
  }
}

/** Mid-run with no human still on the way down but bots still racing; the run can be fast-forwarded. */
export function onlyBotsRacing(state: GameState): boolean {
  const going = Object.values(state.players).filter((p) => p.racing && !p.finished);
  return state.phase === 'playing' && going.length > 0 && going.every((p) => p.isBot);
}

/** Player ids ranked by points, then run wins, best run time, slot. */
export function computeStandings(state: GameState): string[] {
  const best = (p: PlayerState) => (p.bestTicks > 0 ? p.bestTicks : Number.MAX_SAFE_INTEGER);
  return Object.values(state.players)
    .sort((a, b) => b.points - a.points || b.wins - a.wins || best(a) - best(b) || a.slot - b.slot)
    .map((p) => p.id);
}
