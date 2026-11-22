import Phaser from 'phaser';
import { ROW_LEN, type GameState, type Track } from '@saniuta/shared';
import { COLORS, PLAYER_COLORS } from './colors';
import { FONT, GAME_W, HUD_DEPTH } from './layout';
import type { Pose } from '../net/view';

const WIDTH = 64;
/** The frame around the strip reaches this far above `top` and below `bottom`. */
export const MINIMAP_PAD = 10;
/** Bends are drawn this many times wider than true scale, or the track would be a hair-thin line. */
const X_STRETCH = 3;

/** The whole track as a narrow strip at the side of the screen, with a dot for every sled; someone's fog hides it. */
export class Minimap {
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly dots: Phaser.GameObjects.Graphics;
  private readonly fog: Phaser.GameObjects.Container;
  private readonly x0 = GAME_W - WIDTH - 12;
  private readonly scale: number;

  constructor(
    scene: Phaser.Scene,
    add: <T extends Phaser.GameObjects.GameObject>(obj: T) => T,
    track: Track,
    private readonly top: number,
    bottom: number,
  ) {
    this.scale = (bottom - top) / track.endY;
    const g = (this.frame = add(scene.add.graphics().setDepth(HUD_DEPTH.panel)));
    g.fillStyle(0x141b33, 0.55);
    g.fillRoundedRect(this.x0 - 6, top - MINIMAP_PAD, WIDTH + 12, bottom - top + 2 * MINIMAP_PAD, 10);
    const edge = (r: number, side: number) => ({
      x: this.mapX(track.center[r]! + side * track.half[r]!),
      y: this.mapY(r * ROW_LEN),
    });
    const rows: number[] = [];
    for (let r = 0; r < track.rowCount; r += 3) rows.push(r);
    rows.push(track.rowCount - 1);
    g.fillStyle(COLORS.snow, 0.9);
    g.fillPoints([...rows.map((r) => edge(r, -1)), ...[...rows].reverse().map((r) => edge(r, 1))], true);
    g.lineStyle(2, 0xe63946, 1);
    g.lineBetween(this.x0, this.mapY(track.finishY), this.x0 + WIDTH, this.mapY(track.finishY));
    g.lineStyle(2, 0x1b2440, 1);
    g.lineBetween(this.x0, this.mapY(track.startY), this.x0 + WIDTH, this.mapY(track.startY));
    this.dots = add(scene.add.graphics().setDepth(HUD_DEPTH.text));

    // Fog: grey clouds over the whole strip.
    const clouds = scene.add.graphics();
    const h = bottom - top + 2 * MINIMAP_PAD;
    clouds.fillStyle(0x8d99ae, 0.92);
    clouds.fillRoundedRect(this.x0 - 6, top - MINIMAP_PAD, WIDTH + 12, h, 10);
    for (let i = 0, y = top - MINIMAP_PAD + 10; y < bottom + MINIMAP_PAD; i++, y += 26) {
      clouds.fillStyle(i % 2 === 0 ? 0xc9d0da : 0xdde2e8, 0.95);
      clouds.fillCircle(this.x0 + (i % 3) * 22 + 6, y, 18);
      clouds.fillCircle(this.x0 + ((i + 1) % 3) * 22 + 4, y + 12, 14);
    }
    const label = scene.add
      .text(this.x0 + WIDTH / 2, (top + bottom) / 2, 'CEAȚĂ', { fontFamily: FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffffff', stroke: '#1b2440', strokeThickness: 4 })
      .setOrigin(0.5)
      .setAngle(-90);
    this.fog = add(scene.add.container(0, 0, [clouds, label]).setDepth(HUD_DEPTH.text + 0.5).setVisible(false));
  }

  private mapX(x: number): number {
    return this.x0 + WIDTH / 2 + x * this.scale * X_STRETCH;
  }

  private mapY(y: number): number {
    return this.top + y * this.scale;
  }

  update(state: Readonly<GameState>, poses: ReadonlyMap<string, Pose>, me: string): void {
    const g = this.dots.clear();
    const fogTicks = state.phase === 'playing' ? (state.players[me]?.fogTicks ?? 0) : 0;
    this.fog.setVisible(fogTicks > 0);
    if (fogTicks > 0) {
      // Thins out over its last half second; drifts a little meanwhile.
      this.fog.setAlpha(Math.min(1, fogTicks / 15)).setX(Math.sin(fogTicks / 7) * 3);
      return;
    }
    const players = Object.values(state.players).filter((p) => p.racing);
    // Others first, the player's own dot on top.
    players.sort((a, b) => Number(a.id === me) - Number(b.id === me));
    for (const p of players) {
      const pose = poses.get(p.id) ?? p;
      const x = Phaser.Math.Clamp(this.mapX(pose.x), this.x0 - 4, this.x0 + WIDTH + 4);
      const y = this.mapY(pose.y);
      const mine = p.id === me;
      if (mine) {
        g.fillStyle(0xffffff, 1);
        g.fillCircle(x, y, 7);
      }
      g.fillStyle(PLAYER_COLORS[p.slot] ?? 0xffffff, 1);
      g.fillCircle(x, y, mine ? 5 : 4);
    }
  }

  destroy(): void {
    this.frame.destroy();
    this.dots.destroy();
    this.fog.destroy();
  }
}
