# Scaffold Helper Index

Read this index before opening helper source files. Pick the helper files that
match the mechanic you are implementing, then open only those files. Do not read
every helper body by default.

| File | Use When | Main Exports | Avoid |
| --- | --- | --- | --- |
| `arcadePhysics.ts` | Arcade bodies, static hitboxes, bounce, overlap, projectile/player/enemy collision. | `attachDynamicBody`, `attachStaticBody`, `moveStaticBody`, `setVelocity`, `wireCollider`, `wireOverlap` | Do not mutate `body.position` directly. Do not reflect velocity again inside `wireCollider`; Phaser already separated and bounced the body. |
| `visualTheme.ts` | Reusable juice and readable feedback: particles, floating text, hit-stop, flash, trails, shockwaves, boss warning. | `ensureProceduralTextures`, `particleBurst`, `floatingText`, `hitStop`, `flash`, `trail`, `shockwave`, `shake`, `screenFlash`, `applyGlow`, `applyBloom` | Do not use camera shake for every ordinary hit. High-frequency feedback should prefer local particles, outline, scale, trail, or floating text. |
| `procSprite.ts` | Many repeated simple shapes that need cached textures instead of one Graphics object per entity. | `procRect`, `procCircle`, `procRing`, `procTriangle` | Do not use it for HUD text, complex sprites, or one-off debug shapes where a plain Graphics object is clearer. |
| `inputController.ts` | Main movement controls for desktop and touch: WASD, arrow keys, pointer joystick style input. | `createKeyboardVector`, `createPointerStick`, `inputVectorFromKeyboard` | Do not use it for single-key toggles such as pause or one-shot ability triggers. |
| `inputExtras.ts` | Narrow keyboard needs: pause, restart, ability trigger, or typed key bags. | `oneShotKey`, `holdKey`, `addKeyBag` | Do not mix event callbacks and polling for the same key unless you intentionally need both. |
| `hudBuilder.ts` | HUD bars, counters, labels, slots, and status text that stay readable over gameplay. | `meterBar`, `statusText`, `iconSlot` | Do not draw HUD directly on the gameplay layer when contrast can become unreadable. |
| `progressionMath.ts` | Level, wave, score, cooldown, and pacing curves. | `clamp`, `lerp`, `linearRamp`, `waveScale`, `thresholdCurve` | Do not hard-code every level value when a small deterministic curve is enough. |
| `cameraRig.ts` | Following a player in a larger world or setting camera and physics bounds together. | `attachCameraFollow`, `setWorldBounds` | Do not use it for a fixed single-screen game unless bounds or follow behavior are actually needed. |
| `safeTimers.ts` | Timers and tweens that must stop cleanly on scene shutdown, restart, win, lose, or pause cleanup. | `safeDelay`, `safeRepeat`, `safeTween`, `cancelSafeTimer`, `cancelSafeTween`, `clearSafeTimers` | Do not leave raw looping timers or long tweens alive across scene restarts. |

Suggested read path:

1. Read this file.
2. Open the 1-2 helper files that match the current mechanic.
3. Import and call at least two useful helpers when they fit the game.
4. Record any implementation tradeoff in `docs/decisions.md` section B.
