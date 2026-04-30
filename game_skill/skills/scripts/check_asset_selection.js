#!/usr/bin/env node
/**
 * check_asset_selection.js — 素材选择校验
 *
 * 用法: node check_asset_selection.js <case-dir>
 *
 * 检查:
 *   1. specs/assets.yaml 存在且语法合法
 *   2. color-scheme.palette-id 可映射到 catalog asset-style，genre 是 catalog.yaml 登记的合法 id
 *   3. 每个 type==local-file 条目:
 *      - source 文件实际存在（相对项目根）
 *      - 所属包的 suitable-styles 覆盖当前 asset-style（或为 [all]）
 *      - 所属包的 suitable-genres 覆盖当前 genre（或为 [all]）
 *   4. local-file 占比达到基础阈值
 *   5. 包含 selection-report 段（candidate-packs / local-file-ratio / fallback-reasons）
 *
 * 退出码: 0 = OK, 1 = 有错误
 *
 * 路径约定:
 *   case-dir 默认为 process.argv[2]，形如 cases/{slug}/
 *   项目根 = path.resolve(case-dir, '../../')
 *   catalog = {project-root}/assets/library_2d/catalog.yaml（2D 引擎）
 *            或 {project-root}/assets/library_3d/catalog.yaml（Three.js 引擎）
 *   通过 assets.yaml 的 is-3d 字段或 runtime=three 判断使用哪个 catalog
 */

import { readFileSync, existsSync } from "fs";
import { basename, resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import {
  VISUAL_PRIMITIVE_ENUM,
  isValidVisualPrimitive,
  requiresColorSource,
  requiresGeneratedType,
  isGeneratedType,
  isValidColorSource,
} from "./_visual_primitive_enum.js";
import { createLogger, parseLogArg } from "./_logger.js";
import { readAssetStrategy, packCoherenceThreshold } from "./_asset_strategy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const _logPath = parseLogArg(process.argv);
const log = createLogger(_logPath);

const caseDir = resolve(process.argv[2] ?? "cases/demo/");
// scripts 在 game_skill/skills/scripts/，项目根 = 上三级
const projectRoot = resolve(__dirname, "../../../");

// 根据引擎类型选择 catalog：Three.js 引擎用 library_3d，其它用 library_2d
const assetsYamlPath = join(caseDir, "specs/assets.yaml");
let is3d = false;
try {
  const assetsRaw = readFileSync(assetsYamlPath, "utf-8");
  // 检查 is-3d: true 或 runtime: three
  is3d = /is-3d:\s*true/i.test(assetsRaw) || /runtime:\s*three/i.test(assetsRaw);
} catch {}
// 同时检查 state.json 中的 runtime
if (!is3d) {
  try {
    const stateRaw = readFileSync(join(caseDir, ".game/state.json"), "utf-8");
    const stateObj = JSON.parse(stateRaw);
    is3d = stateObj?.runtime === "three" || stateObj?.phases?.strategy?.runtime === "three";
  } catch {}
}
const libraryDir = is3d ? "assets/library_3d" : "assets/library_2d";
const catalogPath = join(projectRoot, libraryDir, "catalog.yaml");

const errors = [];
const warnings = [];
function fail(msg) { console.log(`  ✗ ${msg}`); errors.push(msg); }
function warn(msg) { console.log(`  ⚠ ${msg}`); warnings.push(msg); }
function ok(msg)   { console.log(`  ✓ ${msg}`); }

console.log(`素材选择校验: ${assetsYamlPath}`);

// asset-strategy 分档：mode=none → 整条 bypass；generated-only → 跳占比/pack 一致性
const strategy = readAssetStrategy(caseDir);
const MODE = strategy.mode;
const coreEntityIds = new Set(strategy["visual-core-entities"] ?? []);
console.log(`  · asset-strategy.mode = ${MODE}${strategy._isDefault ? " (默认，PRD 未声明)" : ""}`);
if (MODE === "none") {
  ok("mode=none：无需素材校验，整条 bypass");
  finish();
}

// ── 0. 载入 catalog ─────────────────────────────────────────────
if (!existsSync(catalogPath)) {
  fail(`catalog 不存在: ${catalogPath}`);
  finish();
}
let catalog;
try {
  catalog = yaml.load(readFileSync(catalogPath, "utf-8"));
} catch (e) {
  fail(`catalog 解析失败: ${e.message}`);
  finish();
}

const genreEnum = new Set((catalog.genres ?? []).map((g) => g.id));
const packById = new Map((catalog.packs ?? []).map((p) => [p.id, p]));
// 路径前缀（如 "ui-pixel/"）→ pack id，用来从 source 路径反查 pack
const pathPrefixes = [...packById.values()]
  .filter((p) => p.path)
  .map((p) => ({ id: p.id, prefix: p.path.replace(/\/?$/, "/") }))
  .sort((a, b) => b.prefix.length - a.prefix.length);  // 长前缀优先

function packIdFromSource(source) {
  // source 形如 "assets/library_2d/ui-pixel/tile_0013.png" 或 "assets/library_3d/models/..."
  const m = source.match(/^assets\/library_(?:2d|3d)\/(.+)$/);
  if (!m) return null;
  const rel = m[1];
  for (const { id, prefix } of pathPrefixes) {
    if (rel.startsWith(prefix)) return id;
  }
  return null;
}

/**
 * P0.5: 轻量 glob matcher，足够 catalog family.pattern 使用。支持：
 *   *   — 同级目录内任意字符（不跨 /）
 *   **  — 跨目录任意路径
 *   ?   — 单字符
 * 其它字符按字面匹配（包括 / 和 .）。
 */
function matchFamilyPattern(source, pattern) {
  if (!source || !pattern) return false;
  const escape = (c) => c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") { re += ".*"; i++; }
      else re += "[^/]*";
    } else if (ch === "?") {
      re += "[^/]";
    } else {
      re += escape(ch);
    }
  }
  return new RegExp("^" + re + "$").test(source);
}

