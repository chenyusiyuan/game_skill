/**
 * Phaser visual helpers for the scaffold template.
 *
 * Core helpers are CANVAS-safe: procedural textures, particles, text, rings,
 * camera shake/flash/fade, hit impact, and boss entry avoid WebGL-only APIs.
 * FX helpers are optional WebGL fallbacks: applyGlow and applyBloom return null
 * under CANVAS or when the target has no supported FX component.
 */
import Phaser from 'phaser';
const TEXTURE_KEYS = {
  circle: '__white_circle',
  square: '__white_square',
  diamond: '__white_diamond',
  star: '__white_star',
} as const;
/** Options for burstParticles. */
export interface BurstParticleOpts {
  texture?: string;
  color?: number;
  count?: number;
  speed?: { min: number; max: number };
  lifespan?: number;
  scale?: { start: number; end: number };
  blendMode?: 'ADD' | 'NORMAL' | 'MULTIPLY';
  depth?: number;
}
/** Options for damageNumber. */
export interface DamageNumberOpts {
  color?: string;
  fontSize?: string;
  fontStyle?: string;
  duration?: number;
  rise?: number;
  depth?: number;
}
/** Options for flashRing. */
export interface FlashRingOpts {
  startRadius?: number;
  endRadius?: number;
  duration?: number;
  alpha?: number;
  lineWidth?: number;
  depth?: number;
}
/** Options for bossEntry. */
export interface BossEntryOpts {
  warningColor?: number;
  durationMs?: number;
  barHeight?: number;
  depth?: number;
}
/** Named screen-shake presets. */
export type ShakePreset = 'micro' | 'hit' | 'death' | 'explosion';
/** Custom screen-shake preset shape. */
export interface ShakeConfig {
  duration: number;
  intensity: number;
}
/** Named screen-flash presets or RGB color object. */
export type ScreenFlashColor = 'white' | 'red' | 'green' | 'gold' | { r: number; g: number; b: number };
/** Named hit-impact presets. */
export type HitImpactPreset = 'light' | 'medium' | 'heavy';
/** Game Object shape accepted by optional WebGL glow. */
export type GlowTarget = Phaser.GameObjects.GameObject & { preFX?: Phaser.GameObjects.Components.FX | null };
/** Game Object or camera shape accepted by optional WebGL bloom. */
export type BloomTarget = (Phaser.GameObjects.GameObject | Phaser.Cameras.Scene2D.Camera) & {
  postFX?: Phaser.GameObjects.Components.FX | null;
  scene: Phaser.Scene;
};
/** Ensures the scaffold procedural white textures exist in the Texture Manager. */
export function ensureProceduralTextures(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  if (!scene.textures.exists(TEXTURE_KEYS.circle)) {
    g.clear().fillStyle(0xffffff, 1).fillCircle(16, 16, 16).generateTexture(TEXTURE_KEYS.circle, 32, 32);
  }
  if (!scene.textures.exists(TEXTURE_KEYS.square)) {
    g.clear().fillStyle(0xffffff, 1).fillRect(0, 0, 32, 32).generateTexture(TEXTURE_KEYS.square, 32, 32);
  }
  if (!scene.textures.exists(TEXTURE_KEYS.diamond)) {
    g.clear().fillStyle(0xffffff, 1).fillPoints([new Phaser.Math.Vector2(16, 0), new Phaser.Math.Vector2(32, 16), new Phaser.Math.Vector2(16, 32), new Phaser.Math.Vector2(0, 16)], true).generateTexture(TEXTURE_KEYS.diamond, 32, 32);
  }
  if (!scene.textures.exists(TEXTURE_KEYS.star)) {
    const points: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < 10; i += 1) {
      const r = i % 2 === 0 ? 16 : 7;
      const a = -Math.PI / 2 + i * Math.PI / 5;
      points.push(new Phaser.Math.Vector2(16 + Math.cos(a) * r, 16 + Math.sin(a) * r));
    }
    g.clear().fillStyle(0xffffff, 1).fillPoints(points, true).generateTexture(TEXTURE_KEYS.star, 32, 32);
  }
  g.destroy();
}
/** Emits a short procedural particle burst and destroys the emitter after it fades. */
export function burstParticles(scene: Phaser.Scene, x: number, y: number, opts: BurstParticleOpts = {}): Phaser.GameObjects.Particles.ParticleEmitter {
  ensureProceduralTextures(scene);
  const lifespan = opts.lifespan ?? 380;
  const blend = opts.blendMode ?? 'ADD';
  const emitter = scene.add.particles(x, y, opts.texture ?? TEXTURE_KEYS.circle, {
    speed: opts.speed ?? { min: 56, max: 160 },
    lifespan,
    scale: opts.scale ?? { start: 0.7, end: 0 },
    alpha: { start: 1, end: 0 },
    rotate: { min: 0, max: 360 },
    tint: opts.color ?? 0xffffff,
    blendMode: Phaser.BlendModes[blend],
    emitting: false,
  });
  emitter.setDepth(opts.depth ?? 500);
  emitter.explode(opts.count ?? 16);
  scene.time.delayedCall(lifespan + 80, () => emitter.destroy());
  return emitter;
}
/** Creates a floating damage/value number that destroys itself after tweening. */
export function damageNumber(scene: Phaser.Scene, x: number, y: number, value: number | string, opts: DamageNumberOpts = {}): Phaser.GameObjects.Text {
  const text = scene.add.text(x, y, String(value), {
    fontFamily: 'Arial, sans-serif',
    fontSize: opts.fontSize ?? '20px',
    fontStyle: opts.fontStyle ?? 'bold',
    color: opts.color ?? '#ffe070',
    stroke: '#000000',
    strokeThickness: 4,
  }).setOrigin(0.5).setDepth(opts.depth ?? 600);
  scene.tweens.add({ targets: text, y: y - (opts.rise ?? 34), alpha: 0, scale: 1.25, duration: opts.duration ?? 650, ease: 'Cubic.easeOut', onComplete: () => text.destroy() });
  return text;
}
/** Draws an expanding ring flash and destroys it when fully transparent. */
export function flashRing(scene: Phaser.Scene, x: number, y: number, color: number, opts: FlashRingOpts = {}): Phaser.GameObjects.Graphics {
  const startRadius = opts.startRadius ?? 18;
  const endRadius = opts.endRadius ?? 44;
  const ring = scene.add.graphics().setPosition(x, y).setDepth(opts.depth ?? 550);
  ring.lineStyle(opts.lineWidth ?? 3, color, opts.alpha ?? 1).strokeCircle(0, 0, startRadius);
  scene.tweens.add({ targets: ring, scale: endRadius / Math.max(1, startRadius), alpha: 0, duration: opts.duration ?? 420, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  return ring;
}
/** Plays a generic level-up flash using camera flash, particles, and a ring. */
export function levelUpFlash(scene: Phaser.Scene, color: number = 0xffd166): void {
  const camera = scene.cameras.main;
  screenFlash(scene, rgbFromNumber(color), 180);
  burstParticles(scene, camera.midPoint.x, camera.midPoint.y, { color, count: 34, speed: { min: 84, max: 240 }, texture: TEXTURE_KEYS.star });
  flashRing(scene, camera.midPoint.x, camera.midPoint.y, color, { startRadius: 36, endRadius: 86, duration: 620 });
}
/** Applies a forced camera shake from a named preset or custom config. */
export function screenShake(scene: Phaser.Scene, preset: ShakePreset | ShakeConfig): void {
  const presets: Record<ShakePreset, ShakeConfig> = {
    micro: { duration: 60, intensity: 0.004 },
    hit: { duration: 120, intensity: 0.01 },
    death: { duration: 260, intensity: 0.018 },
    explosion: { duration: 360, intensity: 0.028 },
  };
  const p = typeof preset === 'string' ? presets[preset] : preset;
  scene.cameras.main.shake(p.duration, p.intensity, true);
}
/** Applies a forced camera flash from a preset color or RGB object. */
export function screenFlash(scene: Phaser.Scene, color: ScreenFlashColor, duration: number = 120): void {
  const rgb = typeof color === 'string' ? {
    white: { r: 255, g: 255, b: 255 },
    red: { r: 255, g: 51, b: 68 },
    green: { r: 66, g: 245, b: 141 },
    gold: { r: 255, g: 209, b: 102 },
  }[color] : color;
  scene.cameras.main.flash(duration, rgb.r, rgb.g, rgb.b, true);
}
/** Starts a camera fade out and invokes onComplete on FADE_OUT_COMPLETE. */
export function screenFadeOut(scene: Phaser.Scene, duration: number, color: number, onComplete?: () => void): void {
  if (onComplete) scene.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, onComplete);
  scene.cameras.main.fadeOut(duration, (color >> 16) & 255, (color >> 8) & 255, color & 255);
}
/** Plays hit feedback and uses scene-timer hit-stop for medium and heavy presets. */
export function hitImpact(scene: Phaser.Scene, preset: HitImpactPreset): void {
  const settings: Record<HitImpactPreset, { flash: ScreenFlashColor; shake: ShakePreset; stop: number }> = {
    light: { flash: 'white', shake: 'micro', stop: 0 },
    medium: { flash: 'red', shake: 'hit', stop: 55 },
    heavy: { flash: 'gold', shake: 'explosion', stop: 90 },
  };
  const p = settings[preset];
  screenFlash(scene, p.flash, preset === 'light' ? 70 : 110);
  screenShake(scene, p.shake);
  if (p.stop > 0) {
    scene.time.timeScale = preset === 'heavy' ? 0.12 : 0.22;
    scene.time.delayedCall(p.stop, () => { scene.time.timeScale = 1; });
  }
}
/** Plays a boss-entry red flash, shake, and top warning bar that self-destroys. */
export function bossEntry(scene: Phaser.Scene, opts: BossEntryOpts = {}): Phaser.GameObjects.Graphics {
  const camera = scene.cameras.main;
  const color = opts.warningColor ?? 0xff2233;
  const duration = opts.durationMs ?? 1200;
  screenFlash(scene, rgbFromNumber(color), 180);
  screenShake(scene, 'explosion');
  const bar = scene.add.graphics().setScrollFactor(0).setDepth(opts.depth ?? 900);
  bar.fillStyle(color, 0.9).fillRect(0, 0, camera.width, opts.barHeight ?? 18);
  scene.tweens.add({ targets: bar, alpha: 0, delay: Math.max(0, duration - 300), duration: 300, onComplete: () => bar.destroy() });
  return bar;
}
/** Adds a WebGL glow FX when supported; returns null under CANVAS or unsupported targets. */
export function applyGlow(target: GlowTarget, color: number = 0xffffff, strength: number = 4): Phaser.FX.Glow | null {
  if (target.scene.game.renderer.type !== Phaser.WEBGL || !target.preFX) return null;
  return target.preFX.addGlow(color, strength, 0, false);
}
/** Adds a WebGL bloom FX when supported; returns null under CANVAS or unsupported targets. */
export function applyBloom(targetOrCamera: BloomTarget, color: number = 0xffffff, strength: number = 1): Phaser.FX.Bloom | null {
  if (targetOrCamera.scene.game.renderer.type !== Phaser.WEBGL || !targetOrCamera.postFX) return null;
  return targetOrCamera.postFX.addBloom(color, 1, 1, strength, strength, 4);
}
function rgbFromNumber(color: number): { r: number; g: number; b: number } {
  return { r: (color >> 16) & 255, g: (color >> 8) & 255, b: color & 255 };
}
