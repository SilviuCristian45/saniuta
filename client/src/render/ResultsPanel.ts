import Phaser from 'phaser';
import { TICK_RATE, lateFinishPoints, POINTS_BY_PLACE, trackName, type GameState } from '@saniuta/shared';
import { COLORS, PLAYER_COLORS, hexColor } from './colors';
import { FONT, GAME_H, GAME_W, HUD_DEPTH } from './layout';
import { formatTime } from './format';

type AddToHud = <T extends Phaser.GameObjects.GameObject>(obj: T) => T;

const ROW_H = 34;
const WIDTH = 640;

/**
 * Between runs: everyone's place, time and points for the run, and the leaderboard news. The end of
 * the match is the podium's (Podium.ts). Rebuilt whenever what it shows changes.
 */
export class ResultsPanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private key = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly add: AddToHud,
    private readonly onTap: () => void,
  ) {}

  /** `records`: the leaderboard news of this run ('' when none, or offline). */
  update(state: Readonly<GameState>, me: string, records: string): void {
    const show = state.phase === 'results';
    const secs = show ? Math.ceil(state.phaseTimer / TICK_RATE) : 0;
    const footer = `Manșa ${state.round + 1} începe în ${secs}...`;
    const key = show ? `${state.round}:${footer}:${records}` : '';
    if (key === this.key) return;
    this.key = key;
    this.clear();
    if (!show) return;

    const order = Object.values(state.players)
      .filter((p) => p.racing || p.left)
      .sort((a, b) => a.place - b.place);
    // The news may wrap (about 60 characters a line at this size): room for every line.
    const recordsH = records ? Math.ceil(records.length / 60) * 24 + 12 : 0;
    const height = 130 + order.length * ROW_H + 40 + recordsH;
    const x0 = (GAME_W - WIDTH) / 2;
    const y0 = (GAME_H - height) / 2;
    const bg = this.add(
      this.scene.add
        .rectangle(GAME_W / 2, GAME_H / 2, WIDTH, height, 0x141b33, 0.9)
        .setStrokeStyle(3, 0xffd166)
        .setDepth(HUD_DEPTH.overlay)
        .setInteractive(),
    );
    bg.on('pointerdown', () => this.onTap());
    this.objects.push(bg);
    const text = (x: number, y: number, s: string, size: number, color: string, originX = 0) => {
      const t = this.add(
        this.scene.add
          .text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold', color, stroke: COLORS.outline, strokeThickness: 3, align: 'center', wordWrap: { width: WIDTH - 30 } })
          .setOrigin(originX, 0)
          .setDepth(HUD_DEPTH.overlay + 1),
      );
      this.objects.push(t);
    };

    text(GAME_W / 2, y0 + 18, `Manșa ${state.round} din ${state.roundsTotal}`, 30, COLORS.gold, 0.5);
    text(GAME_W / 2, y0 + 58, trackName(state.trackId), 17, COLORS.textDim, 0.5);
    const head = y0 + 92;
    text(x0 + 30, head, 'Loc', 14, COLORS.textDim);
    text(x0 + 90, head, 'Nume', 14, COLORS.textDim);
    text(x0 + 360, head, 'Timp', 14, COLORS.textDim);
    text(x0 + 490, head, 'Puncte', 14, COLORS.textDim);
    text(x0 + WIDTH - 30, head, 'Total', 14, COLORS.textDim, 1);
    order.forEach((p, i) => {
      const y = head + 28 + i * ROW_H;
      const mine = p.id === me;
      const color = mine ? '#ffffff' : COLORS.text;
      if (mine) {
        const hl = this.add(this.scene.add.rectangle(GAME_W / 2, y + 11, WIDTH - 30, ROW_H - 4, 0xffffff, 0.08).setDepth(HUD_DEPTH.overlay + 0.5));
        this.objects.push(hl);
      }
      const dot = this.add(this.scene.add.circle(x0 + 76, y + 11, 7, PLAYER_COLORS[p.slot] ?? 0xffffff).setDepth(HUD_DEPTH.overlay + 1));
      this.objects.push(dot);
      text(x0 + 30, y, `${p.place}.`, 20, color);
      text(x0 + 90, y, p.left ? `${p.name} (a ieșit)` : p.name, 20, color);
      text(x0 + 360, y, p.finished ? formatTime(p.finishTicks) : p.left ? '-' : 'pe drum', 20, p.finished ? color : COLORS.textDim);
      const gained = p.left ? 0 : p.finished ? (POINTS_BY_PLACE[p.place - 1] ?? 0) : lateFinishPoints(p.place);
      text(x0 + 490, y, `+${gained}`, 20, '#7cf29a');
      text(x0 + WIDTH - 30, y, String(p.points), 20, hexColor(0xffd166), 1);
    });
    if (records) text(GAME_W / 2, y0 + height - 40 - recordsH, records, 17, COLORS.gold, 0.5);
    text(GAME_W / 2, y0 + height - 36, footer, 17, COLORS.textDim, 0.5);
  }

  private clear(): void {
    for (const obj of this.objects) obj.destroy();
    this.objects.length = 0;
  }

  destroy(): void {
    this.clear();
  }
}
