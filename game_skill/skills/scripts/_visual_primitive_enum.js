/**
 * _visual_primitive_enum.js — visual-primitive 字段的单一真相源
 *
 * 被 check_asset_selection.js / check_implementation_contract.js /
 *    generate_implementation_contract.js 共享。
 *
 * 设计约束：
 * - 任何 asset 的 visual-primitive 值必须 ∈ VISUAL_PRIMITIVE_ENUM；
 * - 凡 binding-to 在 visual-core-entities（来自 PRD asset-strategy）里 →
 *   必须有 visual-primitive；
 * - visual-primitive ∈ {color-block, color-unit, colorable-token} →
 *   必须声明 color-source；
 * - visual-primitive=color-block → type ∈ {graphics-generated, inline-svg}。
 *
 * 枚举值语义（P0 直接从现 case 用法归纳，未来 P2 会更名为 semantic-slot）：
 *   color-block / color-unit / colorable-token —— 颜色来自玩法字段的抽象色块 / 单位 / 令牌
 *   ui-button / ui-panel / ui-readout / ui-text-surface —— UI 控件与文字承载面
 *   background —— 场景背景（大图/程序化 fill）
 *   grid / track / track-segment —— 棋盘 / 轨道 / 轨道段
 *   icon —— 小图标（HUD/按钮内嵌）
 *   terrain-cell —— 地格（tile 类）
 *   decorative —— 纯装饰，不承担语义
 */

export const VISUAL_PRIMITIVE_ENUM = Object.freeze([
  "color-block",
  "color-unit",
  "colorable-token",
  "ui-button",
  "ui-panel",
  "ui-readout",
  "ui-text-surface",
  "background",
  "grid",
  "track",
  "track-segment",
  "icon",
  "terrain-cell",
  "decorative",
]);

const ENUM_SET = new Set(VISUAL_PRIMITIVE_ENUM);

/**
 * 需要 color-source 字段的 visual-primitive 值（色彩来自玩法实体字段）。
 */
export const COLOR_SOURCE_REQUIRED_SLOTS = Object.freeze([
  "color-block",
  "color-unit",
  "colorable-token",
]);

const COLOR_SOURCE_REQUIRED_SET = new Set(COLOR_SOURCE_REQUIRED_SLOTS);

/**
 * 必须用程序化生成素材的 slot（禁止绑定 local-file 具象图）。
 */
export const GENERATED_ONLY_SLOTS = Object.freeze(["color-block"]);

const GENERATED_ONLY_SET = new Set(GENERATED_ONLY_SLOTS);

/** type 枚举中可被 color-block 接受的值。 */
export const GENERATED_TYPES = Object.freeze([
  "graphics-generated",
  "inline-svg",
  "synthesized",
]);

const GENERATED_TYPE_SET = new Set(GENERATED_TYPES);

export function isValidVisualPrimitive(v) {
  return typeof v === "string" && ENUM_SET.has(v);
}

export function requiresColorSource(v) {
  return typeof v === "string" && COLOR_SOURCE_REQUIRED_SET.has(v);
}

export function requiresGeneratedType(v) {
  return typeof v === "string" && GENERATED_ONLY_SET.has(v);
}

export function isGeneratedType(t) {
  return typeof t === "string" && GENERATED_TYPE_SET.has(t);
}

/**
 * color-source 字段格式校验（宽松）：接受以下形态——
 *   entity.<field>  — 从绑定实体的某个字段取色
 *   palette.<name>  — 从调色板命名色取色
 *   "#rrggbb" / "#rgb" — 字面十六进制
 *   一个形如 rgb(...) / hsl(...) 的函数式颜色串
 */
export function isValidColorSource(v) {
  if (typeof v !== "string" || v.length === 0) return false;
  if (/^entity\.[\w-]+$/.test(v)) return true;
  if (/^palette\.[\w-]+$/.test(v)) return true;
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return true;
  if (/^(rgb|rgba|hsl|hsla)\([^)]+\)$/.test(v)) return true;
  return false;
}
