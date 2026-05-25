import Phaser from 'phaser';
/** Options for a fixed, asset-free meter bar. */
export interface MeterBarOpts {
  x: number;
  y: number;
  width: number;
  height: number;
  current?: number;
  max?: number;
  color?: number;
  bgColor?: number;
  borderColor?: number;
  showText?: boolean;
  textColor?: string;
  label?: string;
  depth?: number;
  fixedToCamera?: boolean;
}
/** Handle returned by meterBar for updating or destroying the bar. */
export interface MeterBarHandle {
  setValue(current: number, max?: number): void;
  setColor(color: number): void;
  destroy(): void;
}
/** Creates a camera-fixed Graphics meter with optional text. */
export function meterBar(scene: Phaser.Scene, opts: MeterBarOpts): MeterBarHandle {
  const depth = opts.depth ?? 1000;
  const graphics = scene.add.graphics().setDepth(depth);
  const labelText = opts.showText ? scene.add.text(opts.x + opts.width / 2, opts.y + opts.height / 2, '', {
    fontFamily: 'Arial, sans-serif',
    fontSize: `${Math.max(10, Math.floor(opts.height * 0.62))}px`,
    color: opts.textColor ?? '#ffffff',
    stroke: '#000000',
    strokeThickness: 2,
  }).setOrigin(0.5).setDepth(depth + 1) : null;
  if (opts.fixedToCamera !== false) {
    graphics.setScrollFactor(0);
    labelText?.setScrollFactor(0);
  }
  let current = opts.current ?? opts.max ?? 1;
  let max = opts.max ?? 1;
  let color = opts.color ?? 0x42f58d;
  const draw = (): void => {
    const pct = max <= 0 ? 0 : Phaser.Math.Clamp(current / max, 0, 1);
    graphics.clear();
    graphics.fillStyle(opts.bgColor ?? 0x101820, 0.85).fillRoundedRect(opts.x, opts.y, opts.width, opts.height, 4);
    graphics.fillStyle(color, 1).fillRoundedRect(opts.x + 2, opts.y + 2, (opts.width - 4) * pct, opts.height - 4, 3);
    graphics.lineStyle(1, opts.borderColor ?? 0xffffff, 0.65).strokeRoundedRect(opts.x, opts.y, opts.width, opts.height, 4);
    labelText?.setText(`${opts.label ? `${opts.label} ` : ''}${Math.ceil(current)}/${Math.ceil(max)}`);
  };
  draw();
  return {
    setValue(nextCurrent: number, nextMax?: number): void {
      current = nextCurrent;
      if (nextMax !== undefined) max = nextMax;
      draw();
    },
    setColor(nextColor: number): void {
      color = nextColor;
      draw();
    },
    destroy(): void {
      graphics.destroy();
      labelText?.destroy();
    },
  };
}
/** Options for a fixed Phaser Text status label. */
export interface StatusTextOpts {
  x: number;
  y: number;
  label?: string;
  fontSize?: string;
  color?: string;
  fontStyle?: string;
  depth?: number;
  fixedToCamera?: boolean;
}
/** Handle returned by statusText for updating or destroying the text. */
export interface StatusTextHandle {
  setText(value: string | number): void;
  destroy(): void;
}
/** Creates a camera-fixed Text label without requiring initial text. */
export function statusText(scene: Phaser.Scene, opts: StatusTextOpts): StatusTextHandle {
  const format = (value: string | number = ''): string => `${opts.label ? `${opts.label}: ` : ''}${value}`;
  const text = scene.add.text(opts.x, opts.y, format(), {
    fontFamily: 'Arial, sans-serif',
    fontSize: opts.fontSize ?? '18px',
    fontStyle: opts.fontStyle ?? '',
    color: opts.color ?? '#ffffff',
    stroke: '#000000',
    strokeThickness: 3,
  }).setDepth(opts.depth ?? 1000);
  if (opts.fixedToCamera !== false) text.setScrollFactor(0);
  return {
    setText(value: string | number): void {
      text.setText(format(value));
    },
    destroy(): void {
      text.destroy();
    },
  };
}
/** Options for a fixed, procedural icon slot. */
export interface IconSlotOpts {
  x: number;
  y: number;
  size: number;
  iconText?: string;
  iconColor?: string;
  bgColor?: number;
  borderColor?: number;
  level?: number;
  active?: boolean;
  depth?: number;
  fixedToCamera?: boolean;
}
/** Handle returned by iconSlot for updating state or destroying the slot. */
export interface IconSlotHandle {
  setLevel(level: number): void;
  setActive(active: boolean): void;
  destroy(): void;
}
/** Creates a square Graphics/Text icon slot with level badge and active border. */
export function iconSlot(scene: Phaser.Scene, opts: IconSlotOpts): IconSlotHandle {
  const depth = opts.depth ?? 1000;
  const graphics = scene.add.graphics().setDepth(depth);
  const icon = scene.add.text(opts.x + opts.size / 2, opts.y + opts.size / 2, opts.iconText ?? '', {
    fontFamily: 'Arial, sans-serif',
    fontSize: `${Math.max(12, Math.floor(opts.size * 0.42))}px`,
    color: opts.iconColor ?? '#ffffff',
    fontStyle: 'bold',
  }).setOrigin(0.5).setDepth(depth + 1);
  const badge = scene.add.text(opts.x + opts.size - 5, opts.y + opts.size - 4, '', {
    fontFamily: 'Arial, sans-serif',
    fontSize: `${Math.max(10, Math.floor(opts.size * 0.28))}px`,
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 2,
  }).setOrigin(1, 1).setDepth(depth + 2);
  if (opts.fixedToCamera !== false) {
    graphics.setScrollFactor(0);
    icon.setScrollFactor(0);
    badge.setScrollFactor(0);
  }
  let level = opts.level ?? 0;
  let active = opts.active ?? true;
  const draw = (): void => {
    const s = opts.size;
    graphics.clear();
    graphics.fillStyle(opts.bgColor ?? 0x121722, active ? 0.9 : 0.45).fillRoundedRect(opts.x, opts.y, s, s, 5);
    graphics.lineStyle(active ? 3 : 1, active ? opts.borderColor ?? 0xffd166 : 0x666666, active ? 0.95 : 0.45).strokeRoundedRect(opts.x, opts.y, s, s, 5);
    badge.setText(level > 0 ? String(level) : '');
    icon.setAlpha(active ? 1 : 0.4);
    badge.setAlpha(active ? 1 : 0.4);
  };
  draw();
  return {
    setLevel(nextLevel: number): void {
      level = nextLevel;
      draw();
    },
    setActive(nextActive: boolean): void {
      active = nextActive;
      draw();
    },
    destroy(): void {
      graphics.destroy();
      icon.destroy();
      badge.destroy();
    },
  };
}
