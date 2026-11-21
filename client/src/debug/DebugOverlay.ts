import Phaser from 'phaser';
import {
  ROW_LEN,
  SLED_RADIUS,
  botThink,
  currentTrack,
  nearby,
  slopeAt,
  speedOf,
  surfaceAt,
  type GameState,
} from '@saniuta/shared';
import { DEPTH, FONT, HUD_DEPTH, px } from '../render/layout';
import type { Pose } from '../net/view';

type Add = <T extends Phaser.GameObjects.GameObject>(obj: T) => T;

const SURFACES = ['zăpadă', 'gheață', 'adâncă'];

/** ?debug: hitboxes near the player, every sled's disc, each bot's chosen line, and the numbers. */
export class DebugOverlay {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, addWorld: Add, addHud: Add) {
    this.g = addWorld(scene.add.graphics().setDepth(DEPTH.debug));
    this.text = addHud(
      scene.add
        .text(280, 14, '', { fontFamily: FONT, fontSize: '13px', color: '#9ff', backgroundColor: '#000a', padding: { x: 6, y: 4 } })
        .setDepth(HUD_DEPTH.overlay + 5),
    );
  }

  update(state: Readonly<GameState>, me: string, fps: number, poses: ReadonlyMap<string, Pose>): void {
    const g = this.g.clear();
    const track = currentTrack(state);
    const p = state.players[me];
    if (p) {
      g.lineStyle(1, 0xff3366, 1);
      for (const y of [p.y - 2 * ROW_LEN, p.y, p.y + 2 * ROW_LEN, p.y + 4 * ROW_LEN]) {
        for (const i of nearby(track, track.rowObstacles, y)) {
          const o = track.obstacles[i]!;
          g.strokeCircle(px(o.x), px(o.y), px(o.r));
        }
      }
      g.lineStyle(1, 0x33ff99, 1);
      for (const r of track.ramps) g.strokeRect(px(r.x0), px(r.y0), px(r.x1 - r.x0), px(r.y1 - r.y0));
    }
    for (const o of Object.values(state.players)) {
      if (!o.racing) continue;
      const pose = poses.get(o.id) ?? o;
      g.lineStyle(1, 0xffff00, 0.9);
      g.strokeCircle(px(pose.x), px(pose.y), px(SLED_RADIUS));
      if (o.isBot && !o.finished) {
        const t = botThink(state as GameState, o.id);
        if (t) {
          g.lineStyle(1, t.intent === 'blocked' ? 0xff0000 : 0x00ccff, 0.8);
          g.lineBetween(px(o.x), px(o.y), px(t.targetX), px(t.targetY));
        }
      }
    }
    if (!p) return;
    this.text.setText(
      [
        `tick ${state.tick}  manșă ${state.round}  fps ${fps.toFixed(0)}`,
        `viteză ${speedOf(p)}  heading ${p.heading}  steer ${p.steer} throttle ${p.throttle}`,
        `aer ${p.airTicks}/${p.airTotal}  răsturnat ${p.crashTicks}  grație ${p.graceTicks}  bulgări ${p.snowballs}`,
        `suprafață ${SURFACES[surfaceAt(track, p.x, p.y)]}  pantă ${slopeAt(track, p.y)}%  seq ${p.lastSeq}`,
      ].join('\n'),
    );
  }
}
