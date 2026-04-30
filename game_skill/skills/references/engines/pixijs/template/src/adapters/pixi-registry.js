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

import { validateManifest, buildStats } from "../_common/registry.spec.js";
import { recordAssetUsage, recordAssetRenderEvidence } from "../_common/asset-usage.js";

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
  const { Assets, Texture, Sprite } = pixi;

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

  function recordPixiDisplayObject(id, displayObject, opts = {}) {
    const manifestItem = opts.section === "spritesheets"
      ? manifestSheetById.get(id)
      : manifestImageById.get(id);
    const width = Number(opts.width ?? displayObject?.width ?? displayObject?.texture?.width ?? 0);
    const height = Number(opts.height ?? displayObject?.height ?? displayObject?.texture?.height ?? 0);
    const visible = opts.visible ?? (
      displayObject?.visible !== false &&
      displayObject?.renderable !== false &&
      Number(displayObject?.alpha ?? displayObject?.worldAlpha ?? 1) > 0
    );
    recordAssetRenderEvidence({
      id,
      section: opts.section ?? "images",
      kind: opts.kind ?? "pixi-display-object",
      manifestItem,
      slotId: opts.slotId ?? null,
      entityId: opts.entityId ?? null,
      semanticSlot: opts.semanticSlot ?? null,
      renderZone: opts.renderZone ?? null,
      x: opts.x ?? displayObject?.x ?? null,
      y: opts.y ?? displayObject?.y ?? null,
      width,
      height,
      visible,
      source: opts.source ?? "pixi-registry.recordPixiDisplayObject",
      extra: opts.extra ?? null,
    });
  }

  function applyDisplayObjectOptions(displayObject, opts = {}) {
    if (!displayObject) return displayObject;
    if (Number.isFinite(Number(opts.x))) displayObject.x = Number(opts.x);
    if (Number.isFinite(Number(opts.y))) displayObject.y = Number(opts.y);
    if (Number.isFinite(Number(opts.width))) displayObject.width = Number(opts.width);
    if (Number.isFinite(Number(opts.height))) displayObject.height = Number(opts.height);
    if (Number.isFinite(Number(opts.alpha))) displayObject.alpha = Number(opts.alpha);
    if (typeof opts.visible === "boolean") displayObject.visible = opts.visible;
    return displayObject;
  }

  function getTexture(id, extra = null) {
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
  }

  function getSpritesheet(id, extra = null) {
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
  }

  function getAudio(id, extra = null) {
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
  }

  return {
    getTexture,
    getSpritesheet,
    getAudio,
    createSprite(id, opts = {}) {
      const texture = getTexture(id, opts.extra ?? null);
      if (!texture) return null;
      const sprite = applyDisplayObjectOptions(new Sprite(texture), opts);
      if (opts.record === true) {
        recordPixiDisplayObject(id, sprite, {
          ...opts,
          source: opts.source ?? "pixi-registry.createSprite",
        });
      }
      return sprite;
    },
    addSprite(container, id, opts = {}) {
      const texture = getTexture(id, opts.extra ?? null);
      if (!texture) return null;
      const sprite = applyDisplayObjectOptions(new Sprite(texture), opts);
      if (container && typeof container.addChild === "function") {
        container.addChild(sprite);
      }
      recordPixiDisplayObject(id, sprite, {
        ...opts,
        source: opts.source ?? "pixi-registry.addSprite",
      });
      return sprite;
    },
    recordDisplayObject(id, displayObject, opts = {}) {
      recordPixiDisplayObject(id, displayObject, opts);
      return displayObject;
    },
    has(id) {
      const e = entries.get(id);
      if (!e || !e.loaded || e.error) return false;
      return e.kind === "image" || e.kind === "spritesheet" || e.kind === "audio";
    },
    stats: () => buildStats(entries),
  };
}
