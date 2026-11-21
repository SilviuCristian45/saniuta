import Phaser from 'phaser';
import { GAME_TITLE } from '@saniuta/shared';

/** Stage 0 placeholder: an evening sky over a snowy slope, until the real scenes arrive in stage 2. */
class PlaceholderScene extends Phaser.Scene {
  constructor() {
    super('placeholder');
  }

  create(): void {
    const { width, height } = this.scale;
    const sky = this.add.graphics();
    sky.fillGradientStyle(0x0d1530, 0x0d1530, 0x6b3a5e, 0x6b3a5e, 1);
    sky.fillRect(0, 0, width, height * 0.6);
    sky.fillStyle(0xe8eef8, 1);
    sky.fillRect(0, height * 0.6, width, height * 0.4);
    this.add
      .text(width / 2, height * 0.42, GAME_TITLE, { fontFamily: 'system-ui, sans-serif', fontSize: '48px', color: '#fff6e0' })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height * 0.52, 'în lucru: etapa 0', { fontFamily: 'system-ui, sans-serif', fontSize: '20px', color: '#c8d4ec' })
      .setOrigin(0.5);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  backgroundColor: '#0d1530',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [PlaceholderScene],
});
