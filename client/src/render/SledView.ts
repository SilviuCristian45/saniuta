import Phaser from 'phaser';
import { ANGLE_STEPS, CRASH_TICKS, JUMP_HEIGHT_PX, type PlayerState } from '@saniuta/shared';
import { COLORS, PLAYER_COLORS, SCARF_COLORS } from './colors';
import { DEPTH, FONT, sortDepth } from './layout';
import type { AddToWorld } from './TrackView';
import { TEX } from './textures';

/** Scarf: links trailing from the rider's neck, each following the one before with some slack. */
const SCARF_LINKS = 7;
const SCARF_LINK_PX = 4.5;

/** Height of a jump (0..1) from the ticks left and its length: a parabola. */
export function jumpHeight(airTicks: number, airTotal: number): number {
  if (airTicks <= 0 || airTotal <= 0) return 0;
  const t = (airTotal - airTicks) / airTotal;
  return 4 * t * (1 - t);
}

/** One sled on the slope: shadow, sled and rider, the fluttering scarf, the name over the others. */
export class SledView {
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly body: Phaser.GameObjects.Image;
  private readonly scarf: Phaser.GameObjects.Graphics;
  private readonly splat: Phaser.GameObjects.Image;
  private readonly label?: Phaser.GameObjects.Text;
  private readonly links: { x: number; y: number }[] = [];
  private readonly coat: number;
  private readonly scarfColor: number;
  /** Neighbours at the start alternate their names above and below the sled, so they never overlap. */
  private readonly labelBelow: boolean;

  constructor(
    scene: Phaser.Scene,
    add: AddToWorld,
    p: Readonly<PlayerState>,
    readonly mine: boolean,
  ) {
    this.coat = PLAYER_COLORS[p.slot] ?? 0xffffff;
    this.scarfColor = SCARF_COLORS[p.slot] ?? 0xffffff;
    this.labelBelow = p.slot % 2 === 1;
    this.shadow = add(scene.add.image(0, 0, TEX.shadow).setDepth(DEPTH.shadows));
    this.body = add(scene.add.image(0, 0, TEX.sled(p.slot)));
    this.scarf = add(scene.add.graphics());
    this.splat = add(scene.add.image(0, 0, TEX.puff).setAlpha(0).setScale(0.9));
    if (!mine) {
      this.label = add(
        scene.add
          .text(0, 0, p.name, { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#ffffff', stroke: COLORS.outline, strokeThickness: 4 })
          .setOrigin(0.5)
          .setDepth(DEPTH.labels),
      );
    }
  }

  /**
   * Draws the sled at a pose (world px, radians). In the air it is bigger and its shadow falls
   * further away; overturned it spins and wobbles.
   */
  setPose(x: number, y: number, angle: number, p: Readonly<PlayerState>, time: number): void {
    const h = jumpHeight(p.airTicks, p.airTotal);
    const lift = h * JUMP_HEIGHT_PX;
    let spin = 0;
    if (p.crashTicks > 0) {
      const k = p.crashTicks / CRASH_TICKS;
      spin = k * k * Math.PI * 3 + Math.sin(time / 40) * 0.15 * k;
    }
    const scale = 1 + h * 0.45;
    this.shadow.setPosition(x + lift * 0.6, y + lift * 0.9).setRotation(angle).setScale(1 - h * 0.3).setAlpha(1 - h * 0.5);
    this.body.setPosition(x, y).setRotation(angle + spin).setScale(scale);
    this.body.setDepth(h > 0 ? DEPTH.air : sortDepth(y));
    this.body.setAlpha(p.graceTicks > 0 && Math.floor(time / 90) % 2 === 0 ? 0.55 : 1);
    this.splat.setPosition(x, y).setDepth(this.body.depth + 1e-7).setAlpha(p.splatTicks > 0 ? Math.min(0.9, p.splatTicks / 12) : 0);
    this.label?.setPosition(x, this.labelBelow ? y + 28 + lift : y - 28 - lift);
    this.drawScarf(x, y, angle + spin, scale, time, this.body.depth + 2e-7);
  }

  setVisible(visible: boolean): void {
    for (const obj of [this.shadow, this.body, this.scarf, this.splat, this.label]) obj?.setVisible(visible);
  }

  /** A new run: the scarf starts hanging straight behind. */
  reset(): void {
    this.links.length = 0;
  }

  private drawScarf(x: number, y: number, angle: number, scale: number, time: number, depth: number): void {
    // The neck: just in front of the hat, at the back of the rider.
    const nx = x + Math.cos(angle) * -4 * scale;
    const ny = y + Math.sin(angle) * -4 * scale;
    if (this.links.length === 0) {
      for (let i = 0; i < SCARF_LINKS; i++) this.links.push({ x: nx - Math.cos(angle) * SCARF_LINK_PX * i, y: ny - Math.sin(angle) * SCARF_LINK_PX * i });
    }
    this.links[0]!.x = nx;
    this.links[0]!.y = ny;
    for (let i = 1; i < SCARF_LINKS; i++) {
      const prev = this.links[i - 1]!;
      const link = this.links[i]!;
      // Flutter sideways, more toward the free end.
      const wave = Math.sin(time / 70 + i * 0.9) * 0.9 * (i / SCARF_LINKS);
      link.x += -Math.sin(angle) * wave;
      link.y += Math.cos(angle) * wave;
      const dx = link.x - prev.x;
      const dy = link.y - prev.y;
      const d = Math.hypot(dx, dy) || 1;
      link.x = prev.x + (dx / d) * SCARF_LINK_PX * scale;
      link.y = prev.y + (dy / d) * SCARF_LINK_PX * scale;
    }
    const g = this.scarf.clear().setDepth(depth);
    for (let i = 1; i < SCARF_LINKS; i++) {
      const a = this.links[i - 1]!;
      const b = this.links[i]!;
      g.lineStyle(4 * scale, i % 2 === 0 ? this.coat : this.scarfColor, 1);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
  }

  destroy(): void {
    for (const obj of [this.shadow, this.body, this.scarf, this.splat, this.label]) obj?.destroy();
  }
}

/** Angle steps to radians. */
export function toRadians(heading: number): number {
  return (heading / ANGLE_STEPS) * Math.PI * 2;
}
