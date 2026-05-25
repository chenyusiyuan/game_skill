/**
 * Keyboard helpers complementing inputController for narrow single-key needs.
 *
 * Phaser exposes Key.isDown for polling and Key.on('down', ...) for events;
 * worker code mixes the two and ends up with double-fires or missed inputs.
 * Phaser.Input.Keyboard.JustDown(key) only returns true on the exact frame the
 * key transitioned and only once per call, so it must be polled in update().
 * Helpers below give a small typed surface for one-shot bindings (uses 'down'
 * event under the hood) and for polling state (uses JustDown wrapped in a
 * getter so consumers cannot accidentally double-consume the transition).
 */
import Phaser from 'phaser';

/** Handle for a one-shot key binding. */
export interface OneShotKeyHandle {
  off(): void;
}

/** Handle for polling held key state including transitions. */
export interface HoldKeyHandle {
  readonly isDown: boolean;
  readonly justDown: boolean;
  readonly justUp: boolean;
  off(): void;
}

type KeyCode = string | number;

/** Registers a callback fired on key-down transition; safe to call when keyboard is unavailable. */
export function oneShotKey(scene: Phaser.Scene, code: KeyCode, fn: () => void): OneShotKeyHandle {
  const keyboard = scene.input.keyboard;
  if (!keyboard) return { off: () => undefined };
  const key = keyboard.addKey(code);
  const handler = (): void => fn();
  key.on('down', handler);
  return {
    off(): void {
      key.off('down', handler);
      keyboard.removeKey(key, true);
    },
  };
}

/** Returns a polling handle for a held key; isDown / justDown / justUp track transitions per call. */
export function holdKey(scene: Phaser.Scene, code: KeyCode): HoldKeyHandle {
  const keyboard = scene.input.keyboard;
  if (!keyboard) {
    return {
      isDown: false,
      justDown: false,
      justUp: false,
      off: () => undefined,
    };
  }
  const key = keyboard.addKey(code);
  return {
    get isDown(): boolean {
      return key.isDown;
    },
    get justDown(): boolean {
      return Phaser.Input.Keyboard.JustDown(key);
    },
    get justUp(): boolean {
      return Phaser.Input.Keyboard.JustUp(key);
    },
    off(): void {
      keyboard.removeKey(key, true);
    },
  };
}

/** Adds multiple keys at once and returns a typed Record. Pass a tuple of literal codes (e.g. ['W','A','S','D'] as const) so TypeScript infers Record<'W'|'A'|'S'|'D', Key>. */
export function addKeyBag<T extends string>(scene: Phaser.Scene, codes: readonly T[]): Record<T, Phaser.Input.Keyboard.Key> {
  const bag = {} as Record<T, Phaser.Input.Keyboard.Key>;
  const keyboard = scene.input.keyboard;
  if (!keyboard) return bag;
  for (const code of codes) {
    bag[code] = keyboard.addKey(code);
  }
  return bag;
}