function normalizeAssetType(item, section) {
  const source = item?.source ?? "";
  if (item?.type === "generated") return section === "audio" ? "synthesized" : "graphics-generated";
  if (item?.type) return String(item.type);
  if (typeof source === "string" && source.startsWith("assets/library_2d/")) return "local-file";
  if (typeof source === "string" && source.startsWith("assets/library_3d/")) return "local-file";
  if (source === "inline-svg") return "inline-svg";
  if (source === "generated") return section === "audio" ? "synthesized" : "graphics-generated";
  if (source === "synthesized") return "synthesized";
  return "unknown";
}

function isLocalFileItem(item, section) {
  return normalizeAssetType(item, section) === "local-file";
}

function readSlotList(obj, key) {
  return Array.isArray(obj?.[key]) ? obj[key].map((v) => String(v)) : [];
}

function validateSlotConstraint({ id, sec, source, packId, vp, scope, label, constraint }) {
  const disallowed = readSlotList(constraint, "disallowed-slots");
  if (disallowed.includes(vp)) {
    fail(`[${sec}.${id}] source "${source}" 属于 pack "${packId}" 的 ${scope} "${label}" (disallowed-slots=${disallowed.join(",")})，不能用作 visual-primitive="${vp}"`);
  }
  const allowed = readSlotList(constraint, "allowed-slots");
  if (allowed.length > 0 && !allowed.includes(vp)) {
    fail(`[${sec}.${id}] source "${source}" 属于 pack "${packId}" 的 ${scope} "${label}" (allowed-slots=${allowed.join(",")})，与声明的 visual-primitive="${vp}" 不符`);
  }
}

// ── 1. 载入 assets.yaml ─────────────────────────────────────────
if (!existsSync(assetsYamlPath)) {
  fail(`specs/assets.yaml 不存在`);
  finish();
}
let spec;
try {
  spec = yaml.load(readFileSync(assetsYamlPath, "utf-8"));
} catch (e) {
  fail(`assets.yaml 解析失败: ${e.message}`);
  finish();
}
const visualSlotInfo = loadVisualSlotInfo(caseDir, coreEntityIds);

