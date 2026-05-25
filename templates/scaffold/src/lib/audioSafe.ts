/**
 * Safe audio helpers for optional SFX / music. They no-op when an audio key is
 * missing, tolerate browser-locked audio, and stop looped sounds on scene
 * shutdown so music does not survive restarts.
 */
import Phaser from 'phaser';

export type SoundConfig = Phaser.Types.Sound.SoundConfig;

/** Plays a one-shot sound effect if the key exists; returns null for missing audio. */
export function playSfx(scene: Phaser.Scene, key: string, config: SoundConfig = {}): Phaser.Sound.BaseSound | null {
  const sound = addSoundIfAvailable(scene, key, { ...config, loop: config.loop ?? false });
  if (!sound) return null;
  stopSoundOnShutdown(scene, sound);
  sound.once(Phaser.Sound.Events.COMPLETE, () => destroySound(sound));
  playWhenUnlocked(scene, sound, { ...config, loop: config.loop ?? false });
  return sound;
}

/** Starts looped music if the key exists; returns null for cases without audio assets. */
export function loopMusic(scene: Phaser.Scene, key: string, config: SoundConfig = {}): Phaser.Sound.BaseSound | null {
  const sound = addSoundIfAvailable(scene, key, { ...config, loop: true });
  if (!sound) return null;
  stopSoundOnShutdown(scene, sound);
  playWhenUnlocked(scene, sound, { ...config, loop: true });
  return sound;
}

/** Stops and destroys a sound when the owning scene shuts down or is destroyed. */
export function stopSoundOnShutdown(scene: Phaser.Scene, sound: Phaser.Sound.BaseSound): Phaser.Sound.BaseSound {
  const stopAndDestroy = (): void => {
    if (sound.pendingRemove) return;
    if (sound.isPlaying || sound.isPaused) sound.stop();
    destroySound(sound);
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, stopAndDestroy);
  scene.events.once(Phaser.Scenes.Events.DESTROY, stopAndDestroy);
  return sound;
}

/** Toggles or sets the global scene mute flag and returns the resulting state. */
export function toggleMute(scene: Phaser.Scene, muted?: boolean): boolean {
  const next = muted ?? !scene.sound.mute;
  scene.sound.mute = next;
  return next;
}

function addSoundIfAvailable(scene: Phaser.Scene, key: string, config: SoundConfig): Phaser.Sound.BaseSound | null {
  if (!scene.sound || !scene.cache.audio.exists(key)) return null;
  try {
    return scene.sound.add(key, config);
  } catch {
    return null;
  }
}

function playWhenUnlocked(scene: Phaser.Scene, sound: Phaser.Sound.BaseSound, config: SoundConfig): void {
  const play = (): void => {
    if (sound.pendingRemove) return;
    try {
      sound.play(config);
    } catch {
      destroySound(sound);
    }
  };
  if (scene.sound.locked) scene.sound.once(Phaser.Sound.Events.UNLOCKED, play);
  else play();
}

function destroySound(sound: Phaser.Sound.BaseSound): void {
  if (!sound.pendingRemove) sound.destroy();
}
