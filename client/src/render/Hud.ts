import Phaser from 'phaser';
import {
  COUNTDOWN_TICKS,
  MAX_SNOWBALLS,
  POWER_NONE,
  POWER_SCARF,
  POWER_TEA,
  POWER_WAX,
  SCARF_TICKS,
  TICK_RATE,
  WAX_TICKS,
  computeStandings,
  countdownSeconds,
  lastCallSeconds,
  raceTicks,
  speedOf,
  trackName,
  type GameState,
} from '@saniuta/shared';
import { COLORS } from './colors';
import { formatTime, kmh, ordinal, POWER_NAMES } from './format';
import { FONT, GAME_W, HUD_DEPTH } from './layout';
import { TEX } from './textures';

/** "HAI!" stays a moment after the countdown. */
const GO_SHOWN_TICKS = Math.round(0.8 * TICK_RATE);

type AddToHud = <T extends Phaser.GameObjects.GameObject>(obj: T) => T;

/** The power-up box, right of the main panel. */
const BOX_X = 272;
const BOX_SIZE = 84;

/**
 * The player's numbers on the screen: run and track, time, place, speed, snowballs, the power-up held
 * and the ones at work, standings, countdown, banners.
 */
export class Hud {
  private readonly title: Phaser.GameObjects.Text;
  private readonly time: Phaser.GameObjects.Text;
  private readonly info: Phaser.GameObjects.Text;
  private readonly balls: Phaser.GameObjects.Image[] = [];
  private readonly standings: Phaser.GameObjects.Text;
  private readonly countdown: Phaser.GameObjects.Text;
  private readonly banner: Phaser.GameObjects.Text;
  private readonly powerBox: Phaser.GameObjects.Graphics;
  private readonly powerIcon: Phaser.GameObjects.Image;
  private readonly powerText: Phaser.GameObjects.Text;
  /** Effects at work: wax, tea, scarf (icon + a bar running down). */
  private readonly effects: { kind: number; icon: Phaser.GameObjects.Image }[] = [];
  private readonly effectBars: Phaser.GameObjects.Graphics;
  private shownPower = -1;
  private lastCountdown = '';

  constructor(
    private readonly scene: Phaser.Scene,
    add: AddToHud,
    private readonly onCount: (label: string) => void,
    /** Keyboard hint under the power-up box (not on phones: the button has the icon). */
    private readonly keyHint: boolean,
  ) {
    const panel = add(scene.add.graphics().setDepth(HUD_DEPTH.panel));
    panel.fillStyle(0x141b33, 0.55);
    panel.fillRoundedRect(12, 12, 250, 128, 12);
    const style = (size: number, color: string = COLORS.text): Phaser.Types.GameObjects.Text.TextStyle => ({
      fontFamily: FONT,
      fontSize: `${size}px`,
      fontStyle: 'bold',
      color,
      stroke: COLORS.outline,
      strokeThickness: 4,
    });
    this.title = add(scene.add.text(24, 20, '', style(15, COLORS.textDim)).setDepth(HUD_DEPTH.text));
    this.time = add(scene.add.text(24, 40, '', style(34)).setDepth(HUD_DEPTH.text));
    this.info = add(scene.add.text(24, 82, '', style(17)).setDepth(HUD_DEPTH.text));
    for (let i = 0; i < MAX_SNOWBALLS; i++) {
      this.balls.push(add(scene.add.image(34 + i * 24, 120, TEX.ball).setScale(1.3).setDepth(HUD_DEPTH.text)));
    }
    this.standings = add(scene.add.text(20, 152, '', { ...style(15), lineSpacing: 3 }).setDepth(HUD_DEPTH.text));
    this.powerBox = add(scene.add.graphics().setDepth(HUD_DEPTH.panel));
    this.powerIcon = add(scene.add.image(BOX_X + BOX_SIZE / 2, 12 + BOX_SIZE / 2, TEX.power(POWER_WAX)).setScale(1.25).setDepth(HUD_DEPTH.text).setVisible(false));
    this.powerText = add(scene.add.text(BOX_X + BOX_SIZE / 2, 12 + BOX_SIZE + 4, '', { ...style(13), align: 'center' }).setOrigin(0.5, 0).setDepth(HUD_DEPTH.text));
    [POWER_WAX, POWER_TEA, POWER_SCARF].forEach((kind, i) => {
      const icon = add(scene.add.image(BOX_X + BOX_SIZE + 26 + i * 44, 34, TEX.power(kind)).setScale(0.62).setDepth(HUD_DEPTH.text).setVisible(false));
      this.effects.push({ kind, icon });
    });
    this.effectBars = add(scene.add.graphics().setDepth(HUD_DEPTH.text));
    this.countdown = add(
      scene.add
        .text(GAME_W / 2, 250, '', { fontFamily: FONT, fontSize: '120px', fontStyle: 'bold', color: COLORS.gold, stroke: COLORS.outline, strokeThickness: 12 })
        .setOrigin(0.5)
        .setDepth(HUD_DEPTH.banner),
    );
    this.banner = add(
      scene.add
        .text(GAME_W / 2, 40, '', { ...style(24, '#ffd6a5'), align: 'center', strokeThickness: 6 })
        .setOrigin(0.5, 0)
        .setDepth(HUD_DEPTH.banner),
    );
  }

