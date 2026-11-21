import Phaser from 'phaser';
import { MAX_PLAYERS } from '@saniuta/shared';
import { COLORS, PLAYER_COLORS } from './colors';

// Every picture in the game is drawn here once, from code, into textures (no image files).

export const TEX = {
  sled: (slot: number) => `sled-${slot}`,
  shadow: 'shadow',
  fir: 'fir',
  firSmall: 'fir-small',
  rock: 'rock',
  ramp: 'ramp',
  pile: 'pile',
  ball: 'ball',
  flake: 'flake',
  glow: 'glow',
  cabin: 'cabin',
  lamp: 'lamp',
  puff: 'puff',
} as const;

/** Sled texture size: drawn pointing right (heading 0 = +x), the rider seen from above. */
export const SLED_W = 44;
export const SLED_H = 30;

export function ensureTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX.shadow)) return;
  const g = scene.make.graphics({}, false);
  const bake = (key: string, w: number, h: number, draw: () => void) => {
    g.clear();
    draw();
    g.generateTexture(key, w, h);
  };

  for (let slot = 0; slot < MAX_PLAYERS; slot++) bake(TEX.sled(slot), SLED_W, SLED_H, () => drawSled(g, PLAYER_COLORS[slot]!));

  bake(TEX.shadow, 48, 32, () => {
    g.fillStyle(0x1b2440, 0.35);
    g.fillEllipse(24, 16, 44, 26);
  });

  bake(TEX.fir, 76, 76, () => drawFir(g, 38, 38, 36));
  bake(TEX.firSmall, 52, 52, () => drawFir(g, 26, 26, 24));

  bake(TEX.rock, 40, 36, () => {
    g.fillStyle(0x1b2440, 0.3);
    g.fillEllipse(22, 22, 36, 26);
    g.fillStyle(COLORS.rock, 1);
    g.fillPoints(
      [
        { x: 5, y: 18 },
        { x: 11, y: 7 },
        { x: 23, y: 4 },
        { x: 34, y: 11 },
        { x: 36, y: 23 },
        { x: 27, y: 31 },
        { x: 12, y: 30 },
      ],
      true,
    );
    g.fillStyle(COLORS.rockLight, 1);
    g.fillTriangle(11, 9, 23, 6, 17, 18);
    g.fillStyle(COLORS.snowbank, 1);
    g.fillEllipse(21, 12, 20, 9);
  });

  bake(TEX.ramp, 84, 28, () => {
    // Wooden planks across, a snowy lip on the far (downhill) side; the arrow points down the slope.
    g.fillStyle(COLORS.woodDark, 1);
    g.fillRoundedRect(0, 0, 84, 28, 4);
    for (let i = 0; i < 6; i++) {
      g.fillStyle(i % 2 === 0 ? COLORS.wood : COLORS.woodLight, 1);
      g.fillRect(3 + i * 13.2, 3, 12, 18);
    }
    g.fillStyle(COLORS.snowbank, 1);
    g.fillRoundedRect(0, 20, 84, 8, 3);
    g.fillStyle(0xffffff, 0.85);
    g.fillTriangle(34, 6, 50, 6, 42, 16);
  });

  bake(TEX.pile, 36, 30, () => {
    g.fillStyle(0x1b2440, 0.25);
    g.fillEllipse(19, 20, 32, 16);
    g.fillStyle(COLORS.snowbank, 1);
    g.fillEllipse(18, 17, 30, 18);
    for (const [x, y] of [
      [12, 13],
      [24, 13],
      [18, 7],
    ] as const) {
      g.fillStyle(0xb9c6e2, 1);
      g.fillCircle(x + 1, y + 1, 6);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(x, y, 6);
    }
  });

  bake(TEX.ball, 14, 14, () => {
    g.fillStyle(0xb9c6e2, 1);
    g.fillCircle(7.5, 7.5, 6);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(6.5, 6.5, 5.5);
  });

  bake(TEX.flake, 8, 8, () => {
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 3);
  });

  bake(TEX.puff, 24, 24, () => {
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(12, 12, 10);
  });

  bake(TEX.cabin, 110, 86, () => drawCabin(g));

  bake(TEX.lamp, 16, 16, () => {
    g.fillStyle(COLORS.woodDark, 1);
    g.fillCircle(8, 8, 6);
    g.fillStyle(COLORS.warm, 1);
    g.fillCircle(8, 8, 4);
  });
  g.destroy();

  // Soft warm light: a radial gradient (canvas), drawn additively over the snow.
  const size = 128;
  const canvas = scene.textures.createCanvas(TEX.glow, size, size)!;
  const ctx = canvas.getContext();
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 196, 107, 0.55)');
  grad.addColorStop(0.4, 'rgba(255, 170, 80, 0.22)');
  grad.addColorStop(1, 'rgba(255, 150, 60, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  canvas.refresh();
}

