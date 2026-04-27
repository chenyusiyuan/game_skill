/**
 * pixi-registry.js — PixiJS v8 的 asset registry adapter
 *
 * 实现 _common/registry.spec.js 定义的接口。
 *
 *   import { createRegistry } from './adapters/pixi-registry.js';
 *   const registry = await createRegistry(manifest);
 *   const tex = registry.getTexture('hero-warrior-idle');
 *   const sprite = new Sprite(tex);
 */

import { validateManifest, buildStats } from "../../../_common/registry.spec.js";
import { recordAssetUsage } from "../../../_common/asset-usage.js";

export async function createRegistry(manifest) {
  const { ok, errors } = validateManifest(manifest);
  if (!ok) throw new Error("registry manifest invalid: " + errors.join("; "));

  const base = manifest.basePath || "";
  const entries = new Map();
  const manifestImageById = new Map((manifest.images ?? []).map((it) => [it.id, it]));
  const manifestSheetById = new Map((manifest.spritesheets ?? []).map((it) => [it.id, it]));
  const manifestAudioById = new Map((manifest.audio ?? []).map((it) => [it.id, it]));

  // pixi.js 由业务代码在入口 import，adapter 运行时按需拿
  const pixi = await import("pixi.js");
  const { Assets, Texture } = pixi;

  function resolveUrl(src) {
    return base.replace(/\/$/, "") + "/" + src.replace(/^\//, "");
  }

  const loadTasks = [];

  for (const item of manifest.images ?? []) {
    if (item.type === "local-file") {
      const url = resolveUrl(item.src);
      loadTasks.push(
        Assets.load({ alias: item.id, src: url })
          .then(() => entries.set(item.id, { kind: "image", loaded: true }))
          .catch((err) => {
            console.error(`[pixi-registry] failed ${item.id}: ${err?.message}`);
            entries.set(item.id, { kind: "image", loaded: false, error: "load-error" });
          })
      );
    } else if (item.type === "inline-svg") {
      const url = "data:image/svg+xml;base64," + btoa(item.svg);
      loadTasks.push(
        Assets.load({ alias: item.id, src: url })
          .then(() => entries.set(item.id, { kind: "image", loaded: true }))
          .catch(() => entries.set(item.id, { kind: "image", loaded: false, error: "svg-decode" }))
      );
    } else if (item.type === "graphics-generated") {
      entries.set(item.id, { kind: "draw-meta", loaded: true });
    }
  }

  for (const item of manifest.spritesheets ?? []) {
    if (item.type === "local-file") {
      const url = resolveUrl(item.src);
      loadTasks.push(
        Assets.load({ alias: item.id, src: url })
          .then(() => entries.set(item.id, { kind: "spritesheet", loaded: true, frameWidth: item.frameWidth, frameHeight: item.frameHeight }))
          .catch(() => entries.set(item.id, { kind: "spritesheet", loaded: false }))
      );
    }
  }

  for (const item of manifest.audio ?? []) {
    if (item.type === "local-file") {
      // pixi 没原生 audio 加载，用 HTMLAudioElement
      const audio = new Audio(resolveUrl(item.src));
      loadTasks.push(new Promise((res) => {
        audio.addEventListener("canplaythrough", () => { entries.set(item.id, { kind: "audio", value: audio, loaded: true }); res(); }, { once: true });
        audio.addEventListener("error", () => { entries.set(item.id, { kind: "audio", loaded: false }); res(); }, { once: true });
      }));
    } else if (item.type === "synthesized") {
      entries.set(item.id, { kind: "synth-meta", value: item.params ?? null, loaded: true });
    }
  }

  await Promise.all(loadTasks);

  return {
    getTexture(id, extra = null) {
      const e = entries.get(id);
      if (!e) { console.warn(`[registry] missing id: ${id}`); return null; }
      if (e.kind === "image" && e.loaded) {
        recordAssetUsage({
          id,
          section: "images",
          kind: "texture",
          manifestItem: manifestImageById.get(id),
          extra,
        });
        return Texture.from(id);
      }
      return null;
    },
    getSpritesheet(id, extra = null) {
      const e = entries.get(id);
      if (!e || !e.loaded) return null;
      recordAssetUsage({
        id,
        section: "spritesheets",
        kind: "spritesheet",
        manifestItem: manifestSheetById.get(id),
        extra,
      });
      return { texture: Texture.from(id), frameWidth: e.frameWidth, frameHeight: e.frameHeight };
    },
    getAudio(id, extra = null) {
      const e = entries.get(id);
      if (!e) { console.warn(`[registry] missing id: ${id}`); return null; }
      if (e.kind === "audio") {
        recordAssetUsage({
          id,
          section: "audio",
          kind: "audio",
          manifestItem: manifestAudioById.get(id),
          extra,
        });
        return e.value;
      }
      if (e.kind === "synth-meta") {
        recordAssetUsage({
          id,
          section: "audio",
          kind: "audio",
          manifestItem: manifestAudioById.get(id),
          extra,
        });
        return { synthParams: e.value };
      }
      return null;
    },
    has(id) {
      const e = entries.get(id);
      if (!e || !e.loaded || e.error) return false;
      return e.kind === "image" || e.kind === "spritesheet" || e.kind === "audio";
    },
    stats: () => buildStats(entries),
  };
}
