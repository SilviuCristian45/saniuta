import type { GameState, PlayerState } from './types';

// Every field of the state, listed once: the server mirrors exactly these into the Colyseus
// schema and the client rebuilds exactly these, so its prediction steps from the same state the
// server has (a test checks that the lists match createGameState/addPlayer).

export const GAME_STATE_KEYS = [
  'code',
  'phase',
  'hostId',
  'roundsTotal',
  'botLevel',
  'trackId',
  'trackSeed',
  'round',
  'tick',
  'roundTick',
  'phaseTimer',
  'firstFinishTick',
  'finishedCount',
  'rng',
  'joinCounter',
] as const satisfies readonly Exclude<keyof GameState, 'players'>[];

/** The number arrays of the state (ArraySchema<number> on the server). */
export const GAME_ARRAY_KEYS = ['pileTimers', 'ballX', 'ballY', 'ballVx', 'ballVy', 'ballTicks', 'ballOwner'] as const satisfies readonly Exclude<
  keyof GameState,
  'players'
>[];

export const PLAYER_STATE_KEYS = [
  'id',
  'name',
  'slot',
  'joinOrder',
  'isBot',
  'botLevel',
  'connected',
  'left',
  'racing',
  'x',
  'y',
  'vx',
  'vy',
  'heading',
  'steer',
  'throttle',
  'firePressed',
  'lastSeq',
  'airTicks',
  'airTotal',
  'crashTicks',
  'graceTicks',
  'splatTicks',
  'snowballs',
  'throwCooldown',
  'finished',
  'finishTicks',
  'place',
  'points',
  'wins',
  'bestTicks',
  'crashes',
  'hits',
  'jumps',
  'pickups',
  'idle',
] as const satisfies readonly (keyof PlayerState)[];

/** The decoded schema as the Colyseus SDK hands it over: players in a MapSchema, arrays in ArraySchemas. */
export interface RemoteCollection<T> {
  forEach(cb: (value: T) => void): void;
}
type ArrayKey = (typeof GAME_ARRAY_KEYS)[number];
export type RemoteState = Omit<GameState, 'players' | ArrayKey> & {
  players: RemoteCollection<PlayerState>;
} & Record<ArrayKey, Iterable<number>>;

/** A plain GameState from the decoded schema (the client's state rebuild). */
export function rebuildState(remote: Readonly<RemoteState>): GameState {
  const players: Record<string, PlayerState> = {};
  remote.players.forEach((p) => {
    players[p.id] = pick(p, PLAYER_STATE_KEYS);
  });
  const arrays = {} as Pick<GameState, ArrayKey>;
  for (const key of GAME_ARRAY_KEYS) arrays[key] = Array.from(remote[key]);
  return { ...pick(remote, GAME_STATE_KEYS), ...arrays, players };
}

/** A deep copy (the state is flat: one level of players and number arrays). */
export function cloneState(state: Readonly<GameState>): GameState {
  const players: Record<string, PlayerState> = {};
  for (const p of Object.values(state.players)) players[p.id] = { ...p };
  const copy: GameState = { ...state, players };
  for (const key of GAME_ARRAY_KEYS) copy[key] = [...state[key]];
  return copy;
}

function pick<T, K extends keyof T>(src: Readonly<T>, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = src[key];
  return out;
}
