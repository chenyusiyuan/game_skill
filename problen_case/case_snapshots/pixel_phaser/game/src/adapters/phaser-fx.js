/**
 * phaser-fx.js — Phaser 3 的 fx runtime adapter
 *
 * 实现 _common/fx.spec.js 定义的 playEffect。
 *
 *   const fx = createFx({ scene });
 *   fx.playEffect('screen-shake', { intensity: 3, duration: 150 });
 *   fx.playEffect('particle-burst', { x, y, color: 0xffff00, count: 12 });
 */

import { resolveFxParams } from "../_common/fx.spec.js";

export function createFx({ scene } = {}) {
  if (!scene) throw new Error("phaser-fx: scene is required");
  const activeEmitters = [];

  function toInt(hexish) {
    if (typeof hexish === "number") return hexish;
    if (typeof hexish !== "string") return 0xffffff;
    return parseInt(hexish.replace("#", "0x"));
  }

  function playEffect(verb, userCtx = {}) {
    const ctx = resolveFxParams(verb, userCtx);
    if (!ctx) return;

    switch (verb) {
      case "particle-burst": {
        // 使用 1x1 白点贴图（fallback）
        const texKey = ctx.textureKey ?? "__fx_pixel";
        if (!scene.textures.exists(texKey)) {
          const g = scene.add.graphics({ x: 0, y: 0 }).setVisible(false);
          g.fillStyle(0xffffff).fillRect(0, 0, 2, 2);
          g.generateTexture(texKey, 2, 2);
          g.destroy();
        }
        const emitter = scene.add.particles(ctx.x, ctx.y, texKey, {
          speed: { min: ctx.speed * 0.5, max: ctx.speed * 1.5 },
          lifespan: ctx.lifetime,
          quantity: ctx.count,
          tint: toInt(ctx.color),
          alpha: { start: 1, end: 0 },
          gravityY: 200,
          emitting: false,
        });
        emitter.explode(ctx.count);
        activeEmitters.push(emitter);
        scene.time.delayedCall(ctx.lifetime + 50, () => emitter.destroy());
        break;
      }
      case "screen-shake": {
        scene.cameras.main.shake(ctx.duration, ctx.intensity * 0.01);
        break;
      }
      case "tint-flash": {
        if (ctx.target && typeof ctx.target.setTint === "function") {
          const orig = ctx.target.tintTopLeft ?? 0xffffff;
          ctx.target.setTint(toInt(ctx.color));
          scene.time.delayedCall(ctx.duration, () => {
            if (ctx.target.active !== false) ctx.target.setTint(orig);
          });
        } else {
          scene.cameras.main.flash(ctx.duration, ...hexToRgb(ctx.color));
        }
        break;
      }
      case "float-text": {
        const txt = scene.add.text(ctx.x, ctx.y, ctx.text, {
          fontFamily: "sans-serif", fontSize: "18px",
          color: ctx.color,
        });
        scene.tweens.add({
          targets: txt,
          y: ctx.y - ctx.distance,
          alpha: 0,
          duration: ctx.duration,
          onComplete: () => txt.destroy(),
        });
        break;
      }
      case "scale-bounce": {
        if (!ctx.target) return;
        scene.tweens.add({
          targets: ctx.target,
          scale: { from: ctx.from, to: ctx.to },
          duration: ctx.duration / 2,
          yoyo: true,
        });
        break;
      }
      case "pulse": {
        if (!ctx.target) return;
        scene.tweens.add({
          targets: ctx.target,
          scale: 1 + ctx.amplitude,
          duration: ctx.duration / 2,
          yoyo: true,
          repeat: ctx.repeat,
        });
        break;
      }
      case "fade-out": {
        if (!ctx.target) return;
        scene.tweens.add({
          targets: ctx.target,
          alpha: 0,
          duration: ctx.duration,
          onComplete: () => { if (ctx.destroyOnEnd) ctx.target.destroy?.(); },
        });
        break;
      }
    }
  }

  function clearAll() {
    for (const e of activeEmitters) e?.destroy?.();
    activeEmitters.length = 0;
  }

  return { playEffect, clearAll };
}

function hexToRgb(hex) {
  const h = typeof hex === "string" ? hex.replace("#", "") : "ffffff";
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
