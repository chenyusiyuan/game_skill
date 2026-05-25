/**
 * Scene-tracked timers and tweens for the scaffold template.
 *
 * Phaser's time.delayedCall, time.addEvent, and tweens.add do not auto-clean
 * on scene shutdown / restart. Helpers here keep a per-scene registry and wire
 * a single SHUTDOWN listener that removes every outstanding timer and stops
 * every active tween, so worker code is free of cross-scene leakage.
 */
import Phaser from 'phaser';

interface SceneRegistry {
  delays: Set<Phaser.Time.TimerEvent>;
  events: Set<Phaser.Time.TimerEvent>;
  tweens: Set<Phaser.Tweens.Tween>;
}

const sceneRegistries = new WeakMap<Phaser.Scene, SceneRegistry>();

function ensureRegistry(scene: Phaser.Scene): SceneRegistry {
  const existing = sceneRegistries.get(scene);
  if (existing) return existing;
  const registry: SceneRegistry = { delays: new Set(), events: new Set(), tweens: new Set() };
  sceneRegistries.set(scene, registry);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => clearSafeTimers(scene));
  scene.events.once(Phaser.Scenes.Events.DESTROY, () => clearSafeTimers(scene));
  return registry;
}

/** Schedules a one-shot delayed call that cancels itself on scene shutdown. */
export function safeDelay(scene: Phaser.Scene, ms: number, fn: () => void): Phaser.Time.TimerEvent {
  const registry = ensureRegistry(scene);
  const event = scene.time.delayedCall(ms, () => {
    registry.delays.delete(event);
    fn();
  });
  registry.delays.add(event);
  return event;
}

/** Schedules a recurring timer event that is removed on scene shutdown. */
export function safeRepeat(scene: Phaser.Scene, intervalMs: number, fn: () => void): Phaser.Time.TimerEvent {
  const registry = ensureRegistry(scene);
  const event = scene.time.addEvent({ delay: intervalMs, loop: true, callback: fn });
  registry.events.add(event);
  return event;
}

/** Adds a tween that is auto-stopped on scene shutdown and unregistered on its own complete. */
export function safeTween(scene: Phaser.Scene, opts: Phaser.Types.Tweens.TweenBuilderConfig): Phaser.Tweens.Tween {
  const registry = ensureRegistry(scene);
  const tween = scene.tweens.add(opts);
  registry.tweens.add(tween);
  tween.once(Phaser.Tweens.Events.TWEEN_COMPLETE, () => registry.tweens.delete(tween));
  tween.once(Phaser.Tweens.Events.TWEEN_STOP, () => registry.tweens.delete(tween));
  return tween;
}

/** Cancels a previously scheduled safeDelay or safeRepeat, regardless of state. */
export function cancelSafeTimer(scene: Phaser.Scene, event: Phaser.Time.TimerEvent): void {
  const registry = sceneRegistries.get(scene);
  if (!registry) {
    event.remove(false);
    return;
  }
  registry.delays.delete(event);
  registry.events.delete(event);
  event.remove(false);
}

/** Stops a previously added safeTween regardless of state (pending, active, paused, or completed). */
export function cancelSafeTween(scene: Phaser.Scene, tween: Phaser.Tweens.Tween): void {
  const registry = sceneRegistries.get(scene);
  if (registry) registry.tweens.delete(tween);
  tween.stop();
}

/** Clears every safe timer and tween for the scene; called automatically on shutdown. Stops tweens unconditionally so pending and paused tweens are also released. */
export function clearSafeTimers(scene: Phaser.Scene): void {
  const registry = sceneRegistries.get(scene);
  if (!registry) return;
  registry.delays.forEach((event) => event.remove(false));
  registry.events.forEach((event) => event.remove(false));
  registry.tweens.forEach((tween) => tween.stop());
  registry.delays.clear();
  registry.events.clear();
  registry.tweens.clear();
  sceneRegistries.delete(scene);
}
