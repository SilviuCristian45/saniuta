import Phaser from 'phaser';
import './style.css';
import { isTouch } from './device';
import { LocalTransport } from './net/LocalTransport';
import { GAME_H, GAME_W } from './render/layout';
import { GameScene, type GameSceneData } from './scenes/GameScene';
import { initRotatePrompt } from './ui/orientation';
import { debug, quickBotLevel, quickBots, quickRounds, quickSeed, quickTrack, tune } from './urlOptions';

// Stage 2: the page starts a local match against bots right away (menus and the lobby come next).
// URL options: ?bots=1..5, ?rounds=3|5|7, ?track=0..3, ?seed=abc, ?botlevel=usor|mediu|greu,
// ?debug, ?tune, ?touch / ?touch=0.
if (tune) document.body.classList.add('tuning');

function localMatch(seed = quickSeed): GameSceneData {
  return {
    transport: new LocalTransport({
      name: 'Tu',
      bots: quickBots,
      botLevel: quickBotLevel,
      rounds: quickRounds,
      trackId: quickTrack,
      seed,
      autoStart: true,
    }),
    debug,
    tune,
    newMatch: () => localMatch(Math.random().toString(36).slice(2)),
  };
}

if (isTouch) {
  document.body.classList.add('touch');
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#141b33',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  // The canvas only sees one finger at a time; the HTML touch controls track their own.
  input: { activePointers: 1 },
});
// ?debug: the game object for scripted browser tests.
if (debug) (window as unknown as { __game?: Phaser.Game }).__game = game;
initRotatePrompt();
game.scene.add('game', GameScene, true, localMatch());
