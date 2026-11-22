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

/**
 * Snow confetti over the podium: flakes in the winner's color and white burst up from (x, y) and
 * drift down, turning. `add` puts them on the layer that draws them (the HUD over the podium).
 */
export function snowConfetti(scene: Phaser.Scene, add: AddToWorld, x: number, y: number, color: number, depth: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const v = 120 + Math.random() * 180;
    const flake = add(
      scene.add
        .image(x, y, TEX.flake)
        .setDepth(depth)
        .setScale(0.8 + Math.random() * 1.4)
        .setTint(Math.random() < 0.55 ? color : 0xffffff),
    );
    const dx = Math.cos(a) * v;
    const dy = Math.sin(a) * v;
    scene.tweens.add({ targets: flake, x: x + dx, y: y + dy, duration: 500, ease: 'Quad.easeOut' });
    scene.tweens.add({
      targets: flake,
      x: x + dx + (Math.random() - 0.5) * 120,
      y: y + dy + 220 + Math.random() * 160,
      angle: (Math.random() - 0.5) * 720,
      alpha: 0,
      delay: 500,
      duration: 1600 + Math.random() * 900,
      ease: 'Sine.easeIn',
      onComplete: () => flake.destroy(),
    });
  }
}

/** A short fan of snow thrown out sideways by a sled turning hard (opposite to the turn). */
export function turnSpray(scene: Phaser.Scene, add: AddToWorld, x: number, y: number, angle: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const a = angle + (Math.random() - 0.5) * 0.7;
    const d = 18 + Math.random() * 22;
    const puff = add(scene.add.image(x, y, TEX.puff).setDepth(DEPTH.fx).setScale(0.18 + Math.random() * 0.2).setAlpha(0.9));
    scene.tweens.add({
      targets: puff,
      x: x + Math.cos(a) * d,
      y: y + Math.sin(a) * d,
      alpha: 0,
      scale: puff.scale * 1.6,
      duration: 260 + Math.random() * 200,
      ease: 'Quad.easeOut',
      onComplete: () => puff.destroy(),
    });
  }
}

/** Icy sparkles under a sled riding on ice: tiny bright glints that flash and fade. */
export function iceSparks(scene: Phaser.Scene, add: AddToWorld, x: number, y: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const s = add(
      scene.add
        .image(x + (Math.random() - 0.5) * 22, y + (Math.random() - 0.5) * 14, TEX.flake)
        .setDepth(DEPTH.fx)
        .setTint(Math.random() < 0.5 ? 0xe8fbff : 0xa6e6ff)
        .setScale(0.35 + Math.random() * 0.35)
        .setBlendMode(Phaser.BlendModes.ADD),
    );
    scene.tweens.add({ targets: s, alpha: 0, scale: 0.05, duration: 220 + Math.random() * 180, onComplete: () => s.destroy() });
  }
}
