import Phaser from 'phaser';
import {
  DOWNHILL,
  TUNING,
  applyGameTuning,
  currentTrack,
  speedOf,
  type GameEvent,
  type GameState,
} from '@saniuta/shared';
import { DebugOverlay } from '../debug/DebugOverlay';
import { savedTuning, TunePanel } from '../debug/TunePanel';
import { isTouch } from '../device';
import { CombinedInput } from '../input/CombinedInput';
import { NO_INPUT } from '../input/InputSource';
import { KeyboardInput } from '../input/KeyboardInput';
import { TouchInput } from '../input/TouchInput';
import type { GameTransport } from '../net/GameTransport';
import { EMPTY_VIEW, type RenderView } from '../net/view';
import { COLORS, PLAYER_COLORS, hexColor } from '../render/colors';
import { floatText, snowBurst } from '../render/fx';
import { Hud } from '../render/Hud';
import { DEPTH, FONT, GAME_H, GAME_W, HUD_DEPTH, LOOK_AHEAD, ZOOM_FAST, ZOOM_SLOW, px } from '../render/layout';
import { Minimap } from '../render/Minimap';
import { ResultsPanel } from '../render/ResultsPanel';
import { SledView, toRadians } from '../render/SledView';
import { Snowfall } from '../render/Snowfall';
import { ensureTextures, TEX } from '../render/textures';
import { TrackView } from '../render/TrackView';
import { Trails } from '../render/Trails';
import { getSetting, reducedEffects, vibrate } from '../settings';
import { fullscreenOnFirstTap } from '../ui/orientation';

export interface GameSceneData {
  transport: GameTransport;
  debug: boolean;
  /** ?tune: the saved values and the panel (local games only). */
  tune: boolean;
  /** Started from test URL options: after the match, Enter (or a tap) starts a new one. */
  newMatch?: () => GameSceneData;
}

type Add = <T extends Phaser.GameObjects.GameObject>(obj: T) => T;

/** Renders the shared GameState and forwards local input; knows nothing about where the state comes from. */
export class GameScene extends Phaser.Scene {
  private transport!: GameTransport;
  private data_!: GameSceneData;
  private controls!: CombinedInput;
  private touch?: TouchInput;
  private unsubscribe?: () => void;
  private world!: Phaser.GameObjects.Layer;
  private hudLayer!: Phaser.GameObjects.Layer;
  private hudCam!: Phaser.Cameras.Scene2D.Camera;
  private addWorld!: Add;
  private addHud!: Add;
  private trackView?: TrackView;
  private trackKey = '';
  private minimap?: Minimap;
  private trails!: Trails;
  private snowfall!: Snowfall;
  private hud!: Hud;
  private results!: ResultsPanel;
  private debugOverlay?: DebugOverlay;
  private tunePanel?: TunePanel;
  private pauseText!: Phaser.GameObjects.Text;
  private readonly sleds = new Map<string, SledView>();
  private balls: Phaser.GameObjects.Image[] = [];
  private view: RenderView = EMPTY_VIEW;
  private snapCamera = true;

  constructor() {
    super('game');
  }

  init(data: GameSceneData): void {
    this.data_ = data;
    this.transport = data.transport;
    // Phaser reuses the scene instance on every start: forget the previous match's views.
    this.sleds.clear();
    this.balls = [];
    this.view = EMPTY_VIEW;
    this.trackView = undefined;
    this.trackKey = '';
    this.minimap = undefined;
    this.touch = undefined;
    this.debugOverlay = undefined;
    this.tunePanel = undefined;
    this.snapCamera = true;
  }

