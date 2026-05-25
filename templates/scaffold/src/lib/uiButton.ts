/**
 * Lightweight UI button helpers for pause, start, restart, mute, and result
 * screens. They wrap setInteractive, hover/down/disabled state, event
 * propagation, and fixed-to-camera scroll factor in one place.
 */
import Phaser from 'phaser';

export interface ButtonColors {
  background?: number;
  hover?: number;
  down?: number;
  disabled?: number;
  border?: number;
  text?: string;
  textDisabled?: string;
}

export interface TextButtonOpts {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  onClick: () => void;
  depth?: number;
  fixedToCamera?: boolean;
  disabled?: boolean;
  fontSize?: string;
  fontFamily?: string;
  colors?: ButtonColors;
}

export interface IconButtonOpts extends Omit<TextButtonOpts, 'text'> {
  iconTexture: string;
  iconFrame?: string | number;
  iconSize?: number;
  text?: string;
}

export interface ButtonHandle {
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text | null;
  icon: Phaser.GameObjects.Image | null;
  setEnabled(enabled: boolean): void;
  setText(text: string): void;
  destroy(): void;
}

type ButtonState = 'idle' | 'hover' | 'down' | 'disabled';

const DEFAULT_COLORS: Required<ButtonColors> = {
  background: 0x213547,
  hover: 0x2f4d68,
  down: 0x162433,
  disabled: 0x59636d,
  border: 0xffffff,
  text: '#ffffff',
  textDisabled: '#c8d0d8',
};

/** Creates a text button backed by a fixed-size Container hit area. */
export function makeTextButton(scene: Phaser.Scene, opts: TextButtonOpts): ButtonHandle {
  return buildButton(scene, opts);
}

/** Creates an icon button; if the texture is missing it safely falls back to text-only. */
export function makeIconButton(scene: Phaser.Scene, opts: IconButtonOpts): ButtonHandle {
  return buildButton(scene, opts);
}

function buildButton(scene: Phaser.Scene, opts: TextButtonOpts | IconButtonOpts): ButtonHandle {
  const colors = { ...DEFAULT_COLORS, ...opts.colors };
  let state: ButtonState = opts.disabled ? 'disabled' : 'idle';
  const container = scene.add.container(opts.x, opts.y).setDepth(opts.depth ?? 900);
  const background = scene.add.rectangle(0, 0, opts.width, opts.height, colors.background, 0.94)
    .setStrokeStyle(2, colors.border, 0.72);
  const icon = createIcon(scene, opts);
  const label = createLabel(scene, opts, icon !== null);
  const children: Phaser.GameObjects.GameObject[] = [background];
  if (icon) children.push(icon);
  if (label) children.push(label);
  container.add(children);
  container.setSize(opts.width, opts.height);
  container.setInteractive(
    new Phaser.Geom.Rectangle(-opts.width / 2, -opts.height / 2, opts.width, opts.height),
    Phaser.Geom.Rectangle.Contains,
  );
  if (opts.fixedToCamera ?? true) container.setScrollFactor(0, 0, true);

  const applyState = (next: ButtonState): void => {
    state = next;
    const disabled = state === 'disabled';
    const color = state === 'down' ? colors.down : state === 'hover' ? colors.hover : disabled ? colors.disabled : colors.background;
    background.setFillStyle(color, disabled ? 0.68 : 0.94);
    label?.setColor(disabled ? colors.textDisabled : colors.text);
    icon?.setAlpha(disabled ? 0.45 : 1);
  };

  container.on('pointerover', (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
    stopEvent(event);
    if (state !== 'disabled') applyState('hover');
  });
  container.on('pointerout', (_pointer: Phaser.Input.Pointer, event: Phaser.Types.Input.EventData) => {
    stopEvent(event);
    if (state !== 'disabled') applyState('idle');
  });
  container.on('pointerdown', (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
    stopEvent(event);
    if (state !== 'disabled') applyState('down');
  });
  container.on('pointerup', (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
    stopEvent(event);
    if (state === 'disabled') return;
    applyState('hover');
    opts.onClick();
  });

  applyState(state);

  return {
    container,
    background,
    label,
    icon,
    setEnabled(enabled: boolean): void {
      applyState(enabled ? 'idle' : 'disabled');
    },
    setText(text: string): void {
      label?.setText(text);
    },
    destroy(): void {
      container.destroy(true);
    },
  };
}

function createIcon(scene: Phaser.Scene, opts: TextButtonOpts | IconButtonOpts): Phaser.GameObjects.Image | null {
  if (!('iconTexture' in opts) || !scene.textures.exists(opts.iconTexture)) return null;
  const icon = scene.add.image(opts.text ? -opts.width * 0.24 : 0, 0, opts.iconTexture, opts.iconFrame);
  const size = opts.iconSize ?? Math.max(12, Math.min(opts.width, opts.height) * 0.52);
  icon.setDisplaySize(size, size);
  return icon;
}

function createLabel(scene: Phaser.Scene, opts: TextButtonOpts | IconButtonOpts, hasIcon: boolean): Phaser.GameObjects.Text | null {
  const text = 'text' in opts ? opts.text : undefined;
  if (!text) return null;
  return scene.add.text(hasIcon ? opts.width * 0.12 : 0, 0, text, {
    fontFamily: opts.fontFamily ?? 'Arial, sans-serif',
    fontSize: opts.fontSize ?? '18px',
    color: opts.colors?.text ?? DEFAULT_COLORS.text,
    align: 'center',
  }).setOrigin(0.5);
}

function stopEvent(event: Phaser.Types.Input.EventData | undefined): void {
  event?.stopPropagation();
}