// ── 2. color-scheme / genre 合法性 ──────────────────────────────
// 新流程：visual-style 已废弃，改为 color-scheme 段（含 palette-id + fx-hint）
// 兼容：如果仍存在旧 visual-style 字段也接受但 warn
const colorScheme = spec["color-scheme"];
const visualStyle = spec["visual-style"]; // 旧字段兼容
const genre = spec.genre;
let paletteId = null;
let assetStyle = null;

if (colorScheme) {
  paletteId = colorScheme["palette-id"] ? String(colorScheme["palette-id"]) : null;
  if (!paletteId) {
    fail("color-scheme 缺少 palette-id 字段");
  } else {
    ok(`color-scheme.palette-id = ${paletteId}`);
    if (is3d) {
      assetStyle = "lowpoly-3d";
      ok(`asset-style = ${assetStyle} (3D catalog 默认)`);
    } else {
      const aliases = catalog["palette-style-aliases"] ?? {};
      assetStyle = aliases[paletteId];
      if (!assetStyle) {
        fail(`palette-id "${paletteId}" 未在 catalog.palette-style-aliases 中映射到 asset-style`);
      } else {
        ok(`asset-style = ${assetStyle} (from palette-style-aliases)`);
      }
    }
  }
} else if (visualStyle) {
  warn(`发现旧字段 visual-style: "${visualStyle}"，已废弃。请迁移为 color-scheme 段`);
  assetStyle = String(visualStyle);
} else {
  fail("assets.yaml 缺 color-scheme 段（Phase 2 应自动推断并回写）");
}

if (!genre) fail("assets.yaml 缺 genre 字段");
else if (!genreEnum.has(genre)) {
  fail(`genre 非法: "${genre}"，必须是 catalog.genres 登记的 id: ${[...genreEnum].join("|")}`);
} else ok(`genre = ${genre}`);

// ── 3. 遍历 images / audio / spritesheets / fonts 的 local-file 条目 ──
const sections = ["images", "audio", "spritesheets", "fonts"];

// T8: 从 PRD 抽所有 @entity / @ui 的 id，用于 binding-to 校验
const prdEntityUiIds = loadPrdEntityUiIds(caseDir);
const colorPrimitiveIds = loadColorPrimitiveEntityIds(caseDir);

