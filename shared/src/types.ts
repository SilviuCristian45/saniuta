// Game state is flat and serializable so it maps directly onto @colyseus/schema:
// players -> MapSchema, number arrays -> ArraySchema, everything else plain numbers/strings/booleans.
// Every number is an integer. The track itself is not in the state: both sides generate it from
// trackId + trackSeed (track.ts).

export type Phase = 'lobby' | 'playing' | 'results' | 'finished';

/** One tick of riding input; held by the sled until the next input arrives. */
export interface SledInput {
  /** Client sequence number, echoed back as PlayerState.lastSeq for reconciliation. */
  seq: number;
  steer: number; // -100 (left) .. 100 (right)
  throttle: number; // > 0 kick with the feet ("sus"), < 0 brake ("jos"), -100..100
  fire: boolean; // throw a snowball; latched until the next tick
  use?: boolean; // use the power-up held; latched until the next tick (absent: not pressed)
}

export interface PlayerInput extends SledInput {
  playerId: string;
}

export interface PlayerState {
  id: string;
  name: string;
  slot: number; // 0..5, also the color of the sled and the scarf
  joinOrder: number;
  isBot: boolean;
  botLevel: number; // BOT_EASY..BOT_HARD, only meaningful for bots
  connected: boolean;
  left: boolean; // gone for good mid-match: stays in the standings until the lobby
  racing: boolean; // on the slope this run (finished ones too)
  // Physics (sub-units, sub-units per tick, angle steps)
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  // Held input
  steer: number;
  throttle: number;
  firePressed: boolean; // consumed at the next tick
  lastSeq: number; // last input seq applied
  // Riding state
  airTicks: number; // >0 while in the air after a ramp
  airTotal: number; // length of the current jump (for the height curve)
  crashTicks: number; // >0 while overturned
  graceTicks: number; // >0 right after getting up: obstacles cannot overturn it
  splatTicks: number; // >0 right after a snowball hit
  snowballs: number; // 0..MAX_SNOWBALLS carried
  throwCooldown: number;
  // Power-ups (powerups.ts)
  powerUp: number; // POWER_NONE or the one held (at most one)
  usePressed: boolean; // consumed at the next tick
  waxTicks: number; // >0 while waxed (faster)
  tea: boolean; // the next overturn is saved (until the end of the run)
  scarfTicks: number; // >0 while snowballs do nothing
  fogTicks: number; // >0 while someone's fog hides the minimap (drawn only)
  // This run
  finished: boolean;
  finishTicks: number; // run time in ticks from HAI! to the finish line (0 = not finished)
  place: number; // 1-based place this run once the run is decided (finishers by time, then the rest by distance)
  // Match
  points: number;
  wins: number;
  bestTicks: number; // best run time this match (0 = none)
  crashes: number; // statistics (awards)
  hits: number; // snowballs that hit someone
  hitsTaken: number; // snowballs that hit this sled
  jumps: number;
  airTime: number; // ticks in the air, all runs of the match
  topSpeed: number; // highest speed of the match (sub-units per tick)
  pickups: number; // snowballs collected
  powerUpsUsed: number;
  // Set by the server room, outside the simulation (which never reads it): no input for IDLE_TICKS
  // while a run is played. Others see "zzz".
  idle: boolean;
}

export interface GameState {
  code: string;
  phase: Phase;
  hostId: string;
  roundsTotal: number;
  botLevel: number; // level given to bots added from now on
  trackId: number; // lobby option: TRACK_BUNICII..TRACK_RANDOM
  trackSeed: number; // the current run's track (fixed per named track, drawn from rng for a random one)
  powerUps: boolean; // lobby option: gift boxes on the track (runs with them never count for the leaderboard)
  round: number;
  tick: number;
  roundTick: number; // ticks since the run started, countdown included
  phaseTimer: number; // results countdown
  firstFinishTick: number; // roundTick when the first sled finished (0 = nobody yet)
  finishedCount: number;
  rng: number; // uint32 RNG state
  joinCounter: number;
  /** Ticks until each snowball pile of the track is back (0 = there). Same length as track.piles. */
  pileTimers: number[];
  /** Ticks until each gift box of the track is back (0 = there). Same length as track.gifts. */
  giftTimers: number[];
  // Snowballs in flight: BALL_SLOTS flat slots (ballTicks 0 = empty), see snowballs.ts.
  ballX: number[];
  ballY: number[];
  ballVx: number[];
  ballVy: number[];
  ballTicks: number[];
  ballOwner: number[]; // thrower's slot
  ballKind: number[]; // BALL_SMALL | BALL_GIANT
  players: Record<string, PlayerState>;
}

export type GameEvent =
  | { type: 'roundStart'; round: number }
  | { type: 'go'; round: number } // countdown over: HAI!
  /** Two sleds shoved each other; x/y the contact point. */
  | { type: 'bump'; a: string; b: string; x: number; y: number; force: number }
  /** Overturned on a tree or a rock. */
  | { type: 'crash'; playerId: string; x: number; y: number; obstacle: number } // obstacle: OBSTACLE_TREE | OBSTACLE_ROCK
  | { type: 'jump'; playerId: string }
  | { type: 'land'; playerId: string }
  | { type: 'pickup'; playerId: string; pile: number }
  | { type: 'throw'; playerId: string; ball: number }
  /** A snowball hit a sled (playerId) or broke on an obstacle/the snowbank (playerId ''). */
  | { type: 'splat'; playerId: string; byId: string; x: number; y: number; big: boolean }
  /** Took a gift box and got this power-up. */
  | { type: 'gift'; playerId: string; gift: number; power: number }
  /** Used the power-up held. */
  | { type: 'power'; playerId: string; power: number }
  /** A power-up saved the sled: the tea from an overturn, the scarf from a snowball. */
  | { type: 'shield'; playerId: string; power: number; x: number; y: number }
  | { type: 'finish'; playerId: string; place: number; ticks: number }
  /** The first finisher started the last FINISH_GRACE_TICKS. */
  | { type: 'lastCall' }
  | { type: 'roundEnd'; round: number; order: string[] }
  | { type: 'matchEnd'; standings: string[] };
