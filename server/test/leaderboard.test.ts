import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  COUNTDOWN_TICKS,
  LEADERBOARD_SIZE,
  MSG_RECORDS,
  ROOM_NAME,
  TRACK_BUNICII,
  TRACK_LUPULUI,
  TRACK_RANDOM,
  ticksToMs,
  type GameState,
  type LeaderboardResponse,
  type MatchRecords,
} from '@saniuta/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/app';
import { openLeaderboard, runResult, useLeaderboard, type Leaderboard, type RunResult } from '../src/leaderboard';
import type { SaniutaRoom } from '../src/SaniutaRoom';

const TEST_PORT = 2571;

let colyseus: ColyseusTestServer;
let board: Leaderboard;

beforeAll(async () => {
  const server = createServer();
  await server.listen(TEST_PORT, '127.0.0.1');
  colyseus = new ColyseusTestServer(server.colyseus);
});
afterAll(async () => {
  await colyseus.shutdown();
});
beforeEach(async () => {
  await colyseus.cleanup();
  board = openLeaderboard(':memory:')!;
  useLeaderboard(board);
});
afterEach(() => {
  useLeaderboard(null);
  try {
    board.close();
  } catch {
    // a test closed it already
  }
});

const run = (trackId: number, times: [string, number][], at = '2026-11-22T18:00:00Z'): RunResult => ({
  room: 'TEST01',
  trackId,
  endedAt: new Date(at),
  humans: 2,
  bots: 0,
  times: times.map(([name, ticks]) => ({ playerId: name, name, ticks })),
});

describe('the leaderboard (database)', () => {
  it('keeps each nickname best time per track, fastest first, ties to whoever set it first', () => {
    board.record(run(TRACK_LUPULUI, [['Ana', 2000], ['Ion', 2100]], '2026-11-20T10:00:00Z'));
    board.record(run(TRACK_LUPULUI, [['ana', 1900], ['Eva', 2100]], '2026-11-21T10:00:00Z'));
    board.record(run(TRACK_BUNICII, [['Ion', 1500], ['Ana', 1600]]));
    const top = board.top();
    expect(top[String(TRACK_LUPULUI)]!.map((e) => [e.place, e.name, e.ms, e.runs])).toEqual([
      [1, 'ana', ticksToMs(1900), 2],
      [2, 'Ion', ticksToMs(2100), 1],
      [3, 'Eva', ticksToMs(2100), 1],
    ]);
    expect(top[String(TRACK_BUNICII)]!.map((e) => e.name)).toEqual(['Ion', 'Ana']);
    expect(top['2']).toEqual([]);
    expect(top[String(TRACK_RANDOM)]).toBeUndefined();
    expect(top[String(TRACK_LUPULUI)]![0]!.setAt).toBe('2026-11-21T10:00:00.000Z');
  });

  it(`shows ${LEADERBOARD_SIZE} rows per track and files "Ştefan" and "ștefan" as one player`, () => {
    board.record(run(TRACK_BUNICII, Array.from({ length: 20 }, (_, i) => [`P${i}`, 3000 + i] as [string, number])));
    board.record(run(TRACK_BUNICII, [['Ştefan', 1000]]));
    board.record(run(TRACK_BUNICII, [['ștefan', 1100]]));
    const rows = board.top()[String(TRACK_BUNICII)]!;
    expect(rows).toHaveLength(LEADERBOARD_SIZE);
    expect(rows[0]).toMatchObject({ name: 'Ștefan', runs: 2 });
    expect(rows.filter((r) => r.name.toLowerCase() === 'ștefan')).toHaveLength(1);
  });

  it('announces entering the top and beating an own record, nothing for a slower time', () => {
    expect(board.record(run(TRACK_LUPULUI, [['Ana', 2000], ['Ion', 2200]]))).toEqual([
      { playerId: 'Ana', name: 'Ana', trackId: TRACK_LUPULUI, place: 1, kind: 'top' },
      { playerId: 'Ion', name: 'Ion', trackId: TRACK_LUPULUI, place: 2, kind: 'top' },
    ]);
    expect(board.record(run(TRACK_LUPULUI, [['Ana', 2100], ['Ion', 1900]]))).toEqual([
      { playerId: 'Ion', name: 'Ion', trackId: TRACK_LUPULUI, place: 1, kind: 'record' },
    ]);
  });
});

