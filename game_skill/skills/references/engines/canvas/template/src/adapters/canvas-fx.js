/**
 * canvas-fx.js — Canvas 2D 的 fx runtime adapter
 *
 * 实现 _common/fx.spec.js 定义的 playEffect 接口。
 *
 * 用法：
 *   const fx = createFx({ canvas, ctx, camera: null });
 *   fx.playEffect('particle-burst', { x: 100, y: 200, color: '#ff0', count: 12 });
 *
 * Canvas 没有 scene graph，所有特效靠 per-frame 叠加绘制。调用方负责在
 * 每帧 draw 循环里调 `fx.render(ctx)`。
 */

import { FX_VERBS, resolveFxParams } from "../../../_common/fx.spec.js";

export function createFx({ canvas, ctx } = {}) {
  const particles = [];
  const floats = [];
  const shakes = [];
  const tints = []; // { target, color, remaining }

  function now() { return performance.now(); }

  function playEffect(verb, userCtx = {}) {
    const ctx = resolveFxParams(verb, userCtx);
    if (!ctx) return;
    const t = now();

    switch (verb) {
      case "particle-burst": {
        for (let i = 0; i < ctx.count; i++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = (0.5 + Math.random()) * ctx.speed;
          particles.push({
            x: ctx.x, y: ctx.y,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            color: ctx.color,
            born: t,
            life: ctx.lifetime,
          });
        }
        break;
      }
      case "screen-shake": {
        shakes.push({ intensity: ctx.intensity, born: t, duration: ctx.duration });
        break;
      }
      case "tint-flash": {
        if (ctx.target) tints.push({ target: ctx.target, color: ctx.color, born: t, duration: ctx.duration });
        break;
      }
      case "float-text": {
        floats.push({
          x: ctx.x, y: ctx.y, startY: ctx.y,
          text: ctx.text, color: ctx.color,
          born: t, duration: ctx.duration, distance: ctx.distance,
        });
        break;
      }
      case "scale-bounce": {
        if (ctx.target) {
          ctx.target.__scale = ctx.from;
          const start = ctx.target.__scale;
          const end = ctx.to;
          animate(start, end, ctx.duration, (v) => { ctx.target.__scale = v; });
        }
        break;
      }
      case "pulse": {
        if (ctx.target) {
          const loop = () => {
            animate(1.0, 1.0 + ctx.amplitude, ctx.duration / 2, (v) => ctx.target.__scale = v, () => {
              animate(1.0 + ctx.amplitude, 1.0, ctx.duration / 2, (v) => ctx.target.__scale = v, loop);
            });
          };
          loop();
        }
        break;
      }
      case "fade-out": {
        if (ctx.target) {
          animate(1.0, 0.0, ctx.duration, (v) => { ctx.target.__alpha = v; }, () => {
            if (ctx.destroyOnEnd && typeof ctx.target.destroy === "function") ctx.target.destroy();
          });
        }
        break;
      }
    }
  }

  /**
   * 业务侧每帧调用。返回当前应施加的 screen-shake 偏移 { ox, oy }，
   * 用于在主 draw 之前 ctx.save(); ctx.translate(ox, oy)。
   */
  function render(renderCtx) {
    const t = now();
    const targetCtx = renderCtx ?? ctx;
    if (!targetCtx) return { ox: 0, oy: 0 };

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const age = t - p.born;
      if (age >= p.life) { particles.splice(i, 1); continue; }
      const dt = age / 1000;
      const px = p.x + p.vx * dt;
      const py = p.y + p.vy * dt + 200 * dt * dt; // 轻微重力
      const alpha = 1 - age / p.life;
      targetCtx.save();
      targetCtx.globalAlpha = alpha;
      targetCtx.fillStyle = p.color;
      targetCtx.fillRect(px - 2, py - 2, 4, 4);
      targetCtx.restore();
    }

    // float-text
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      const age = t - f.born;
      if (age >= f.duration) { floats.splice(i, 1); continue; }
      const k = age / f.duration;
      const y = f.startY - f.distance * k;
      targetCtx.save();
      targetCtx.globalAlpha = 1 - k;
      targetCtx.fillStyle = f.color;
      targetCtx.font = "bold 18px sans-serif";
      targetCtx.fillText(f.text, f.x, y);
      targetCtx.restore();
    }

    // shake — 返回 offset 给调用方
    let ox = 0, oy = 0;
    for (let i = shakes.length - 1; i >= 0; i--) {
      const s = shakes[i];
      const age = t - s.born;
      if (age >= s.duration) { shakes.splice(i, 1); continue; }
      const falloff = 1 - age / s.duration;
      ox += (Math.random() * 2 - 1) * s.intensity * falloff;
      oy += (Math.random() * 2 - 1) * s.intensity * falloff;
    }
    return { ox, oy };
  }

  function clearAll() {
    particles.length = 0;
    floats.length = 0;
    shakes.length = 0;
    tints.length = 0;
  }

  return { playEffect, render, clearAll };
}

// tween helper（不依赖引擎动画系统）
function animate(from, to, duration, onUpdate, onComplete) {
  const start = performance.now();
  function step(t) {
    const k = Math.min(1, (t - start) / duration);
    onUpdate(from + (to - from) * k);
    if (k < 1) requestAnimationFrame(step);
    else onComplete?.();
  }
  requestAnimationFrame(step);
}
