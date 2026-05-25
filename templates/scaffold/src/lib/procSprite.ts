/**
 * Procedural sprite factory for the scaffold template.
 *
 * Worker code keeps reaching for scene.add.rectangle / scene.add.circle and
 * setStrokeStyle to draw paddles, bricks, tiles, and bullets. That route uses
 * a Graphics object per instance, which costs more than a cached Texture in
 * the renderer. Helpers here render once into the Texture Manager keyed by
 * shape + size + color, then return cheap Image instances. Callers may attach
 * arcade bodies via arcadePhysics.attachDynamicBody / attachStaticBody.
 */
import Phaser from 'phaser';

/** Options for procRect. */
export interface ProcRectOpts {
  fill: number;
  alpha?: number;
  stroke?: number;
  strokeWidth?: number;
  strokeAlpha?: number;
  radius?: number;
}

/** Options for procCircle. */
export interface ProcCircleOpts {
  fill: number;
  alpha?: number;
  stroke?: number;
  strokeWidth?: number;
  strokeAlpha?: number;
}

/** Options for procRing. */
export interface ProcRingOpts {
  innerRadius: number;
  outerRadius: number;
  fill: number;
  alpha?: number;
}

/** Options for procTriangle. */
export interface ProcTriangleOpts {
  size: number;
  fill: number;
  alpha?: number;
  stroke?: number;
  strokeWidth?: number;
  rotation?: 'up' | 'down' | 'left' | 'right';
}

function ensureTexture(scene: Phaser.Scene, key: string, build: (graphics: Phaser.GameObjects.Graphics) => { width: number; height: number }): void {
  if (scene.textures.exists(key)) return;
  const graphics = scene.add.graphics();
  const { width, height } = build(graphics);
  graphics.generateTexture(key, width, height);
  graphics.destroy();
}

function rectKey(width: number, height: number, opts: ProcRectOpts): string {
  return `__procRect_${width}x${height}_${opts.fill.toString(16)}_${opts.alpha ?? 1}_${opts.stroke ?? 'none'}_${opts.strokeWidth ?? 0}_${opts.strokeAlpha ?? 1}_${opts.radius ?? 0}`;
}

function strokePad(strokeWidth: number | undefined, hasStroke: boolean): number {
  if (!hasStroke) return 1;
  return Math.ceil((strokeWidth ?? 1) / 2) + 1;
}

/** Creates a cached Image for a filled rectangle with optional stroke and corner radius. Texture pads by half the stroke width so the outline is not clipped. */
export function procRect(scene: Phaser.Scene, x: number, y: number, width: number, height: number, opts: ProcRectOpts): Phaser.GameObjects.Image {
  const key = rectKey(width, height, opts);
  const hasStroke = opts.stroke !== undefined;
  const pad = strokePad(opts.strokeWidth, hasStroke);
  const texW = width + pad * 2;
  const texH = height + pad * 2;
  ensureTexture(scene, key, (graphics) => {
    if (opts.radius && opts.radius > 0) {
      graphics.fillStyle(opts.fill, opts.alpha ?? 1).fillRoundedRect(pad, pad, width, height, opts.radius);
      if (hasStroke) graphics.lineStyle(opts.strokeWidth ?? 1, opts.stroke as number, opts.strokeAlpha ?? 1).strokeRoundedRect(pad, pad, width, height, opts.radius);
    } else {
      graphics.fillStyle(opts.fill, opts.alpha ?? 1).fillRect(pad, pad, width, height);
      if (hasStroke) graphics.lineStyle(opts.strokeWidth ?? 1, opts.stroke as number, opts.strokeAlpha ?? 1).strokeRect(pad, pad, width, height);
    }
    return { width: texW, height: texH };
  });
  return scene.add.image(x, y, key);
}

function circleKey(radius: number, opts: ProcCircleOpts): string {
  return `__procCircle_r${radius}_${opts.fill.toString(16)}_${opts.alpha ?? 1}_${opts.stroke ?? 'none'}_${opts.strokeWidth ?? 0}_${opts.strokeAlpha ?? 1}`;
}

