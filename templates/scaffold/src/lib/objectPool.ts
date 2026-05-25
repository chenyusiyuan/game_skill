/**
 * Small Arcade object-pool helpers for projectiles, enemies, pickups, and wave
 * spawns. Phaser groups already do the core pooling; these wrappers standardize
 * active / visible / body-enable behavior so reused objects do not keep stale
 * bodies, velocity, or invisible-but-colliding state.
 */
import Phaser from 'phaser';

type PoolBody = Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody;

export type ArcadePoolObject = Phaser.GameObjects.GameObject & {
  x: number;
  y: number;
  body?: PoolBody;
  setActive(active: boolean): ArcadePoolObject;
  setVisible(visible: boolean): ArcadePoolObject;
};

export interface ArcadePoolOpts {
  classType?: Function;
  maxSize?: number;
  defaultKey?: string;
  defaultFrame?: string | number;
  runChildUpdate?: boolean;
  allowGravity?: boolean;
  immovable?: boolean;
  collideWorldBounds?: boolean;
}

export interface DespawnPoolOpts {
  disableBody?: boolean;
  resetPosition?: { x: number; y: number };
}

/** Creates a dynamic Arcade Physics Group configured as a pool. */
export function createArcadePool(scene: Phaser.Scene, opts: ArcadePoolOpts = {}): Phaser.Physics.Arcade.Group {
  const config: Phaser.Types.Physics.Arcade.PhysicsGroupConfig = {
    classType: opts.classType ?? Phaser.Physics.Arcade.Image,
    maxSize: opts.maxSize ?? -1,
    runChildUpdate: opts.runChildUpdate ?? false,
    allowGravity: opts.allowGravity ?? false,
    immovable: opts.immovable ?? false,
    collideWorldBounds: opts.collideWorldBounds ?? false,
  };
  if (opts.defaultKey !== undefined) config.defaultKey = opts.defaultKey;
  if (opts.defaultFrame !== undefined) config.defaultFrame = opts.defaultFrame;
  return scene.physics.add.group(config);
}

/** Gets or creates an object from a pool and re-enables its body at x/y. */
export function spawnFromPool<T extends ArcadePoolObject>(
  pool: Phaser.Physics.Arcade.Group,
  x: number,
  y: number,
  texture?: string,
  frame?: string | number,
): T | null {
  const object = pool.get(x, y, texture, frame, true) as T | null;
  if (!object) return null;
  if (texture && hasSetTexture(object)) object.setTexture(texture, frame);
  object.setActive(true);
  object.setVisible(true);
  object.x = x;
  object.y = y;
  resetBody(object, x, y);
  return object;
}

/** Returns an object to the pool and disables its Arcade body by default. */
export function despawnToPool(pool: Phaser.Physics.Arcade.Group, object: ArcadePoolObject, opts: DespawnPoolOpts = {}): void {
  pool.killAndHide(object);
  object.setActive(false);
  object.setVisible(false);
  if (opts.resetPosition) {
    object.x = opts.resetPosition.x;
    object.y = opts.resetPosition.y;
  }
  if (opts.disableBody ?? true) disableBody(object.body);
}

function resetBody(object: ArcadePoolObject, x: number, y: number): void {
  const body = object.body;
  if (!body) return;
  body.enable = true;
  body.reset(x, y);
  if (body instanceof Phaser.Physics.Arcade.Body) body.setVelocity(0, 0);
  else body.updateFromGameObject();
}

function disableBody(body: PoolBody | undefined): void {
  if (!body) return;
  body.enable = false;
  if (body instanceof Phaser.Physics.Arcade.Body) body.setVelocity(0, 0);
}

function hasSetTexture(object: ArcadePoolObject): object is ArcadePoolObject & { setTexture: (texture: string, frame?: string | number) => void } {
  return 'setTexture' in object && typeof object.setTexture === 'function';
}