const perSectionCount = {};
const assetItems = [];
for (const sec of sections) {
  perSectionCount[sec] = { total: 0, localFile: 0 };
  const list = spec[sec] ?? [];
  if (!Array.isArray(list)) continue;

  for (const item of list) {
    const id = item.id ?? item.family ?? "(unnamed)";
    const type = normalizeAssetType(item, sec);
    const source = item.source ?? "";
    const bindingTo = item["binding-to"];
    perSectionCount[sec].total++;
    assetItems.push({
      id: String(id),
      section: sec,
      type,
      source,
      bindingTo,
      fulfillsSlot: item["fulfills-slot"],
      raw: item,
    });

    if (bindingTo && bindingTo !== "decor" && prdEntityUiIds.size > 0 && !prdEntityUiIds.has(String(bindingTo))) {
      fail(`[${sec}.${id}] binding-to="${bindingTo}" 在 PRD 的 @entity/@ui 里不存在；合法值（节选）: ${[...prdEntityUiIds].slice(0, 8).join(", ")}...`);
    }

    // P0.4: visual-primitive 通用校验（images/spritesheets 才有视觉语义）
    if (["images", "spritesheets"].includes(sec)) {
      const vpRaw = item["visual-primitive"];
      const hasVp = vpRaw !== undefined && vpRaw !== null && vpRaw !== "";
      const bindingIsCore = bindingTo && coreEntityIds.has(String(bindingTo));

      // (1) 值若声明，必须 ∈ enum（防御错写 btn / color_block 等）
      if (hasVp && !isValidVisualPrimitive(String(vpRaw))) {
        fail(`[${sec}.${id}] visual-primitive="${vpRaw}" 不在合法枚举内；合法值: ${VISUAL_PRIMITIVE_ENUM.join(", ")}`);
      }

      // (2) core entity 绑定必须有 visual-primitive
      if (bindingIsCore && !hasVp) {
        fail(`[${sec}.${id}] binding-to="${bindingTo}" 是 visual-core-entities；必须声明 visual-primitive（合法值: ${VISUAL_PRIMITIVE_ENUM.join(", ")}）`);
      }

      // (3) 需要 color-source 的 slot 必须声明 color-source
      if (hasVp && requiresColorSource(String(vpRaw))) {
        const cs = item["color-source"];
        if (!cs) {
          fail(`[${sec}.${id}] visual-primitive="${vpRaw}" 要求声明 color-source（允许: entity.<field> / palette.<name> / #rrggbb / rgb(...)）`);
        } else if (!isValidColorSource(String(cs))) {
          fail(`[${sec}.${id}] color-source="${cs}" 格式不合法；允许: entity.<field> / palette.<name> / #rrggbb / rgb(...)`);
        }
      }

      // (4) 强制程序化 slot（当前只 color-block）必须 type 为 generated/inline-svg/synthesized
      if (hasVp && requiresGeneratedType(String(vpRaw)) && !isGeneratedType(type)) {
        fail(`[${sec}.${id}] visual-primitive="${vpRaw}" 必须使用程序化 type（graphics-generated / inline-svg / synthesized），当前 type="${type}"`);
      }
    }

    if (["images", "spritesheets"].includes(sec) && isColorBlockSemantic({ id, item, bindingTo, colorPrimitiveIds })) {
      const visualPrimitive = String(item["visual-primitive"] ?? "");
      if (type === "local-file") {
        fail(`[${sec}.${id}] binding-to="${bindingTo}" 是色块/目标块语义，必须使用 generated/graphics-generated/inline-svg + visual-primitive: color-block；禁止绑定具象 local-file 素材: ${source}`);
      } else if (visualPrimitive !== "color-block") {
        fail(`[${sec}.${id}] 色块/目标块语义缺少 visual-primitive: color-block`);
      } else {
        ok(`[${sec}.${id}] 色块语义使用 generated primitive: color-block`);
      }
    }

    // fonts 的 type 字段是 optional，source google-fonts 也算合法
    if (isLocalFileItem(item, sec)) {
      perSectionCount[sec].localFile++;
      // a) 文件存在
      const abs = join(projectRoot, item.source);
      if (!existsSync(abs)) {
        fail(`[${sec}.${id}] 本地文件不存在: ${item.source}`);
        continue;
      }
      // T8: binding-to 必须存在且指向 PRD 中的 @entity/@ui id
      // 装饰音效 / 字体除外（声明 binding-to: "decor" 可豁免）
      if (!bindingTo) {
        fail(`[${sec}.${id}] 缺少 binding-to 字段——每个 local-file 必须声明它绑定到哪个 @entity/@ui；纯装饰写 binding-to: decor`);
      }
      if (coreEntityIds.size > 0 && String(bindingTo ?? "") === "decor") {
        const slotId = String(item["fulfills-slot"] ?? visualSlotInfo.assetSlotById.get(String(id)) ?? "");
        const text = `${id} ${item.usage ?? ""} ${item["semantic-slot"] ?? ""} ${source}`.toLowerCase();
        const namesCore = [...coreEntityIds].find((coreId) => {
          const needle = String(coreId).toLowerCase();
          return needle && new RegExp(`(^|[^a-z0-9_-])${escapeReg(needle)}([^a-z0-9_-]|$)`).test(text);
        });
        if (slotId && visualSlotInfo.coreSlotIds.has(slotId)) {
          fail(`[${sec}.${id}] binding-to: decor 但 fulfills-slot="${slotId}" 指向 required/core visual slot；核心 slot 禁止 decor 绑定`);
        } else if (namesCore) {
          fail(`[${sec}.${id}] binding-to: decor 但 id/usage/source 指向 core entity "${namesCore}"；核心实体素材禁止 decor 绑定`);
        }
      }
      // 语义校验已移至 check_implementation_contract.js 的 validateSemanticBinding
      // 此处只做文件存在性 + pack style/genre 匹配
      // b) 反查所属包
      const packId = packIdFromSource(item.source);
      if (!packId) {
        warn(`[${sec}.${id}] 无法反查到所属 pack: ${item.source}（可能是路径不规范）`);
        continue;
      }
      const pack = packById.get(packId);
      // P0.5: pack/family-level allowed/disallowed-slots 语义冲突检测。
      //   pack 可声明 allowed-slots / disallowed-slots 作为整包默认；
      //   families 可对命中的 glob pattern 做更细约束。family 与 pack
      //   两层都会生效，用于挡"素材和玩法语义彻底不匹配"的错配。
      const families = Array.isArray(pack?.families) ? pack.families : [];
      const vp = String(item["visual-primitive"] ?? "");
      if (vp) {
        if (readSlotList(pack, "allowed-slots").length > 0 || readSlotList(pack, "disallowed-slots").length > 0) {
          validateSlotConstraint({
            id,
            sec,
            source: item.source,
            packId,
            vp,
            scope: "pack",
            label: packId,
            constraint: pack,
          });
        }
        for (const fam of families) {
          const pat = String(fam?.pattern ?? "");
          if (!pat || !matchFamilyPattern(item.source, pat)) continue;
          validateSlotConstraint({
            id,
            sec,
            source: item.source,
            packId,
            vp,
            scope: "family",
            label: pat,
            constraint: fam,
          });
          // 一条 source 只匹配第一个命中的 family
          break;
        }
      }
      // c) asset-style 匹配（3D catalog 通常无 suitable-styles，因此自然跳过）
      if (assetStyle && pack["suitable-styles"]) {
        const styles = pack["suitable-styles"];
        if (!styles.includes("all") && !styles.includes(assetStyle)) {
          fail(`[${sec}.${id}] 来自 pack "${packId}" (styles=${styles.join(",")})，与当前 asset-style "${assetStyle}" 不匹配`);
        }
      }
      // d) genre 匹配
      if (genre && pack["suitable-genres"]) {
        const genres = pack["suitable-genres"];
        if (!genres.includes("all") && !genres.includes(genre)) {
          fail(`[${sec}.${id}] 来自 pack "${packId}" (genres=${pack["suitable-genres"].join(",")})，与当前 genre "${genre}" 不匹配`);
        }
      }
    }
  }
}

