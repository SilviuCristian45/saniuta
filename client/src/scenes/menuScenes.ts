import Phaser from 'phaser';
import type { GameTransport } from '../net/GameTransport';
import { ensureTextures } from '../render/textures';
import type { MenuData, NameData } from '../screens/host';
import { showIntro } from '../screens/intro';
import { showLeaderboard } from '../screens/leaderboard';
import { LobbyScreen } from '../screens/lobby';
import { MenuScreen } from '../screens/menu';
import { showName } from '../screens/name';
import { drawBackdrop } from '../ui/backdrop';
import { phaserHost } from './phaserHost';

// The HTML screens (screens/*.ts) over the mountain at dusk, one Phaser scene each.

/** Title screen. */
export class IntroScene extends Phaser.Scene {
  private next!: MenuData;

  constructor() {
    super('intro');
  }

  init(data: MenuData): void {
    this.next = data;
  }

  create(): void {
    ensureTextures(this);
    drawBackdrop(this);
    showIntro(phaserHost(this), this.next);
  }
}

/** "Cum te cheamă?" / "Salut, X!" */
export class NameScene extends Phaser.Scene {
  private opts!: NameData;

  constructor() {
    super('name');
  }

  init(data: NameData): void {
    this.opts = data;
  }

  create(): void {
    ensureTextures(this);
    drawBackdrop(this);
    showName(phaserHost(this), this.opts);
  }
}

/** Create / join / offline. */
export class MenuScene extends Phaser.Scene {
  private opts!: MenuData;

  constructor() {
    super('menu');
  }

  init(data: MenuData): void {
    this.opts = data;
  }

  create(): void {
    ensureTextures(this);
    drawBackdrop(this);
    new MenuScreen(phaserHost(this), this.opts);
  }
}

/** The all-time best times. */
export class LeaderboardScene extends Phaser.Scene {
  constructor() {
    super('leaderboard');
  }

  create(): void {
    ensureTextures(this);
    drawBackdrop(this);
    showLeaderboard(phaserHost(this));
  }
}

export interface LobbySceneData {
  transport: GameTransport;
}

/** The room's lobby. */
export class LobbyScene extends Phaser.Scene {
  private transport!: GameTransport;
  private screen!: LobbyScreen;

  constructor() {
    super('lobby');
  }

  init(data: LobbySceneData): void {
    this.transport = data.transport;
  }

  create(): void {
    ensureTextures(this);
    drawBackdrop(this);
    this.screen = new LobbyScreen(phaserHost(this), this.transport);
  }

  update(time: number, delta: number): void {
    this.screen.update(time, delta);
  }
}
