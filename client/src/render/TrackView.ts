import Phaser from 'phaser';
import {
  OBSTACLE_TREE,
  ROW_LEN,
  SURFACE_ICE,
  centerAt,
  halfWidthAt,
  hash32,
  type GameState,
  type Patch,
  type Track,
} from '@saniuta/shared';
import { COLORS } from './colors';
import { DEPTH, FONT, px, sortDepth } from './layout';
import { TEX } from './textures';

// The slope, drawn once per track in chunks of CHUNK_ROWS rows; only the chunks near the camera are
// shown. Ground (snow, grooming lines, steep stretches, ice, deep snow, snowbanks, start and finish)
// is a Graphics per chunk; trees, rocks, ramps, piles and the scenery beside the track are images.

const CHUNK_ROWS = 24;
/** Scenery beside the track: firs from the snowbank out to this far. */
const FOREST_DEPTH = 520;
/** Fir images are drawn this much smaller than their texture (a tree's canopy over its trunk hitbox). */
const OBSTACLE_FIR_SCALE = 0.78;

/** Anything added to the world (the scene puts it on the world layer, so only the world camera draws it). */
export type AddToWorld = <T extends Phaser.GameObjects.GameObject>(obj: T) => T;

interface Chunk {
  y0: number;
  y1: number;
  objects: (Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Visible)[];
  visible: boolean;
}

export class TrackView {
  readonly track: Track;
  private readonly chunks: Chunk[] = [];
  /** Pile images by pile index (hidden while a pile is gone). */
  private readonly piles: Phaser.GameObjects.Image[] = [];
  private readonly lights: Phaser.GameObjects.Image[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    track: Track,
    private readonly add: AddToWorld,
    reduced: boolean,
  ) {
    this.track = track;
    const rows = track.rowCount;
    for (let r0 = 0; r0 < rows - 1; r0 += CHUNK_ROWS) {
      const r1 = Math.min(rows - 1, r0 + CHUNK_ROWS);
      const chunk: Chunk = { y0: px(r0 * ROW_LEN), y1: px(r1 * ROW_LEN), objects: [], visible: true };
      this.chunks.push(chunk);
      this.drawGround(chunk, r0, r1);
      this.drawScenery(chunk, r0, r1, reduced);
    }
    for (const o of track.obstacles) {
      const tree = o.kind === OBSTACLE_TREE;
      const img = this.scene.add.image(px(o.x), px(o.y), tree ? TEX.fir : TEX.rock).setDepth(sortDepth(px(o.y))).setScale(tree ? 1 : 1.15);
      if (tree) img.setScale(OBSTACLE_FIR_SCALE).setRotation(hash32(o.x, o.y) % 628 / 100);
      this.place(img, px(o.y));
    }
    for (const r of track.ramps) {
      const img = this.scene.add.image(px((r.x0 + r.x1) / 2), px((r.y0 + r.y1) / 2), TEX.ramp).setDepth(DEPTH.ramps);
      img.setDisplaySize(px(r.x1 - r.x0) + 4, px(r.y1 - r.y0) + 6);
      this.place(img, img.y);
    }
    track.piles.forEach((p) => {
      const img = this.scene.add.image(px(p.x), px(p.y), TEX.pile).setDepth(DEPTH.piles);
      this.piles.push(img);
      this.place(img, img.y);
    });
  }

  /** Shows the chunks near the camera's view, hides the rest; piles follow the state. */
  update(view: Phaser.Geom.Rectangle, state: Readonly<GameState>, time: number): void {
    const margin = 300;
    for (const chunk of this.chunks) {
      const show = chunk.y1 > view.y - margin && chunk.y0 < view.bottom + margin;
      if (show === chunk.visible) continue;
      chunk.visible = show;
      for (const obj of chunk.objects) obj.setVisible(show);
    }
    this.piles.forEach((img, i) => {
      if (!img.visible && (state.pileTimers[i] ?? 0) === 0 && this.chunkVisible(img.y)) img.setVisible(true);
      else if (img.visible && (state.pileTimers[i] ?? 0) > 0) img.setVisible(false);
    });
    // Cabin and lamp lights breathe a little.
    const flicker = 0.85 + 0.15 * Math.sin(time / 400);
    for (const light of this.lights) if (light.visible) light.setAlpha(flicker);
  }