/** A wooden sled with two runners, a rider in a colored coat and a bobble hat, pointing right. */
function drawSled(g: Phaser.GameObjects.Graphics, coat: number): void {
  // Runners: curled up at the front (right).
  g.fillStyle(COLORS.woodDark, 1);
  g.fillRoundedRect(2, 3, 38, 4, 2);
  g.fillRoundedRect(2, 23, 38, 4, 2);
  g.fillCircle(40, 5, 3);
  g.fillCircle(40, 25, 3);
  // Seat slats.
  g.fillStyle(COLORS.wood, 1);
  g.fillRoundedRect(6, 6, 28, 18, 3);
  g.fillStyle(COLORS.woodLight, 1);
  for (let i = 0; i < 4; i++) g.fillRect(8 + i * 7, 7, 4, 16);
  // Rider: legs forward, coat, arms on the sides, head with hat at the back.
  g.fillStyle(0x2b2d42, 1);
  g.fillRoundedRect(22, 9, 14, 5, 2);
  g.fillRoundedRect(22, 16, 14, 5, 2);
  g.fillStyle(coat, 1);
  g.fillEllipse(17, 15, 18, 20);
  g.fillStyle(Phaser.Display.Color.IntegerToColor(coat).darken(25).color, 1);
  g.fillEllipse(19, 6, 8, 5);
  g.fillEllipse(19, 24, 8, 5);
  g.fillStyle(0xf1c27d, 1);
  g.fillCircle(11, 15, 6);
  g.fillStyle(Phaser.Display.Color.IntegerToColor(coat).lighten(15).color, 1);
  g.fillEllipse(10, 15, 10, 12);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(6, 15, 3);
}

/** A fir seen from above: star-shaped layers of branches, heavy with snow. */
function drawFir(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number): void {
  g.fillStyle(0x0f1a2e, 0.35);
  g.fillCircle(cx + 4, cy + 5, r * 0.92);
  const layers: [number, number, number][] = [
    [1, COLORS.fir, 0],
    [0.74, COLORS.firMid, 0.4],
    [0.48, COLORS.firLight, 0.8],
  ];
  for (const [scale, color, twist] of layers) {
    const points: { x: number; y: number }[] = [];
    const spikes = 9;
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2 + twist;
      const rr = r * scale * (i % 2 === 0 ? 1 : 0.68);
      points.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
    }
    g.fillStyle(color, 1);
    g.fillPoints(points, true);
    // Snow on the tips of this layer.
    g.fillStyle(COLORS.snowbank, 0.92);
    for (let i = 0; i < spikes; i += 2) {
      const a = (i / spikes) * Math.PI * 2 + twist + 0.2;
      g.fillEllipse(cx + Math.cos(a) * r * scale * 0.72, cy + Math.sin(a) * r * scale * 0.72, r * scale * 0.34, r * scale * 0.22);
    }
  }
  g.fillStyle(0xffffff, 1);
  g.fillCircle(cx - 1, cy - 1, r * 0.13);
}

/** A log cabin seen from above: a snowy roof with a ridge, a chimney, light spilling from the windows. */
function drawCabin(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(0x0f1a2e, 0.35);
  g.fillRect(14, 14, 90, 68);
  // Walls peeking out under the eaves, with lit windows.
  g.fillStyle(COLORS.woodDark, 1);
  g.fillRect(6, 6, 96, 72);
  g.fillStyle(COLORS.warm, 1);
  for (const x of [20, 46, 72]) {
    g.fillRect(x, 4, 14, 5);
    g.fillRect(x, 75, 14, 5);
  }
  // Roof: two slopes, snow-covered, the ridge along the middle.
  g.fillStyle(COLORS.snow, 1);
  g.fillRect(10, 10, 88, 31);
  g.fillStyle(COLORS.snowShade, 1);
  g.fillRect(10, 41, 88, 31);
  g.fillStyle(COLORS.woodLight, 1);
  g.fillRect(8, 39, 92, 4);
  // Chimney with a warm glow on top.
  g.fillStyle(0x5a3a2a, 1);
  g.fillRect(70, 18, 12, 12);
  g.fillStyle(COLORS.warmDeep, 1);
  g.fillRect(73, 21, 6, 6);
}