  create(): void {
    ensureTextures(this);
    // Every game starts from the default riding numbers; saved ?tune values only for a local ?tune game.
    applyGameTuning({ online: this.transport.online, tune: this.data_.tune, saved: savedTuning() });
    fullscreenOnFirstTap();
    const reduced = reducedEffects();

    // Two layers, two cameras: the world camera follows the sled and zooms, the HUD camera never moves.
    this.world = this.add.layer();
    this.hudLayer = this.add.layer();
    this.addWorld = (obj) => {
      this.world.add(obj);
      return obj;
    };
    this.addHud = (obj) => {
      this.hudLayer.add(obj);
      return obj;
    };
    const cam = this.cameras.main;
    cam.setBackgroundColor(COLORS.offPiste);
    cam.ignore(this.hudLayer);
    this.hudCam = this.cameras.add(0, 0, GAME_W, GAME_H);
    this.hudCam.ignore(this.world);

    // Dusk over the slope: darker toward the top of the screen and the edges.
    const tint = this.addHud(this.add.graphics().setDepth(HUD_DEPTH.tint));
    tint.fillGradientStyle(0x1b1340, 0x1b1340, 0x1b1340, 0x1b1340, 0.5, 0.5, 0, 0);
    tint.fillRect(0, 0, GAME_W, GAME_H * 0.55);
    tint.fillGradientStyle(0x2a1b4d, 0x2a1b4d, 0x2a1b4d, 0x2a1b4d, 0, 0, 0.35, 0.35);
    tint.fillRect(0, GAME_H * 0.6, GAME_W, GAME_H * 0.4);

    this.trails = new Trails(this, this.addWorld, reduced ? 90 : 320);
    this.snowfall = new Snowfall(this, this.addHud, reduced ? 30 : 110);
    this.hud = new Hud(this, this.addHud, () => undefined);
    const footer = this.data_.newMatch ? (isTouch ? 'Atinge pentru un meci nou' : 'Enter = meci nou') : '';
    this.results = new ResultsPanel(this, this.addHud, footer, () => this.onContinue());
    this.pauseText = this.addHud(
      this.add
        .text(GAME_W / 2, GAME_H / 2, '', { fontFamily: FONT, fontSize: '40px', fontStyle: 'bold', color: COLORS.gold, stroke: COLORS.outline, strokeThickness: 8, align: 'center' })
        .setOrigin(0.5)
        .setDepth(HUD_DEPTH.overlay),
    );

    const keyboard = new KeyboardInput(this.input.keyboard!);
    if (isTouch) {
      this.touch = new TouchInput({ leftHanded: getSetting('leftHanded') });
      this.controls = new CombinedInput([this.touch, keyboard]);
    } else {
      this.controls = new CombinedInput([keyboard]);
    }

    this.unsubscribe = this.transport.onEvents((events) => this.handleEvents(events));
    this.game.events.on(Phaser.Core.Events.HIDDEN, this.onHidden, this);
    this.input.keyboard!.on('keydown-P', () => this.togglePause());
    this.input.keyboard!.on('keydown-ENTER', () => this.onContinue());
    // On a phone, a tap anywhere resumes a paused game (it pauses when the page goes to the background).
    this.input.on('pointerdown', () => {
      if (this.transport.isPaused()) this.togglePause();
    });
    if (this.data_.debug) this.debugOverlay = new DebugOverlay(this, this.addWorld, this.addHud);
    if (this.data_.tune && !this.transport.online) this.tunePanel = new TunePanel();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe?.();
      this.controls.destroy();
      // Phaser keeps key captures game-wide: without this, WASD and Space could not be typed in the menus.
      this.input.keyboard!.clearCaptures();
      this.tunePanel?.destroy();
      this.results.destroy();
      this.trackView?.destroy();
      for (const sled of this.sleds.values()) sled.destroy();
      this.game.events.off(Phaser.Core.Events.HIDDEN, this.onHidden, this);
    });
  }

  update(time: number, delta: number): void {
    const before = this.transport.getState();
    const meBefore = before.players[this.transport.playerId];
    const input = this.controls.poll();
    const canRide = before.phase === 'playing' && !!meBefore?.racing && !meBefore.finished && !this.transport.isPaused();
    this.transport.setInput(canRide ? input : NO_INPUT);
    this.transport.update(delta);

    const state = this.transport.getState();
    const me = state.players[this.transport.playerId];
    this.syncTrack(state);
    this.view = this.transport.view();
    this.touch?.setVisible(state.phase === 'playing' && !!me?.racing && !me.finished && !this.transport.isPaused());
    if (me) this.touch?.setSnowballs(me.snowballs);

    this.followCamera(state, delta);
    const worldView = this.cameras.main.worldView;
    this.trackView?.update(worldView, state, time);
    this.syncSleds(state, time);
    this.syncBalls();
    this.trails.draw(worldView);
    this.snowfall.update(delta, time, this.cameras.main.scrollX, this.cameras.main.scrollY);
    this.minimap?.update(state, this.view.poses, this.transport.playerId);
    this.hud.update(state, this.transport.playerId);
    this.results.update(state, this.transport.playerId);
    this.pauseText.setText(this.transport.isPaused() ? `Pauză\n${isTouch ? '' : 'P = continuă'}` : '');
    this.debugOverlay?.update(state, this.transport.playerId, this.game.loop.actualFps, this.view.poses);
  }

  /** A new track (first run, or a new random one): rebuild the slope and the minimap. */
  private syncTrack(state: Readonly<GameState>): void {
    const key = `${state.trackId}:${state.trackSeed}`;
    if (key === this.trackKey) return;
    this.trackKey = key;
    this.trackView?.destroy();
    this.minimap?.destroy();
    this.trackView = new TrackView(this, currentTrack(state), this.addWorld, reducedEffects());
    // The minimap stays out of the way of the snowball button on phones.
    this.minimap = new Minimap(this, this.addHud, this.trackView.track, 70, isTouch ? GAME_H - 250 : GAME_H - 40);
    this.trails.clear();
    this.snapCamera = true;
  }

  /** The camera rides with the sled, a little ahead down the slope, zooming out with speed. */
  private followCamera(state: Readonly<GameState>, delta: number): void {
    const cam = this.cameras.main;
    const id = this.transport.playerId;
    const pose = this.view.poses.get(id);
    const me = state.players[id];
    if (!pose || !me) return;
    const speed = me ? speedOf(me) / TUNING.maxSpeed : 0;
    const zoom = ZOOM_SLOW + (ZOOM_FAST - ZOOM_SLOW) * Math.min(1, speed * 1.2);
    const k = this.snapCamera ? 1 : 1 - Math.exp(-delta / 250);
    cam.setZoom(cam.zoom + (zoom - cam.zoom) * k);
    const tx = px(pose.x);
    const ty = px(pose.y) + (LOOK_AHEAD * GAME_H) / cam.zoom;
    const cx = cam.midPoint.x;
    const cy = cam.midPoint.y;
    const follow = this.snapCamera ? 1 : 1 - Math.exp(-delta / 90);
    cam.centerOn(cx + (tx - cx) * follow, cy + (ty - cy) * follow);
    this.snapCamera = false;
  }

  private syncSleds(state: Readonly<GameState>, time: number): void {
    for (const p of Object.values(state.players)) {
      let sled = this.sleds.get(p.id);
      if (!sled) {
        sled = new SledView(this, this.addWorld, p, p.id === this.transport.playerId);
        this.sleds.set(p.id, sled);
      }
      sled.setVisible(p.racing);
      if (!p.racing) continue;
      const pose = this.view.poses.get(p.id);
      if (!pose) continue;
      const x = px(pose.x);
      const y = px(pose.y);
      const angle = toRadians(state.phase === 'lobby' ? DOWNHILL : pose.heading);
      sled.setPose(x, y, angle, p, time);
      if (p.airTicks > 0 || p.crashTicks > 0 || p.finished) this.trails.lift(p.id);
      else if (state.phase === 'playing') this.trails.extend(p.id, x, y, angle);
    }
    for (const [id, sled] of this.sleds) {
      if (state.players[id]) continue;
      sled.destroy();
      this.sleds.delete(id);
    }
  }

  private syncBalls(): void {
    const balls = this.view.balls;
    while (this.balls.length < balls.length) this.balls.push(this.addWorld(this.add.image(0, 0, TEX.ball).setDepth(DEPTH.balls)));
    this.balls.forEach((img, i) => {
      const b = balls[i];
      img.setVisible(!!b);
      if (!b) return;
      // A low arc: up, then down into the snow.
      const lift = Math.sin(b.flight * Math.PI) * 14;
      img.setPosition(px(b.x), px(b.y) - lift).setScale(1 + lift / 30);
    });
  }

  private posOf(id: string): { x: number; y: number } | undefined {
    const pose = this.view.poses.get(id);
    return pose ? { x: px(pose.x), y: px(pose.y) } : undefined;
  }

  private handleEvents(events: GameEvent[]): void {
    const me = this.transport.playerId;
    const state = this.transport.getState();
    const shake = (ms: number, k: number) => {
      if (!reducedEffects()) this.cameras.main.shake(ms, k);
    };
    for (const e of events) {
      if (e.type === 'crash') {
        snowBurst(this, this.addWorld, px(e.x), px(e.y), reducedEffects() ? 5 : 12, 40);
        if (e.playerId === me) {
          shake(220, 0.008);
          vibrate(120);
        }
      } else if (e.type === 'land') {
        const pos = this.posOf(e.playerId);
        if (pos) snowBurst(this, this.addWorld, pos.x, pos.y, reducedEffects() ? 3 : 7, 26);
        if (e.playerId === me) vibrate(30);
      } else if (e.type === 'pickup') {
        const pos = this.posOf(e.playerId);
        if (pos && e.playerId === me) floatText(this, this.addWorld, pos.x, pos.y - 30, '+1 bulgăre', '#ffffff');
      } else if (e.type === 'splat') {
        snowBurst(this, this.addWorld, px(e.x), px(e.y), reducedEffects() ? 4 : 9, 22);
        if (e.playerId === me) {
          shake(140, 0.005);
          vibrate(60);
        } else if (e.byId === me && e.playerId) {
          floatText(this, this.addWorld, px(e.x), px(e.y) - 30, 'Nimerit!', '#7cf29a');
        }
      } else if (e.type === 'bump') {
        if (e.a === me || e.b === me) vibrate(25);
      } else if (e.type === 'finish') {
        const p = state.players[e.playerId];
        const pos = this.posOf(e.playerId);
        if (p && pos) floatText(this, this.addWorld, pos.x, pos.y - 34, e.place === 1 ? 'Primul!' : `Locul ${e.place}`, hexColor(PLAYER_COLORS[p.slot] ?? 0xffffff));
        if (e.playerId === me) vibrate(e.place === 1 ? 150 : 60);
      } else if (e.type === 'roundStart') {
        for (const sled of this.sleds.values()) sled.reset();
        this.trails.clear();
        this.snapCamera = true;
      }
    }
  }

  private togglePause(): void {
    if (!this.transport.pausable) return;
    const phase = this.transport.getState().phase;
    if (phase !== 'playing' && phase !== 'results') return;
    this.transport.setPaused(!this.transport.isPaused());
    this.controls.releaseAll();
  }

  /** The page went to the background: let go of everything held; offline the match pauses. */
  private onHidden(): void {
    this.controls.releaseAll();
    this.transport.setInput(NO_INPUT);
    if (this.transport.pausable && this.transport.getState().phase !== 'finished') this.transport.setPaused(true);
  }

  /** Enter or a tap: after the match a new one (test URL); paused, resume. */
  private onContinue(): void {
    const state = this.transport.getState();
    if (state.phase === 'finished') {
      const next = this.data_.newMatch;
      if (next) {
        this.transport.dispose();
        this.scene.restart(next());
      }
      return;
    }
    if (this.transport.isPaused()) this.togglePause();
  }
}
