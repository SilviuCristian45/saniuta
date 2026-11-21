import Phaser from 'phaser';
import { COLORS } from './colors';
import { DEPTH } from './layout';

/** A new trail point once the sled moved this far (px). */
const STEP_PX = 6;
/** The runners are this far from the sled's middle line. */
const RUNNER_PX = 10;

interface TrailPoint {
  x: number;
  y: number;
  angle: number;
  /** Starts a new piece (after a jump or a crash). */
  gap: boolean;
}

/** Two runner tracks behind every sled in the snow; the oldest points fade away. */
export class Trails {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly trails = new Map<string, TrailPoint[]>();
  private readonly broken = new Set<string>();

  constructor(
    scene: Phaser.Scene,
    add: <T extends Phaser.GameObjects.GameObject>(obj: T) => T,
    private readonly maxPoints: number,
  ) {
    this.g = add(scene.add.graphics().setDepth(DEPTH.trails));
  }

  /** The sled is on the snow at (x, y): extend its trail. */
  extend(id: string, x: number, y: number, angle: number): void {
    let trail = this.trails.get(id);
    if (!trail) {
      trail = [];
      this.trails.set(id, trail);
    }
    const last = trail[trail.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < STEP_PX) return;
    trail.push({ x, y, angle, gap: !last || this.broken.delete(id) });
    if (trail.length > this.maxPoints) trail.shift();
  }

  /** In the air or overturned: the next point starts a new piece. */
  lift(id: string): void {
    this.broken.add(id);
  }

  clear(): void {
    this.trails.clear();
    this.broken.clear();
    this.g.clear();
  }

  draw(view: Phaser.Geom.Rectangle): void {
    const g = this.g.clear();
    for (const trail of this.trails.values()) {
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1]!;
        const b = trail[i]!;
        if (b.gap || b.y < view.y - 50 || a.y > view.bottom + 50) continue;
        const alpha = 0.45 * (i / trail.length);
        g.lineStyle(2, COLORS.trail, alpha);
        for (const side of [-1, 1]) {
          const ox = -Math.sin(a.angle) * RUNNER_PX * side;
          const oy = Math.cos(a.angle) * RUNNER_PX * side;
          const bx = -Math.sin(b.angle) * RUNNER_PX * side;
          const by = Math.cos(b.angle) * RUNNER_PX * side;
          g.lineBetween(a.x + ox, a.y + oy, b.x + bx, b.y + by);
        }
      }
    }
  }
}
