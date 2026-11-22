import Phaser from 'phaser';
import { Snowfall } from '../render/Snowfall';
import { GAME_H, GAME_W } from '../render/layout';
import { TEX } from '../render/textures';
import { PLAYER_COLORS } from '../render/colors';
import { reducedEffects } from '../settings';

// The Carpathians at dusk behind the HTML screens (intro, name, menu, lobby), seen from the side:
// a violet-to-orange sky with the last of the sun, three ridges of snowy peaks, fir forests, a
// cabin with lit windows on the slope, falling snow, and now and then a sled sliding down.
// "Efecte reduse" keeps it still (no sleds, fewer flakes).

const SKY_KEY = 'backdrop-sky';
const SLED_EVERY_MS = 4200;

export function drawBackdrop(scene: Phaser.Scene): void {
  ensureSky(scene);
  scene.add.image(GAME_W / 2, GAME_H / 2, SKY_KEY).setDisplaySize(GAME_W, GAME_H);
  const still = reducedEffects();
  const rnd = new Phaser.Math.RandomDataGenerator(['saniuta']);

  // The first stars above the dusk.
  for (let i = 0; i < 70; i++) {
    const star = scene.add.circle(rnd.between(0, GAME_W), rnd.between(0, GAME_H * 0.32), rnd.realInRange(0.5, 1.4), 0xfff4d6, rnd.realInRange(0.3, 0.9));
    if (still) continue;
    scene.tweens.add({ targets: star, alpha: 0.15, duration: rnd.between(1200, 3000), yoyo: true, repeat: -1, delay: rnd.between(0, 2000) });
  }

  // The sun going down behind the far ridge.
  const sun = scene.add.graphics();
  sun.fillStyle(0xffb36b, 0.18).fillCircle(GAME_W * 0.68, GAME_H * 0.5, 120);
  sun.fillStyle(0xffc98a, 0.35).fillCircle(GAME_W * 0.68, GAME_H * 0.5, 70);
  sun.fillStyle(0xffe2b0, 1).fillCircle(GAME_W * 0.68, GAME_H * 0.5, 42);

  ridge(scene, rnd, GAME_H * 0.5, 150, 7, 0x6a5a9e, 0xd9cdf0);
  ridge(scene, rnd, GAME_H * 0.6, 120, 5, 0x4a3f7a, 0xc4bce6);
  forest(scene, rnd, GAME_H * 0.66, 0x2b2650, 26);
  ridge(scene, rnd, GAME_H * 0.72, 80, 4, 0x2f2a58, 0xb5b2dc);
  forest(scene, rnd, GAME_H * 0.78, 0x1c1a3a, 36);

  // The slope in front: snow in the evening light, from upper left down to the lower right.
  const slope = scene.add.graphics();
  slope.fillStyle(0xcfd6f0, 1);
  slope.fillPoints(slopePoints(0), true);
  slope.fillStyle(0xe8ecfb, 1);
  slope.fillPoints(slopePoints(10), true);
  // Grooming lines down the slope.
  slope.lineStyle(2, 0xc2cbe8, 0.8);
  for (let i = 1; i < 6; i++) {
    const off = 18 + i * 22;
    slope.beginPath();
    slope.moveTo(0, slopeY(0) + off);
    slope.lineTo(GAME_W, slopeY(GAME_W) + off);
    slope.strokePath();
  }

  cabin(scene, GAME_W * 0.12, slopeY(GAME_W * 0.12) + 8);
  for (const x of [0.04, 0.22, 0.27, 0.86, 0.93, 0.98]) fir(scene, GAME_W * x, slopeY(GAME_W * x) + 14, 38 + rnd.between(0, 22), 0x1e4637);

  snowfall(scene, still);
  if (!still) sledsGoingDown(scene);
}

/** Night above, violet in the middle, the orange glow of the sunset at the horizon. */
function ensureSky(scene: Phaser.Scene): void {
  if (scene.textures.exists(SKY_KEY)) return;
  const tex = scene.textures.createCanvas(SKY_KEY, 256, 256)!;
  const g = tex.getContext();
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#141b3d');
  sky.addColorStop(0.3, '#3a2d6b');
  sky.addColorStop(0.5, '#8a4f8f');
  sky.addColorStop(0.62, '#e0806a');
  sky.addColorStop(0.75, '#ffb36b');
  sky.addColorStop(1, '#ffd29a');
  g.fillStyle = sky;
  g.fillRect(0, 0, 256, 256);
  tex.refresh();
}

/** A ridge of peaks with snowy tops along y = base (peaks up to `height` above it). */
function ridge(scene: Phaser.Scene, rnd: Phaser.Math.RandomDataGenerator, base: number, height: number, peaks: number, color: number, snow: number): void {
  const g = scene.add.graphics();
  const step = GAME_W / peaks;
  const tops: { x: number; y: number }[] = [];
  for (let i = -1; i <= peaks + 1; i++) tops.push({ x: i * step + rnd.realInRange(-step * 0.25, step * 0.25), y: base - rnd.realInRange(height * 0.45, height) });
  const pts: { x: number; y: number }[] = [{ x: -step, y: GAME_H }];
  tops.forEach((t, i) => {
    pts.push(t);
    const next = tops[i + 1];
    if (next) pts.push({ x: (t.x + next.x) / 2, y: base - rnd.realInRange(0, height * 0.3) });
  });
  pts.push({ x: GAME_W + step, y: GAME_H });
  g.fillStyle(color, 1).fillPoints(pts, true);
  // Snow caps: a small jagged triangle at every peak.
  g.fillStyle(snow, 1);
  for (const t of tops) {
    const w = height * 0.32;
    const h = height * 0.22;
    g.fillPoints(
      [
        { x: t.x, y: t.y },
        { x: t.x + w * 0.5, y: t.y + h },
        { x: t.x + w * 0.2, y: t.y + h * 0.8 },
        { x: t.x, y: t.y + h * 1.05 },
        { x: t.x - w * 0.25, y: t.y + h * 0.75 },
        { x: t.x - w * 0.5, y: t.y + h },
      ],
      true,
    );
  }
}

