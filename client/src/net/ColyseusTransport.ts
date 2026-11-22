import { CloseCode, type Room } from '@colyseus/sdk';
import {
  angleDiff,
  BALL_TICKS,
  CLOSE_LOBBY_IDLE,
  FP,
  MSG_EVENTS,
  MSG_PONG,
  MSG_RECORDS,
  Predictor,
  rebuildState,
  SLED_RADIUS,
  TICK_MS,
  type ClientMessage,
  type GameEvent,
  type GameState,
  type MatchRecords,
  type NewRecord,
  type Pong,
  type RemoteState,
  type TickEvents,
} from '@saniuta/shared';
import type { RideInput } from '../input/InputSource';
import type { ConnectionStatus, GameTransport, NetStats, RoomMessage } from './GameTransport';
import { LagLine, type NetSimOptions } from './LagLine';
import { retryReconnectionNow } from './sdkReconnect';
import { ballsOf, blendBalls, isRoundReset, lerpPose, poseOf, type BallSnap, type Pose, type RenderView } from './view';

// Plays an authoritative Colyseus room. The server sends one state patch per tick (decoded by the
// SDK through reflection and rebuilt into a plain GameState) and the events of each tick.
//
// - Own sled: predicted. Every client tick the input is applied at once to a copy of the last server
//   state with the same runTick (shared Predictor), and sent; every server state rewinds the
//   prediction to it and replays the inputs the server has not processed yet (PlayerState.lastSeq).
//   The jump a correction would cause is drawn away gradually. The own snowballs fly from the
//   prediction too, so a throw leaves the sled at once.
// - Everything else (other sleds, their snowballs, piles, scores, phases): drawn INTERP_TICKS in
//   the past, between the two server states around that moment, so it moves smoothly whatever the
//   network jitter.
// - Events play when the drawn state reaches their tick; those about the own sled as soon as they arrive.

type Incoming =
  | { kind: 'state'; state: GameState }
  | { kind: 'events'; msg: TickEvents }
  | { kind: 'pong'; t: number }
  | { kind: 'records'; records: NewRecord[] };

/** Other sleds are drawn this many ticks (100 ms) behind the newest server state. */
const INTERP_TICKS = 3;
/** Further than this from where it should be (a stall, a background tab), the view clock jumps. */
const MAX_DRIFT_TICKS = 8;
/** Otherwise it eases toward its target over about this long. */
const CLOCK_EASE_MS = 500;
/** Server states kept for interpolation (2 s). */
const TIMELINE_LENGTH = 60;
/** A correction of the own sled fades out with this time constant. */
const SMOOTH_MS = 100;
/** Corrections larger than this are not smoothed but applied at once. */
const SNAP_DISTANCE = 4 * SLED_RADIUS;
/** Counted as a big correction in ?debug. */
const BIG_CORRECTION = 6 * FP;
const PING_INTERVAL_MS = 1000;
const MAX_FRAME_MS = 250;
/** Events normally wait for their tick's state; a state that never comes must not hold them forever. */
const MAX_EVENT_WAIT_MS = 500;
/** No message at all for this long while the page is shown (pings go out every second): the connection is dead. */
const SILENT_DEAD_MS = 4000;
/** Effects of events this old are past (the tab was in the background): they are dropped, not replayed at once. */
const STALE_EVENT_MS = 2000;
const LOST_MESSAGE = 'Conexiunea cu serverul s-a pierdut.';
const IDLE_LOBBY_MESSAGE = 'Jocul a fost închis: a stat prea mult în lobby fără să pornească meciul.';
/** Retries back off 0.2 s, 0.4 s ... up to 5 s: about 20 s in all, past the server's 15 s window. */
const RECONNECT_RETRIES = 8;

const ZERO_POSE: Pose = { x: 0, y: 0, heading: 0 };

export class ColyseusTransport implements GameTransport {
  readonly playerId: string;
  readonly online = true;
  readonly pausable = false;
  closeReason = '';
  private status: ConnectionStatus = 'connected';
  private disposed = false;
  private readonly listeners = new Set<(events: GameEvent[]) => void>();
  private readonly predictor: Predictor;
  private readonly inbox: LagLine<Incoming>;
  private readonly outbox: LagLine<ClientMessage>;