describe('which runs count', () => {
  function state(trackId: number): GameState {
    const p = (id: string, extra: object) => ({ id, name: id, isBot: false, racing: true, left: false, finished: true, finishTicks: 2000, ...extra });
    return {
      code: 'TEST01',
      trackId,
      powerUps: false,
      players: {
        a: p('a', {}),
        b: p('b', { finishTicks: 2100 }),
        c: p('c', { finished: false, finishTicks: 0 }),
        bot: p('bot', { isBot: true, finishTicks: 1500 }),
      },
    } as unknown as GameState;
  }
  const all = () => true;

  it('saves only humans who played for real, finished and stayed; never bots', () => {
    const result = runResult(state(TRACK_LUPULUI), new Date(), all)!;
    expect(result.times.map((t) => t.playerId)).toEqual(['a', 'b']);
    expect(result).toMatchObject({ humans: 3, bots: 1, trackId: TRACK_LUPULUI });
    const s = state(TRACK_LUPULUI);
    s.players.b!.left = true;
    s.players.b!.racing = false;
    expect(runResult(s, new Date(), all)!.times.map((t) => t.playerId)).toEqual(['a']);
  });

  it(`needs two humans who played for real, and never a random track or power-ups`, () => {
    expect(runResult(state(TRACK_RANDOM), new Date(), all)).toBeNull();
    expect(runResult({ ...state(TRACK_LUPULUI), powerUps: true }, new Date(), all)).toBeNull();
    // Only "a" really rode: one human is not enough, however many bots.
    expect(runResult(state(TRACK_LUPULUI), new Date(), (id) => id === 'a')).toBeNull();
    // Two who rode, but the one who finished did not: nothing to save.
    expect(runResult(state(TRACK_LUPULUI), new Date(), (id) => id === 'c' || id === 'b')!.times.map((t) => t.playerId)).toEqual(['b']);
  });
});

describe('the room saves counted runs', () => {
  async function setUp(powerUps = false): Promise<{ host: ClientRoom; guest: ClientRoom; room: SaniutaRoom; game: GameState }> {
    const host = await colyseus.sdk.create(ROOM_NAME, { name: 'Ana' });
    const room = colyseus.getRoomById<SaniutaRoom>(host.roomId);
    const guest = await colyseus.sdk.joinById(host.roomId, { name: 'Ion' });
    const game: GameState = room['game'];
    // Waits for each lobby action to have happened, not for a number of messages or steps (a loaded
    // machine may process them a step later).
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 100 && !check(); i++) await room.waitForNextTimestep();
      expect(check()).toBe(true);
    };
    host.send('track', { trackId: TRACK_LUPULUI });
    await until(() => game.trackId === TRACK_LUPULUI);
    host.send('powerUps', { on: powerUps });
    await until(() => game.powerUps === powerUps);
    host.send('addBot');
    await until(() => Object.keys(game.players).length === 3);
    host.send('start');
    await until(() => game.phase === 'playing');
    game.roundTick = COUNTDOWN_TICKS + 10;
    return { host, guest, room, game };
  }

  /** Both humans cross the line (the bot too): the run ends on the next tick. */
  async function finishRun(room: SaniutaRoom, game: GameState, rode: (id: string) => boolean): Promise<void> {
    let place = 1;
    for (const p of Object.values(game.players)) {
      if (!p.isBot) room['activity'].set(p.id, rode(p.id) ? { riding: 100, driving: 80 } : { riding: 100, driving: 5 });
      Object.assign(p, { finished: true, finishTicks: 1800 + place * 10, place: place++ });
    }
    for (let i = 0; i < 100 && game.phase === 'playing'; i++) await room.waitForNextTimestep();
    await room.waitForNextTimestep();
  }

  it('two humans who rode for real: their times are saved and the new records announced', async () => {
    const { host, room, game } = await setUp();
    const records = host.waitForMessage(MSG_RECORDS) as Promise<MatchRecords>;
    await finishRun(room, game, () => true);
    const msg = await records;
    expect(msg.records.map((r) => [r.name, r.kind, r.trackId])).toEqual([
      ['Ana', 'top', TRACK_LUPULUI],
      ['Ion', 'top', TRACK_LUPULUI],
    ]);
    const res = await colyseus.http.get('/leaderboard');
    const body = res.data as LeaderboardResponse;
    expect(body.available).toBe(true);
    expect(body.tracks[String(TRACK_LUPULUI)]!.map((e) => e.name)).toEqual(['Ana', 'Ion']);
  });

  it('a human who let the sled slide on its own does not count, and alone the other is not enough', async () => {
    const { room, game } = await setUp();
    await finishRun(room, game, (id) => game.players[id]!.name === 'Ana');
    expect(board.top()[String(TRACK_LUPULUI)]).toEqual([]);
  });

  it('a run with power-ups on is never saved', async () => {
    const { room, game } = await setUp(true);
    await finishRun(room, game, () => true);
    expect(game.phase).toBe('results');
    expect(board.top()[String(TRACK_LUPULUI)]).toEqual([]);
  });

  it('answers without a leaderboard when the server has none, and a broken database does not stop the match', async () => {
    useLeaderboard(null);
    expect(((await colyseus.http.get('/leaderboard')).data as LeaderboardResponse).available).toBe(false);
    useLeaderboard(board);
    const { room, game } = await setUp();
    board.close();
    await finishRun(room, game, () => true);
    expect(game.phase).toBe('results');
  });
});
