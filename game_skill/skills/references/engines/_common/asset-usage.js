/**
 * asset-usage.js — 共享 asset-usage runtime evidence helper
 *
 * registry adapter 每次把 texture / spritesheet / audio 交给业务代码时，
 * 调用 recordAssetUsage() 把一条 entry push 到 window.__assetUsage，给
 * check_asset_usage.js 的"运行时层"校验吃——比 grep 静态证据更硬：只有真正
 * 被业务代码消费（而不仅仅是注册/预加载）才算被用过。
 *
 * Entry shape:
 *   {
 *     id:            string                    // registry id
 *     assetId:       string                    // alias of id
 *     phase:         'requested'|'rendered'|'visible'
 *     section:       'images'|'spritesheets'|'audio'
 *     kind:          'texture'|'spritesheet'|'audio'
 *     bindingTo:     string | null             // 来自 manifest 的 binding-to（可选）
 *     visualPrimitive: string | null           // 来自 manifest 的 visual-primitive（可选）
 *     colorSource:   string | null             // 来自 manifest 的 color-source（可选）
 *     at:            number                    // performance.now() 或 Date.now()
 *     extra:         any                       // 业务传的额外上下文（如 color 参数）
 *   }
 *
 * Usage (registry adapter 内部):
 *   recordAssetUsage({
 *     id, section: 'images', kind: 'texture',
 *     manifestItem: manifestImagesById.get(id),  // 可选：自动拿 binding-to 等
 *     extra: { color: pig.color },               // color-block / color-unit 建议带上
 *   });
 */

function resolveNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function getSink() {
  if (typeof window === "undefined") return null;
  if (!Array.isArray(window.__assetUsage)) window.__assetUsage = [];
  return window.__assetUsage;
}

export function recordAssetUsage({
  id,
  assetId = null,
  phase = "requested",
  section,
  kind = null,
  manifestItem = null,
  bindingTo = null,
  visualPrimitive = null,
  colorSource = null,
  slotId = null,
  entityId = null,
  semanticSlot = null,
  renderZone = null,
  x = null,
  y = null,
  width = null,
  height = null,
  visible = null,
  source = null,
  extra = null,
} = {}) {
  const sink = getSink();
  const resolvedId = id ?? assetId;
  if (!sink || !resolvedId) return;
  const entry = {
    id: resolvedId,
    assetId: resolvedId,
    phase,
    section: section ?? null,
    kind,
    bindingTo: bindingTo ?? manifestItem?.["binding-to"] ?? manifestItem?.bindingTo ?? null,
    visualPrimitive:
      visualPrimitive ?? manifestItem?.["visual-primitive"] ?? manifestItem?.visualPrimitive ?? null,
    colorSource:
      colorSource ?? manifestItem?.["color-source"] ?? manifestItem?.colorSource ?? null,
    slotId,
    entityId,
    semanticSlot,
    renderZone,
    x,
    y,
    width,
    height,
    visible,
    source,
    at: resolveNow(),
    extra,
  };
  sink.push(entry);
}

export function recordAssetRendered(opts = {}) {
  recordAssetUsage({ ...opts, phase: "rendered" });
}

export function recordAssetVisible(opts = {}) {
  recordAssetUsage({ ...opts, phase: "visible", visible: opts.visible ?? true });
}

export function hasVisibleArea({ width = null, height = null, visible = true } = {}) {
  return visible !== false && Number(width) > 0 && Number(height) > 0;
}

export function recordAssetRenderEvidence(opts = {}) {
  const {
    id,
    assetId = id,
    section = "images",
    kind = "rendered-asset",
    width = null,
    height = null,
    visible = true,
  } = opts;
  recordAssetRendered({ ...opts, id: assetId, section, kind, visible });
  if (hasVisibleArea({ width, height, visible })) {
    recordAssetVisible({ ...opts, id: assetId, section, kind, visible: true });
  }
}

/**
 * Minimal cross-engine render evidence helper. Business code may wrap a real
 * draw/DOM insertion call so checker can distinguish request from render.
 */
export function renderSlot(opts = {}) {
  const {
    id,
    assetId = id,
    draw,
    section = "images",
    kind = "render-slot",
    width,
    height,
    visible = true,
  } = opts;
  recordAssetUsage({ ...opts, id: assetId, section, kind, phase: "requested" });
  if (typeof draw === "function") draw();
  recordAssetRenderEvidence({ ...opts, id: assetId, section, kind, width, height, visible });
}

/**
 * 取 snapshot（常用于 getAssetUsage observer）。返回 deep-ish copy。
 */
export function getAssetUsageSnapshot() {
  const sink = getSink();
  if (!sink) return [];
  return sink.map((e) => ({ ...e }));
}

/**
 * Test / test-hook 用，清空记录。
 */
export function resetAssetUsage() {
  if (typeof window === "undefined") return;
  window.__assetUsage = [];
}