  /** Newest server state, the one the prediction starts from. */
  private latest: GameState;
  /** Recent server states, oldest first, one per tick (lobby changes replace the last one). */
  private readonly timeline: GameState[] = [];
  /** The server tick being drawn (fractional), INTERP_TICKS behind the newest state. */
  private viewTick = -1;
  /** What the scene reads: the state at viewTick, with the own sled's riding from the prediction. */
  private shown: GameState;
  private currentView: RenderView = { poses: new Map(), balls: [] };

  private acc = 0;
  private steer = 0;
  private throttle = 0;
  private fireLatched = false;
  private useLatched = false;
  /** Predicted own sled at the last two client ticks, drawn in between... */
  private ownPrev: Pose | null = null;
  private ownCur: Pose | null = null;
  /** ...plus what is left of the last corrections. */
  private offset: Pose = ZERO_POSE;
  /** Predicted snowballs at the last two client ticks (only the own ones are drawn from these). */
  private ballsPrev: BallSnap[] = [];
  private ballsCur: BallSnap[] = [];
  private bigCorrections: number[] = [];
  private records: NewRecord[] = [];
  private pingMs = 0;
  private nextPingAt = 0;
  private readonly queued: { tick: number; at: number; events: GameEvent[]; ownDone: boolean }[] = [];
  /** When the last message (state, events, pong) arrived: a pong is due every second while the page is shown. */
  private lastHeardAt = performance.now();
  private readonly onVisibility = () => {
    if (document.hidden) this.releaseNow();
    else this.backFromBackground();
  };