/** Creates a cached Image for a filled circle with optional stroke. Texture pads by strokeWidth so the outline is not clipped. */
export function procCircle(scene: Phaser.Scene, x: number, y: number, radius: number, opts: ProcCircleOpts): Phaser.GameObjects.Image {
  const key = circleKey(radius, opts);
  const strokeWidth = opts.strokeWidth ?? 1;
  const pad = opts.stroke !== undefined ? strokeWidth + 1 : 1;
  const size = radius * 2 + pad * 2;
  ensureTexture(scene, key, (graphics) => {
    graphics.fillStyle(opts.fill, opts.alpha ?? 1).fillCircle(radius + pad, radius + pad, radius);
    if (opts.stroke !== undefined) graphics.lineStyle(strokeWidth, opts.stroke, opts.strokeAlpha ?? 1).strokeCircle(radius + pad, radius + pad, radius);
    return { width: size, height: size };
  });
  return scene.add.image(x, y, key);
}

/** Creates a cached Image for a filled ring drawn as a thick stroke at the mid-radius. */
export function procRing(scene: Phaser.Scene, x: number, y: number, opts: ProcRingOpts): Phaser.GameObjects.Image {
  const thickness = Math.max(1, opts.outerRadius - opts.innerRadius);
  const midRadius = (opts.outerRadius + opts.innerRadius) / 2;
  const key = `__procRing_${opts.innerRadius}_${opts.outerRadius}_${opts.fill.toString(16)}_${opts.alpha ?? 1}`;
  const size = opts.outerRadius * 2 + 2;
  ensureTexture(scene, key, (graphics) => {
    graphics.lineStyle(thickness, opts.fill, opts.alpha ?? 1).strokeCircle(opts.outerRadius + 1, opts.outerRadius + 1, midRadius);
    return { width: size, height: size };
  });
  return scene.add.image(x, y, key);
}

function trianglePoints(size: number, rotation: NonNullable<ProcTriangleOpts['rotation']>, offset: number): Phaser.Math.Vector2[] {
  const o = offset;
  switch (rotation) {
    case 'up': return [new Phaser.Math.Vector2(size / 2 + o, o), new Phaser.Math.Vector2(size + o, size + o), new Phaser.Math.Vector2(o, size + o)];
    case 'down': return [new Phaser.Math.Vector2(o, o), new Phaser.Math.Vector2(size + o, o), new Phaser.Math.Vector2(size / 2 + o, size + o)];
    case 'left': return [new Phaser.Math.Vector2(size + o, o), new Phaser.Math.Vector2(size + o, size + o), new Phaser.Math.Vector2(o, size / 2 + o)];
    case 'right': return [new Phaser.Math.Vector2(o, o), new Phaser.Math.Vector2(size + o, size / 2 + o), new Phaser.Math.Vector2(o, size + o)];
  }
}

/** Creates a cached Image for an equilateral triangle pointing in the requested direction. Texture pads by half the stroke width so the outline is not clipped. */
export function procTriangle(scene: Phaser.Scene, x: number, y: number, opts: ProcTriangleOpts): Phaser.GameObjects.Image {
  const rotation = opts.rotation ?? 'up';
  const key = `__procTri_${opts.size}_${opts.fill.toString(16)}_${opts.alpha ?? 1}_${rotation}_${opts.stroke ?? 'none'}_${opts.strokeWidth ?? 0}`;
  const hasStroke = opts.stroke !== undefined;
  const pad = strokePad(opts.strokeWidth, hasStroke);
  const texSize = opts.size + pad * 2;
  ensureTexture(scene, key, (graphics) => {
    const points = trianglePoints(opts.size, rotation, pad);
    graphics.fillStyle(opts.fill, opts.alpha ?? 1).fillPoints(points, true);
    if (hasStroke) graphics.lineStyle(opts.strokeWidth ?? 1, opts.stroke as number, 1).strokePoints(points, true, true);
    return { width: texSize, height: texSize };
  });
  return scene.add.image(x, y, key);
}
