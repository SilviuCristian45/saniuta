import { describe, expect, it } from 'vitest';
import {
  BALL_GIANT,
  BALL_SMALL,
  BALL_TICKS,
  BOT_EASY,
  BOT_HARD,
  BOT_MEDIUM,
  BOT_PARAMS,
  DOWNHILL,
  FIXED_TRACK_IDS,
  FOG_TICKS,
  GIFT_RESPAWN_TICKS,
  MAX_SPEED,
  OBSTACLE_GIANT,
  OBSTACLE_TREE,
  POWER_FOG,
  POWER_GIANT,
  POWER_KINDS,
  POWER_NONE,
  POWER_ODDS_FIRST,
  POWER_ODDS_LAST,
  POWER_SCARF,
  POWER_TEA,
  POWER_WAX,
  SCARF_TICKS,
  TREE_RADIUS,
  TRACK_RANDOM,
  WAX_TICKS,
  botThink,
  clearBalls,
  createGameState,
  drawPowerUp,
  getTrack,
  fixedTrackSeed,
  hitObstacles,
  pickUpGift,
  placePerMille,
  powerOdds,
  resetGifts,
  rideSled,
  runTick,
  setPowerUps,
  speedOf,
  speedCap,
  startMatch,
  addPlayer,
  tickGifts,
  updateBalls,
  usePowerUp,
  type GameEvent,
  type GameState,
  type PlayerState,
} from '../src';
import { flatTrack, makeRace, px, run, sled } from './helpers';

function world(gifts: { x: number; y: number }[] = []) {
  const track = flatTrack({ gifts });
  const state = createGameState({ code: 'PU', seed: 1 });
  clearBalls(state);
  resetGifts(state, track);
  return { track, state };
}

describe('gift boxes on the tracks', () => {
  it('every track has lines of gift boxes, clear of obstacles, ramps and piles, and generating them changed nothing else', () => {
    for (const trackId of [...FIXED_TRACK_IDS, TRACK_RANDOM]) {
      const track = getTrack(trackId, trackId === TRACK_RANDOM ? 12345 : fixedTrackSeed(trackId));
      expect(track.gifts.length, track.name).toBeGreaterThanOrEqual(20);
      for (const g of track.gifts) {
        expect(g.y).toBeGreaterThan(track.startY);
        expect(g.y).toBeLessThan(track.finishY);
        for (const o of track.obstacles) expect(Math.hypot(o.x - g.x, o.y - g.y)).toBeGreaterThan(o.r + px(20));
      }
    }
    // Obstacles, ramps and piles of the fixed tracks as they were before gift boxes existed.
    const layout = FIXED_TRACK_IDS.map((id) => getTrack(id, fixedTrackSeed(id))).map((t) => [t.obstacles.length, t.ramps.length, t.piles.length]);
    expect(layout).toEqual([
      [70, 4, 38],
      [89, 6, 31],
      [102, 8, 30],
    ]);
  });
});

