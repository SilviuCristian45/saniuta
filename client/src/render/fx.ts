import Phaser from 'phaser';
import { DEPTH } from './layout';
import type { AddToWorld } from './TrackView';
import { TEX } from './textures';

// Short-lived effects in the world: snow bursts and puffs. All tweened, then destroyed.

/** A burst of snow: `count` puffs flying out from (x, y). */
export function snowBurst(scene: Phaser.Scene, add: AddToWorld, x: number, y: number, count: number, spread: number): void {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = spread * (0.4 + Math.random() * 0.6);
    const puff = add(scene.add.image(x, y, TEX.puff).setDepth(DEPTH.fx).setScale(0.3 + Math.random() * 0.4).setAlpha(0.95));
    scene.tweens.add({
      targets: puff,
      x: x + Math.cos(a) * d,
      y: y + Math.sin(a) * d,
      scale: puff.scale * 1.8,
      alpha: 0,
      duration: 380 + Math.random() * 260,
      ease: 'Quad.easeOut',
      onComplete: () => puff.destroy(),
    });
  }
}

/** Text floating up from a point in the world. */
export function floatText(scene: Phaser.Scene, add: AddToWorld, x: number, y: number, text: string, color: string): void {
  const t = add(
    scene.add
      .text(x, y, text, { fontFamily: "'Trebuchet MS', sans-serif", fontSize: '20px', fontStyle: 'bold', color, stroke: '#141b33', strokeThickness: 5 })
      .setOrigin(0.5)
      .setDepth(DEPTH.labels),
  );
  scene.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 1200, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
}
