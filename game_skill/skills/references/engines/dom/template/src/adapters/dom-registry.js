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
import { recordAssetRendered, recordAssetUsage, recordAssetVisible } from "../_common/asset-usage.js";

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

  function sectionFor(id) {
    return manifestSheetById.has(id) ? "spritesheets" : "images";
  }

  function manifestItemFor(id) {
    return manifestImageById.get(id) ?? manifestSheetById.get(id) ?? null;
  }

  function applyStyle(el, style) {
    if (!style) return;
    if (typeof style === "string") {
      el.style.cssText += style;
      return;
    }
    Object.assign(el.style, style);
  }

  function evidenceBase(id, opts, kind) {
    return {
      id,
      section: sectionFor(id),
      kind,
      manifestItem: manifestItemFor(id),
      slotId: opts.slotId ?? null,
      entityId: opts.entityId ?? null,
      semanticSlot: opts.semanticSlot ?? null,
      renderZone: opts.renderZone ?? null,
      source: opts.source ?? null,
      extra: opts.extra ?? null,
    };
  }

  function measureVisible(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") {
      return { visible: false, x: null, y: null, width: null, height: null };
    }
    const rect = el.getBoundingClientRect();
    const style = typeof getComputedStyle === "function" ? getComputedStyle(el) : {};
    const opacity = Number.parseFloat(style.opacity ?? "1");
    const visible =
      Number(rect.width) > 0 &&
      Number(rect.height) > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      (!Number.isFinite(opacity) || opacity > 0);
    return {
      visible,
      x: Number(rect.x ?? rect.left ?? 0),
      y: Number(rect.y ?? rect.top ?? 0),
      width: Number(rect.width ?? 0),
      height: Number(rect.height ?? 0),
    };
  }

  function scheduleVisibleEvidence(el, id, opts, kind) {
    const record = () => {
      const measured = measureVisible(el);
      if (!measured.visible) return;
      recordAssetVisible({
        ...evidenceBase(id, opts, kind),
        ...measured,
        visible: true,
      });
    };
    if (typeof el?.addEventListener === "function" && el.tagName === "IMG") {
      el.addEventListener("load", record, { once: true });
    }
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(record);
    else setTimeout(record, 0);
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
      recordAssetUsage({ id, section: sectionFor(id), kind: "texture-url", manifestItem: manifestItemFor(id), extra });
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
    createImageElement(id, opts = {}) {
      const url = this.getTextureUrl(id, opts.extra ?? null);
      if (!url || typeof document === "undefined") return null;
      const img = document.createElement("img");
      img.src = url;
      img.alt = opts.alt ?? id;
      img.dataset.assetId = id;
      if (opts.className) img.className = opts.className;
      if (opts.width !== undefined) img.width = Number(opts.width);
      if (opts.height !== undefined) img.height = Number(opts.height);
      applyStyle(img, opts.style);
      recordAssetRendered({
        ...evidenceBase(id, { ...opts, source: "dom-registry.createImageElement" }, "dom-img"),
        width: opts.width ?? null,
        height: opts.height ?? null,
      });
      scheduleVisibleEvidence(img, id, { ...opts, source: "dom-registry.createImageElement" }, "dom-img");
      return img;
    },
    setBackgroundAsset(element, id, opts = {}) {
      const url = this.getTextureUrl(id, opts.extra ?? null);
      if (!url || !element?.style) return false;
      element.style.backgroundImage = `url("${url}")`;
      if (opts.backgroundSize) element.style.backgroundSize = opts.backgroundSize;
      if (opts.backgroundPosition) element.style.backgroundPosition = opts.backgroundPosition;
      if (opts.backgroundRepeat) element.style.backgroundRepeat = opts.backgroundRepeat;
      recordAssetRendered({
        ...evidenceBase(id, { ...opts, source: "dom-registry.setBackgroundAsset" }, "dom-background-image"),
      });
      scheduleVisibleEvidence(element, id, { ...opts, source: "dom-registry.setBackgroundAsset" }, "dom-background-image");
      return true;
    },
    has: (id) => entries.has(id),
    stats: () => buildStats(entries),
  };
}
