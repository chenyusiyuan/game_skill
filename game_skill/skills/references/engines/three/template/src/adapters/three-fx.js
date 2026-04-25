/**
 * three-fx.js — Three.js 的 fx runtime adapter
 *
 * 实现 _common/fx.spec.js 的 playEffect 最小可用子集。
 *
 *   const fx = createFx({ scene, camera, renderer });
 *   fx.playEffect('screen-shake', { intensity: 3, duration: 150 });
 *   fx.playEffect('particle-burst', { x, y, color: '#ff0', count: 12 }); // x/y 是屏幕坐标
 *   fx.playEffect('tint-flash', { target: mesh, color: '#ff0000', duration: 120 });
 *
 * 坐标约定：
 *   - particle-burst / float-text 的 x/y 按"屏幕像素"处理，adapter 内部 unproject 到
 *     相机面前 z=-3 的平面。如果业务要在 3D 世界坐标做粒子，传入 worldPos: THREE.Vector3。
 *   - tint-flash / scale-bounce / pulse / fade-out 的 target 必须是 THREE.Object3D（通常 Mesh）。
 */

import * as THREE from "three";
import { resolveFxParams } from "../../../_common/fx.spec.js";

export function createFx({ scene, camera, renderer } = {}) {
  if (!scene || !camera || !renderer) {
    throw new Error("three-fx: 需要 { scene, camera, renderer }");
  }
  const active = []; // 清理句柄

  function parseColor(c) {
    if (typeof c === "number") return c;
    return new THREE.Color(c).getHex();
  }
  function parseColorCSS(c) {
    if (typeof c === "string") return c;
    return "#" + new THREE.Color(c).getHexString();
  }
  function screenToWorld(xScreen, yScreen, depth = -3) {
    // 把屏幕像素点投射到相机前 depth 的平面
    const size = renderer.getSize(new THREE.Vector2());
    const ndc = new THREE.Vector3(
      (xScreen / size.x) * 2 - 1,
      -(yScreen / size.y) * 2 + 1,
      0.5
    );
    ndc.unproject(camera);
    const dir = ndc.sub(camera.position).normalize();
    const target = camera.position.clone().add(dir.multiplyScalar(Math.abs(depth)));
    return target;
  }

  function playEffect(verb, userCtx = {}) {
    const ctx = resolveFxParams(verb, userCtx);
    if (!ctx) return;

    switch (verb) {
      case "particle-burst":    return particleBurst(ctx);
      case "screen-shake":      return screenShake(ctx);
      case "tint-flash":        return tintFlash(ctx);
      case "float-text":        return floatText(ctx);
      case "scale-bounce":      return scaleBounce(ctx);
      case "pulse":             return pulse(ctx);
      case "fade-out":          return fadeOut(ctx);
    }
  }

  function particleBurst(ctx) {
    const origin = ctx.worldPos instanceof THREE.Vector3
      ? ctx.worldPos.clone()
      : screenToWorld(ctx.x, ctx.y);
    const count = ctx.count;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel = [];
    for (let i = 0; i < count; i++) {
      pos[i * 3] = origin.x; pos[i * 3 + 1] = origin.y; pos[i * 3 + 2] = origin.z;
      vel.push(new THREE.Vector3(
        (Math.random() - 0.5) * ctx.speed * 0.03,
        Math.random() * ctx.speed * 0.04,
        (Math.random() - 0.5) * ctx.speed * 0.03
      ));
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: parseColor(ctx.color), size: 0.15, transparent: true });
    const points = new THREE.Points(geo, mat);
    scene.add(points);

    const start = performance.now();
    function frame() {
      const t = (performance.now() - start) / ctx.lifetime;
      if (t >= 1) {
        scene.remove(points);
        geo.dispose(); mat.dispose();
        return;
      }
      const arr = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        arr[i * 3]     += vel[i].x;
        arr[i * 3 + 1] += vel[i].y - 0.002; // 轻微重力
        arr[i * 3 + 2] += vel[i].z;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 1 - t;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function screenShake(ctx) {
    const origin = camera.position.clone();
    const start = performance.now();
    const amp = ctx.intensity * 0.02;
    function frame() {
      const t = (performance.now() - start) / ctx.duration;
      if (t >= 1) { camera.position.copy(origin); return; }
      camera.position.x = origin.x + (Math.random() - 0.5) * amp;
      camera.position.y = origin.y + (Math.random() - 0.5) * amp;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function tintFlash(ctx) {
    const obj = ctx.target;
    if (!obj || !obj.isObject3D) {
      console.warn("[three-fx] tint-flash: target 必须是 THREE.Object3D");
      return;
    }
    // 收集所有有 material.color 的 mesh，保存原色并替换
    const backups = [];
    obj.traverse((child) => {
      if (child.isMesh && child.material?.color) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          if (!mat.color) continue;
          backups.push({ mat, orig: mat.color.getHex() });
          mat.color.setHex(parseColor(ctx.color));
        }
      }
    });
    setTimeout(() => {
      for (const b of backups) b.mat.color.setHex(b.orig);
    }, ctx.duration);
  }

  function floatText(ctx) {
    // 走 DOM 叠加，3D 场景的 2D HUD 飘字
    const el = document.createElement("div");
    el.textContent = ctx.text;
    el.style.position = "fixed";
    el.style.left = `${ctx.x}px`;
    el.style.top = `${ctx.y}px`;
    el.style.color = parseColorCSS(ctx.color);
    el.style.fontSize = "18px";
    el.style.fontWeight = "bold";
    el.style.pointerEvents = "none";
    el.style.transition = `transform ${ctx.duration}ms ease-out, opacity ${ctx.duration}ms ease-out`;
    el.style.transform = "translate(-50%, 0)";
    el.style.textShadow = "0 1px 2px rgba(0,0,0,.7)";
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = `translate(-50%, -${ctx.distance}px)`;
      el.style.opacity = "0";
    });
    setTimeout(() => el.remove(), ctx.duration + 50);
  }

  function scaleBounce(ctx) {
    const obj = ctx.target;
    if (!obj?.isObject3D) { console.warn("[three-fx] scale-bounce 需要 target"); return; }
    const from = ctx.from, to = ctx.to;
    const start = performance.now();
    function frame() {
      const t = (performance.now() - start) / ctx.duration;
      if (t >= 1) { obj.scale.setScalar(from); return; }
      // 0→1: from→to→from (ease)
      const k = t < 0.5 ? t * 2 : (1 - t) * 2;
      const s = from + (to - from) * k;
      obj.scale.setScalar(s);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function pulse(ctx) {
    const obj = ctx.target;
    if (!obj?.isObject3D) { console.warn("[three-fx] pulse 需要 target"); return; }
    let cancelled = false;
    const baseScale = obj.scale.x;
    const start = performance.now();
    function frame() {
      if (cancelled) { obj.scale.setScalar(baseScale); return; }
      const t = (performance.now() - start) / ctx.duration;
      const k = Math.sin(t * Math.PI * 2);
      obj.scale.setScalar(baseScale * (1 + ctx.amplitude * k));
      if (ctx.repeat >= 0 && t >= ctx.repeat + 1) { obj.scale.setScalar(baseScale); return; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    const handle = { cancel: () => { cancelled = true; } };
    active.push(handle);
    return handle;
  }

  function fadeOut(ctx) {
    const obj = ctx.target;
    if (!obj?.isObject3D) { console.warn("[three-fx] fade-out 需要 target"); return; }
    // 收集可 fade 的 material
    const mats = [];
    obj.traverse((c) => {
      if (c.isMesh && c.material) {
        const list = Array.isArray(c.material) ? c.material : [c.material];
        for (const m of list) {
          m.transparent = true;
          mats.push({ mat: m, orig: m.opacity });
        }
      }
    });
    const start = performance.now();
    function frame() {
      const t = (performance.now() - start) / ctx.duration;
      if (t >= 1) {
        if (ctx.destroyOnEnd) {
          obj.parent?.remove(obj);
          for (const { mat } of mats) mat.dispose?.();
        } else {
          for (const { mat } of mats) mat.opacity = 0;
        }
        return;
      }
      for (const { mat, orig } of mats) mat.opacity = orig * (1 - t);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  return {
    playEffect,
    clearAll() {
      for (const h of active) h.cancel?.();
      active.length = 0;
    },
  };
}
