import Phaser from 'phaser';
import { INPUT_MAX } from '@saniuta/shared';
import { isTyping } from '../ui/el';
import type { InputSource, RideInput } from './InputSource';

const K = Phaser.Input.Keyboard.KeyCodes;

/** Left/right (A/D) steer, up (W) kicks off, down (S) brakes, Space throws a snowball, E uses the power-up. */
export class KeyboardInput implements InputSource {
  private readonly left: Phaser.Input.Keyboard.Key[];
  private readonly right: Phaser.Input.Keyboard.Key[];
  private readonly up: Phaser.Input.Keyboard.Key[];
  private readonly down: Phaser.Input.Keyboard.Key[];
  private readonly fireKey: Phaser.Input.Keyboard.Key;
  private readonly useKey: Phaser.Input.Keyboard.Key;
  private fireQueued = false;
  private useQueued = false;

  constructor(private readonly keyboard: Phaser.Input.Keyboard.KeyboardPlugin) {
    const add = (...codes: number[]) => codes.map((code) => keyboard.addKey(code, true));
    this.left = add(K.LEFT, K.A);
    this.right = add(K.RIGHT, K.D);
    this.up = add(K.UP, K.W);
    this.down = add(K.DOWN, K.S);
    this.fireKey = keyboard.addKey(K.SPACE, true);
    this.fireKey.on('down', () => {
      if (!isTyping()) this.fireQueued = true;
    });
    this.useKey = keyboard.addKey(K.E, true);
    this.useKey.on('down', () => {
      if (!isTyping()) this.useQueued = true;
    });
  }

  poll(): RideInput | null {
    const held = (keys: Phaser.Input.Keyboard.Key[]) => (keys.some((k) => k.isDown) ? 1 : 0);
    const steer = (held(this.right) - held(this.left)) * INPUT_MAX;
    const throttle = (held(this.up) - held(this.down)) * INPUT_MAX;
    const fire = this.fireQueued;
    const use = this.useQueued;
    this.fireQueued = false;
    this.useQueued = false;
    if (isTyping() || (steer === 0 && throttle === 0 && !fire && !use)) return null;
    return { steer, throttle, fire, use };
  }

  releaseAll(): void {
    this.fireQueued = false;
    this.useQueued = false;
    this.keyboard.resetKeys();
  }

  destroy(): void {
    this.fireKey.removeAllListeners();
    this.useKey.removeAllListeners();
  }
}
