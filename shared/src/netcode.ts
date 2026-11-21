import { INPUT_QUEUE_MAX } from './protocol';
import { runTick } from './runner';
import { cloneState } from './stateKeys';
import type { GameState, PlayerInput, SledInput } from './types';

// Both halves of the online input path, kept pure so tests can run them against a simulated
// network: the server's bounded per-player queue and the client's prediction/reconciliation.

/** Largest input sequence number (it travels as a uint32 in the schema). */
export const MAX_SEQ = 0xffffffff;
/** Unconfirmed inputs the client keeps for replay (3 s); older ones are dropped. */
export const MAX_PENDING_INPUTS = 90;

/** An untrusted 'input' message as a SledInput, or null when it is malformed. */
export function parseInput(msg: unknown): SledInput | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const { seq, steer, throttle, fire } = msg as Record<string, unknown>;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1 || seq > MAX_SEQ) return null;
  if (typeof steer !== 'number' || typeof throttle !== 'number') return null;
  // applyInput clamps and truncates the axes.
  return { seq, steer, throttle, fire: fire === true };
}

/**
 * Server side: every player's inputs wait here and one is applied per tick. A player who sends
 * faster than the server ticks (a burst after a lag spike) would build up latency, so beyond
 * INPUT_QUEUE_MAX the oldest input is dropped; a throw press in it moves to the next one.
 * A tick without an input leaves the sled on its held steer/throttle.
 */
export class InputQueue {
  private readonly queues = new Map<string, SledInput[]>();
  private readonly lastSeq = new Map<string, number>();

  push(playerId: string, input: SledInput): void {
    // Old or repeated inputs (seq not increasing) are ignored.
    if (input.seq <= (this.lastSeq.get(playerId) ?? 0)) return;
    this.lastSeq.set(playerId, input.seq);
    let queue = this.queues.get(playerId);
    if (!queue) {
      queue = [];
      this.queues.set(playerId, queue);
    }
    queue.push(input);
    while (queue.length > INPUT_QUEUE_MAX) {
      const dropped = queue.shift()!;
      if (dropped.fire) queue[0] = { ...queue[0]!, fire: true };
    }
  }

  /** This tick's inputs: the oldest waiting one of every player. */
  take(): PlayerInput[] {
    const out: PlayerInput[] = [];
    for (const [playerId, queue] of this.queues) {
      const input = queue.shift();
      if (input) out.push({ ...input, playerId });
    }
    return out;
  }

  /** Inputs waiting for a player (debugging and tests). */
  size(playerId: string): number {
    return this.queues.get(playerId)?.length ?? 0;
  }

  /** Between runs nothing waits: inputs only count while a run is being played. */
  clear(): void {
    this.queues.clear();
  }

  /** Forgets a player: gone for good, or back on a new connection (whose inputs number on from PlayerState.lastSeq). */
  remove(playerId: string): void {
    this.queues.delete(playerId);
    this.lastSeq.delete(playerId);
  }
}

/**
 * Client side: the player's own inputs are applied at once to a copy of the last server state
 * (the same runTick the server runs, so bots and other sleds move as they would there) and kept
 * until the server confirms them through PlayerState.lastSeq. Every server state rewinds the
 * prediction to it and replays the inputs it has not processed yet.
 */
export class Predictor {
  private predicted: GameState | null = null;
  private pending: SledInput[] = [];
  private seq = 0;
  private driving = false;

  constructor(readonly playerId: string) {}

  /** The predicted state (null before the first server state). */
  get state(): Readonly<GameState> | null {
    return this.predicted;
  }

  /** Inputs sent but not processed by the server yet. */
  get unconfirmed(): number {
    return this.pending.length;
  }

  /**
   * Whether inputs should be sent and predicted: only while the server is playing a run with
   * this player in it (the prediction alone may already have ended a run the server has not).
   */
  canDrive(): boolean {
    return this.driving;
  }

  /** A new authoritative state: rewind to it, forget what it already contains, replay the rest. */
  reconcile(server: Readonly<GameState>): void {
    this.predicted = cloneState(server);
    const me = server.players[this.playerId];
    this.driving = server.phase === 'playing' && !!me;
    // A new client for a known player (the tab was reloaded and resumed the seat) numbers on from
    // the last input the server applied: lower numbers would be ignored as old.
    if (me && this.seq < me.lastSeq) this.seq = me.lastSeq;
    if (!this.driving || !me) {
      this.pending = [];
      return;
    }
    this.pending = this.pending.filter((input) => input.seq > me.lastSeq);
    for (const input of this.pending) runTick(this.predicted, [{ ...input, playerId: this.playerId }]);
  }

  /**
   * Starts over from a server state, forgetting every unconfirmed input: for a page coming back from
   * the background, whose old inputs are long past (they were sent, dropped or overtaken). Numbering
   * goes on from the server's lastSeq, so new inputs are never taken for old ones.
   */
  resync(server: Readonly<GameState>): void {
    this.pending = [];
    this.reconcile(server);
  }

  /** One client tick: numbers the input, applies it to the prediction and returns it for sending. */
  advance(input: Omit<SledInput, 'seq'>): SledInput {
    const numbered: SledInput = { seq: ++this.seq, steer: input.steer, throttle: input.throttle, fire: input.fire };
    this.pending.push(numbered);
    if (this.pending.length > MAX_PENDING_INPUTS) this.pending.shift();
    if (this.predicted) runTick(this.predicted, [{ ...numbered, playerId: this.playerId }]);
    return numbered;
  }
}