describe('picking up a power-up', () => {
  it('a sled with empty hands takes a gift box, one at a most, and the box comes back later', () => {
    const { track, state } = world([{ x: 0, y: px(1000) }, { x: 0, y: px(1010) }]);
    const p = sled({ y: px(1005) });
    const events: GameEvent[] = [];
    pickUpGift(state, track, [p], p, events);
    expect(p.powerUp).not.toBe(POWER_NONE);
    expect(events).toEqual([{ type: 'gift', playerId: 's', gift: 0, power: p.powerUp }]);
    expect(state.giftTimers).toEqual([GIFT_RESPAWN_TICKS, 0]);
    // Holding one: the next box stays there.
    pickUpGift(state, track, [p], p, events);
    expect(state.giftTimers[1]).toBe(0);
    for (let i = 0; i < GIFT_RESPAWN_TICKS; i++) tickGifts(state);
    expect(state.giftTimers).toEqual([0, 0]);
  });

  it('nothing is taken with power-ups off, in the air or overturned', () => {
    const { track, state } = world([{ x: 0, y: px(1000) }]);
    const events: GameEvent[] = [];
    for (const over of [{ airTicks: 5 }, { crashTicks: 5 }]) {
      const p = sled({ y: px(1000), ...over });
      pickUpGift(state, track, [p], p, events);
      expect(p.powerUp).toBe(POWER_NONE);
    }
    state.powerUps = false;
    const p = sled({ y: px(1000) });
    pickUpGift(state, track, [p], p, events);
    expect(p.powerUp).toBe(POWER_NONE);
    expect(events).toEqual([]);
  });

  it('catch-up: the further back, the better the odds', () => {
    expect(POWER_ODDS_FIRST.reduce((a, b) => a + b)).toBe(100);
    expect(POWER_ODDS_LAST.reduce((a, b) => a + b)).toBe(100);
    const at = (place: number, kind: number) => powerOdds(place)[POWER_KINDS.indexOf(kind)]!;
    // Strong ones go up toward the back, weak ones down.
    for (const kind of [POWER_WAX, POWER_GIANT]) expect(at(1000, kind)).toBeGreaterThan(at(500, kind) + 5);
    for (const kind of [POWER_FOG, POWER_SCARF]) expect(at(1000, kind)).toBeLessThan(at(500, kind) - 5);
    expect(at(0, POWER_FOG)).toBeGreaterThan(at(0, POWER_GIANT) * 5);

    const count = (place: number) => {
      const state = createGameState({ code: 'X', seed: 'odds' });
      const n: Record<number, number> = {};
      for (let i = 0; i < 4000; i++) {
        const k = drawPowerUp(state, place);
        n[k] = (n[k] ?? 0) + 1;
      }
      return n;
    };
    const first = count(0);
    const last = count(1000);
    expect(first[POWER_GIANT]!).toBeLessThan(300);
    expect(last[POWER_GIANT]!).toBeGreaterThan(1200);
    expect(first[POWER_FOG]!).toBeGreaterThan(1200);
    expect(last[POWER_FOG]!).toBeLessThan(300);
  });

  it('the place counts finished sleds as ahead; alone in the middle', () => {
    const a = sled({ id: 'a', slot: 0, y: px(1000) });
    const b = sled({ id: 'b', slot: 1, y: px(900) });
    const c = sled({ id: 'c', slot: 2, y: px(500), finished: true });
    expect(placePerMille([a, b, c], a)).toBe(500);
    expect(placePerMille([a, b, c], b)).toBe(1000);
    expect(placePerMille([a, b], a)).toBe(0);
    expect(placePerMille([a], a)).toBe(500);
  });
});

/** Uses the power-up a sled holds, in a fresh state, and returns what happened. */
function use(p: PlayerState, others: PlayerState[] = []): { state: GameState; events: GameEvent[] } {
  const state = createGameState({ code: 'U', seed: 1 });
  clearBalls(state);
  const events: GameEvent[] = [];
  p.usePressed = true;
  usePowerUp(state, [p, ...others], p, events);
  return { state, events };
}

