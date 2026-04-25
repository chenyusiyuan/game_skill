/**
 * pixi-fx.js — PixiJS v8 的 fx runtime adapter
 *
 *   const fx = createFx({ app, stage: app.stage });
 *   fx.playEffect('particle-burst', { x, y, color: '#ff0', count: 12 });
 *   fx.playEffect('screen-shake', { intensity: 3, duration: 150 });
 */

import { resolveFxParams } from "../../../_common/fx.spec.js";

export function createFx({ app, stage } = {}) {
  if (!app || !stage) throw new Error("pixi-fx: app and stage are required");
  const pixiPromise = import("pixi.js");
  const shakeState = { intensity: 0, born: 0, duration: 0 };
  let originalStagePos = null;

  // 每帧检查 shake
  app.ticker.add(() => {
    if (shakeState.duration > 0) {
      const age = performance.now() - shakeState.born;
      if (age >= shakeState.duration) {
        if (originalStagePos) { stage.x = originalStagePos.x; stage.y = originalStagePos.y; }
        shakeState.duration = 0;
        originalStagePos = null;
      } else {
        if (!originalStagePos) originalStagePos = { x: stage.x, y: stage.y };
        const k = 1 - age / shakeState.duration;
        stage.x = originalStagePos.x + (Math.random() * 2 - 1) * shakeState.intensity * k;
        stage.y = originalStagePos.y + (Math.random() * 2 - 1) * shakeState.intensity * k;
      }
    }
  });

  async function playEffect(verb, userCtx = {}) {
    const ctx = resolveFxParams(verb, userCtx);
    if (!ctx) return;
    const pixi = await pixiPromise;
    const { Graphics, Text, ColorMatrixFilter, Container } = pixi;

    switch (verb) {
      case "particle-burst": {
        const cont = new Container();
        cont.x = ctx.x; cont.y = ctx.y;
        stage.addChild(cont);
        const born = performance.now();
        const particles = [];
        for (let i = 0; i < ctx.count; i++) {
          const g = new Graphics();
          g.rect(-2, -2, 4, 4).fill({ color: ctx.color });
          const ang = Math.random() * Math.PI * 2;
          const spd = (0.5 + Math.random()) * ctx.speed;
          particles.push({ g, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd });
          cont.addChild(g);
        }
        const tick = () => {
          const age = performance.now() - born;
          if (age >= ctx.lifetime) {
            app.ticker.remove(tick);
            cont.destroy({ children: true });
            return;
          }
          const dt = 1 / 60;
          const alpha = 1 - age / ctx.lifetime;
          for (const p of particles) {
            p.g.x += p.vx * dt;
            p.g.y += p.vy * dt + 200 * dt * dt;
            p.g.alpha = alpha;
          }
        };
        app.ticker.add(tick);
        break;
      }
      case "screen-shake": {
        shakeState.intensity = ctx.intensity;
        shakeState.born = performance.now();
        shakeState.duration = ctx.duration;
        break;
      }
      case "tint-flash": {
        if (ctx.target) {
          const filter = new ColorMatrixFilter();
          filter.brightness(2, false);
          ctx.target.filters = [...(ctx.target.filters || []), filter];
          setTimeout(() => {
            ctx.target.filters = (ctx.target.filters || []).filter(f => f !== filter);
          }, ctx.duration);
        }
        break;
      }
      case "float-text": {
        const t = new Text({ text: ctx.text, style: { fontSize: 18, fill: ctx.color } });
        t.x = ctx.x; t.y = ctx.y;
        stage.addChild(t);
        const born = performance.now();
        const tick = () => {
          const age = performance.now() - born;
          if (age >= ctx.duration) { app.ticker.remove(tick); t.destroy(); return; }
          const k = age / ctx.duration;
          t.y = ctx.y - ctx.distance * k;
          t.alpha = 1 - k;
        };
        app.ticker.add(tick);
        break;
      }
      case "scale-bounce":
      case "pulse": {
        if (!ctx.target) return;
        const born = performance.now();
        const peak = verb === "pulse" ? 1 + ctx.amplitude : ctx.to;
        const half = ctx.duration / 2;
        const tick = () => {
          const age = performance.now() - born;
          const cycle = age % ctx.duration;
          if (cycle < half) ctx.target.scale.set(1 + (peak - 1) * (cycle / half));
          else ctx.target.scale.set(peak - (peak - 1) * ((cycle - half) / half));
          if (verb === "scale-bounce" && age >= ctx.duration) { app.ticker.remove(tick); ctx.target.scale.set(1); }
        };
        app.ticker.add(tick);
        break;
      }
      case "fade-out": {
        if (!ctx.target) return;
        const born = performance.now();
        const startAlpha = ctx.target.alpha ?? 1;
        const tick = () => {
          const age = performance.now() - born;
          if (age >= ctx.duration) {
            app.ticker.remove(tick);
            if (ctx.destroyOnEnd) ctx.target.destroy?.();
            return;
          }
          ctx.target.alpha = startAlpha * (1 - age / ctx.duration);
        };
        app.ticker.add(tick);
        break;
      }
    }
  }

  function clearAll() {
    shakeState.duration = 0;
    if (originalStagePos) { stage.x = originalStagePos.x; stage.y = originalStagePos.y; }
  }

  return { playEffect, clearAll };
}
