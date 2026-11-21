import {
  BALL_TICKS,
  TICK_MS,
  addBot,
  addPlayer,
  backToLobby,
  createGameState,
  generateRoomCode,
  removeBot,
  runTick,
  setBotLevel,
  setDefaultBotLevel,
  setRounds,
  setTrack,
  skipBotRound,
  startMatch,
  type GameEvent,
  type GameState,
  type PlayerInput,
} from '@saniuta/shared';
import type { RideInput } from '../input/InputSource';
import type { ConnectionStatus, GameTransport, RoomMessage } from './GameTransport';
import { TickBlend, type RenderView } from './view';

export interface LocalOptions {
  name: string;
  bots: number;
  /** Level of the bots added at the start (BOT_EASY..BOT_HARD); the room default otherwise. */
  botLevel?: number;
  rounds: number;
  trackId: number;
  seed: string;
  /** Start run 1 right away (test URL options) instead of waiting in the lobby. */
  autoStart: boolean;
}

const MAX_FRAME_MS = 250; // after a stall, catch up at most this much

/** Runs the shared simulation in the browser at a fixed 30 ticks/s, with bots filling the room. */
export class LocalTransport implements GameTransport {
  readonly playerId = 'local';
  readonly online = false;
  readonly pausable = true;
  private readonly state: GameState;
  private readonly listeners = new Set<(events: GameEvent[]) => void>();
  private steer = 0;
  private throttle = 0;
  private fireLatched = false;
  private seq = 0;
  private acc = 0;
  private paused = false;
  private botCounter = 0;
  private readonly blend = new TickBlend(BALL_TICKS);

  constructor(opts: LocalOptions) {
    this.state = createGameState({ code: generateRoomCode(Math.random), seed: opts.seed });
    addPlayer(this.state, this.playerId, opts.name);
    if (opts.botLevel !== undefined) setDefaultBotLevel(this.state, this.playerId, opts.botLevel);
    for (let i = 0; i < opts.bots; i++) this.addBot();
    setRounds(this.state, this.playerId, opts.rounds);
    setTrack(this.state, this.playerId, opts.trackId);
    if (opts.autoStart) startMatch(this.state, this.playerId);
  }

  getState(): Readonly<GameState> {
    return this.state;
  }

  setInput(input: RideInput): void {
    this.steer = input.steer;
    this.throttle = input.throttle;
    if (input.fire) this.fireLatched = true;
  }

  send(msg: RoomMessage): void {
    if (msg.type === 'rounds') setRounds(this.state, this.playerId, msg.rounds);
    else if (msg.type === 'track') setTrack(this.state, this.playerId, msg.trackId);
    else if (msg.type === 'addBot') this.addBot();
    else if (msg.type === 'removeBot') removeBot(this.state, this.playerId);
    else if (msg.type === 'botLevel') setDefaultBotLevel(this.state, this.playerId, msg.level);
    else if (msg.type === 'setBotLevel') setBotLevel(this.state, this.playerId, msg.botId, msg.level);
    else if (msg.type === 'start') startMatch(this.state, this.playerId);
    else if (msg.type === 'lobby') backToLobby(this.state, this.playerId);
    else if (msg.type === 'skipRound') this.skipRound();
  }

  onEvents(cb: (events: GameEvent[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  update(dtMs: number): void {
    if (this.paused) return;
    this.acc += Math.min(dtMs, MAX_FRAME_MS);
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.tick();
    }
  }

  view(): RenderView {
    this.blend.push(this.state);
    return this.blend.view(this.paused ? 1 : Math.min(1, this.acc / TICK_MS));
  }

  isPaused(): boolean {
    return this.paused;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.acc = 0;
  }

  connectionStatus(): ConnectionStatus {
    return 'connected';
  }

  dispose(): void {
    this.listeners.clear();
  }

  private skipRound(): void {
    this.acc = 0;
    this.emit(skipBotRound(this.state));
  }

  private addBot(): void {
    addBot(this.state, this.playerId, `bot${++this.botCounter}`);
  }

  /** One fixed step: this tick's input (throw consumed) for the player, bots decide inside runTick. */
  private tick(): void {
    const input: PlayerInput = {
      playerId: this.playerId,
      seq: ++this.seq,
      steer: this.steer,
      throttle: this.throttle,
      fire: this.fireLatched,
    };
    this.fireLatched = false;
    this.emit(runTick(this.state, [input]));
  }

  private emit(events: GameEvent[]): void {
    if (events.length > 0) for (const cb of this.listeners) cb(events);
  }
}