// ── 4. core visual 覆盖与 local-file 阈值 ───────────────────────
// 只把 visual-core-entities 绑定的视觉素材纳入严格判断；背景/HUD/装饰 generated
// 不进入分母，避免误杀"核心用素材、外围程序化绘制"的健康方案。
const coreVisualAssets = assetItems.filter((a) =>
  ["images", "spritesheets"].includes(a.section) &&
  a.bindingTo &&
  a.bindingTo !== "decor" &&
  coreEntityIds.has(String(a.bindingTo))
);
for (const coreId of coreEntityIds) {
  const hits = coreVisualAssets.filter((a) => String(a.bindingTo) === String(coreId));
  if (hits.length === 0) {
    fail(`[core-binding] visual-core-entities 中的 "${coreId}" 没有任何非 decor 视觉 asset 绑定；核心实体必须至少有一个 local-file / generated / inline-svg 表达`);
  } else {
    ok(`[core-binding] ${coreId} 有 ${hits.length} 个核心视觉 asset 绑定`);
  }
}

if (MODE === "generated-only") {
  ok(`mode=generated-only：允许核心视觉使用 generated/inline-svg，跳过 local-file 阈值`);
} else if (MODE === "library-first") {
  if (coreEntityIds.size === 0) {
    ok(`[core-local-file] visual-core-entities 为空，跳过核心 local-file 阈值`);
  } else if (coreVisualAssets.length === 0) {
    fail(`[core-local-file] library-first 需要至少一个绑定到 visual-core-entities 的视觉 asset`);
  } else {
    const coreLocal = coreVisualAssets.filter((a) => a.type === "local-file").length;
    const ratio = coreLocal / coreVisualAssets.length;
    const pct = (ratio * 100).toFixed(1);
    if (ratio < 0.30) {
      fail(`[core-local-file] 核心视觉 local-file 占比 ${pct}% < 30%（只统计 visual-core-entities，外围 generated 不进分母）`);
    } else {
      ok(`[core-local-file] 核心视觉 local-file 占比 ${pct}% ≥ 30%`);
    }
  }
}

