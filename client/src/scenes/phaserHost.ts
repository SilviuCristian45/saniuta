import type Phaser from 'phaser';
import type { Route, ScreenHost } from '../screens/host';
import { TEX } from '../render/textures';
import { mountScreen, sceneLifetime, textureUrl } from '../ui/dom';
import { debug } from '../urlOptions';
import type { GameSceneData } from './GameScene';
import type { LobbySceneData } from './menuScenes';

/** The HTML screens inside a Phaser scene: routes are scenes, the backdrop is the scene's canvas. */
export function phaserHost(scene: Phaser.Scene): ScreenHost {
  return {
    life: sceneLifetime(scene),
    go: (route) => go(scene, route),
    isActive: () => scene.sys.isActive(),
    mount: (className, children) => mountScreen(scene, className, children),
    avatarUrl: (slot) => avatarUrl(scene.game, slot),
  };
}

function go(scene: Phaser.Scene, route: Route): void {
  const scenes = scene.scene;
  if (route.to === 'lobby') {
    const data: LobbySceneData = { transport: route.transport };
    scenes.start('lobby', data);
  } else if (route.to === 'game') {
    const data: GameSceneData = { transport: route.transport, debug, tune: false };
    scenes.start('game', data);
  } else if (route.to === 'leaderboard') {
    scenes.start('leaderboard');
  } else {
    scenes.start(route.to, route.data);
  }
}

const avatars = new Map<number, string>();

function avatarUrl(game: Phaser.Game, slot: number): string {
  let url = avatars.get(slot);
  if (!url) {
    url = textureUrl(game, TEX.sled(slot));
    avatars.set(slot, url);
  }
  return url;
}
