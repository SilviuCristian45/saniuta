import { randomBytes, randomInt } from 'node:crypto';
import { Room, ServerError, type AuthContext, type Client, type Delayed } from '@colyseus/core';
import {
  addBot,
  addPlayer,
  backToLobby,
  CLOSE_LOBBY_IDLE,
  COUNTDOWN_TICKS,
  createGameState,
  ERR_IN_PROGRESS,
  ERR_ROOM_FULL,
  ERR_SERVER_FULL,
  ERR_TOO_MANY_ROOMS,
  generateRoomCode,
  IDLE_TICKS,
  InputQueue,
  LEADERBOARD_MIN_ACTIVE_PERCENT,
  leavePlayer,
  MAX_PLAYERS,
  MSG_EVENTS,
  MSG_PONG,
  MSG_RECORDS,
  parseInput,
  removeBot,
  ROOM_CODE_ALPHABET,
  runTick,
  setBotLevel,
  setConnected,
  setDefaultBotLevel,
  setRounds,
  setPowerUps,
  setTrack,
  skipBotRound,
  startMatch,
  TICK_RATE,
  type GameEvent,
  type GameState,
  type MatchRecords,
  type Pong,
  type RoomStatus,
  type TickEvents,
} from '@saniuta/shared';
import { IP_HEADER } from './clientIp';
import { LEADERBOARD_RUNS_PER_IP_PER_DAY, LOBBY_IDLE_MINUTES, MAX_MESSAGES_PER_SECOND, MAX_ROOMS, MAX_ROOMS_PER_IP, RECONNECT_SECONDS } from './config';
import { currentLeaderboard, runResult } from './leaderboard';
import { DailyQuota } from './limits';
import { mirror } from './mirror';
import { isCodeTaken, registerRoom, roomCount, roomsOwnedBy, unregisterRoom } from './registry';
import { RoomState } from './schema';

/** Join/create option onAuth overwrites with the requester's limit key. */
const CLIENT_IP = 'clientIp';

interface JoinOptions {
  name?: unknown;
  /** Set by onAuth from the guard's IP_HEADER (never what the client sent): the limit key, '' outside Caddy. */
  [CLIENT_IP]?: unknown;
}

/** Leaderboard runs saved per address today, across all rooms. */
export const savedRunsToday = new DailyQuota(LEADERBOARD_RUNS_PER_IP_PER_DAY);

/** The limit key onAuth put in the options. */
function clientIpOf(options: JoinOptions | undefined): string {
  const ip = options?.[CLIENT_IP];
  return typeof ip === 'string' ? ip : '';
}

/**
 * One game room. Authoritative: clients only send inputs and lobby intents; the room runs the
 * shared simulation at TICK_RATE and sends one state patch per tick (each carries its tick and
 * every player's last processed input seq, which the clients reconcile their prediction with).
 */
export class SaniutaRoom extends Room<{ state: RoomState }> {
  private game!: GameState;
  private readonly inputQueue = new InputQueue();
  /** Events produced outside a tick (skipped runs), sent with the next one. */
  private pendingEvents: GameEvent[] = [];
  private botCounter = 0;
  /** Closes the room if it sits in the lobby this long without a Start; a field so tests can shorten it. */
  lobbyIdleMs = LOBBY_IDLE_MINUTES * 60_000;
  private lobbyTimer: Delayed | undefined;
  /** The tick each player's last input arrived on (for idle). */
  private readonly lastInputTick = new Map<string, number>();
  /** Each player's limit key ('' outside Caddy), for the leaderboard quota. */
  private readonly clientIps = new Map<string, string>();
  /** Per human, this run: ticks riding after the countdown (not finished), and of those the ones with input held. */
  private readonly activity = new Map<string, { riding: number; driving: number }>();

