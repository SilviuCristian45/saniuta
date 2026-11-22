import Phaser from 'phaser';
import { computeAwards, computeStandings, type GameState, type NewRecord } from '@saniuta/shared';
import { isTouch } from '../device';
import { reducedEffects } from '../settings';
import { AWARD_TEXT } from '../ui/awards';
import { recordsLine } from '../ui/records';
import { COLORS, PLAYER_COLORS, hexColor } from './colors';
import { formatTime } from './format';
import { snowConfetti } from './fx';
import { FONT, GAME_H, GAME_W, HUD_DEPTH } from './layout';
import { TEX } from './textures';

// End of the match (as in Bombe și Petarde and Mașinuțe): the top three slide up onto a 2-1-3
// podium one after the other (third, second, then the winner with snow confetti in their color),
// then the full table and the awards. Records from the all-time leaderboard appear on top as soon
// as the server sends them. Drawn on the HUD layer (`add`), so the world camera never moves it.

type AddToHud = <T extends Phaser.GameObjects.GameObject>(obj: T) => T;

/** Phones are seen from further away: everything a bit bigger. */
const K = isTouch ? 1.2 : 1;
const DEPTH = HUD_DEPTH.overlay + 10;
const BASE_Y = 500;
const PODIUM_CX = Math.round(GAME_W * 0.25);
const STEP_W = 120;
/** Index = place - 1: x offset from PODIUM_CX and step height. */
const STEPS = [
  { dx: 0, h: 170 },
  { dx: -STEP_W - 8, h: 118 },
  { dx: STEP_W + 8, h: 82 },
];
const RISE_MS = 650;
/** Third place starts, then second, then first. */
const RISE_DELAYS = [2000, 1100, 300];
const TABLE_DELAY = 3000;
const TABLE_X = Math.round(GAME_W * 0.5);
const TABLE_W = GAME_W - 50 - TABLE_X;
const TABLE_Y = 140;
const ROW_H = 32 * K;
const BUTTON_Y = GAME_H - 56;

export interface PodiumOptions {
  me: string;
  /** Online matches may set all-time records; offline ones get a note that they do not count. */
  online: boolean;
  /** Test URL options: no note, and the button starts a new local match. */
  testMatch: boolean;
  /** Enter or a tap on the button: a new match (test) or back to the lobby (host). */
  onContinue: () => void;
}

