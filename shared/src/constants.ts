// Game-wide constants. Driving-feel numbers move to tuning.ts in stage 1.

export const GAME_TITLE = 'Săniuța la vale';

/** Simulation ticks per second: the same in LocalTransport, client prediction and on the server. */
export const TICK_RATE = 30;

/** Colyseus room name (rooms are joined by their 6-character code, which is the room id). */
export const ROOM_NAME = 'saniuta';

export const MAX_PLAYERS = 6;