  /**
   * Runs for every create/join request, before the room exists for a create. Only stamps the options
   * with the requester's limit key (onCreate counts rooms per key); anything but a plain object is refused.
   */
  static async onAuth(_token: string, options: unknown, context: AuthContext): Promise<boolean> {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) return false;
    (options as JoinOptions)[CLIENT_IP] = context.headers.get(IP_HEADER) ?? '';
    return true;
  }

  onCreate(options?: JoinOptions): void {
    if (roomCount() >= MAX_ROOMS) throw new ServerError(ERR_SERVER_FULL, 'Serverul e plin');
    const ownerIp = clientIpOf(options);
    if (ownerIp && roomsOwnedBy(ownerIp) >= MAX_ROOMS_PER_IP) throw new ServerError(ERR_TOO_MANY_ROOMS, 'Prea multe jocuri de la aceeași adresă');
    // Room codes double as Colyseus room ids, so players join with joinById(code).
    // From crypto: Math.random could be predicted from the codes of rooms one creates oneself.
    const code = generateRoomCode(() => (randomInt(ROOM_CODE_ALPHABET.length) + 0.5) / ROOM_CODE_ALPHABET.length, isCodeTaken);
    this.roomId = code;
    registerRoom(code, this, ownerIp);
    // Out of the public listing: only someone with the code (joinById) finds the room.
    void this.setPrivate(true);

    this.maxClients = MAX_PLAYERS;
    this.autoDispose = true;
    this.maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;

    this.game = createGameState({ code, seed: randomBytes(8).toString('hex') });
    this.state = new RoomState();
    mirror(this.game, this.state);

    this.onMessage('input', (client, msg: unknown) => {
      if (this.game.phase !== 'playing') return;
      const input = parseInput(msg);
      // The player id always comes from the connection, never from the message.
      if (!input) return;
      this.inputQueue.push(client.sessionId, input);
      this.lastInputTick.set(client.sessionId, this.game.tick);
    });
    this.onMessage('ping', (client, msg: { t?: unknown }) => {
      if (typeof msg?.t === 'number' && Number.isFinite(msg.t)) client.send(MSG_PONG, { t: msg.t } satisfies Pong);
    });
    // Lobby actions: the shared functions check that the sender is the host and the room is in the lobby.
    this.onMessage('rounds', (client, msg: { rounds?: unknown }) => {
      if (typeof msg?.rounds === 'number') setRounds(this.game, client.sessionId, msg.rounds);
    });
    this.onMessage('track', (client, msg: { trackId?: unknown }) => {
      if (typeof msg?.trackId === 'number') setTrack(this.game, client.sessionId, msg.trackId);
    });
    this.onMessage('powerUps', (client, msg: { on?: unknown }) => {
      if (typeof msg?.on === 'boolean') setPowerUps(this.game, client.sessionId, msg.on);
    });
    this.onMessage('addBot', (client) => {
      addBot(this.game, client.sessionId, `bot${++this.botCounter}`);
    });
    this.onMessage('removeBot', (client) => {
      removeBot(this.game, client.sessionId);
    });
    this.onMessage('botLevel', (client, msg: { level?: unknown }) => {
      if (typeof msg?.level === 'number') setDefaultBotLevel(this.game, client.sessionId, msg.level);
    });
    this.onMessage('setBotLevel', (client, msg: { botId?: unknown; level?: unknown }) => {
      if (typeof msg?.botId === 'string' && typeof msg.level === 'number') setBotLevel(this.game, client.sessionId, msg.botId, msg.level);
    });
    this.onMessage('start', async (client) => {
      if (!startMatch(this.game, client.sessionId)) return;
      this.lobbyTimer?.clear();
      await this.lock();
    });
    this.onMessage('lobby', async (client) => {
      if (!backToLobby(this.game, client.sessionId)) return;
      this.armLobbyTimer();
      await this.unlock();
    });
    // Online a run may be fast-forwarded only by the host, and only once no human is still riding.
    this.onMessage('skipRound', (client) => {
      if (client.sessionId !== this.game.hostId) return;
      this.inputQueue.clear();
      this.pendingEvents.push(...skipBotRound(this.game));
    });
    this.onMessage('*', () => {
      // unknown message types are ignored
    });

    this.setFixedTimestep(() => this.tick(), TICK_RATE);
    // No patch timer: tick() sends a patch right after every simulation step. Only after
    // setFixedTimestep: without a simulation loop, Colyseus would start a second timer that
    // advances the room clock on its own, and the fixed-step loop would barely ever step.
    this.patchRate = null;
    this.armLobbyTimer();
  }

  /** (Re)starts the countdown after which a lobby nobody started is closed. */
  armLobbyTimer(): void {
    this.lobbyTimer?.clear();
    this.lobbyTimer = this.clock.setTimeout(() => {
      // Everyone goes back to the menu with a message (CLOSE_LOBBY_IDLE); the room disposes itself.
      if (this.game.phase === 'lobby') void this.disconnect(CLOSE_LOBBY_IDLE);
    }, this.lobbyIdleMs);
  }

  onJoin(client: Client, options?: JoinOptions): void {
    const name = typeof options?.name === 'string' ? options.name : '';
    const result = addPlayer(this.game, client.sessionId, name);
    if (!result.ok) {
      if (result.reason === 'in-progress') throw new ServerError(ERR_IN_PROGRESS, 'Meciul e în desfășurare');
      throw new ServerError(ERR_ROOM_FULL, 'Jocul e plin');
    }
    this.clientIps.set(client.sessionId, clientIpOf(options));
    mirror(this.game, this.state);
  }

  onDrop(client: Client): void {
    setConnected(this.game, client.sessionId, false);
    // Rejected when the window runs out (onLeave follows) or the room is shutting down.
    this.allowReconnection(client, RECONNECT_SECONDS).catch(() => undefined);
  }

  onReconnect(client: Client): void {
    setConnected(this.game, client.sessionId, true);
    // A reloaded tab numbers its inputs on from PlayerState.lastSeq, which may be below the last one
    // received; whatever the old connection still had queued is stale anyway.
    this.inputQueue.remove(client.sessionId);
  }

  /** Gone for good: a consented leave, or the reconnection window expired. */
  onLeave(client: Client): void {
    this.pendingEvents.push(...leavePlayer(this.game, client.sessionId));
    this.inputQueue.remove(client.sessionId);
    this.lastInputTick.delete(client.sessionId);
    this.clientIps.delete(client.sessionId);
  }

  onDispose(): void {
    unregisterRoom(this.roomId);
  }

  /** Read by GET /rooms/:code to explain why a join was refused. */
  status(): RoomStatus {
    if (this.game.phase !== 'lobby') return 'playing';
    return Object.keys(this.game.players).length >= MAX_PLAYERS ? 'full' : 'open';
  }

  private tick(): void {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    // Inputs only count while a run is being played; nothing moves in the lobby.
    if (this.game.phase !== 'playing') this.inputQueue.clear();
    if (this.game.phase !== 'lobby') events.push(...runTick(this.game, this.inputQueue.take()));
    if (events.some((e) => e.type === 'roundStart')) this.activity.clear();
    this.trackActivity();
    mirror(this.game, this.state);
    // The patch first: clients hold a tick's events until their state has reached it.
    this.broadcastPatch();
    if (events.length > 0) this.broadcast(MSG_EVENTS, { tick: this.game.tick, events } satisfies TickEvents);
    // A run ends once (from a tick, or from a skipped run sent with this tick); the state still holds its times.
    if (events.some((e) => e.type === 'roundEnd')) this.saveRun();
  }

  /**
   * Who is idle: still riding, but no input for IDLE_TICKS (a hidden tab, a dropped connection), and
   * how much each human really rode this run, for the leaderboard's "played for real" rule. Room-side
   * bookkeeping: the simulation never reads PlayerState.idle (others see "zzz").
   */
  private trackActivity(): void {
    const game = this.game;
    const playing = game.phase === 'playing';
    // Counted from the run's start at the latest, so nobody shows idle in a run's first two seconds.
    const roundStart = game.tick - game.roundTick;
    for (const p of Object.values(game.players)) {
      const riding = playing && p.racing && !p.finished && !p.isBot && !p.left;
      const idle = riding && game.tick - Math.max(this.lastInputTick.get(p.id) ?? 0, roundStart) > IDLE_TICKS;
      p.idle = idle;
      if (!riding || game.roundTick <= COUNTDOWN_TICKS) continue;
      let a = this.activity.get(p.id);
      if (!a) this.activity.set(p.id, (a = { riding: 0, driving: 0 }));
      a.riding++;
      if (!idle && (p.steer !== 0 || p.throttle !== 0)) a.driving++;
    }
  }

  /** Whether a human played this run for real (input held in LEADERBOARD_MIN_ACTIVE_PERCENT of their riding ticks). */
  playedForReal(playerId: string): boolean {
    const a = this.activity.get(playerId);
    return !!a && a.riding > 0 && a.driving * 100 >= a.riding * LEADERBOARD_MIN_ACTIVE_PERCENT;
  }

  /** Writes a counted run to the all-time leaderboard and announces new records. A database error is only logged. */
  private saveRun(): void {
    const board = currentLeaderboard();
    if (!board) return;
    const now = new Date();
    const result = runResult(this.game, now, (id) => this.playedForReal(id));
    if (!result) return;
    // One address saves at most LEADERBOARD_RUNS_PER_IP_PER_DAY runs a day (one person with several
    // tabs); times from an address past it are left out, the others still count.
    const ipOf = (playerId: string) => this.clientIps.get(playerId) ?? '';
    const times = result.times.filter((t) => !ipOf(t.playerId) || savedRunsToday.has(ipOf(t.playerId), now));
    if (times.length < result.times.length) {
      console.warn(`Clasament: ${result.times.length - times.length} timp(i) din ${this.roomId} lăsați afară (limita zilnică per adresă).`);
    }
    if (times.length === 0) return;
    try {
      const records = board.record({ ...result, times });
      for (const ip of new Set(times.map((t) => ipOf(t.playerId)).filter(Boolean))) savedRunsToday.use(ip, now);
      if (records.length > 0) this.broadcast(MSG_RECORDS, { records } satisfies MatchRecords);
    } catch (err) {
      console.error(`Clasament: manșa din ${this.roomId} nu s-a putut salva:`, err);
    }
  }
}