// ── 5. selection-report 段 ─────────────────────────────────────
const report = spec["selection-report"];
if (!report) {
  fail("assets.yaml 缺 selection-report 段（expander 必须说明每个候选包是否选用）");
} else {
  if (!Array.isArray(report["candidate-packs"]) || report["candidate-packs"].length === 0) {
    fail("selection-report.candidate-packs 为空");
  } else {
    ok(`selection-report 列出 ${report["candidate-packs"].length} 个候选包`);
  }
  if (!report["local-file-ratio"]) warn("selection-report 缺 local-file-ratio 段");
  // fallback-reasons 是弱要求：若 images/audio 里有非 local-file 条目，则必须列出
  const hasFallback = sections.some((sec) =>
    (spec[sec] ?? []).some((item) => item.type && item.type !== "local-file")
  );
  if (hasFallback && (!Array.isArray(report["fallback-reasons"]) || report["fallback-reasons"].length === 0)) {
    warn("存在非 local-file 条目但 selection-report.fallback-reasons 为空，建议为每个条目说明原因");
  }
}

// ── 5.5. T8/P1-2：decor 占比 > 40% 的阻断策略 ──────────────────
// decor 是 binding-to 的退路，但不应用它水通过。如果一半以上 asset 都写 decor，
// 大概率是 expander 偷懒没去绑真正的 @entity/@ui。
let totalBindings = 0, decorBindings = 0;
for (const sec of sections) {
  for (const item of spec[sec] ?? []) {
    if (!item || !isLocalFileItem(item, sec)) continue;
    totalBindings++;
    if (String(item["binding-to"] ?? "") === "decor") decorBindings++;
  }
}
if (totalBindings > 0) {
  const decorRatio = decorBindings / totalBindings;
  const decorPct = (decorRatio * 100).toFixed(0);
  if (decorRatio > 0.4) {
    if (coreEntityIds.size > 0) {
      fail(`[binding-decor] visual-core-entities 非空时，local-file decor 占比 ${decorBindings}/${totalBindings} (${decorPct}%) > 40%，必须改为绑定真实 @entity/@ui 或降低素材数量`);
    } else {
      warn(`[binding-decor] ${decorBindings}/${totalBindings} (${decorPct}%) 的 local-file 写了 binding-to: decor，可能漏绑 @entity/@ui；当前 visual-core-entities 为空，保留 warning`);
    }
  } else {
    ok(`[binding-decor] decor 占比 ${decorPct}% ≤ 40%`);
  }
}

// ── 6. T17/L3: 同 pack 优先软约束 ──────────────────────────────
// 一个 case 的 local-file 应该 ≥70% 来自同一个 pack（视觉风格不割裂）
// 不同 pack 可以混，但必须在 selection-report.pack-mix-reason 里说明原因
// 只 warn，不 fail——给创作空间，但让模型知道"从 20 个 pack 各挑一件"不健康
const packCounts = new Map();
let totalLocal = 0;
for (const sec of sections) {
  for (const item of spec[sec] ?? []) {
    if (!item || !isLocalFileItem(item, sec) || !item.source) continue;
    const packId = packIdFromSource(item.source);
    if (!packId) continue;
    totalLocal++;
    packCounts.set(packId, (packCounts.get(packId) ?? 0) + 1);
  }
}
if (totalLocal >= 5) {  // 太少素材时跳过检查
  const packThreshold = packCoherenceThreshold(strategy);
  if (packThreshold === null) {
    ok(`[pack-coherence] style-coherence=n/a，跳过 pack 一致性检查`);
  } else {
    const sorted = [...packCounts.entries()].sort((a, b) => b[1] - a[1]);
    const topPack = sorted[0];
    const topRatio = topPack[1] / totalLocal;
    const topPct = (topRatio * 100).toFixed(0);
    const thrPct = (packThreshold * 100).toFixed(0);
    if (topRatio < packThreshold) {
      const breakdown = sorted.slice(0, 5).map(([id, n]) => `${id}=${n}`).join(" ");
      const hasReason = typeof report?.["pack-mix-reason"] === "string" && report["pack-mix-reason"].length > 0;
      if (!hasReason) {
        warn(`[pack-coherence] 最大包 "${topPack[0]}" 仅占 local-file ${topPct}% (<${thrPct}%，strategy=${strategy["style-coherence"]?.level})，视觉风格易割裂；各包分布: ${breakdown}。如有意混包请在 selection-report.pack-mix-reason 说明`);
      } else {
        ok(`[pack-coherence] 混包但已说明原因: "${String(report["pack-mix-reason"]).slice(0, 60)}..."`);
      }
    } else {
      ok(`[pack-coherence] 主包 "${topPack[0]}" 覆盖率 ${topPct}% ≥ ${thrPct}% (strategy=${strategy["style-coherence"]?.level})`);
    }
  }
}

