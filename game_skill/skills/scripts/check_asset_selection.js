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
import { createLogger, parseLogArg } from "./_logger.js";

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
  // source 形如 "assets/library_2d/ui-pixel/tile_0010.png" 或 "assets/library_3d/models/..."
  const m = source.match(/^assets\/library_(?:2d|3d)\/(.+)$/);
  if (!m) return null;
  const rel = m[1];
  for (const { id, prefix } of pathPrefixes) {
    if (rel.startsWith(prefix)) return id;
  }
  return null;
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
const perSectionCount = {};
for (const sec of sections) {
  perSectionCount[sec] = { total: 0, localFile: 0 };
  const list = spec[sec] ?? [];
  if (!Array.isArray(list)) continue;

  for (const item of list) {
    const id = item.id ?? item.family ?? "(unnamed)";
    perSectionCount[sec].total++;

    // fonts 的 type 字段是 optional，source google-fonts 也算合法
    if (item.type === "local-file" || (item.source && typeof item.source === "string" && (item.source.startsWith("assets/library_2d/") || item.source.startsWith("assets/library_3d/")))) {
      perSectionCount[sec].localFile++;
      // a) 文件存在
      const abs = join(projectRoot, item.source);
      if (!existsSync(abs)) {
        fail(`[${sec}.${id}] 本地文件不存在: ${item.source}`);
        continue;
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

// ── 4. local-file 占比阈值（no-external-assets 约束不豁免此项）──────────
// no-external-assets 语义：禁止远程 CDN/HTTP 运行时依赖，但不禁止仓库内相对路径的
// project-local 素材（assets/library_2d、assets/library_3d）。因此 ratio 检查照常做。
// 新流程：不再按 asset-style 区分阈值，统一使用基础阈值
const th = { images: 0.30, audio: 0.30 };

for (const sec of ["images", "audio"]) {
  const c = perSectionCount[sec];
  if (c.total === 0) continue;
  const ratio = c.localFile / c.total;
  const min = th[sec];
  const pct = (ratio * 100).toFixed(1);
  if (ratio < min) {
    fail(`[${sec}] local-file 占比 ${pct}% < 阈值 ${(min*100).toFixed(0)}%，catalog 里有合适素材却没用`);
  } else {
    ok(`[${sec}] local-file 占比 ${pct}% ≥ ${(min*100).toFixed(0)}%`);
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
