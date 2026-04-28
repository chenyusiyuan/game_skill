/**
 * dom-registry.js — DOM+CSS 的 asset registry adapter
 *
 * DOM 不需要显式预加载（<img> 标签会 lazy load），registry 只做 id→url 映射 +
 * inline-svg → data URL 的转换。调用方用 `registry.getTextureUrl(id)` 塞到
 * <img src> 或 CSS background-image。
 *
 *   const registry = await createRegistry(manifest);
 *   const url = registry.getTextureUrl('hero');
 *   el.style.backgroundImage = `url(${url})`;
 */

import { validateManifest, buildStats } from "../_common/registry.spec.js";
import { recordAssetUsage } from "../_common/asset-usage.js";

export async function createRegistry(manifest) {
  const { ok, errors } = validateManifest(manifest);
  if (!ok) throw new Error("registry manifest invalid: " + errors.join("; "));

  const base = manifest.basePath || "";
  const entries = new Map();
  const manifestImageById = new Map((manifest.images ?? []).map((it) => [it.id, it]));
  const manifestSheetById = new Map((manifest.spritesheets ?? []).map((it) => [it.id, it]));
  const manifestAudioById = new Map((manifest.audio ?? []).map((it) => [it.id, it]));

  for (const item of manifest.images ?? []) {
    let url = null;
    if (item.type === "local-file") url = base.replace(/\/$/, "") + "/" + item.src.replace(/^\//, "");
    else if (item.type === "inline-svg") url = "data:image/svg+xml;base64," + btoa(item.svg);
    entries.set(item.id, { kind: "image-url", url, loaded: !!url });
  }
  for (const item of manifest.spritesheets ?? []) {
    if (item.type === "local-file") {
      const url = base.replace(/\/$/, "") + "/" + item.src.replace(/^\//, "");
      entries.set(item.id, { kind: "spritesheet-url", url, loaded: true, frameWidth: item.frameWidth, frameHeight: item.frameHeight });
    }
  }
  for (const item of manifest.audio ?? []) {
    if (item.type === "local-file") {
      const url = base.replace(/\/$/, "") + "/" + item.src.replace(/^\//, "");
      entries.set(item.id, { kind: "audio-url", url, loaded: true });
    } else if (item.type === "synthesized") {
      entries.set(item.id, { kind: "synth-meta", value: item.params ?? null, loaded: true });
    }
  }

  return {
    getTexture(id, extra = null) {
      // DOM 没有 "texture" 概念。保持接口一致性返回 HTMLImageElement。
      const e = entries.get(id);
      if (!e || !e.url) { console.warn(`[registry] missing id: ${id}`); return null; }
      const img = new Image();
      img.src = e.url;
      recordAssetUsage({ id, section: "images", kind: "texture", manifestItem: manifestImageById.get(id), extra });
      return img;
    },
    getTextureUrl(id, extra = null) {
      const e = entries.get(id);
      if (!e) { console.warn(`[registry] missing id: ${id}`); return null; }
      recordAssetUsage({ id, section: "images", kind: "texture-url", manifestItem: manifestImageById.get(id), extra });
      return e.url ?? null;
    },
    getSpritesheet(id, extra = null) {
      const e = entries.get(id);
      if (!e) return null;
      recordAssetUsage({ id, section: "spritesheets", kind: "spritesheet", manifestItem: manifestSheetById.get(id), extra });
      return { url: e.url, frameWidth: e.frameWidth, frameHeight: e.frameHeight };
    },
    getAudio(id, extra = null) {
      const e = entries.get(id);
      if (!e) { console.warn(`[registry] missing id: ${id}`); return null; }
      recordAssetUsage({ id, section: "audio", kind: "audio", manifestItem: manifestAudioById.get(id), extra });
      if (e.kind === "audio-url") return new Audio(e.url);
      if (e.kind === "synth-meta") return { synthParams: e.value };
      return null;
    },
    has: (id) => entries.has(id),
    stats: () => buildStats(entries),
  };
}