// ── Finish ─────────────────────────────────────────────────────
function finish() {
  console.log(
    `\n${errors.length === 0 ? "✓ 通过" : `✗ ${errors.length} 个错误`}` +
      (warnings.length ? `（${warnings.length} warnings）` : "")
  );
  log.entry({
    type: "check-run",
    phase: "verify",
    step: "asset-selection",
    script: "check_asset_selection.js",
    exit_code: errors.length > 0 ? 1 : 0,
    errors,
    warnings,
  });
  process.exit(errors.length > 0 ? 1 : 0);
}
finish();

// T8 helper: 从 PRD 抽所有 @entity / @ui 的 id，用于 binding-to 校验
function loadPrdEntityUiIds(caseDir) {
  const prdPath = join(caseDir, "docs/game-prd.md");
  const ids = new Set();
  if (!existsSync(prdPath)) return ids;
  try {
    const content = readFileSync(prdPath, "utf-8");
    // 抓 ### @entity(xxx) 和 ### @ui(xxx)
    const re = /^#{2,4}[ \t]+@(entity|ui)\(([^)]+)\)/gm;
    let m;
    while ((m = re.exec(content)) !== null) {
      ids.add(m[2].trim());
    }
  } catch {}
  return ids;
}

function loadColorPrimitiveEntityIds(caseDir) {
  const prdPath = join(caseDir, "docs/game-prd.md");
  const ids = new Set();
  if (!existsSync(prdPath)) return ids;
  try {
    const content = readFileSync(prdPath, "utf-8");
    const re = /^#{2,4}[ \t]+@(entity|ui)\(([^)]+)\)([^\n]*)\n([\s\S]*?)(?=^#{2,4}[ \t]+@|\n## |\n# |$)/gm;
    let m;
    while ((m = re.exec(content)) !== null) {
      const id = m[2].trim();
      const block = `${m[3]}\n${m[4]}`.toLowerCase();
      const isBlock = /色块|方块|目标块|color\s*block|\bblock\b/.test(block) || /\bblock\b/.test(id.toLowerCase());
      const hasColorField = /color|颜色/.test(block);
      if (isBlock && hasColorField) ids.add(id);
    }
  } catch {}
  return ids;
}

function loadVisualSlotInfo(caseDir, coreEntityIds) {
  const slotPath = join(caseDir, "specs/visual-slots.yaml");
  const info = { coreSlotIds: new Set(), assetSlotById: new Map() };
  if (!existsSync(slotPath)) return info;
  try {
    const doc = yaml.load(readFileSync(slotPath, "utf-8")) ?? {};
    for (const slot of doc.slots ?? []) {
      const id = String(slot?.id ?? "");
      if (!id) continue;
      if (slot.required === true || coreEntityIds.has(String(slot.entity ?? ""))) {
        info.coreSlotIds.add(id);
      }
    }
    for (const binding of doc["asset-slot-bindings"] ?? []) {
      const assetId = String(binding?.["asset-id"] ?? "");
      const slotId = String(binding?.["fulfills-slot"] ?? "");
      if (assetId && slotId) info.assetSlotById.set(assetId, slotId);
    }
  } catch {}
  return info;
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isColorBlockSemantic({ id, item, bindingTo, colorPrimitiveIds }) {
  const text = `${id} ${item?.usage ?? ""} ${item?.["visual-primitive"] ?? ""}`.toLowerCase();
  if (String(item?.["visual-primitive"] ?? "") === "color-block") return true;
  if (bindingTo && colorPrimitiveIds.has(String(bindingTo))) return true;
  return /色块|目标块|方块|color\s*block/.test(text);
}
