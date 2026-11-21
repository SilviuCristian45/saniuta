import Phaser from 'phaser';
import { INPUT_MAX } from '@saniuta/shared';
import { isTyping } from '../ui/el';
import type { InputSource, RideInput } from './InputSource';

const K = Phaser.Input.Keyboard.KeyCodes;

/** Left/right (A/D) steer, up (W) kicks off, down (S) brakes, Space throws a snowball. */
export class KeyboardInput implements InputSource {
  private readonly left: Phaser.Input.Keyboard.Key[];
  private readonly right: Phaser.Input.Keyboard.Key[];
  private readonly up: Phaser.Input.Keyboard.Key[];
  private readonly down: Phaser.Input.Keyboard.Key[];
  private readonly fireKey: Phaser.Input.Keyboard.Key;
  private fireQueued = false;

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
  }

  poll(): RideInput | null {
    const held = (keys: Phaser.Input.Keyboard.Key[]) => (keys.some((k) => k.isDown) ? 1 : 0);
    const steer = (held(this.right) - held(this.left)) * INPUT_MAX;
    const throttle = (held(this.up) - held(this.down)) * INPUT_MAX;
    const fire = this.fireQueued;
    this.fireQueued = false;
    if (isTyping() || (steer === 0 && throttle === 0 && !fire)) return null;
    return { steer, throttle, fire };
  }

  releaseAll(): void {
    this.fireQueued = false;
    this.keyboard.resetKeys();
  }

  destroy(): void {
    this.fireKey.removeAllListeners();
  }
}