  private chunkVisible(y: number): boolean {
    return this.chunks.some((c) => c.visible && y >= c.y0 && y < c.y1);
  }

  /** Registers an object with the chunk its y falls in (hidden and shown with it), on the world layer. */
  private place<T extends Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Visible>(obj: T, y: number): T {
    const chunk = this.chunks.find((c) => y >= c.y0 && y < c.y1) ?? this.chunks[this.chunks.length - 1]!;
    chunk.objects.push(obj);
    this.add(obj);
    return obj;
  }

  private edge(r: number, side: -1 | 1, extra = 0): { x: number; y: number } {
    const t = this.track;
    return { x: px(t.center[r]! + side * t.half[r]!) + side * extra, y: px(r * ROW_LEN) };
  }

  private drawGround(chunk: Chunk, r0: number, r1: number): void {
    const t = this.track;
    const g = this.scene.add.graphics().setDepth(DEPTH.ground);
    chunk.objects.push(g);
    this.add(g);
    const rows: number[] = [];
    for (let r = r0; r <= r1; r++) rows.push(r);

    // The groomed track.
    g.fillStyle(COLORS.snow, 1);
    g.fillPoints([...rows.map((r) => this.edge(r, -1)), ...rows.reverse().map((r) => this.edge(r, 1))], true);
    rows.reverse();

    // Steep stretches are shaded (they are fast).
    for (let r = r0; r < r1; r++) {
      const steep = t.slope[r]! - 118;
      if (steep <= 0) continue;
      g.fillStyle(COLORS.snowShade, Math.min(0.8, steep / 50));
      g.fillPoints([this.edge(r, -1), this.edge(r + 1, -1), this.edge(r + 1, 1), this.edge(r, 1)], true);
    }

    // Grooming lines along the track.
    g.lineStyle(1, COLORS.snowShade, 0.7);
    for (const f of [-0.66, -0.33, 0, 0.33, 0.66]) {
      g.beginPath();
      rows.forEach((r, i) => {
        const x = px(t.center[r]! + t.half[r]! * f);
        const y = px(r * ROW_LEN);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.strokePath();
    }

    for (const patch of t.patches) {
      const y0 = Math.max(patch.y0, r0 * ROW_LEN);
      const y1 = Math.min(patch.y1, r1 * ROW_LEN);
      if (y1 > y0) this.drawPatch(g, patch, y0, y1);
    }

    // Snowbanks along both edges, with lumps and a shadow on the outside.
    for (const side of [-1, 1] as const) {
      g.lineStyle(14, COLORS.snowbankShadow, 0.6);
      g.strokePoints(rows.map((r) => this.edge(r, side, 7)));
      g.lineStyle(10, COLORS.snowbank, 1);
      g.strokePoints(rows.map((r) => this.edge(r, side, 2)));
      g.fillStyle(COLORS.snowbank, 1);
      for (let r = r0; r < r1; r++) {
        const e = this.edge(r, side, 4);
        const h = hash32(r, side + 5);
        g.fillCircle(e.x + side * (h % 5), e.y + (h % 17), 6 + (h % 4));
      }
    }

    // Start and finish lines: a checkered band across.
    for (const [y, label] of [
      [t.startY, 'START'],
      [t.finishY, 'SOSIRE'],
    ] as const) {
      const r = Math.floor(y / ROW_LEN);
      if (r < r0 || r >= r1) continue;
      const c = px(centerAt(t, y));
      const h = px(halfWidthAt(t, y));
      const cell = 12;
      for (let i = 0; i * cell < 2 * h; i++) {
        for (let j = 0; j < 2; j++) {
          g.fillStyle((i + j) % 2 === 0 ? 0x1b2440 : 0xffffff, 0.9);
          g.fillRect(c - h + i * cell, px(y) - cell + j * cell, Math.min(cell, 2 * h - i * cell), cell);
        }
      }
      // Poles and a banner.
      g.fillStyle(COLORS.woodDark, 1);
      g.fillCircle(c - h - 14, px(y), 6);
      g.fillCircle(c + h + 14, px(y), 6);
      const text = this.scene.add
        .text(c, px(y) + 42, label, { fontFamily: FONT, fontSize: '34px', fontStyle: 'bold', color: '#e63946', stroke: '#ffffff', strokeThickness: 6 })
        .setOrigin(0.5)
        .setDepth(DEPTH.ground + 0.5);
      chunk.objects.push(text);
      this.add(text);
    }
  }

  private drawPatch(g: Phaser.GameObjects.Graphics, patch: Patch, y0: number, y1: number): void {
    const t = this.track;
    const steps: number[] = [];
    for (let y = y0; y < y1; y += ROW_LEN / 2) steps.push(y);
    steps.push(y1);
    const at = (y: number, f: number) => ({ x: px(centerAt(t, y) + (halfWidthAt(t, y) * f) / 1000), y: px(y) });
    const ice = patch.kind === SURFACE_ICE;
    g.fillStyle(ice ? COLORS.ice : COLORS.deep, ice ? 0.75 : 1);
    g.fillPoints([...steps.map((y) => at(y, patch.lo)), ...[...steps].reverse().map((y) => at(y, patch.hi))], true);
    if (ice) {
      // Glints across the ice.
      g.lineStyle(2, COLORS.iceStreak, 0.8);
      for (let y = y0; y < y1; y += ROW_LEN) {
        const h = hash32(y, patch.lo);
        const f = patch.lo + (h % Math.max(1, patch.hi - patch.lo));
        const p = at(y, f);
        g.lineBetween(p.x - 10, p.y + 4, p.x + 12, p.y - 6);
      }
    } else {
      // Lumpy powder.
      for (let y = y0; y < y1; y += ROW_LEN / 3) {
        const h = hash32(y, patch.hi);
        const f = patch.lo + (h % Math.max(1, patch.hi - patch.lo));
        const p = at(y, f);
        g.fillStyle(COLORS.deepLump, 0.8);
        g.fillEllipse(p.x + 2, p.y + 3, 22, 10);
        g.fillStyle(0xffffff, 1);
        g.fillEllipse(p.x, p.y, 22, 10);
      }
    }
  }

  /** Firs beside the track, a cabin with lit windows now and then, lamps along the snowbank. */
  private drawScenery(chunk: Chunk, r0: number, r1: number, reduced: boolean): void {
    const t = this.track;
    const forestStep = reduced ? 2 : 1;
    for (let r = r0; r < r1; r += forestStep) {
      for (const side of [-1, 1] as const) {
        const h = hash32(t.seed, r, side + 3);
        // A cabin every so often, set back from the snowbank, its windows lighting the snow.
        if (h % 41 === 0 && r > 10) {
          const e = this.edge(r, side, 150);
          const cabin = this.scene.add.image(e.x, e.y, TEX.cabin).setDepth(sortDepth(e.y)).setRotation(side * 0.06);
          chunk.objects.push(cabin);
          this.add(cabin);
          const glow = this.scene.add.image(e.x, e.y, TEX.glow).setScale(2.4).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.lights);
          chunk.objects.push(glow);
          this.add(glow);
          this.lights.push(glow);
          continue;
        }
        const trees = 2 + (h % 3);
        for (let k = 0; k < trees; k++) {
          const hk = hash32(h, k);
          const d = 30 + (hk % FOREST_DEPTH);
          const e = this.edge(r, side, d);
          const y = e.y + ((hk >>> 8) % ROW_LEN) / 256;
          const tree = this.scene.add
            .image(e.x, y, d < 120 ? TEX.firSmall : TEX.fir)
            .setScale(0.7 + ((hk >>> 4) % 60) / 100)
            .setRotation(((hk >>> 12) % 628) / 100)
            .setDepth(sortDepth(y));
          chunk.objects.push(tree);
          this.add(tree);
        }
      }
      // Lamps on alternating sides, every few rows.
      if (r % 9 === 0 && r > 4) {
        const side = r % 18 === 0 ? -1 : 1;
        const e = this.edge(r, side, 20);
        const lamp = this.scene.add.image(e.x, e.y, TEX.lamp).setDepth(sortDepth(e.y));
        const glow = this.scene.add.image(e.x, e.y, TEX.glow).setScale(1.6).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.lights);
        chunk.objects.push(lamp, glow);
        this.add(lamp);
        this.add(glow);
        this.lights.push(glow);
      }
    }
  }

  destroy(): void {
    for (const chunk of this.chunks) for (const obj of chunk.objects) obj.destroy();
    this.chunks.length = 0;
  }
}