describe('using a power-up', () => {
  it('needs a press, something held, and the sled on its runners', () => {
    const p = sled({ powerUp: POWER_WAX, crashTicks: 3 });
    use(p);
    expect(p.powerUp).toBe(POWER_WAX);
    expect(p.usePressed).toBe(false);
    p.crashTicks = 0;
    const { events } = use(p);
    expect(p.powerUp).toBe(POWER_NONE);
    expect(p.waxTicks).toBe(WAX_TICKS);
    expect(p.powerUpsUsed).toBe(1);
    expect(events).toEqual([{ type: 'power', playerId: 's', power: POWER_WAX }]);
    expect(use(p).events).toEqual([]);
  });

  it('wax: the sled gets faster than without it, above the normal cap, and back under it once the wax is gone', () => {
    const track = flatTrack({ slope: 160, rows: 2000 });
    const plain = sled({ vy: 3000 });
    const waxed = sled({ vy: 3000, waxTicks: WAX_TICKS });
    const events: GameEvent[] = [];
    for (let i = 0; i < WAX_TICKS; i++) {
      rideSled(plain, track, events);
      rideSled(waxed, track, events);
      waxed.waxTicks--;
    }
    expect(speedOf(waxed)).toBeGreaterThan(speedOf(plain) + 600);
    expect(waxed.y - plain.y).toBeGreaterThan(px(150));

    const fast = sled({ vy: MAX_SPEED + 500, waxTicks: 10 });
    expect(speedCap(fast)).toBeGreaterThan(MAX_SPEED);
    fast.waxTicks = 0;
    rideSled(fast, track, events);
    expect(speedOf(fast)).toBeLessThanOrEqual(MAX_SPEED);
  });

  it('tea: the next hard hit only shoves the sled, then the tea is gone and the one after overturns it', () => {
    const tree = { kind: OBSTACLE_TREE, x: 0, y: px(1000) + TREE_RADIUS + px(13) - 100, r: TREE_RADIUS };
    const track = flatTrack({ obstacles: [tree] });
    const p = sled({ powerUp: POWER_TEA });
    use(p);
    expect(p.tea).toBe(true);
    p.vy = 2000;
    const events: GameEvent[] = [];
    hitObstacles(p, track, events);
    expect(p.crashTicks).toBe(0);
    expect(p.tea).toBe(false);
    expect(p.graceTicks).toBeGreaterThan(0);
    expect(events).toMatchObject([{ type: 'shield', playerId: 's', power: POWER_TEA }]);

    const q = sled({ vy: 2000 });
    hitObstacles(q, track, events);
    expect(q.crashTicks).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ type: 'crash', playerId: 's', obstacle: OBSTACLE_TREE });
  });

  it('scarf: a snowball falls apart on the sled for a while, then hits again', () => {
    const track = flatTrack();
    const p = sled({ powerUp: POWER_SCARF });
    const { state } = use(p);
    expect(p.scarfTicks).toBe(SCARF_TICKS);
    const thrower = sled({ id: 't', slot: 1, y: px(800) });
    const throwAt = () => {
      state.ballX[0] = 0;
      state.ballY[0] = p.y - px(10);
      state.ballVx[0] = 0;
      state.ballVy[0] = 10;
      state.ballTicks[0] = BALL_TICKS;
      state.ballOwner[0] = 1;
      state.ballKind[0] = BALL_SMALL;
    };
    const events: GameEvent[] = [];
    p.vy = 1000;
    throwAt();
    updateBalls(state, track, [p, thrower], events);
    expect(events).toMatchObject([{ type: 'shield', playerId: 's', power: POWER_SCARF }]);
    expect(p.vy).toBe(1000);
    expect(state.ballTicks[0]).toBe(0);
    p.scarfTicks = 0;
    throwAt();
    updateBalls(state, track, [p, thrower], events);
    expect(events.at(-1)).toMatchObject({ type: 'splat', playerId: 's', big: false });
    expect(p.vy).toBeLessThan(1000);
  });

  it('fog: everyone else still racing loses the minimap for a while', () => {
    const p = sled({ powerUp: POWER_FOG });
    const b = sled({ id: 'b', slot: 1 });
    const done = sled({ id: 'c', slot: 2, finished: true });
    use(p, [b, done]);
    expect([p.fogTicks, b.fogTicks, done.fogTicks]).toEqual([0, FOG_TICKS, 0]);
  });

  it('giant snowball: rolls down the slope, overturns the sleds ahead in its way (not the thrower), breaks on a tree', () => {
    const tree = { kind: OBSTACLE_TREE, x: 0, y: px(2600), r: TREE_RADIUS };
    const track = flatTrack({ obstacles: [tree], rows: 300 });
    const p = sled({ powerUp: POWER_GIANT, vy: 1500 });
    const victim = sled({ id: 'v', slot: 1, y: px(1500), vy: 1200 });
    const aside = sled({ id: 'w', slot: 2, y: px(1500), x: px(150), vy: 1200 });
    const { state, events } = use(p, [victim, aside]);
    const slot = state.ballKind.indexOf(BALL_GIANT);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(state.ballY[slot]).toBeGreaterThan(p.y);
    const racers = [p, victim, aside];
    let vy0 = state.ballVy[slot]!;
    for (let i = 0; i < 400 && state.ballTicks[slot]! > 0; i++) {
      updateBalls(state, track, racers, events);
      if (i === 5) expect(state.ballVy[slot]).toBeGreaterThan(vy0); // gravity
      if (i === 5) vy0 = 0;
      for (const s of [victim, aside]) {
        s.x += s.vx;
        s.y += s.vy;
      }
    }
    expect(victim.crashTicks).toBeGreaterThan(0);
    expect(victim.hitsTaken).toBe(1);
    expect(p.hits).toBe(1);
    expect(aside.crashTicks).toBe(0);
    expect(p.crashTicks).toBe(0);
    expect(events).toContainEqual(expect.objectContaining({ type: 'crash', playerId: 'v', obstacle: OBSTACLE_GIANT }));
    expect(events.at(-1)).toMatchObject({ type: 'splat', big: true, byId: 's' });
    expect(state.ballTicks.every((t) => t === 0)).toBe(true);
  });

  it('a sled with tea is not overturned by the giant snowball either', () => {
    const track = flatTrack();
    const p = sled({ powerUp: POWER_GIANT });
    const victim = sled({ id: 'v', slot: 1, y: px(1060), tea: true });
    const { state, events } = use(p, [victim]);
    for (let i = 0; i < 20; i++) updateBalls(state, track, [p, victim], events);
    expect(victim.crashTicks).toBe(0);
    expect(victim.tea).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: 'shield', playerId: 'v', power: POWER_TEA }));
  });
});

