import { describe, expect, it } from 'vitest';
import { BALL_TICKS, GIANT_TICKS, addPlayer, createGameState, startMatch } from '@saniuta/shared';
import { blendBalls, lerpPose, TickBlend } from '../src/net/view';

describe('drawing between ticks', () => {
  it('poses are blended, the heading the short way round', () => {
    expect(lerpPose({ x: 0, y: 0, heading: 1020 }, { x: 10, y: 20, heading: 4 }, 0.5)).toEqual({ x: 5, y: 10, heading: 1024 });
  });

  it('a new run snaps the sleds to the start instead of gliding there', () => {
    const state = createGameState({ code: 'V', seed: 1 });
    addPlayer(state, 'a', 'A');
    addPlayer(state, 'b', 'B');
    startMatch(state, 'a');
    const blend = new TickBlend(BALL_TICKS);
    blend.push(state);
    state.tick++;
    state.players.a!.y += 1000;
    blend.push(state);
    expect(blend.view(0.5).poses.get('a')!.y).toBe(state.players.a!.y - 500);
    state.tick++;
    state.round++;
    state.players.a!.y = 0;
    blend.push(state);
    expect(blend.view(0.5).poses.get('a')!.y).toBe(0);
  });

  it('snowballs glide between ticks; a fresh throw is drawn where it is', () => {
    const prev = [{ x: 0, y: 0, ticks: 10, giant: false }, { x: 0, y: 0, ticks: 0, giant: false }];
    const cur = [{ x: 100, y: 50, ticks: 9, giant: false }, { x: 7, y: 8, ticks: BALL_TICKS, giant: false }];
    const balls = blendBalls(prev, cur, 0.5, BALL_TICKS);
    expect(balls).toHaveLength(2);
    expect(balls[0]).toMatchObject({ slot: 0, x: 50, y: 25 });
    expect(balls[1]).toMatchObject({ slot: 1, x: 7, y: 8 });
    expect(balls[1]!.flight).toBeLessThan(0.05);
  });

  it('a giant snowball counts its own (longer) life, and a slot that changed kind does not glide', () => {
    const prev = [{ x: 0, y: 0, ticks: GIANT_TICKS, giant: true }, { x: 0, y: 0, ticks: 3, giant: false }];
    const cur = [{ x: 100, y: 0, ticks: GIANT_TICKS - 1, giant: true }, { x: 40, y: 40, ticks: 2, giant: true }];
    const balls = blendBalls(prev, cur, 0.5, BALL_TICKS);
    expect(balls[0]).toMatchObject({ x: 50, giant: true });
    expect(balls[0]!.flight).toBeLessThan(0.02);
    expect(balls[1]).toMatchObject({ x: 40, y: 40, giant: true });
  });
});
