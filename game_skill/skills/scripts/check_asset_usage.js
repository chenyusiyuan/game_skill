#!/usr/bin/env node
/**
 * check_asset_usage.js — 素材消费校验（Phase 4 硬门槛）
 *
 * 用法: node check_asset_usage.js <case-dir>
 *
 * 目的：阻断"expander 列了 assets，codegen 生成了 manifest + adapter，
 * 但业务代码里一次都没用"的链路断层。这是背单词 case phaser/pixijs
 * 产出"0 次 add.image / 0 次 new Sprite"问题的根因防线。
 *
 * 检查逻辑：
 *   对 specs/assets.yaml 中每个 type=local-file 的条目：
 *     1. 该 asset 的 id 必须在 game/src 或 index.html 中出现（走 registry 路径）
 *        或该 asset 的 basename 必须在代码中出现（走直接路径引用）
 *     2. 同时整份代码（index.html + src/**\/*.js）必须出现至少一次引擎级消费调用：
 *        canvas  → drawImage 或 <img src
 *        dom-ui  → <img src / background-image / getTextureUrl
 *        phaser3 → add.image / add.sprite / sound.play / sound.add
 *        pixijs  → new Sprite / Sprite.from / Sprite(
 *        three   → TextureLoader / GLTFLoader / SpriteMaterial / MeshBasicMaterial
 *   统计 used / total，比例 < 60% 或 0 次引擎级消费 → FAIL
 *
 * 退出码: 0 = OK, 1 = FAIL
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";
import { readGameMeta } from "./_run_mode.js";
import { readAssetStrategy } from "./_asset_strategy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const _logPath = parseLogArg(process.argv);
const log = createLogger(_logPath);

const caseDir = resolve(process.argv[2] ?? "cases/demo/");
const gameDir = join(caseDir, "game");
const assetsYamlPath = join(caseDir, "specs/assets.yaml");

const errors = [];
const warnings = [];
function fail(msg) { console.log(`  ✗ ${msg}`); errors.push(msg); }
function warn(msg) { console.log(`  ⚠ ${msg}`); warnings.push(msg); }
function ok(msg)   { console.log(`  ✓ ${msg}`); }

function finish() {
  console.log(`\n${errors.length === 0 ? "✓ 通过" : `✗ ${errors.length} 个错误`}` +
    (warnings.length ? `（${warnings.length} warnings）` : ""));
  log.entry({
    type: "check-run",
    phase: "verify",
    step: "asset-usage",
    script: "check_asset_usage.js",
    exit_code: errors.length > 0 ? 1 : 0,
    errors,
    warnings,
  });
  process.exit(errors.length > 0 ? 1 : 0);
}

console.log(`素材消费校验: ${caseDir}`);

// asset-strategy: mode=none → bypass
const strategy = readAssetStrategy(caseDir);
if (strategy.mode === "none") {
  ok(`mode=none：无需消费校验，整条 bypass`);
  finish();
}

if (!existsSync(assetsYamlPath)) {
  console.log("  · 无 specs/assets.yaml，跳过");
  finish();
}
if (!existsSync(gameDir)) {
  fail(`game/ 目录不存在: ${gameDir}`);
  finish();
}

// 1) 读 engineId
let engineId = "";
try {
  const meta = readGameMeta(gameDir);
  engineId = (meta.marker?.engineId ?? "").toLowerCase();
} catch (e) {
  fail(`读取 index.html 失败: ${e.message}`);
  finish();
}

// 2) 读 assets.yaml
let spec;
try {
  spec = yaml.load(readFileSync(assetsYamlPath, "utf-8"));
} catch (e) {
  fail(`assets.yaml 解析失败: ${e.message}`);
  finish();
}

// T9: 从 contract 读 must-render 清单；没有 contract 就 fallback 到 assets.yaml 的 local-file 全量
// required = 必须被业务代码消费的 asset id 子集；其它 asset 存在但不强制消费
let requiredAssetIds = null;
const contractPath = join(caseDir, "specs/implementation-contract.yaml");
if (existsSync(contractPath)) {
  try {
    const contract = yaml.load(readFileSync(contractPath, "utf-8"));
    const bindings = Array.isArray(contract?.["asset-bindings"]) ? contract["asset-bindings"] : [];
    const mustRender = bindings.filter((b) =>
      b["must-render"] === true &&
      ["images", "spritesheets", "audio"].includes(b.section)
    );
    requiredAssetIds = new Set(mustRender.map((b) => String(b.id)));
  } catch {}
}

const assetItems = [];
for (const sec of ["images", "audio", "spritesheets"]) {
  const list = spec?.[sec] ?? [];
  if (!Array.isArray(list)) continue;
  for (const item of list) {
    if (!item) continue;
    const type = normalizeAssetType(item, sec);
    if (!["local-file", "graphics-generated", "inline-svg", "synthesized"].includes(type)) continue;
    assetItems.push({
      section: sec,
      id: item.id ?? basename(item.source ?? "unknown"),
      source: item.source ?? "",
      type,
    });
  }
}

// T9: 如果没有 contract 派生的 required 集合，fallback 成 local-file 全量（兼容旧流程）
const requiredAssets = requiredAssetIds
  ? assetItems.filter((a) => requiredAssetIds.has(String(a.id)))
  : assetItems.filter((a) => a.type === "local-file");

if (assetItems.length === 0) {
  // 上游 check_asset_selection.js 已经在 images=[] 时失败，这里只需
  // 给出 warning，不重复阻断。
  warn("assets.yaml 中没有可检查的视觉/音频 asset 条目，跳过消费校验");
  finish();
}

if (requiredAssets.length === 0 && requiredAssetIds !== null) {
  // contract 里没有 must-render=true 的 asset —— 也许所有 asset 都是 decor
  // 这是合法的，不阻断；但提醒用户
  warn("implementation-contract.yaml 中没有 must-render=true 的素材；如果 PRD 真的无图形化核心 entity 则忽略，否则检查 binding-to 设置");
  finish();
}

// 3) 收集所有源码（index.html + src/**/*.js）
function walkJs(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walkJs(p));
    else if (f.endsWith(".js") || f.endsWith(".mjs")) out.push(p);
  }
  return out;
}
const htmlPath = join(gameDir, "index.html");
const jsFiles = walkJs(join(gameDir, "src"));
const srcBlobs = [];
if (existsSync(htmlPath)) srcBlobs.push(readFileSync(htmlPath, "utf-8"));
for (const p of jsFiles) srcBlobs.push(readFileSync(p, "utf-8"));
const allSrc = srcBlobs.join("\n");