  update(state: Readonly<GameState>, me: string): void {
    const p = state.players[me];
    this.title.setText(`Manșa ${Math.max(1, state.round)}/${state.roundsTotal} · ${trackName(state.trackId)}`);
    const race = raceTicks(state.roundTick);
    const shownTicks = p?.finished ? p.finishTicks : state.phase === 'playing' ? race : 0;
    this.time.setText(formatTime(shownTicks));
    if (p) {
      const going = Object.values(state.players).filter((o) => o.racing);
      const place = p.finished ? p.place : 1 + going.filter((o) => o.id !== me && (o.finished || o.y > p.y)).length;
      this.info.setText(`Locul ${place} din ${going.length}   ${kmh(speedOf(p))} km/h`);
      this.balls.forEach((img, i) => img.setAlpha(i < p.snowballs ? 1 : 0.22));
    }
    this.syncPowerUps(state, me);
    this.standings.setText(
      computeStandings(state as GameState)
        .map((id, i) => {
          const o = state.players[id]!;
          return `${id === me ? '▸ ' : ''}${i + 1}. ${o.name}  ${o.points}p`;
        })
        .join('\n'),
    );
    this.syncCountdown(state);
    this.syncBanner(state, me);
  }

  /** The box with the power-up held (only with power-ups on), and the effects at work beside it. */
  private syncPowerUps(state: Readonly<GameState>, me: string): void {
    const p = state.players[me];
    const on = state.powerUps && state.phase === 'playing' && !!p?.racing;
    const held = on && p ? p.powerUp : -1;
    if (held !== this.shownPower) {
      this.shownPower = held;
      const g = this.powerBox.clear();
      if (on) {
        g.fillStyle(0x141b33, 0.55);
        g.fillRoundedRect(BOX_X, 12, BOX_SIZE, BOX_SIZE, 12);
        g.lineStyle(2, held === POWER_NONE ? 0x5c6b94 : 0xffd166, held === POWER_NONE ? 0.6 : 1);
        g.strokeRoundedRect(BOX_X + 4, 16, BOX_SIZE - 8, BOX_SIZE - 8, 10);
      }
      const has = held > POWER_NONE;
      this.powerIcon.setVisible(has);
      if (has) {
        this.powerIcon.setTexture(TEX.power(held)).setScale(1.7);
        this.scene.tweens.add({ targets: this.powerIcon, scale: 1.25, duration: 280, ease: 'Back.easeOut' });
      }
      this.powerText.setText(!on ? '' : has ? `${POWER_NAMES[held]}${this.keyHint ? '\n[E]' : ''}` : 'ia o cutie');
      this.powerText.setColor(has ? COLORS.text : COLORS.textDim);
    }
    const bars = this.effectBars.clear();
    let slot = 0;
    for (const { kind, icon } of this.effects) {
      const left = !on || !p ? 0 : kind === POWER_WAX ? p.waxTicks / WAX_TICKS : kind === POWER_SCARF ? p.scarfTicks / SCARF_TICKS : p.tea ? 1 : 0;
      icon.setVisible(left > 0);
      if (left <= 0) continue;
      const x = BOX_X + BOX_SIZE + 26 + slot++ * 44;
      icon.setX(x);
      if (kind === POWER_TEA) continue; // until it is used up
      bars.fillStyle(0x141b33, 0.7);
      bars.fillRect(x - 17, 56, 34, 5);
      bars.fillStyle(0xffd166, 1);
      bars.fillRect(x - 17, 56, 34 * left, 5);
    }
  }

  /** "3", "2", "1", then "HAI!" for a moment; a little pop on every change. */
  private syncCountdown(state: Readonly<GameState>): void {
    let label = '';
    if (state.phase === 'playing') {
      const secs = countdownSeconds(state.roundTick);
      if (secs > 0) label = String(secs);
      else if (state.roundTick - COUNTDOWN_TICKS <= GO_SHOWN_TICKS) label = 'HAI!';
    }
    if (label === this.lastCountdown) return;
    this.lastCountdown = label;
    this.countdown.setText(label).setColor(label === 'HAI!' ? '#7cf29a' : COLORS.gold);
    if (label) {
      this.onCount(label);
      this.countdown.setScale(1.5).setAlpha(1);
      this.scene.tweens.add({ targets: this.countdown, scale: 1, duration: 260, ease: 'Back.easeOut' });
    }
  }

  private syncBanner(state: Readonly<GameState>, me: string): void {
    const p = state.players[me];
    let text = '';
    if (state.phase === 'playing') {
      const left = lastCallSeconds(state);
      if (p?.finished) text = `Ai sosit ${ordinal(p.place)}! ${formatTime(p.finishTicks)}`;
      if (left !== null && !p?.finished) text = `Primul a sosit! Mai ai ${left} s`;
      else if (left !== null) text += `\nMai sunt ${left} s pentru ceilalți`;
    }
    this.banner.setText(text);
  }
}
