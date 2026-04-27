/**
 * dom-fx.js — DOM+CSS 的 fx runtime adapter
 *
 * 用 CSS 类 + Web Animations API 实现标准 fx 动词。
 *
 *   const fx = createFx({ root: document.querySelector('#game') });
 *   fx.playEffect('screen-shake', { intensity: 6, duration: 150 });  // 给 #game 加 shake class
 *   fx.playEffect('particle-burst', { x, y, color: '#ff0', count: 10 });
 *
 * 必须在 head 里 import fx 的 CSS（见 `ensureStyles`，首次调用时自动注入）。
 */

import { resolveFxParams } from "../../../_common/fx.spec.js";

const STYLE_ID = "__fx_styles";
const CSS = `
.__fx-shake { animation: __fx-shake-kf var(--fx-dur, 150ms) ease-in-out; }
@keyframes __fx-shake-kf {
  0%,100% { transform: translate(0,0); }
  20% { transform: translate(var(--fx-amp, 3px), calc(-1 * var(--fx-amp, 3px))); }
  40% { transform: translate(calc(-1 * var(--fx-amp, 3px)), var(--fx-amp, 3px)); }
  60% { transform: translate(calc(-0.7 * var(--fx-amp, 3px)), var(--fx-amp, 3px)); }
  80% { transform: translate(var(--fx-amp, 3px), calc(-0.7 * var(--fx-amp, 3px))); }
}
.__fx-particle { position: absolute; width: 6px; height: 6px; border-radius: 50%; pointer-events: none; }
.__fx-float-text { position: absolute; font: bold 18px sans-serif; pointer-events: none; white-space: nowrap; }
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function createFx({ root } = {}) {
  if (!root) throw new Error("dom-fx: root element is required");
  ensureStyles();

  // particle layer 叠在 root 之上
  const layer = document.createElement("div");
  Object.assign(layer.style, { position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible", width: "100%", height: "100%" });
  if (getComputedStyle(root).position === "static") root.style.position = "relative";
  root.appendChild(layer);

  function playEffect(verb, userCtx = {}) {
    const ctx = resolveFxParams(verb, userCtx);
    if (!ctx) return;

    switch (verb) {
      case "screen-shake": {
        root.style.setProperty("--fx-amp", ctx.intensity + "px");
        root.style.setProperty("--fx-dur", ctx.duration + "ms");
        root.classList.remove("__fx-shake"); void root.offsetWidth; // reflow to replay
        root.classList.add("__fx-shake");
        setTimeout(() => root.classList.remove("__fx-shake"), ctx.duration);
        break;
      }
      case "particle-burst": {
        for (let i = 0; i < ctx.count; i++) {
          const p = document.createElement("div");
          p.className = "__fx-particle";
          p.style.background = ctx.color;
          p.style.left = ctx.x + "px";
          p.style.top = ctx.y + "px";
          layer.appendChild(p);
          const ang = Math.random() * Math.PI * 2;
          const spd = (0.5 + Math.random()) * ctx.speed;
          const dx = Math.cos(ang) * spd;
          const dy = Math.sin(ang) * spd;
          p.animate(
            [
              { transform: "translate(0,0)", opacity: 1 },
              { transform: `translate(${dx}px, ${dy + 200}px)`, opacity: 0 },
            ],
            { duration: ctx.lifetime, easing: "ease-out", fill: "forwards" }
          ).onfinish = () => p.remove();
        }
        break;
      }
      case "tint-flash": {
        const el = ctx.target;
        if (!(el instanceof HTMLElement)) return;
        const origFilter = el.style.filter;
        el.style.filter = `brightness(2) drop-shadow(0 0 8px ${ctx.color})`;
        setTimeout(() => { el.style.filter = origFilter; }, ctx.duration);
        break;
      }
      case "float-text": {
        const t = document.createElement("div");
        t.className = "__fx-float-text";
        t.textContent = ctx.text;
        t.style.color = ctx.color;
        t.style.left = ctx.x + "px";
        t.style.top = ctx.y + "px";
        layer.appendChild(t);
        t.animate(
          [{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(-${ctx.distance}px)`, opacity: 0 }],
          { duration: ctx.duration, easing: "ease-out", fill: "forwards" }
        ).onfinish = () => t.remove();
        break;
      }
      case "scale-bounce": {
        const el = ctx.target;
        if (!(el instanceof HTMLElement)) return;
        el.animate(
          [{ transform: `scale(${ctx.from})` }, { transform: `scale(${ctx.to})` }, { transform: "scale(1)" }],
          { duration: ctx.duration, easing: "ease-out" }
        );
        break;
      }
      case "pulse": {
        const el = ctx.target;
        if (!(el instanceof HTMLElement)) return;
        el.animate(
          [{ transform: "scale(1)" }, { transform: `scale(${1 + ctx.amplitude})` }, { transform: "scale(1)" }],
          { duration: ctx.duration, iterations: ctx.repeat < 0 ? Infinity : ctx.repeat, easing: "ease-in-out" }
        );
        break;
      }
      case "fade-out": {
        const el = ctx.target;
        if (!(el instanceof HTMLElement)) return;
        const anim = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ctx.duration, fill: "forwards" });
        anim.onfinish = () => { if (ctx.destroyOnEnd) el.remove(); };
        break;
      }
    }
  }

  function clearAll() {
    layer.innerHTML = "";
    root.classList.remove("__fx-shake");
  }

  return { playEffect, clearAll };
}
