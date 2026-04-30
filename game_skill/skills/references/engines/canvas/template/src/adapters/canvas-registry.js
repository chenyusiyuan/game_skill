/**
 * canvas-registry.js — Canvas 2D 的 asset registry adapter
 *
 * 实现 _common/registry.spec.js 定义的接口。
 * 所有素材预加载为 HTMLImageElement / HTMLAudioElement，业务代码用
 * getTexture(id) 拿到 Image，直接 ctx.drawImage(img, x, y) 使用。
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

  // 并行预加载
  const loadImage = (item) => new Promise((resolve) => {
    if (item.type === "inline-svg" && item.svg) {
      const blob = new Blob([item.svg], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { entries.set(item.id, { kind: "image", value: img, loaded: true }); resolve(); };
      img.onerror = () => { entries.set(item.id, { kind: "image", value: null, loaded: false, error: "svg-decode" }); resolve(); };
      img.src = url;
      return;
    }
    if (item.type === "graphics-generated") {
      // 程序化占位：registry 只保留 draw meta，business 代码自己画
      entries.set(item.id, { kind: "draw-meta", value: item.draw ?? null, loaded: true });
      return resolve();
    }
    if (item.type === "local-file") {
      const img = new Image();
      const url = base.replace(/\/$/, "") + "/" + item.src.replace(/^\//, "");
      img.onload = () => { entries.set(item.id, { kind: "image", value: img, loaded: true }); resolve(); };
      img.onerror = () => {
        console.error(`[canvas-registry] failed to load ${item.id}: ${url}`);
        entries.set(item.id, { kind: "image", value: null, loaded: false, error: "404" });
        resolve();
      };
      img.src = url;
      return;
    }
    // 其他类型忽略
    entries.set(item.id, { kind: "unknown", value: null, loaded: false });
    resolve();
  });

  const loadAudio = (item) => new Promise((resolve) => {
    if (item.type === "local-file") {
      const audio = new Audio();
      const url = base.replace(/\/$/, "") + "/" + item.src.replace(/^\//, "");
      audio.addEventListener("canplaythrough", () => { entries.set(item.id, { kind: "audio", value: audio, loaded: true }); resolve(); }, { once: true });
      audio.addEventListener("error", () => {
        console.error(`[canvas-registry] failed to load audio ${item.id}: ${url}`);
        entries.set(item.id, { kind: "audio", value: null, loaded: false, error: "404" });
        resolve();
      }, { once: true });
      audio.src = url;
      return;
    }
    if (item.type === "synthesized") {
      // 合成音效由业务代码通过 Web Audio 自己做，registry 只留 meta
      entries.set(item.id, { kind: "synth-meta", value: item.params ?? null, loaded: true });
      return resolve();
    }
    entries.set(item.id, { kind: "unknown", value: null, loaded: false });
    resolve();
  });

  await Promise.all([
    ...(manifest.images ?? []).map(loadImage),
    ...(manifest.spritesheets ?? []).map(loadImage),
    ...(manifest.audio ?? []).map(loadAudio),
  ]);

  function get(id) { return entries.get(id); }

  return {
    getTexture(id, extra = null) {
      const e = get(id);
      if (!e) { console.warn(`[registry] missing id: ${id}`); return null; }
      if (e.kind !== "image") return null;
      const isSheet = manifestSheetById.has(id);
      recordAssetUsage({
        id,
        section: isSheet ? "spritesheets" : "images",
        kind: "texture",
        manifestItem: isSheet ? manifestSheetById.get(id) : manifestImageById.get(id),
        extra,
      });
      return e.value;
    },
    getSpritesheet(id, extra = null) {
      const e = get(id);
      if (!e) { console.warn(`[registry] missing id: ${id}`); return null; }
      const meta = manifestSheetById.get(id);
      if (e.kind !== "image") return null;
      recordAssetUsage({
        id,
        section: "spritesheets",
        kind: "spritesheet",
        manifestItem: meta,
        extra,
      });
      return { image: e.value, frameWidth: meta?.frameWidth, frameHeight: meta?.frameHeight };
    },
    getAudio(id, extra = null) {
      const e = get(id);
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
    drawAsset(ctx, id, rect, opts = {}) {
      const texture = this.getTexture(id, opts.extra ?? null);
      if (!texture) return false;
      const x = Number(rect?.x ?? 0);
      const y = Number(rect?.y ?? 0);
      const width = Number(rect?.width ?? rect?.w ?? 0);
      const height = Number(rect?.height ?? rect?.h ?? 0);
      ctx.drawImage(texture, x, y, width, height);
      const manifestItem = manifestImageById.get(id) ?? manifestSheetById.get(id) ?? null;
      recordAssetRenderEvidence({
        id,
        section: manifestSheetById.has(id) ? "spritesheets" : "images",
        kind: "canvas-draw-image",
        manifestItem,
        slotId: opts.slotId ?? null,
        entityId: opts.entityId ?? null,
        semanticSlot: opts.semanticSlot ?? null,
        renderZone: opts.renderZone ?? null,
        x,
        y,
        width,
        height,
        visible: width > 0 && height > 0,
        source: "canvas-registry.drawAsset",
        extra: opts.extra ?? null,
      });
      return true;
    },
    has: (id) => entries.has(id),
    stats: () => buildStats(entries),
  };
}