  constructor(
    private readonly room: Room,
    private readonly net: NetSimOptions,
    /** Keeps the reconnection token for a reload of the tab (null: forget it). */
    private readonly onToken: (token: string | null) => void = () => undefined,
  ) {
    this.playerId = room.sessionId;
    this.predictor = new Predictor(this.playerId);
    this.inbox = new LagLine(net);
    this.outbox = new LagLine(net);
    const first = rebuildState(room.state as unknown as RemoteState);
    this.latest = first;
    this.shown = first;
    this.onServerState(first, performance.now());
    // The SDK skips auto-reconnection for rooms joined less than 5 s ago; a drop right after Start must still recover.
    room.reconnection.minUptime = 0;
    room.reconnection.maxRetries = RECONNECT_RETRIES;
    onToken(room.reconnectionToken);

    // Patches are rebuilt at once: with simulated lag the SDK's live state would be ahead of the delay.
    room.onStateChange(() => this.receive({ kind: 'state', state: rebuildState(room.state as unknown as RemoteState) }));
    room.onMessage(MSG_EVENTS, (msg: TickEvents) => this.receive({ kind: 'events', msg }));
    room.onMessage(MSG_PONG, (msg: Pong) => this.receive({ kind: 'pong', t: msg.t }));
    room.onMessage(MSG_RECORDS, (msg: MatchRecords) => this.receive({ kind: 'records', records: Array.isArray(msg?.records) ? msg.records : [] }));
    room.onDrop(() => {
      this.status = 'reconnecting';
    });
    room.onReconnect(() => {
      // Left while the connection was down: the leave could not reach the server then, so send it now.
      if (this.disposed) {
        void room.leave().catch(() => undefined);
        return;
      }
      this.status = 'connected';
      onToken(room.reconnectionToken);
    });
    // The token is kept here on purpose: a tab reload also closes the socket and must be able to resume.
    room.onLeave((code) => {
      if (this.disposed) return;
      this.status = 'closed';
      this.closeReason = code === CLOSE_LOBBY_IDLE ? IDLE_LOBBY_MESSAGE : LOST_MESSAGE;
      // A room the server closed on purpose cannot be resumed by a reload.
      if (code === CLOSE_LOBBY_IDLE) onToken(null);
    });
    // Failed attempts while reconnecting also land here; the banner already tells that story.
    room.onError((code, message) => {
      if (this.status === 'connected') console.warn(`Colyseus error ${code}: ${message ?? ''}`);
    });
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  getState(): Readonly<GameState> {
    return this.shown;
  }

  setInput(input: RideInput): void {
    this.steer = input.steer;
    this.throttle = input.throttle;
    if (input.fire) this.fireLatched = true;
    if (input.use) this.useLatched = true;
  }

  send(msg: RoomMessage): void {
    this.post(msg);
  }

  onEvents(cb: (events: GameEvent[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  update(dtMs: number): void {
    const now = performance.now();
    for (const item of this.inbox.take(now)) this.handle(item, now);
    for (const msg of this.outbox.take(now)) this.transmit(msg);
    if (now >= this.nextPingAt && this.status === 'connected') {
      this.nextPingAt = now + PING_INTERVAL_MS;
      this.post({ type: 'ping', t: now });
    }
    // A socket can look open long after the connection died (a phone that slept, a changed network):
    // with no answer to several pings, hand it to the SDK's reconnection (the seat waits 15 s).
    if (this.status === 'connected' && !document.hidden && now - this.lastHeardAt > SILENT_DEAD_MS) {
      this.lastHeardAt = now;
      this.room.connection.close(CloseCode.MAY_TRY_RECONNECT, 'no answer');
    }

    this.acc += Math.min(dtMs, MAX_FRAME_MS);
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.clientTick();
    }

    this.advanceViewClock(dtMs);
    this.buildView();
    const fade = Math.exp(-dtMs / SMOOTH_MS);
    this.offset = { x: this.offset.x * fade, y: this.offset.y * fade, heading: this.offset.heading * fade };
    this.bigCorrections = this.bigCorrections.filter((t) => now - t < 1000);
    this.flushEvents(now);
  }

  view(): RenderView {
    return this.currentView;
  }

  newRecords(): readonly NewRecord[] {
    return this.records;
  }

  netStats(): NetStats {
    return {
      pingMs: Math.round(this.pingMs),
      predictionErrorPx: Math.hypot(this.offset.x, this.offset.y) / FP,
      unconfirmed: this.predictor.unconfirmed,
      bigCorrectionsPerSecond: this.bigCorrections.length,
      lagMs: this.net.lagMs,
      jitterMs: this.net.jitterMs,
    };
  }

  isPaused(): boolean {
    return false;
  }

  setPaused(): void {
    // the server owns the clock
  }

  connectionStatus(): ConnectionStatus {
    return this.status;
  }

  /** Leaving for good: a consented leave (no 15 s seat). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.onToken(null);
    void this.room.leave().catch(() => undefined);
  }

  /** Through the simulated network when ?lag/?jitter is on. */
  private receive(item: Incoming): void {
    const now = performance.now();
    this.lastHeardAt = now;
    if (this.inbox.active) this.inbox.push(item, now);
    else this.handle(item, now);
  }

  private post(msg: ClientMessage): void {
    if (this.outbox.active) this.outbox.push(msg, performance.now());
    else this.transmit(msg);
  }

  private transmit(msg: ClientMessage): void {
    // Inputs from while the connection is down would replay late; lobby actions can wait in the SDK queue.
    if (this.status === 'closed' || ((msg.type === 'input' || msg.type === 'ping') && this.status !== 'connected')) return;
    const { type, ...payload } = msg;
    this.room.send(type, payload);
  }

  private handle(item: Incoming, now: number): void {
    if (item.kind === 'state') this.onServerState(item.state, now);
    else if (item.kind === 'events') this.queued.push({ tick: item.msg.tick, at: now, events: item.msg.events, ownDone: false });
    else if (item.kind === 'records') this.records = item.records;
    else if (Number.isFinite(item.t)) {
      const sample = now - item.t;
      this.pingMs = this.pingMs > 0 ? this.pingMs * 0.7 + sample * 0.3 : sample;
    }
  }

  private onServerState(state: GameState, now: number): void {
    const last = this.timeline.at(-1);
    if (last && state.tick <= last.tick) this.timeline[this.timeline.length - 1] = state;
    else this.timeline.push(state);
    if (this.timeline.length > TIMELINE_LENGTH) this.timeline.shift();
    this.latest = state;
    // Records belong to the run just finished; the next run (or the lobby) starts without them.
    if (state.phase === 'playing' || state.phase === 'lobby') this.records = [];

    const beforeState = this.predictor.state;
    const before = this.ownPose();
    this.predictor.reconcile(state);
    const after = this.ownPose();
    // The own snowballs as the replayed prediction has them now (a small jump at most; they are quick).
    this.ballsCur = this.predictedBalls();
    const reset =
      !beforeState || !before || !after || !this.predictor.canDrive() || beforeState.round !== state.round || beforeState.phase !== 'playing';
    if (reset) {
      this.ownPrev = after;
      this.ownCur = after;
      this.ballsPrev = this.ballsCur;
      this.offset = ZERO_POSE;
      return;
    }
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const dh = angleDiff(before.heading, after.heading);
    if (dx === 0 && dy === 0 && dh === 0) return;
    const distance = Math.hypot(dx, dy);
    if (distance > SNAP_DISTANCE) {
      this.ownPrev = after;
      this.ownCur = after;
      this.offset = ZERO_POSE;
      return;
    }
    if (distance > BIG_CORRECTION) this.bigCorrections.push(now);
    // The drawn sled stays where it was; the offset then fades out.
    this.offset = { x: this.offset.x - dx, y: this.offset.y - dy, heading: this.offset.heading - dh };
    // After a stall many states arrive in one frame and their corrections add up: past the snap
    // distance in all, the sled is moved at once instead of gliding after itself for a while.
    if (Math.hypot(this.offset.x, this.offset.y) > SNAP_DISTANCE) {
      this.ownPrev = after;
      this.ownCur = after;
      this.offset = ZERO_POSE;
      return;
    }
    if (this.ownPrev) this.ownPrev = { x: this.ownPrev.x + dx, y: this.ownPrev.y + dy, heading: this.ownPrev.heading + dh };
    this.ownCur = after;
  }

  /** One client tick (30/s): the held input is numbered, predicted and sent. */
  private clientTick(): void {
    if (this.status !== 'connected' || !this.predictor.canDrive()) {
      this.fireLatched = false;
      this.useLatched = false;
      return;
    }
    const input = this.predictor.advance({ steer: this.steer, throttle: this.throttle, fire: this.fireLatched, use: this.useLatched });
    this.fireLatched = false;
    this.useLatched = false;
    this.post({ type: 'input', ...input });
    this.ownPrev = this.ownCur;
    this.ownCur = this.ownPose();
    this.ballsPrev = this.ballsCur;
    this.ballsCur = this.predictedBalls();
  }

  /** The page went to the background (no more frames, so no more inputs): let go of the sled now. */
  private releaseNow(): void {
    this.steer = 0;
    this.throttle = 0;
    this.fireLatched = false;
    this.useLatched = false;
    if (this.status !== 'connected' || !this.predictor.canDrive()) return;
    const input = this.predictor.advance({ steer: 0, throttle: 0, fire: false, use: false });
    for (const msg of this.outbox.take(Infinity)) this.transmit(msg);
    this.transmit({ type: 'input', ...input });
  }

  /**
   * The page is shown again after any time in the background (no frames ran meanwhile, but states
   * kept arriving): start over from the newest server state instead of catching up. The prediction
   * forgets its unconfirmed inputs and numbers on from the server's lastSeq, the tick accumulator is
   * empty (no burst of catch-up ticks), the view clock jumps to the newest state, and events that went
   * stale meanwhile are dropped by flushEvents. A dropped connection is retried at once.
   */
  private backFromBackground(): void {
    const now = performance.now();
    this.acc = 0;
    this.viewTick = -1;
    this.predictor.resync(this.latest);
    this.ownPrev = this.ownCur = this.ownPose();
    this.ballsPrev = this.ballsCur = this.predictedBalls();
    this.offset = ZERO_POSE;
    // getState() shows the newest state at once (scenes check the phase on visibilitychange too).
    this.advanceViewClock(0);
    this.buildView();
    // Ping now; the dead-connection check counts from here (no pongs came while hidden in the lobby).
    this.lastHeardAt = now;
    this.nextPingAt = 0;
    // The SDK's own retries back off up to 5 s and ran on while the page was hidden (with throttled
    // timers): without this, a player coming back could wait seconds with a frozen game.
    if (this.status === 'reconnecting') retryReconnectionNow(this.room);
  }

  private ownPose(): Pose | null {
    const me = this.predictor.state?.players[this.playerId];
    return me ? poseOf(me) : null;
  }

  /** The predicted snowball slots, with the ones not thrown by this player emptied. */
  private predictedBalls(): BallSnap[] {
    const predicted = this.predictor.state;
    const me = predicted?.players[this.playerId];
    if (!predicted || !me) return [];
    return ballsOf(predicted).map((b, i) => (predicted.ballOwner[i] === me.slot ? b : { ...b, ticks: 0 }));
  }

  private advanceViewClock(dtMs: number): void {
    const newest = this.timeline.at(-1);
    if (!newest) return;
    const target = newest.tick - INTERP_TICKS;
    if (this.viewTick < 0 || Math.abs(target - this.viewTick) > MAX_DRIFT_TICKS) this.viewTick = target;
    else {
      this.viewTick += dtMs / TICK_MS;
      this.viewTick += (target - this.viewTick) * Math.min(1, dtMs / CLOCK_EASE_MS);
    }
    // Never ahead of what has arrived (in the lobby the tick stands still).
    this.viewTick = Math.min(this.viewTick, newest.tick);
  }

  /** The state, poses and snowballs at viewTick; the own sled and its snowballs from the prediction while a run is on. */
  private buildView(): void {
    let i = 0;
    while (i + 1 < this.timeline.length && this.timeline[i + 1]!.tick <= this.viewTick) i++;
    const a = this.timeline[i]!;
    const b = this.timeline[i + 1] ?? a;
    const t = b.tick > a.tick ? Math.min(1, Math.max(0, (this.viewTick - a.tick) / (b.tick - a.tick))) : 0;
    const blend = !isRoundReset(a, b);

    const poses = new Map<string, Pose>();
    for (const p of Object.values(a.players)) {
      const q = b.players[p.id];
      poses.set(p.id, q && blend ? lerpPose(poseOf(p), poseOf(q), t) : poseOf(p));
    }
    let balls = blendBalls(ballsOf(a), ballsOf(b), blend ? t : 0, BALL_TICKS);

    let shown = a;
    const predicted = this.predictor.state?.players[this.playerId];
    const me = a.players[this.playerId];
    if (me && predicted && this.ownCur && this.predictor.canDrive() && a.phase === 'playing' && a.round === this.latest.round) {
      // Riding from the prediction; the run's outcome (finish, place, points) only from the server.
      shown = {
        ...a,
        players: {
          ...a.players,
          [this.playerId]: {
            ...me,
            x: predicted.x,
            y: predicted.y,
            vx: predicted.vx,
            vy: predicted.vy,
            heading: predicted.heading,
            steer: predicted.steer,
            throttle: predicted.throttle,
            airTicks: predicted.airTicks,
            airTotal: predicted.airTotal,
            crashTicks: predicted.crashTicks,
            graceTicks: predicted.graceTicks,
            splatTicks: predicted.splatTicks,
            snowballs: predicted.snowballs,
            throwCooldown: predicted.throwCooldown,
            powerUp: predicted.powerUp,
            waxTicks: predicted.waxTicks,
            tea: predicted.tea,
            scarfTicks: predicted.scarfTicks,
          },
        },
      };
      const drawn = lerpPose(this.ownPrev ?? this.ownCur, this.ownCur, this.acc / TICK_MS);
      poses.set(this.playerId, { x: drawn.x + this.offset.x, y: drawn.y + this.offset.y, heading: drawn.heading + this.offset.heading });
      // Others' snowballs from the server, the own ones from the prediction.
      const ownSlot = me.slot;
      balls = [
        ...balls.filter((ball) => a.ballOwner[ball.slot] !== ownSlot),
        ...blendBalls(this.ballsPrev, this.ballsCur, this.acc / TICK_MS, BALL_TICKS),
      ];
    }
    this.shown = shown;
    this.currentView = { poses, balls };
  }

  /**
   * The events message and the state patch of a tick may arrive in either order. Events about the
   * own sled play as soon as the newest state has their tick (the sled is drawn ahead, predicted);
   * the rest once the drawn state has reached it, so effects line up with what is on screen.
   */
  private flushEvents(now: number): void {
    const me = this.playerId;
    const own = (e: GameEvent) => {
      if (e.type === 'bump') return e.a === me || e.b === me;
      if (e.type === 'splat') return e.playerId === me || e.byId === me;
      return 'playerId' in e && e.playerId === me;
    };
    const ready: GameEvent[] = [];
    for (const q of this.queued) {
      if (q.ownDone || q.tick > this.latest.tick) continue;
      q.ownDone = true;
      if (now - q.at < STALE_EVENT_MS) ready.push(...q.events.filter(own));
    }
    while (this.queued.length > 0) {
      const next = this.queued[0]!;
      if (next.tick > this.shown.tick && now - next.at < MAX_EVENT_WAIT_MS) break;
      this.queued.shift();
      if (now - next.at >= STALE_EVENT_MS) continue;
      ready.push(...(next.ownDone ? next.events.filter((e) => !own(e)) : next.events));
    }
    if (ready.length > 0) for (const cb of this.listeners) cb(ready);
  }
}
