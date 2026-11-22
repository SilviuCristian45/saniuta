import Phaser from 'phaser';
import './style.css';
import './screens.css';
import { isValidRoomCode, normalizeRoomCode } from '@saniuta/shared';
import { initRideSounds } from './audio/ride';
import { initSfx } from './audio/sfx';
import { initMute, phaserAudioOut } from './audio/sound';
import { isTouch } from './device';
import { LocalTransport } from './net/LocalTransport';
import { startupRoute } from './net/resume';
import { resumableRoomCode } from './net/rooms';
import { GAME_H, GAME_W } from './render/layout';
import { GameScene, type GameSceneData } from './scenes/GameScene';
import { IntroScene, LeaderboardScene, LobbyScene, MenuScene, NameScene } from './scenes/menuScenes';
import type { MenuData } from './screens/host';
import { trackVisualViewport } from './ui/html';
import { initRotatePrompt } from './ui/orientation';
import { debug, params, quickBotLevel, quickBots, quickPowerUps, quickRounds, quickSeed, quickStart, quickTrack, tune } from './urlOptions';

// Intro -> nickname -> menu -> lobby -> game -> lobby (a reload mid-game goes straight back in).
// Test URL options skip the menus and start a local match at once: ?bots=1..5, ?rounds=3|5|7,
// ?track=0..3, ?seed=abc, ?botlevel=usor|mediu|greu, ?debug, ?tune. ?touch / ?touch=0 only force
// the layout (device.ts); ?online, ?lag=ms, ?jitter=ms keep the menus.
if (tune) document.body.classList.add('tuning');

function localMatch(seed = quickSeed): GameSceneData {
  return {
    transport: new LocalTransport({
      name: 'Tu',
      bots: quickBots,
      botLevel: quickBotLevel,
      rounds: quickRounds,
      trackId: quickTrack,
      powerUps: quickPowerUps,
      seed,
      autoStart: true,
    }),
    debug,
    tune,
    newMatch: () => localMatch(Math.random().toString(36).slice(2)),
  };
}

// ?room=COD (invite link): after the intro and the nickname, the menu joins that room.
function menuData(): MenuData {
  const room = params.get('room');
  if (room === null) return {};
  const code = normalizeRoomCode(room);
  return isValidRoomCode(code) ? { invite: code } : { message: 'Codul din link nu e valid.' };
}

// A reload during an online game skips the intro and reconnects to the same room; a link to
// another room skips it too, and the menu asks whether to leave the current game for it.
const startup = quickStart ? startupRoute(null, undefined) : startupRoute(resumableRoomCode(), menuData().invite);
const resume = startup.kind !== 'normal';
const menuStart: MenuData = startup.kind === 'switch' ? { invite: startup.to, switchFrom: startup.from } : resume ? { resume: true } : menuData();

// Phones: no long-press menu (the CSS already stops selection and the callout); text fields keep theirs.
if (isTouch) {
  document.body.classList.add('touch');
  document.addEventListener('contextmenu', (e) => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
  });
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
initMute(game);
initSfx(phaserAudioOut(game));
initRideSounds(phaserAudioOut(game));
initRotatePrompt();
trackVisualViewport();
game.scene.add('intro', IntroScene, !quickStart && !resume, menuData());
game.scene.add('name', NameScene);
game.scene.add('menu', MenuScene, resume, menuStart);
game.scene.add('leaderboard', LeaderboardScene);
game.scene.add('lobby', LobbyScene);
game.scene.add('game', GameScene, quickStart, quickStart ? localMatch() : undefined);
