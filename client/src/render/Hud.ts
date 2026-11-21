import Phaser from 'phaser';
import {
  COUNTDOWN_TICKS,
  FP,
  MAX_SNOWBALLS,
  TICK_RATE,
  computeStandings,
  countdownSeconds,
  lastCallSeconds,
  raceTicks,
  speedOf,
  ticksToMs,
  trackName,
  type GameState,
} from '@saniuta/shared';
import { COLORS } from './colors';
import { FONT, GAME_W, HUD_DEPTH } from './layout';
import { TEX } from './textures';

/** "HAI!" stays a moment after the countdown. */
const GO_SHOWN_TICKS = Math.round(0.8 * TICK_RATE);

/** m:ss.d for a run time in ticks. */
export function formatTime(ticks: number): string {
  const ms = ticksToMs(ticks);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const d = Math.floor((ms % 1000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}

/** Sub-units per tick to a fun km/h (450 px/s reads as ~65 km/h). */
export function kmh(speed: number): number {
  return Math.round(((speed / FP) * TICK_RATE * 0.145));
}

/** "1-a", "al 2-lea", ... as in "Ai sosit al 2-lea". */
export function ordinal(place: number): string {
  return place === 1 ? 'primul' : `al ${place}-lea`;
}

type AddToHud = <T extends Phaser.GameObjects.GameObject>(obj: T) => T;

/** The player's numbers on the screen: run and track, time, place, speed, snowballs, standings, countdown, banners. */
export class Hud {
  private readonly title: Phaser.GameObjects.Text;
  private readonly time: Phaser.GameObjects.Text;
  private readonly info: Phaser.GameObjects.Text;
  private readonly balls: Phaser.GameObjects.Image[] = [];
  private readonly standings: Phaser.GameObjects.Text;
  private readonly countdown: Phaser.GameObjects.Text;
  private readonly banner: Phaser.GameObjects.Text;
  private lastCountdown = '';

  constructor(
    private readonly scene: Phaser.Scene,
    add: AddToHud,
    private readonly onCount: (label: string) => void,
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