/** A band of fir silhouettes standing on y = base, down to the bottom of the screen. */
function forest(scene: Phaser.Scene, rnd: Phaser.Math.RandomDataGenerator, base: number, color: number, size: number): void {
  const g = scene.add.graphics();
  g.fillStyle(color, 1).fillRect(0, base, GAME_W, GAME_H - base);
  for (let x = -10; x < GAME_W + 20; x += size * rnd.realInRange(0.45, 0.8)) {
    const h = size * rnd.realInRange(1.2, 2.1);
    const y = base + rnd.realInRange(-4, 8);
    g.fillTriangle(x, y - h, x - h * 0.32, y + 2, x + h * 0.32, y + 2);
  }
}

/** One fir in the foreground: three tiers with snow on the branches. */
function fir(scene: Phaser.Scene, x: number, y: number, h: number, color: number): void {
  const g = scene.add.graphics();
  g.fillStyle(0x4a2f1a, 1).fillRect(x - 3, y - h * 0.15, 6, h * 0.18);
  for (let i = 0; i < 3; i++) {
    const top = y - h + i * h * 0.25;
    const w = h * (0.28 + i * 0.1);
    g.fillStyle(color, 1).fillTriangle(x, top, x - w, top + h * 0.45, x + w, top + h * 0.45);
    g.fillStyle(0xeef2ff, 0.9).fillTriangle(x, top, x - w * 0.35, top + h * 0.16, x + w * 0.35, top + h * 0.16);
  }
}

/** A wooden cabin with a snowy roof and warm windows. */
function cabin(scene: Phaser.Scene, x: number, y: number): void {
  const g = scene.add.graphics();
  g.fillStyle(0x6b4423, 1).fillRect(x - 46, y - 52, 92, 52);
  g.lineStyle(2, 0x4a2f1a, 1);
  for (let i = 1; i < 5; i++) g.lineBetween(x - 46, y - 52 + i * 10.4, x + 46, y - 52 + i * 10.4);
  g.fillStyle(0xf6f9ff, 1).fillTriangle(x, y - 98, x - 60, y - 48, x + 60, y - 48);
  g.fillStyle(0x3a2a40, 1).fillTriangle(x, y - 88, x - 44, y - 52, x + 44, y - 52);
  g.fillStyle(0xffc46b, 1).fillRect(x - 30, y - 38, 18, 16).fillRect(x + 12, y - 38, 18, 16);
  g.fillStyle(0x6b4423, 1).fillRect(x - 22, y - 38, 2, 16).fillRect(x + 20, y - 38, 2, 16);
  const glow = scene.add.image(x, y - 30, TEX.glow).setScale(1.6).setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({ targets: glow, alpha: 0.75, duration: 1400, yoyo: true, repeat: -1 });
}

/** The front slope's top edge: higher on the left, going down to the right. */
function slopeY(x: number): number {
  return GAME_H * 0.8 + (x / GAME_W) * GAME_H * 0.12 - Math.sin((x / GAME_W) * Math.PI) * 18;
}

function slopePoints(lift: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [{ x: 0, y: GAME_H }];
  for (let x = 0; x <= GAME_W; x += 40) pts.push({ x, y: slopeY(x) + lift });
  pts.push({ x: GAME_W, y: GAME_H });
  return pts;
}

/** Every few seconds a sled in a random color slides down the front slope, left to right. */
function sledsGoingDown(scene: Phaser.Scene): void {
  let slot = 0;
  const send = () => {
    const sled = scene.add.image(-40, 0, TEX.sled(slot % PLAYER_COLORS.length)).setScale(1.1);
    slot += 1 + Math.floor(Math.random() * 3);
    const lane = 26 + Math.random() * 60;
    const dur = 3600 + Math.random() * 1800;
    scene.tweens.addCounter({
      from: -40,
      to: GAME_W + 40,
      duration: dur,
      ease: 'Sine.easeIn',
      onUpdate: (tw) => {
        const x = tw.getValue() ?? 0;
        const dx = 4;
        const angle = Math.atan2(slopeY(x + dx) - slopeY(x), dx);
        // Seen a little from above: the sled is drawn pointing right, tilted with the slope.
        sled.setPosition(x, slopeY(x) + lane).setRotation(angle);
      },
      onComplete: () => sled.destroy(),
    });
  };
  send();
  scene.time.addEvent({ delay: SLED_EVERY_MS, loop: true, callback: send });
}

/** The game's snowfall, standing still (no camera to drift against). */
function snowfall(scene: Phaser.Scene, still: boolean): void {
  const snow = new Snowfall(scene, (obj) => obj, still ? 30 : 90);
  const tick = (time: number, delta: number) => snow.update(delta, time, 0, 0);
  scene.events.on(Phaser.Scenes.Events.UPDATE, tick);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.UPDATE, tick));
}
