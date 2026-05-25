/**
 * Phaser arcade physics helpers for the scaffold template.
 *
 * Wraps the high-frequency arcade body lifecycle calls so worker code can not
 * fall into the classic footguns: setSize/setCircle ordering, StaticBody
 * position drift after a setPosition, manually mutating body.position from a
 * collider callback, and forgotten setBounce defaults. Movement is always
 * driven through body.setVelocity (or scene.tweens), never through direct
 * body.position assignment.
 */
import Phaser from 'phaser';

type GameObjectWithBody = Phaser.GameObjects.GameObject & { x: number; y: number };
type ArcadeTarget = Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[] | Phaser.GameObjects.Group;

/** Options for attachDynamicBody. */
export interface DynamicBodyOpts {
  radius?: number;
  size?: { width: number; height: number };
  offset?: { x: number; y: number };
  bounce?: number | { x: number; y: number };
  collideWorldBounds?: boolean;
  onWorldBounds?: boolean;
  drag?: number | { x: number; y: number };
  maxVelocity?: number | { x: number; y: number };
  immovable?: boolean;
  allowGravity?: boolean;
}

/** Options for attachStaticBody. */
export interface StaticBodyOpts {
  size?: { width: number; height: number };
  offset?: { x: number; y: number };
}

/** Contact info exposed to wireCollider callbacks; derived from body.touching flags. */
export interface CollisionContact {
  normalX: number;
  normalY: number;
}

/** Attaches a dynamic Arcade body and applies the standard suite of options in safe order. */
export function attachDynamicBody(go: Phaser.GameObjects.GameObject, opts: DynamicBodyOpts = {}): Phaser.Physics.Arcade.Body {
  const scene = go.scene;
  scene.physics.add.existing(go);
  const body = (go as unknown as { body: Phaser.Physics.Arcade.Body }).body;
  if (opts.size) body.setSize(opts.size.width, opts.size.height);
  if (opts.radius !== undefined) {
    const ox = opts.offset?.x;
    const oy = opts.offset?.y;
    if (ox !== undefined && oy !== undefined) body.setCircle(opts.radius, ox, oy);
    else body.setCircle(opts.radius);
  } else if (opts.offset) {
    body.setOffset(opts.offset.x, opts.offset.y);
  }
  if (opts.bounce !== undefined) {
    const b = typeof opts.bounce === 'number' ? { x: opts.bounce, y: opts.bounce } : opts.bounce;
    body.setBounce(b.x, b.y);
  }
  if (opts.collideWorldBounds) body.setCollideWorldBounds(true);
  if (opts.onWorldBounds) body.onWorldBounds = true;
  if (opts.drag !== undefined) {
    const d = typeof opts.drag === 'number' ? { x: opts.drag, y: opts.drag } : opts.drag;
    body.setDrag(d.x, d.y);
  }
  if (opts.maxVelocity !== undefined) {
    const m = typeof opts.maxVelocity === 'number' ? { x: opts.maxVelocity, y: opts.maxVelocity } : opts.maxVelocity;
    body.setMaxVelocity(m.x, m.y);
  }
  if (opts.immovable) body.setImmovable(true);
  if (opts.allowGravity === false) body.setAllowGravity(false);
  return body;
}

/** Attaches a static Arcade body sized to the GameObject; centers automatically. */
export function attachStaticBody(go: Phaser.GameObjects.GameObject, opts: StaticBodyOpts = {}): Phaser.Physics.Arcade.StaticBody {
  const scene = go.scene;
  scene.physics.add.existing(go, true);
  const body = (go as unknown as { body: Phaser.Physics.Arcade.StaticBody }).body;
  if (opts.size) body.setSize(opts.size.width, opts.size.height);
  if (opts.offset) body.setOffset(opts.offset.x, opts.offset.y);
  return body;
}

/** Moves a static-bodied GameObject without leaving the body at the old hitbox. */
export function moveStaticBody(go: GameObjectWithBody, x: number, y: number): void {
  go.x = x;
  go.y = y;
  const body = (go as unknown as { body?: Phaser.Physics.Arcade.StaticBody }).body;
  if (body && typeof body.updateFromGameObject === 'function') body.updateFromGameObject();
}

/** Sets velocity on a dynamic body. The canonical movement primitive — use this for launch, AI input, knockback, or projectile spawn. Do not assign body.position directly anywhere in the codebase. */
export function setVelocity(go: Phaser.GameObjects.GameObject, vx: number, vy: number): void {
  const body = (go as unknown as { body?: Phaser.Physics.Arcade.Body }).body;
  if (!body) return;
  body.setVelocity(vx, vy);
}

function readContact(go: Phaser.GameObjects.GameObject): CollisionContact {
  const body = (go as unknown as { body?: Phaser.Physics.Arcade.Body }).body;
  if (!body) return { normalX: 0, normalY: 0 };
  const t = body.touching;
  let nx = 0;
  let ny = 0;
  if (t.up) ny = -1;
  else if (t.down) ny = 1;
  if (t.left) nx = -1;
  else if (t.right) nx = 1;
  return { normalX: nx, normalY: ny };
}

/**
 * Registers a Phaser collider. The callback runs AFTER Phaser's automatic
 * separate+bounce step, so the dynamic body has already been pushed out of the
 * static body and its velocity has already been reflected per the bounce
 * coefficient set at attachDynamicBody time.
 *
 * The callback is therefore only for non-physics responses: scoring, brick
 * destruction, milestone emission, particle effects, sound. Do not modify the
 * dynamic body's velocity here — Phaser already did, and a second reflection
 * would put the object back on its original heading and reproduce tunneling.
 *
 * If you need a non-bouncing impact, set bounce: 0 at attachDynamicBody and
 * still let Phaser separate; or use wireOverlap which performs no separation.
 */
export function wireCollider<A extends Phaser.GameObjects.GameObject, B extends Phaser.GameObjects.GameObject>(
  scene: Phaser.Scene,
  a: ArcadeTarget,
  b: ArcadeTarget,
  onContact?: (a: A, b: B, contact: CollisionContact) => void,
): Phaser.Physics.Arcade.Collider {
  const callback: ArcadePhysicsCallback | undefined = onContact
    ? (objA, objB) => onContact(objA as unknown as A, objB as unknown as B, readContact(objA as Phaser.GameObjects.GameObject))
    : undefined;
  return scene.physics.add.collider(a as ArcadeColliderType, b as ArcadeColliderType, callback);
}

/** Registers a Phaser overlap (no separation). The callback receives both objects. */
export function wireOverlap<A extends Phaser.GameObjects.GameObject, B extends Phaser.GameObjects.GameObject>(
  scene: Phaser.Scene,
  a: ArcadeTarget,
  b: ArcadeTarget,
  onOverlap: (a: A, b: B) => void,
): Phaser.Physics.Arcade.Collider {
  return scene.physics.add.overlap(
    a as ArcadeColliderType,
    b as ArcadeColliderType,
    (objA, objB) => onOverlap(objA as unknown as A, objB as unknown as B),
  );
}

type ArcadePhysicsCallback = Phaser.Types.Physics.Arcade.ArcadePhysicsCallback;
type ArcadeColliderType = Phaser.Types.Physics.Arcade.ArcadeColliderType;