describe('power-ups in a run', () => {
  it('a new run takes back what was held and every effect', () => {
    const state = makeRace([{ id: 'a', powerUp: POWER_GIANT, tea: true, waxTicks: 9, fogTicks: 4 }, { id: 'b' }], { rounds: 3 });
    startMatch(state, 'a'); // not in the lobby: refused, nothing changes
    expect(state.players.a!.powerUp).toBe(POWER_GIANT);
    state.phase = 'results';
    state.phaseTimer = 1;
    runTick(state, []);
    expect(state.phase).toBe('playing');
    const a = state.players.a!;
    expect([a.powerUp, a.tea, a.waxTicks, a.fogTicks]).toEqual([POWER_NONE, false, 0, 0]);
    expect(state.giftTimers.every((t) => t === 0)).toBe(true);
    expect(state.giftTimers.length).toBeGreaterThan(0);
  });

  it('the lobby option is the host\'s, on by default', () => {
    const state = createGameState({ code: 'L', seed: 1 });
    expect(state.powerUps).toBe(true);
    addPlayer(state, 'h', 'Host');
    addPlayer(state, 'g', 'Guest');
    expect(setPowerUps(state, 'g', false)).toBe(false);
    expect(setPowerUps(state, 'h', false)).toBe(true);
    expect(state.powerUps).toBe(false);
    startMatch(state, 'h');
    expect(setPowerUps(state, 'h', true)).toBe(false);
  });

  it('a human rides through a gift box and uses what it gave', () => {
    const state = makeRace([{ id: 'a' }, { id: 'b' }], { trackId: 0 });
    const track = getTrack(state.trackId, state.trackSeed);
    const gift = track.gifts[0]!;
    Object.assign(state.players.a!, { x: gift.x, y: gift.y - px(30), vx: 0, vy: 900, heading: DOWNHILL });
    const events = run(state, 10);
    const got = events.find((e) => e.type === 'gift');
    expect(got).toMatchObject({ type: 'gift', playerId: 'a', gift: 0 });
    const power = state.players.a!.powerUp;
    expect(POWER_KINDS).toContain(power);
    const used = run(state, 1, { a: { use: true } });
    expect(used).toContainEqual({ type: 'power', playerId: 'a', power });
    expect(state.players.a!.powerUp).toBe(POWER_NONE);
  });

  it('no gift box is ever taken with power-ups off', () => {
    const state = makeRace([{ id: 'a', isBot: true, botLevel: BOT_HARD }, { id: 'b', isBot: true, botLevel: BOT_MEDIUM }], { powerUps: false });
    const events = run(state, 1500);
    expect(events.some((e) => e.type === 'gift' || e.type === 'power')).toBe(false);
  });
});

