// Fixed simulation constants. Everything in the simulation is an integer (fixed-point):
// distances in sub-units (FP per pixel), speeds in sub-units per tick, angles in steps (fixed.ts).
// World axes: x to the right, y down the slope (the race goes toward +y).

export const GAME_TITLE = 'Săniuța la vale';

// Timing
/** Simulation ticks per second; client and server step at exactly this rate. */
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;

/** Fixed-point scale: 1 px = FP sub-units. */
export const FP = 256;

/** Heading straight down the slope (angle steps: 0 = +x, 256 = +y). */
export const DOWNHILL = 256;
/** A sled can point at most this far (angle steps) away from straight downhill: ~105°. */
export const MAX_HEADING_OFFSET = 300;

// Players
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS_TO_START = 2;
export const MAX_NAME_LENGTH = 16;

// Sled
/** Sleds collide as discs of this radius (with each other, obstacles, piles and snowballs). */
export const SLED_RADIUS = 13 * FP;
export const SLED_MASS = 100;

// Riding (per tick). Gravity along the slope is GRAVITY × slope% / 100; friction and grip come
// from the surface (per-mille of the forward / sideways speed lost every tick).
export const GRAVITY = 30;
export const MAX_SPEED = 5600; // ~656 px/s, the hard cap
export const FRICTION_SNOW = 8;
export const FRICTION_ICE = 3;
export const FRICTION_DEEP = 22;
export const GRIP_SNOW = 220;
export const GRIP_ICE = 22;
export const GRIP_DEEP = 380;
/** Turning in angle steps per tick at full steer. */
export const TURN_RATE = 12;
/** Extra per-mille of forward speed lost per tick at full steer: tight turns slow the sled down. */
export const TURN_DRAG = 9;
/** "Sus": a kick with the feet, only below PUSH_MAX_SPEED. */
export const PUSH_ACCEL = 45;
export const PUSH_MAX_SPEED = 1300; // ~150 px/s
/** "Jos": extra per-mille of forward and sideways speed lost per tick at full brake. */
export const BRAKE = 55;
/** Hitting the snowbank at the track's edge: the outward speed bounces back this much (percent)... */
export const EDGE_BOUNCE = 30;
/** ...and the sled loses this percent of its speed. */
export const EDGE_LOSS = 6;

// Obstacles
export const TREE_RADIUS = 15 * FP;
export const ROCK_RADIUS = 13 * FP;
/** Approach speed (along the contact normal) above which hitting a tree or a rock overturns the sled. */
export const CRASH_MIN_SPEED = 650;
/** Overturned: no steering, no kicking, no throwing (~1 s). */
export const CRASH_TICKS = 30;
/** Percent of the approach speed the sled bounces back with when it overturns. */
export const CRASH_BOUNCE = 25;
/** Per-mille of speed lost per tick while overturned. */
export const CRASH_FRICTION = 90;
/** After getting up: obstacles only push the sled aside for a moment (no second crash right away). */
export const GRACE_TICKS = 24;

// Ramps
/** Below this speed a sled just rolls over a ramp. */
export const JUMP_MIN_SPEED = 1200;
/** Air time: speed × AIR_PER_SPEED / 1000 ticks, clamped to [AIR_MIN_TICKS, AIR_MAX_TICKS]. */
export const AIR_PER_SPEED = 7;
export const AIR_MIN_TICKS = 14;
export const AIR_MAX_TICKS = 40;
/** Per-mille of speed lost per tick in the air. */
export const AIR_DRAG = 2;
/** Added along the heading on landing. */
export const LAND_BOOST = 700;
/** Peak height of a jump in px, for drawing only (scale and shadow); the sim keeps airTicks/airTotal. */
export const JUMP_HEIGHT_PX = 36;

// Snowballs
export const MAX_SNOWBALLS = 3;
export const PILE_RADIUS = 14 * FP;
/** A pile comes back this long after someone took it. */
export const PILE_RESPAWN_TICKS = 6 * TICK_RATE;
/** Snowballs in flight at once (flat state slots). */
export const BALL_SLOTS = 8;
export const BALL_RADIUS = 5 * FP;
/** Thrown forward at the sled's own velocity plus this along its heading. */
export const BALL_SPEED = 2400;
export const BALL_TICKS = 36;
export const THROW_COOLDOWN_TICKS = 12;
/** A hit sled keeps this percent of its speed. */
export const BALL_HIT_KEEP_PCT = 50;
/** Ticks the snow stays on a hit sled (drawn; it also cannot kick meanwhile). */
export const SPLAT_TICKS = 24;

// Sled-sled collisions
/** Restitution in percent (100 = perfectly elastic): sleds mostly shove each other. */
export const RESTITUTION = 40;
/** Impulse above which a contact is reported as a 'bump' event (sound). */
export const BUMP_EVENT_MIN = 30000;

// Input
export const INPUT_MAX = 100; // steer and throttle are integers in [-INPUT_MAX, INPUT_MAX]

// Race flow
/** "3, 2, 1, HAI!" at the start of every run: sleds wait at the start line. */
export const COUNTDOWN_TICKS = 3 * TICK_RATE;
/** Once the first sled crosses the finish line, the others have this long. */
export const FINISH_GRACE_TICKS = 15 * TICK_RATE;
/** A run always ends this long after HAI! (nobody should ever need it). */
export const RUN_TIME_LIMIT_TICKS = 150 * TICK_RATE;
/** The results between runs. */
export const RESULTS_TICKS = 7 * TICK_RATE;
/** Per-mille of speed a finished sled loses per tick in the run-out. */
export const FINISHED_FRICTION = 30;
export const ROUND_OPTIONS: readonly number[] = [3, 5, 7];
export const DEFAULT_ROUNDS = 3;

// Scoring: points by finishing place; not finishing in time scores nothing.
export const POINTS_BY_PLACE: readonly number[] = [10, 7, 5, 3, 2, 1];

// Tracks (GameState.trackId)
export const TRACK_BUNICII = 0;
export const TRACK_LUPULUI = 1;
export const TRACK_NEBUNILOR = 2;
export const TRACK_RANDOM = 3;
export const TRACK_IDS: readonly number[] = [TRACK_BUNICII, TRACK_LUPULUI, TRACK_NEBUNILOR, TRACK_RANDOM];
export const FIXED_TRACK_IDS: readonly number[] = [TRACK_BUNICII, TRACK_LUPULUI, TRACK_NEBUNILOR];
export const DEFAULT_TRACK = TRACK_BUNICII;

// Surfaces
export const SURFACE_SNOW = 0;
export const SURFACE_ICE = 1;
export const SURFACE_DEEP = 2;

// Obstacles
export const OBSTACLE_TREE = 0;
export const OBSTACLE_ROCK = 1;

// Bots
export const BOT_EASY = 0;
export const BOT_MEDIUM = 1;
export const BOT_HARD = 2;
export const BOT_LEVELS: readonly number[] = [BOT_EASY, BOT_MEDIUM, BOT_HARD];
export const DEFAULT_BOT_LEVEL = BOT_MEDIUM;
/** Names for bots added in the lobby, in order. */
export const BOT_NAMES: readonly string[] = ['Nea Ghiță', 'Ileana', 'Moș Vasile', 'Tanti Florica', 'Bulgărel', 'Fulguța'];
