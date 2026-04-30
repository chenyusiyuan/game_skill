/**
 * phaser-registry.js — Phaser 3 的 asset registry adapter
 *
 * 实现 _common/registry.spec.js 定义的接口。
 *
 * Phaser 有原生 this.load 生命周期。adapter 分两步：
 *   1. preloadRegistryAssets(manifest, { scene }) 只能在 scene.preload() 调用，
 *      负责把 manifest 队列注册给 Phaser Loader。
 *   2. createRegistry(manifest, { scene }) 在 scene.create() 调用，只检查已经
 *      由 Phaser 完成加载的 texture/cache，并创建统一 registry。
 *
 * 用法：
 *   preload() { preloadRegistryAssets(manifest, { scene: this }); }
 *   create()  { const registry = createRegistry(manifest, { scene: this }); }
 *   const tex = registry.getTexture('hero-warrior-idle');
 *   scene.add.image(x, y, 'hero-warrior-idle');  // Phaser 用 id 即可
 */

import { validateManifest, buildStats } from "../_common/registry.spec.js";
import { recordAssetUsage, recordAssetRenderEvidence } from "../_common/asset-usage.js";

export function preloadRegistryAssets(manifest, { scene } = {}) {
  const { ok, errors } = validateManifest(manifest);
  if (!ok) throw new Error("registry manifest invalid: " + errors.join("; "));
  if (!scene || !scene.load) throw new Error("phaser-registry: scene with .load is required");

  const base = manifest.basePath || "";

  function resolveUrl(src) {
    return base.replace(/\/$/, "") + "/" + src.replace(/^\//, "");
  }

  for (const item of manifest.images ?? []) {
    if (item.type === "local-file") {
      scene.load.image(item.id, resolveUrl(item.src));
    } else if (item.type === "inline-svg") {
      scene.textures.addBase64(item.id, "data:image/svg+xml;base64," + btoa(item.svg));
    }
  }
  for (const item of manifest.spritesheets ?? []) {
    if (item.type === "local-file") {
      scene.load.spritesheet(item.id, resolveUrl(item.src), {
        frameWidth: item.frameWidth,
        frameHeight: item.frameHeight,
      });
    }
  }
  for (const item of manifest.audio ?? []) {
    if (item.type === "local-file") {
      scene.load.audio(item.id, resolveUrl(item.src));
    }
  }
}

export function createRegistry(manifest, { scene } = {}) {
  const { ok, errors } = validateManifest(manifest);
  if (!ok) throw new Error("registry manifest invalid: " + errors.join("; "));
  if (!scene || !scene.textures || !scene.cache) {
    throw new Error("phaser-registry: scene with textures/cache is required");
  }

  const entries = new Map();
  const manifestImageById = new Map((manifest.images ?? []).map((it) => [it.id, it]));
  const manifestSheetById = new Map((manifest.spritesheets ?? []).map((it) => [it.id, it]));
  const manifestAudioById = new Map((manifest.audio ?? []).map((it) => [it.id, it]));

  function register(section, item, loaded, error = null) {
    entries.set(item.id, { kind: section, loaded, error });
  }

  for (const item of manifest.images ?? []) {
    if (item.type === "local-file" || item.type === "inline-svg") {
      const loaded = scene.textures.exists(item.id);
      register("image", item, loaded, loaded ? null : "not-loaded");
    } else if (item.type === "graphics-generated") {
      register("draw-meta", item, true);
    }
  }
  for (const item of manifest.spritesheets ?? []) {
    if (item.type === "local-file") {
      const loaded = scene.textures.exists(item.id);
      register("spritesheet", item, loaded, loaded ? null : "not-loaded");
    }
  }
  for (const item of manifest.audio ?? []) {
    if (item.type === "local-file") {
      const loaded = scene.cache.audio.exists(item.id);
      register("audio", item, loaded, loaded ? null : "not-loaded");
    } else if (item.type === "synthesized") {
      register("synth-meta", item, true);
    }
  }

  function recordPhaserGameObject(id, gameObject, opts = {}) {
    const manifestItem = opts.section === "spritesheets"
      ? manifestSheetById.get(id)
      : manifestImageById.get(id);
    const width = Number(opts.width ?? gameObject?.displayWidth ?? gameObject?.width ?? 0);
    const height = Number(opts.height ?? gameObject?.displayHeight ?? gameObject?.height ?? 0);
    const visible = opts.visible ?? (
      gameObject?.visible !== false &&
      Number(gameObject?.alpha ?? 1) > 0
    );
    recordAssetRenderEvidence({
      id,
      section: opts.section ?? "images",
      kind: opts.kind ?? "phaser-game-object",
      manifestItem,
      slotId: opts.slotId ?? null,
      entityId: opts.entityId ?? null,
      semanticSlot: opts.semanticSlot ?? null,
      renderZone: opts.renderZone ?? null,
      x: opts.x ?? gameObject?.x ?? null,
      y: opts.y ?? gameObject?.y ?? null,
      width,
      height,
      visible,
      source: opts.source ?? "phaser-registry.recordGameObject",
      extra: opts.extra ?? null,
    });
  }

  function applyGameObjectOptions(gameObject, opts = {}) {
    if (!gameObject) return gameObject;
    if (Number.isFinite(Number(opts.width)) && Number.isFinite(Number(opts.height)) &&
        typeof gameObject.setDisplaySize === "function") {
      gameObject.setDisplaySize(Number(opts.width), Number(opts.height));
    }
    if (Number.isFinite(Number(opts.alpha)) && typeof gameObject.setAlpha === "function") {
      gameObject.setAlpha(Number(opts.alpha));
    }
    if (typeof opts.visible === "boolean" && typeof gameObject.setVisible === "function") {
      gameObject.setVisible(opts.visible);
    }
    return gameObject;
  }

  function getTexture(id, extra = null) {
      const e = entries.get(id);
      if (!e) { console.warn(`[registry] missing id: ${id}`); return null; }
      if (e.loaded && !e.error && scene.textures.exists(id)) {
        recordAssetUsage({
          id,
          section: "images",
          kind: "texture",
          manifestItem: manifestImageById.get(id),
          extra,
        });
        return scene.textures.get(id);
      }
      return null;
  }

  function getSpritesheet(id, extra = null) {
      const e = entries.get(id);
      if (!e) { console.warn(`[registry] missing id: ${id}`); return null; }
      if (e.loaded && !e.error && scene.textures.exists(id)) {
        recordAssetUsage({
          id,
          section: "spritesheets",
          kind: "spritesheet",
          manifestItem: manifestSheetById.get(id),
          extra,
        });
        return scene.textures.get(id);
      }
      return null;
  }

  function getAudio(id, extra = null) {
      const e = entries.get(id);
      if (!e) { console.warn(`[registry] missing id: ${id}`); return null; }
      if (e.loaded && !e.error && scene.cache.audio.exists(id)) {
        recordAssetUsage({
          id,
          section: "audio",
          kind: "audio",
          manifestItem: manifestAudioById.get(id),
          extra,
        });
        return scene.sound.add(id);
      }
      return null;
  }

  return {
    getTexture,
    getSpritesheet,
    getAudio,
    addImage(id, x = 0, y = 0, opts = {}) {
      if (!getTexture(id, opts.extra ?? null)) return null;
      const image = applyGameObjectOptions(scene.add.image(x, y, id), opts);
      recordPhaserGameObject(id, image, {
        ...opts,
        x,
        y,
        source: opts.source ?? "phaser-registry.addImage",
      });
      return image;
    },
    addSprite(id, x = 0, y = 0, opts = {}) {
      if (!getTexture(id, opts.extra ?? null)) return null;
      const sprite = applyGameObjectOptions(scene.add.sprite(x, y, id), opts);
      recordPhaserGameObject(id, sprite, {
        ...opts,
        x,
        y,
        source: opts.source ?? "phaser-registry.addSprite",
      });
      return sprite;
    },
    recordGameObject(id, gameObject, opts = {}) {
      recordPhaserGameObject(id, gameObject, opts);
      return gameObject;
    },
    has(id) {
      const e = entries.get(id);
      if (!e || !e.loaded || e.error) return false;
      if (e.kind === "image" || e.kind === "spritesheet") return scene.textures.exists(id);
      if (e.kind === "audio") return scene.cache.audio.exists(id);
      return false;
    },
    stats: () => buildStats(entries),
  };
}
