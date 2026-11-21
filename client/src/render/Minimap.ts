import Phaser from 'phaser';
import { ROW_LEN, type GameState, type Track } from '@saniuta/shared';
import { COLORS, PLAYER_COLORS } from './colors';
import { GAME_W, HUD_DEPTH } from './layout';
import type { Pose } from '../net/view';

const WIDTH = 64;
/** Bends are drawn this many times wider than true scale, or the track would be a hair-thin line. */
const X_STRETCH = 3;

/** The whole track as a narrow strip at the side of the screen, with a dot for every sled. */
export class Minimap {
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly dots: Phaser.GameObjects.Graphics;
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
    g.fillRoundedRect(this.x0 - 6, top - 10, WIDTH + 12, bottom - top + 20, 10);
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
  }

  private mapX(x: number): number {
    return this.x0 + WIDTH / 2 + x * this.scale * X_STRETCH;
  }

  private mapY(y: number): number {
    return this.top + y * this.scale;
  }

  update(state: Readonly<GameState>, poses: ReadonlyMap<string, Pose>, me: string): void {
    const g = this.dots.clear();
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
  }
}
