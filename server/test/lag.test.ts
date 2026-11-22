import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  centerAt,
  COUNTDOWN_TICKS,
  currentTrack,
  FP,
  isqrt,
  MSG_EVENTS,
  Predictor,
  rebuildState,
  ROOM_NAME,
  TICK_MS,
  type GameState,
  type RemoteState,
  type TickEvents,
} from '@saniuta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/app';
import type { SaniutaRoom } from '../src/SaniutaRoom';

// End to end over a slow network: the real server, the Colyseus SDK and the client's Predictor,
// with 100-150 ms of round trip (and jitter) added in both directions, as ?lag=&jitter= does in
// the browser. The other sled rides just ahead and starts braking hard once the client is already
// predicting: the hit is mispredicted, then the prediction settles again within a round trip and a
// few ticks. (The exact, timer-free version of this is shared/test/netcode.test.ts.)

const TEST_PORT = 2571;

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  const server = createServer();
  await server.listen(TEST_PORT, '127.0.0.1');
  colyseus = new ColyseusTestServer(server.colyseus);
});
afterAll(async () => {
  await colyseus.shutdown();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One direction of a slow link: half the round trip plus up to `jitterMs`, order kept (a WebSocket). */
function slowLink(lagMs: number, jitterMs: number) {
  let last = 0;
  return (deliver: () => void) => {
    const at = Math.max(performance.now() + lagMs / 2 + Math.random() * jitterMs, last);
    last = at;
    setTimeout(deliver, at - performance.now());
  };
}

async function rideOverSlowNetwork(lagMs: number, jitterMs: number) {
  const me = await colyseus.sdk.create(ROOM_NAME, { name: 'Ana' });
  const room = colyseus.getRoomById<SaniutaRoom>(me.roomId);
  const foe: ClientRoom = await colyseus.sdk.joinById(me.roomId, { name: 'Ion' });
  me.send('start');
  await room.waitForNextMessage();
  const game: GameState = room['game'];
  expect(game.phase).toBe('playing');

  // Between two ticks: the countdown is over, both sleds side by side down the middle of the track.
  const track = currentTrack(game);
  const y = track.startY + 40 * FP;
  const c = centerAt(track, y);
  game.roundTick = COUNTDOWN_TICKS;
  Object.assign(game.players[me.sessionId]!, { x: c, y, vx: 0, vy: 5 * FP });
  Object.assign(game.players[foe.sessionId]!, { x: c + 4 * FP, y: y + 40 * FP, vx: 0, vy: 5 * FP });

  const down = slowLink(lagMs, jitterMs);
  const up = slowLink(lagMs, jitterMs);
  const predictor = new Predictor(me.sessionId);
  /**
   * Every server state the client reconciled with: how far it moved the predicted sled (what the
   * player would see jump), how far ahead of that server state the prediction then was, and the
   * sled's speed (sub-units per tick).
   */
  const reconciles: { tick: number; correction: number; lead: number; speed: number }[] = [];
  let bumpTick = -1;

  me.onStateChange(() => {
    const state = rebuildState(me.state as unknown as RemoteState);
    // The client only learns of it after the slow link.
    down(() => {
      const before = predictor.state?.players[me.sessionId];
      predictor.reconcile(state);
      const after = predictor.state?.players[me.sessionId];
      const server = state.players[me.sessionId]!;
      if (!before || !after || state.phase !== 'playing') return;
      reconciles.push({
        tick: state.tick,
        correction: isqrt((after.x - before.x) ** 2 + (after.y - before.y) ** 2),
        lead: after.y - server.y,
        speed: isqrt(after.vx ** 2 + after.vy ** 2),
      });
    });
  });
  me.onMessage(MSG_EVENTS, (msg: TickEvents) => {
    if (bumpTick < 0 && msg.events.some((e) => e.type === 'bump')) bumpTick = msg.tick;
  });

  // Our client: one riding input per client tick, nothing held (the sled just slides).
  const clientTicks = setInterval(() => {
    if (!predictor.canDrive()) return;
    const sent = predictor.advance({ steer: 0, throttle: 0, fire: false });
    up(() => me.send('input', sent));
  }, TICK_MS);
  // The other player brakes hard once our prediction is well under way (it cannot see it coming).
  let foeSeq = 0;
  const foeTicks = setInterval(() => {
    const braking = game.roundTick > COUNTDOWN_TICKS + 12;
    foe.send('input', { seq: ++foeSeq, steer: 0, throttle: braking ? -100 : 0, fire: false });
  }, TICK_MS);

  await sleep(2500);
  clearInterval(clientTicks);
  clearInterval(foeTicks);
  return { reconciles, bumpTick, phase: game.phase };
}

describe('online riding over a slow network (real server and SDK)', () => {
  it.each([
    [100, 30],
    [150, 30],
  ])('rides a round trip ahead of the server, mispredicts a hit it could not foresee, then settles (lag %i ms, jitter %i ms)', async (lagMs, jitterMs) => {
    const { reconciles, bumpTick, phase } = await rideOverSlowNetwork(lagMs, jitterMs);
    expect(phase).toBe('playing');
    expect(bumpTick).toBeGreaterThan(0);
    // The braking reached the client late: at least one correction of more than a pixel...
    expect(Math.max(...reconciles.map((r) => r.correction))).toBeGreaterThan(FP);
    const settleTicks = Math.ceil((lagMs + jitterMs) / TICK_MS) + 3;
    const settled = reconciles.filter((r) => r.tick >= bumpTick + settleTicks);
    expect(settled.length).toBeGreaterThan(15);
    // ...and from a round trip and a few ticks after the hit, every new server state either leaves the
    // prediction where it was or shifts it by a whole tick of riding. Such shifts come from real timers
    // (about 47 ms on Windows), which now and then deliver two of our inputs in one server tick or none:
    // the server then rides a tick on the held input. The client's smoothing draws them away; a real
    // misprediction would not come out a whole tick.
    const wrong = settled.filter((r) => r.correction > FP / 4 && Math.abs(r.correction - r.speed) > 0.05 * r.speed);
    expect(wrong).toEqual([]);
    expect(settled.filter((r) => r.correction <= FP / 4).length).toBeGreaterThan(settled.length / 2);
    // The prediction replays the inputs the server has not applied yet: the drawn sled rides ahead of
    // the newest server state by about a round trip, not on it.
    const leads = settled.map((r) => r.lead / r.speed).sort((x, y) => x - y);
    expect(leads[Math.floor(leads.length / 2)]!).toBeGreaterThanOrEqual(Math.floor(lagMs / TICK_MS) - 1);
  }, 20000);
});
