import Phaser from 'phaser';
import { GAME_H, GAME_W, HUD_DEPTH } from './layout';
import { TEX } from './textures';

interface Flake {
  img: Phaser.GameObjects.Image;
  /** 0.3 (far, slow, small) .. 1 (near). */
  depth: number;
  phase: number;
}

/** Snow falling in front of the camera; the near flakes drift against the ride (parallax). */
export class Snowfall {
  private readonly flakes: Flake[] = [];
  private lastX = 0;
  private lastY = 0;
  private started = false;

  constructor(scene: Phaser.Scene, add: <T extends Phaser.GameObjects.GameObject>(obj: T) => T, count: number) {
    for (let i = 0; i < count; i++) {
      const depth = 0.3 + Math.random() * 0.7;
      const img = add(
        scene.add
          .image(Math.random() * GAME_W, Math.random() * GAME_H, TEX.flake)
          .setScale(depth * 0.9)
          .setAlpha(0.35 + depth * 0.5)
          .setDepth(HUD_DEPTH.snow),
      );
      this.flakes.push({ img, depth, phase: Math.random() * Math.PI * 2 });
    }
  }

  /** `camX/camY`: the world camera's scroll, for the parallax. */
  update(dtMs: number, time: number, camX: number, camY: number): void {
    const dx = this.started ? camX - this.lastX : 0;
    const dy = this.started ? camY - this.lastY : 0;
    this.started = true;
    this.lastX = camX;
    this.lastY = camY;
    const dt = Math.min(dtMs, 100) / 1000;
    for (const f of this.flakes) {
      const img = f.img;
      img.x += (Math.sin(time / 900 + f.phase) * 18 - 10) * f.depth * dt - dx * f.depth * 0.6;
      img.y += 40 * f.depth * dt - dy * f.depth * 0.6;
      if (img.y > GAME_H + 10) img.y -= GAME_H + 20;
      if (img.y < -10) img.y += GAME_H + 20;
      if (img.x > GAME_W + 10) img.x -= GAME_W + 20;
      if (img.x < -10) img.x += GAME_W + 20;
    }
  }
}