// 排除 registry/adapter/manifest 这些"仅仅搬运素材"的粘合文件 —— 它们不算"真正的业务消费"
const businessBlobs = [];
if (existsSync(htmlPath)) businessBlobs.push(readFileSync(htmlPath, "utf-8"));
for (const p of jsFiles) {
  if (/adapters\//.test(p)) continue;
  if (/_common\//.test(p)) continue;
  if (/assets\.manifest\.json$/.test(p)) continue;
  businessBlobs.push(readFileSync(p, "utf-8"));
}
const businessSrc = businessBlobs.join("\n");
const generatedConsumerPattern = /fillRect\s*\(|strokeRect\s*\(|roundRect\s*\(|arc\s*\(|beginPath\s*\(|ctx\.fill\s*\(|ctx\.stroke\s*\(|new\s+Graphics\s*\(|\.add\.graphics\s*\(|\.fillRect\s*\(|\.fillCircle\s*\(|\.rect\s*\(|\.circle\s*\(|\.fill\s*\(|\.stroke\s*\(|<svg\b|createElementNS\s*\([^)]*svg/;

// 4) 单条 asset 被引用判定：id 或 basename 命中 allSrc（allSrc 含 manifest，id 在 manifest 里也算用了）
// T9: 只统计 required（contract 声明 must-render=true）子集；其它 asset 存在不报错
let used = 0;
const unused = [];
for (const a of requiredAssets) {
  const base = a.source ? basename(a.source) : "";
  const hasRef = (a.id && new RegExp(`["'\`]${escapeReg(a.id)}["'\`]`).test(businessSrc)) ||
    (a.type === "local-file" && base && businessSrc.includes(base));
  const hasConsumer = consumerPatternForAsset(a).test(businessSrc);
  if (hasRef && hasConsumer) {
    used++;
  } else {
    unused.push(a);
  }
}

const ratio = requiredAssets.length === 0 ? 1 : used / requiredAssets.length;
const pct = (ratio * 100).toFixed(1);
console.log(`  • required asset 条目: ${requiredAssets.length} / 全量 ${assetItems.length}，业务代码消费 ${used}（${pct}%）`);
for (const a of unused.slice(0, 10)) {
  console.log(`    ↳ 未引用: [${a.section}] ${a.id} (${a.source})`);
}
if (unused.length > 10) console.log(`    ↳ ... 还有 ${unused.length - 10} 条未列出`);

// T9: required 必须 100% 被消费（而不是以前的"整体 60%"——整体阈值允许模型靠塞非核心素材过线）
if (ratio < 1.0 && requiredAssets.length > 0) {
  fail(`required asset 有 ${unused.length} 条未被业务代码消费（must-render=true 的素材必须 100% 被引用并形成渲染/播放证据）`);
} else {
  ok(`required asset 消费率 100% (${used}/${requiredAssets.length})`);
}

// 5) 引擎级消费调用至少出现一次
const engineConsumerPatterns = {
  canvas:  [/\.drawImage\s*\(/, /<img\s+[^>]*src\s*=/i],
  "dom-ui": [/<img\s+[^>]*src\s*=/i, /background-image\s*:\s*url\(/i, /getTextureUrl\s*\(/],
  dom:     [/<img\s+[^>]*src\s*=/i, /background-image\s*:\s*url\(/i, /getTextureUrl\s*\(/],
  phaser3: [/\.add\.image\s*\(/, /\.add\.sprite\s*\(/, /\.sound\.add\s*\(/, /\.sound\.play\s*\(/, /this\.load\.image\s*\(/, /this\.load\.audio\s*\(/],
  phaser:  [/\.add\.image\s*\(/, /\.add\.sprite\s*\(/, /\.sound\.add\s*\(/, /\.sound\.play\s*\(/, /this\.load\.image\s*\(/, /this\.load\.audio\s*\(/],
  pixijs:  [/new\s+Sprite\s*\(/, /Sprite\.from\s*\(/, /PIXI\.Sprite\s*\(/],
  pixi:    [/new\s+Sprite\s*\(/, /Sprite\.from\s*\(/, /PIXI\.Sprite\s*\(/],
  three:   [/TextureLoader\s*\(/, /GLTFLoader\s*\(/, /AudioLoader\s*\(/, /new\s+THREE\.Sprite\s*\(/, /SpriteMaterial\s*\(/, /MeshBasicMaterial\s*\(\s*{[^}]*map\s*:/],
};

const hasRequiredLocal = requiredAssets.some((a) => a.type === "local-file");
const hasRequiredGeneratedVisual = requiredAssets.some((a) =>
  ["graphics-generated", "inline-svg"].includes(a.type) &&
  ["images", "spritesheets"].includes(a.section)
);

const patterns = engineConsumerPatterns[engineId];
if (!patterns) {
  warn(`未识别的 engineId=${engineId}，跳过消费调用检查`);
} else if (hasRequiredLocal) {
  // 在业务源码（排除 adapter/manifest）里查消费调用
  const hits = patterns.map((re) => re.test(businessSrc));
  const hitIdx = hits.findIndex(Boolean);
  if (hitIdx === -1) {
    fail(`[ENGINE-${engineId}] 业务代码中未找到引擎级素材消费调用（需至少一处：${patterns.map((r) => r.source).join(" | ")}）；仅在 manifest 注册不算消费`);
  } else {
    ok(`[ENGINE-${engineId}] 业务代码存在引擎级消费调用（匹配模式 ${hitIdx}）`);
  }
} else if (hasRequiredGeneratedVisual) {
  if (!generatedConsumerPattern.test(businessSrc)) {
    fail(`[ENGINE-${engineId}] required generated 视觉 asset 缺少程序化绘制证据（fillRect/Graphics/svg 等）`);
  } else {
    ok(`[ENGINE-${engineId}] 业务代码存在 generated 视觉绘制调用`);
  }
} else {
  ok(`[ENGINE-${engineId}] 无 required local/generated 视觉素材，跳过引擎级消费调用检查`);
}

function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

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

function consumerPatternForAsset(asset) {
  if (asset.section === "audio") {
    return asset.type === "synthesized"
      ? /AudioContext\s*\(|OscillatorNode|createOscillator\s*\(|beep\s*\(|playTone\s*\(/
      : /getAudio\s*\(|playSound\s*\(|sound\.add\s*\(|sound\.play\s*\(/;
  }
  if (asset.type === "graphics-generated" || asset.type === "inline-svg") {
    return generatedConsumerPattern;
  }
  return /getTexture\s*\(|new\s+Sprite\s*\(|\.add\.image\s*\(|\.add\.sprite\s*\(|drawImage\s*\(|Sprite\.from\s*\(/;
}

finish();