describe('bots and power-ups', () => {
  /** A bot at speed on Pârtia Bunicii holding a power-up, the others placed around it (a sled with no snowballs stays at the start, behind). */
  function botWith(level: number, power: number, others: Partial<PlayerState>[] = []): { state: GameState; id: string } {
    const state = makeRace([{ id: 'bot', isBot: true, botLevel: level }, { id: 'start' }, ...others.map((o, i) => ({ id: `o${i}`, ...o }))]);
    expect(state.phase).toBe('playing');
    const track = getTrack(state.trackId, state.trackSeed);
    const y = track.startY + px(200);
    Object.assign(state.players.bot!, { powerUp: power, x: 0, y, vy: 2500, heading: DOWNHILL });
    others.forEach((o, i) => Object.assign(state.players[`o${i}`]!, { x: 0, y: y + (o.y ?? 0), vy: 2000 }));
    state.roundTick = 200;
    return { state, id: 'bot' };
  }
  /** How many of the next decisions use the power-up. */
  const usesOf = (state: GameState, id: string, decisions = 40) => {
    let n = 0;
    for (let d = 0; d < decisions; d++) {
      state.tick = d * BOT_PARAMS[state.players[id]!.botLevel]!.interval;
      state.rng = (state.rng + 7919) % 4294967296;
      if (botThink(state, id)?.input.use) n++;
    }
    return n;
  };

  it('Greu keeps the giant snowball until a rival is ahead in line, then throws it', () => {
    const alone = botWith(BOT_HARD, POWER_GIANT);
    expect(usesOf(alone.state, alone.id)).toBe(0);
    const ahead = botWith(BOT_HARD, POWER_GIANT, [{ y: px(300) }]);
    expect(usesOf(ahead.state, ahead.id)).toBeGreaterThan(30);
  });

  it('Greu keeps the scarf for a snowball coming its way; tea and fog right away', () => {
    const calm = botWith(BOT_HARD, POWER_SCARF);
    expect(usesOf(calm.state, calm.id)).toBe(0);
    const threat = botWith(BOT_HARD, POWER_SCARF, [{ y: -px(120), snowballs: 2 }]);
    expect(usesOf(threat.state, threat.id)).toBeGreaterThan(30);
    for (const power of [POWER_TEA, POWER_FOG]) {
      const b = botWith(BOT_HARD, power);
      expect(usesOf(b.state, b.id)).toBeGreaterThan(30);
    }
  });

  it('Ușor uses whatever it holds now and then, at random', () => {
    const b = botWith(BOT_EASY, POWER_GIANT);
    const n = usesOf(b.state, b.id, 400);
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThan(60);
  });

  it('bots of every level pick power-ups up and use them in a race', () => {
    const state = createGameState({ code: 'BP', seed: 'bots-power' });
    [BOT_EASY, BOT_MEDIUM, BOT_HARD].forEach((level, i) => addPlayer(state, `b${i}`, `b${i}`, true, level));
    state.hostId = 'b0';
    startMatch(state, 'b0');
    const used = new Set<number>();
    while (state.round === 1 && state.phase === 'playing') {
      for (const e of runTick(state, [])) if (e.type === 'power') used.add(e.power);
    }
    for (const p of Object.values(state.players)) expect(p.powerUpsUsed, p.id).toBeGreaterThan(0);
    expect(used.size).toBeGreaterThanOrEqual(3);
  });
});
