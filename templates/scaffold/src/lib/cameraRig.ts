/**
 * Camera follow rig for the scaffold template.
 *
 * cameras.main.startFollow(target, roundPixels, lerpX, lerpY) plus setBounds
 * plus setDeadzone is the standard combo for top-down and side-scrolling
 * cases. Worker code keeps mis-ordering the lerp arguments or forgets to
 * setBounds, which lets the camera drift to negative coordinates and produce
 * black-frame screenshots. This helper gives a single named-options entry
 * point and a small handle for retargeting and stop.
 */
import Phaser from 'phaser';

/** Options for attachCameraFollow. */
export interface CameraFollowOpts {
  worldBounds?: { x: number; y: number; width: number; height: number };
  syncPhysicsBounds?: boolean;
  deadzone?: { width: number; height: number };
  lerp?: number | { x: number; y: number };
  roundPixels?: boolean;
  zoom?: number;
  followOffset?: { x: number; y: number };
}

/** Handle returned by attachCameraFollow for retargeting and stop. */
export interface CameraRigHandle {
  setTarget(target: Phaser.GameObjects.GameObject): void;
  setZoom(zoom: number): void;
  stop(): void;
}

function lerpPair(value: CameraFollowOpts['lerp']): { x: number; y: number } {
  if (value === undefined) return { x: 0.1, y: 0.1 };
  if (typeof value === 'number') return { x: value, y: value };
  return value;
}

/** Configures cameras.main with bounds, follow, deadzone, and zoom in the right order. */
export function attachCameraFollow(scene: Phaser.Scene, target: Phaser.GameObjects.GameObject, opts: CameraFollowOpts = {}): CameraRigHandle {
  const camera = scene.cameras.main;
  if (opts.worldBounds) {
    const bounds = opts.worldBounds;
    camera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    if (opts.syncPhysicsBounds !== false) scene.physics.world.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
  }
  if (opts.zoom !== undefined) camera.setZoom(opts.zoom);
  const lerp = lerpPair(opts.lerp);
  const roundPixels = opts.roundPixels ?? true;
  camera.startFollow(target, roundPixels, lerp.x, lerp.y);
  if (opts.followOffset) camera.setFollowOffset(opts.followOffset.x, opts.followOffset.y);
  if (opts.deadzone) camera.setDeadzone(opts.deadzone.width, opts.deadzone.height);
  return {
    setTarget(nextTarget: Phaser.GameObjects.GameObject): void {
      camera.startFollow(nextTarget, roundPixels, lerp.x, lerp.y);
      if (opts.followOffset) camera.setFollowOffset(opts.followOffset.x, opts.followOffset.y);
    },
    setZoom(zoom: number): void {
      camera.setZoom(zoom);
    },
    stop(): void {
      camera.stopFollow();
    },
  };
}

/** Sets only the world bounds for both camera and physics, without enabling follow. */
export function setWorldBounds(scene: Phaser.Scene, bounds: { x: number; y: number; width: number; height: number }, syncPhysicsBounds: boolean = true): void {
  scene.cameras.main.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
  if (syncPhysicsBounds) scene.physics.world.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
}