export class Podium {
  private readonly parts: Phaser.GameObjects.GameObject[] = [];
  private readonly rows: { place: Phaser.GameObjects.Text; name: Phaser.GameObjects.Text; stats: Phaser.GameObjects.Text[] }[] = [];
  private readonly button: Phaser.GameObjects.Text;
  private readonly waitText: Phaser.GameObjects.Text;
  /** Records once the server has saved the last run, or the offline note. */
  private readonly recordText: Phaser.GameObjects.Text;
  private recordsShown: readonly NewRecord[] | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly addHud: AddToHud,
    state: Readonly<GameState>,
    private readonly opts: PodiumOptions,
  ) {
    this.add(scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x141b33, 0.94).setInteractive());
    this.add(
      scene.add
        .text(GAME_W / 2, 46, 'Gata meciul!', { fontFamily: FONT, fontSize: `${Math.round(40 * K)}px`, fontStyle: 'bold', color: COLORS.gold, stroke: COLORS.outline, strokeThickness: 7 })
        .setOrigin(0.5),
    );
    this.recordText = this.add(
      scene.add
        .text(GAME_W / 2, 92, '', { fontFamily: FONT, fontSize: `${Math.round(19 * K)}px`, fontStyle: 'bold', color: COLORS.gold, align: 'center', wordWrap: { width: GAME_W - 120 } })
        .setOrigin(0.5),
    );

    computeStandings(state as GameState)
      .slice(0, 3)
      .forEach((id, place) => this.addStep(state, id, place));
    this.addTable(state);
    this.addAwards(state);

    this.button = this.add(
      scene.add
        .text(GAME_W / 2, BUTTON_Y, '', {
          fontFamily: FONT,
          fontSize: `${Math.round(22 * K)}px`,
          fontStyle: 'bold',
          color: '#2a1a10',
          backgroundColor: '#ffb347',
          padding: { x: 22, y: 10 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true }),
    );
    this.button.on('pointerdown', () => opts.onContinue());
    this.waitText = this.add(
      scene.add
        .text(GAME_W / 2, BUTTON_Y, 'Așteaptă ca hostul să pornească încă un meci.', { fontFamily: FONT, fontSize: `${Math.round(17 * K)}px`, color: COLORS.textDim, align: 'center' })
        .setOrigin(0.5),
    );
    this.update(state, []);
  }

  /** Keeps the table and the host's button current (players may leave, the host may change). */
  update(state: Readonly<GameState>, records: readonly NewRecord[]): void {
    this.syncTable(state);
    if (records !== this.recordsShown) this.showRecords(records);
    const enter = isTouch ? '' : ' (Enter)';
    const canContinue = this.opts.testMatch || state.hostId === this.opts.me;
    if (this.button.text !== `Încă un meci${enter}`) this.button.setText(`Încă un meci${enter}`);
    this.button.setVisible(canContinue);
    this.waitText.setVisible(!canContinue);
  }

  destroy(): void {
    for (const part of this.parts) part.destroy();
  }

  private add<T extends Phaser.GameObjects.GameObject & { setDepth(d: number): unknown }>(obj: T, depth = DEPTH): T {
    obj.setDepth(depth);
    this.addHud(obj);
    this.parts.push(obj);
    return obj;
  }

  /** Mine first; offline, a note that it does not count. */
  private showRecords(records: readonly NewRecord[]): void {
    this.recordsShown = records;
    if (!this.opts.online) {
      this.recordText.setText(this.opts.testMatch ? '' : 'Meciurile offline nu intră în clasament.').setColor(COLORS.textDim);
      return;
    }
    const line = recordsLine(records, this.opts.me);
    this.recordText.setText(line);
    if (line && !reducedEffects()) {
      this.scene.tweens.add({ targets: this.recordText, scale: { from: 1.4, to: 1 }, duration: 400, ease: 'Back.easeOut' });
    }
  }

  private addStep(state: Readonly<GameState>, id: string, place: number): void {
    const scene = this.scene;
    const p = state.players[id]!;
    const color = PLAYER_COLORS[p.slot]!;
    const { dx, h } = STEPS[place]!;
    const x = PODIUM_CX + dx;
    const delay = RISE_DELAYS[place]!;
    const reduced = reducedEffects();

    // A snowy wooden step.
    const step = this.add(scene.add.rectangle(x, BASE_Y, STEP_W, h, 0x6b4423).setOrigin(0.5, 1).setStrokeStyle(3, color));
    const cap = this.add(scene.add.rectangle(x, BASE_Y - h, STEP_W + 6, 12, 0xf2f6ff).setOrigin(0.5, 0.5));
    const number = this.add(
      scene.add
        .text(x, BASE_Y - h / 2, String(place + 1), { fontFamily: FONT, fontSize: `${Math.round(46 * K)}px`, fontStyle: 'bold', color: COLORS.gold, stroke: COLORS.outline, strokeThickness: 5 })
        .setOrigin(0.5)
        .setAlpha(0),
    );
    // The sled drawn pointing right; facing up the podium it stands nose up.
    const sled = this.add(scene.add.image(x, BASE_Y - h - 30, TEX.sled(p.slot)).setScale(1.8).setRotation(-Math.PI / 2).setAlpha(0));
    const name = this.add(
      scene.add
        .text(x, BASE_Y - h - 80, p.name, { fontFamily: FONT, fontSize: `${Math.round(18 * K)}px`, fontStyle: 'bold', color: hexColor(color), stroke: COLORS.outline, strokeThickness: 4 })
        .setOrigin(0.5)
        .setAlpha(0),
    );

    step.scaleY = 0;
    cap.setAlpha(0);
    scene.tweens.add({ targets: step, scaleY: 1, delay, duration: RISE_MS, ease: reduced ? 'Quad.easeOut' : 'Back.easeOut' });
    scene.tweens.add({ targets: [cap, number], alpha: 1, delay: delay + RISE_MS * 0.6, duration: 250 });
    // The sled slides up onto its step (reduced effects: it just fades in).
    scene.tweens.add({
      targets: sled,
      alpha: 1,
      y: reduced ? sled.y : { from: sled.y + 40, to: sled.y },
      delay: delay + RISE_MS,
      duration: 380,
      ease: reduced ? 'Linear' : 'Bounce.easeOut',
    });
    scene.tweens.add({ targets: name, alpha: 1, delay: delay + RISE_MS, duration: 300 });

    if (place === 0) {
      // Snow confetti in the winner's color, a few volleys over the podium (fewer with reduced effects).
      const volleys = reduced ? 2 : 7;
      const flakes = reduced ? 14 : 34;
      for (let i = 0; i < volleys; i++) {
        scene.time.delayedCall(delay + RISE_MS + i * 420, () => {
          snowConfetti(scene, this.addHud, PODIUM_CX + Phaser.Math.Between(-170, 170), BASE_Y - 200 + Phaser.Math.Between(-30, 30), color, DEPTH + 0.5, flakes);
        });
      }
    }
  }

  /** Every player: place, name, points, runs won, best time. */
  private addTable(state: Readonly<GameState>): void {
    const scene = this.scene;
    const size = `${Math.round(18 * K)}px`;
    const cols = [TABLE_W - 190 * K, TABLE_W - 110 * K, TABLE_W];
    const items: Phaser.GameObjects.Text[] = [];
    const head = (x: number, text: string, origin: number) =>
      this.add(scene.add.text(TABLE_X + x, TABLE_Y, text, { fontFamily: FONT, fontSize: `${Math.round(14 * K)}px`, color: COLORS.textDim }).setOrigin(origin, 0));
    items.push(head(0, 'Loc', 0), head(40 * K, 'Săniuța', 0), head(cols[0]!, 'Puncte', 1), head(cols[1]!, 'Manșe', 1), head(cols[2]!, 'Cel mai bun', 1));
    const count = Object.keys(state.players).length;
    for (let i = 0; i < count; i++) {
      const y = TABLE_Y + 28 * K + i * ROW_H;
      const text = (x: number, origin: number) =>
        this.add(scene.add.text(TABLE_X + x, y, '', { fontFamily: FONT, fontSize: size, fontStyle: 'bold', color: COLORS.text }).setOrigin(origin, 0));
      const row = { place: text(0, 0), name: text(40 * K, 0), stats: cols.map((x) => text(x, 1)) };
      this.rows.push(row);
      items.push(row.place, row.name, ...row.stats);
    }
    for (const item of items) item.setAlpha(0);
    scene.tweens.add({ targets: items, alpha: 1, delay: TABLE_DELAY, duration: 500 });
  }

  private syncTable(state: Readonly<GameState>): void {
    const ids = computeStandings(state as GameState);
    this.rows.forEach((row, i) => {
      const p = ids[i] !== undefined ? state.players[ids[i]!] : undefined;
      for (const t of [row.place, row.name, ...row.stats]) t.setVisible(!!p);
      if (!p) return;
      const color = p.id === this.opts.me ? COLORS.gold : hexColor(PLAYER_COLORS[p.slot]!);
      row.place.setText(String(i + 1));
      row.name.setText(`${p.name}${p.id === this.opts.me ? ' (tu)' : ''}${p.left ? ' · a plecat' : ''}`).setColor(color);
      [String(p.points), String(p.wins), p.bestTicks > 0 ? formatTime(p.bestTicks) : '-'].forEach((v, k) => row.stats[k]!.setText(v));
    });
  }

  private addAwards(state: Readonly<GameState>): void {
    const awards = computeAwards(state);
    if (awards.length === 0) return;
    const scene = this.scene;
    const top = TABLE_Y + 28 * K + Object.keys(state.players).length * ROW_H + 22;
    const size = `${Math.round(15 * K)}px`;
    const items: Phaser.GameObjects.Text[] = [this.add(scene.add.text(TABLE_X, top, 'Premii', { fontFamily: FONT, fontSize: `${Math.round(14 * K)}px`, color: COLORS.textDim }))];
    // Each row as tall as its text: a long one wraps and pushes the next one down.
    let y = top + 22 * K;
    for (const award of awards) {
      const text = AWARD_TEXT[award.id];
      const names = award.playerIds.map((id) => state.players[id]!.name).join(', ');
      const title = this.add(scene.add.text(TABLE_X, y, `★ ${text.title}`, { fontFamily: FONT, fontSize: size, fontStyle: 'bold', color: COLORS.gold }));
      const rest = this.add(
        scene.add.text(TABLE_X + 150 * K, y, `${names} · ${text.detail(award.value)}`, { fontFamily: FONT, fontSize: size, color: COLORS.text, wordWrap: { width: TABLE_W - 150 * K } }),
      );
      items.push(title, rest);
      y += Math.max(title.height, rest.height) + 4 * K;
    }
    for (const item of items) item.setAlpha(0);
    scene.tweens.add({ targets: items, alpha: 1, delay: TABLE_DELAY + 300, duration: 500 });
  }
}
