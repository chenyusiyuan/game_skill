import Phaser from 'phaser';
type ActionCallback = () => void;
interface ActionState {
  down: boolean;
  wasDown: boolean;
  justDown: boolean;
  justUp: boolean;
  downCallbacks: Set<ActionCallback>;
  upCallbacks: Set<ActionCallback>;
}
/** Options for InputController keyboard, touch, and gamepad input. */
export interface InputControllerOptions {
  enableKeyboard?: boolean;
  enableTouch?: boolean;
  enableGamepad?: boolean;
  actionBindings?: Record<string, string[]>;
  joystickRadius?: number;
  joystickPosition?: Phaser.Types.Math.Vector2Like;
  joystickDepth?: number;
}
const DEFAULT_BINDINGS: Record<string, string[]> = {
  primary: ['SPACE', 'pointer1'],
  pause: ['ESC'],
};
/** Aggregates keyboard, pointer joystick, and optional gamepad input. */
export class InputController {
  public readonly axes2D = new Phaser.Math.Vector2();
  private readonly scene: Phaser.Scene;
  private readonly enableKeyboard: boolean;
  private readonly enableTouch: boolean;
  private readonly enableGamepad: boolean;
  private readonly bindings: Record<string, string[]>;
  private readonly actions = new Map<string, ActionState>();
  private readonly keys = new Map<string, Phaser.Input.Keyboard.Key>();
  private readonly joystickRadius: number;
  private readonly joystickBase: Phaser.Math.Vector2;
  private readonly joystickVector = new Phaser.Math.Vector2();
  private joystickGraphics: Phaser.GameObjects.Graphics | null = null;
  private pointerId: number | null = null;
  private pointerPrimaryDown = false;
  /** Creates an input controller with keyboard and touch enabled by default. */
  public constructor(scene: Phaser.Scene, opts: InputControllerOptions = {}) {
    this.scene = scene;
    this.enableKeyboard = opts.enableKeyboard ?? true;
    this.enableTouch = opts.enableTouch ?? true;
    this.enableGamepad = opts.enableGamepad ?? false;
    this.bindings = opts.actionBindings ?? DEFAULT_BINDINGS;
    this.joystickRadius = opts.joystickRadius ?? 48;
    const base = opts.joystickPosition ?? { x: this.joystickRadius + 24, y: scene.scale.height - this.joystickRadius - 24 };
    this.joystickBase = new Phaser.Math.Vector2(base.x, base.y);
    for (const action of Object.keys(this.bindings)) this.ensureAction(action);
    if (this.enableKeyboard) this.createKeyboardKeys();
    if (this.enableTouch) this.createTouchInput(opts.joystickDepth ?? 900);
  }
  /** Updates axes2D and action down/justDown/justUp states for the current frame. */
  public update(): void {
    let x = 0;
    let y = 0;
    if (this.enableKeyboard) {
      x += this.keyDown('A') || this.keyDown('LEFT') ? -1 : 0;
      x += this.keyDown('D') || this.keyDown('RIGHT') ? 1 : 0;
      y += this.keyDown('W') || this.keyDown('UP') ? -1 : 0;
      y += this.keyDown('S') || this.keyDown('DOWN') ? 1 : 0;
    }
    x += this.joystickVector.x;
    y += this.joystickVector.y;
    const pad = this.enableGamepad ? this.scene.input.gamepad?.pad1 : null;
    if (pad?.connected) {
      x += pad.leftStick.x + (pad.left ? -1 : 0) + (pad.right ? 1 : 0);
      y += pad.leftStick.y + (pad.up ? -1 : 0) + (pad.down ? 1 : 0);
    }
    this.axes2D.set(x, y);
    if (this.axes2D.lengthSq() > 1) this.axes2D.normalize();
    for (const [action, state] of this.actions) {
      state.down = (this.bindings[action] ?? []).some((binding) => this.bindingDown(binding));
      state.justDown = state.down && !state.wasDown;
      state.justUp = !state.down && state.wasDown;
      if (state.justDown) state.downCallbacks.forEach((callback) => callback());
      if (state.justUp) state.upCallbacks.forEach((callback) => callback());
      state.wasDown = state.down;
    }
  }
  /** Returns true while the named action is held down. */
  public isActionDown(action: string): boolean {
    return this.actions.get(action)?.down ?? false;
  }
  /** Registers a callback fired during update when an action becomes down. */
  public onActionDown(action: string, callback: ActionCallback): void {
    this.ensureAction(action).downCallbacks.add(callback);
  }
  /** Registers a callback fired during update when an action becomes up. */
  public onActionUp(action: string, callback: ActionCallback): void {
    this.ensureAction(action).upCallbacks.add(callback);
  }
  /** Removes input listeners, keyboard captures, callbacks, and joystick graphics. */
  public destroy(): void {
    this.scene.input.off('pointerdown', this.handlePointerDown, this);
    this.scene.input.off('pointermove', this.handlePointerMove, this);
    this.scene.input.off('pointerup', this.handlePointerUp, this);
    this.scene.input.off('pointerupoutside', this.handlePointerUp, this);
    if (this.scene.input.keyboard) {
      this.keys.forEach((key) => this.scene.input.keyboard?.removeKey(key, true));
    }
    this.keys.clear();
    this.actions.clear();
    this.joystickGraphics?.destroy();
    this.joystickGraphics = null;
  }
  private createKeyboardKeys(): void {
    const names = new Set(['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT']);
    for (const list of Object.values(this.bindings)) {
      for (const binding of list) if (this.isKeyboardBinding(binding)) names.add(binding.toUpperCase());
    }
    names.forEach((name) => {
      const keyboard = this.scene.input.keyboard;
      if (keyboard) this.keys.set(name, keyboard.addKey(name));
    });
  }
  private createTouchInput(depth: number): void {
    this.joystickGraphics = this.scene.add.graphics().setScrollFactor(0).setDepth(depth);
    this.redrawJoystick(false);
    this.scene.input.on('pointerdown', this.handlePointerDown, this);
    this.scene.input.on('pointermove', this.handlePointerMove, this);
    this.scene.input.on('pointerup', this.handlePointerUp, this);
    this.scene.input.on('pointerupoutside', this.handlePointerUp, this);
  }
  private ensureAction(action: string): ActionState {
    let state = this.actions.get(action);
    if (!state) {
      state = { down: false, wasDown: false, justDown: false, justUp: false, downCallbacks: new Set(), upCallbacks: new Set() };
      this.actions.set(action, state);
    }
    return state;
  }
  private keyDown(name: string): boolean {
    return this.keys.get(name)?.isDown ?? false;
  }
  private bindingDown(binding: string): boolean {
    const key = binding.toUpperCase();
    if (key === 'POINTER1') return this.pointerPrimaryDown;
    const pad = this.enableGamepad ? this.scene.input.gamepad?.pad1 : null;
    if (pad?.connected && (key === 'GAMEPADA' || key === 'PADA')) return pad.A;
    if (pad?.connected && (key === 'GAMEPADB' || key === 'PADB')) return pad.B;
    return this.keyDown(key);
  }
  private isKeyboardBinding(binding: string): boolean {
    const key = binding.toUpperCase();
    return !key.startsWith('POINTER') && !key.startsWith('PAD') && !key.startsWith('GAMEPAD');
  }
  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.pointerId !== null) return;
    this.pointerId = pointer.id;
    this.pointerPrimaryDown = true;
    this.updateJoystick(pointer);
  }
  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.id === this.pointerId) this.updateJoystick(pointer);
  }
  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.pointerId) return;
    this.pointerId = null;
    this.pointerPrimaryDown = false;
    this.joystickVector.set(0, 0);
    this.redrawJoystick(false);
  }
  private updateJoystick(pointer: Phaser.Input.Pointer): void {
    const dx = pointer.x - this.joystickBase.x;
    const dy = pointer.y - this.joystickBase.y;
    this.joystickVector.set(dx, dy);
    if (this.joystickVector.length() > this.joystickRadius) this.joystickVector.setLength(this.joystickRadius);
    this.joystickVector.scale(1 / this.joystickRadius);
    this.redrawJoystick(true);
  }
  private redrawJoystick(active: boolean): void {
    if (!this.joystickGraphics) return;
    const thumb = this.joystickVector.clone().scale(this.joystickRadius).add(this.joystickBase);
    this.joystickGraphics.clear();
    this.joystickGraphics.lineStyle(2, 0xffffff, active ? 0.55 : 0.22).strokeCircle(this.joystickBase.x, this.joystickBase.y, this.joystickRadius);
    this.joystickGraphics.fillStyle(0xffffff, active ? 0.2 : 0.08).fillCircle(this.joystickBase.x, this.joystickBase.y, this.joystickRadius);
    this.joystickGraphics.fillStyle(0xffffff, active ? 0.75 : 0.22).fillCircle(thumb.x, thumb.y, this.joystickRadius * 0.35);
  }
}
