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

const localFileAssets = [];
for (const sec of ["images", "audio", "spritesheets"]) {
  const list = spec?.[sec] ?? [];
  if (!Array.isArray(list)) continue;
  for (const item of list) {
    if (!item) continue;
    const isLocal = item.type === "local-file" ||
      (typeof item.source === "string" &&
        (item.source.startsWith("assets/library_2d/") ||
         item.source.startsWith("assets/library_3d/")));
    if (!isLocal) continue;
    localFileAssets.push({
      section: sec,
      id: item.id ?? basename(item.source ?? "unknown"),
      source: item.source ?? "",
    });
  }
}

if (localFileAssets.length === 0) {
  // 上游 check_asset_selection.js 已经在 images=[] 时失败，这里只需
  // 给出 warning，不重复阻断。
  warn("assets.yaml 中没有 type=local-file 条目，跳过消费校验（check_asset_selection.js 应已拦截素材占比不足）");
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

// 4) 单条 asset 被引用判定：id 或 basename 命中 allSrc（allSrc 含 manifest，id 在 manifest 里也算用了）
let used = 0;
const unused = [];
for (const a of localFileAssets) {
  const base = a.source ? basename(a.source) : "";
  // 保守匹配：id 或 basename 至少出现一次（manifest 里出现不算数，manifest 是生成物不是业务）
  // 所以优先看 businessSrc；businessSrc 命中直接通过；
  // 若 businessSrc 没命中，再看 allSrc（至少 manifest 有登记），判 warn 不判 fail
  const inBiz = (a.id && new RegExp(`["'\`]${escapeReg(a.id)}["'\`]`).test(businessSrc)) ||
                (base && businessSrc.includes(base));
  if (inBiz) {
    used++;
  } else {
    unused.push(a);
  }
}

const ratio = used / localFileAssets.length;
const pct = (ratio * 100).toFixed(1);
console.log(`  • local-file 条目: 总 ${localFileAssets.length}，业务代码引用 ${used}（${pct}%）`);
for (const a of unused.slice(0, 10)) {
  console.log(`    ↳ 未引用: [${a.section}] ${a.id} (${a.source})`);
}
if (unused.length > 10) console.log(`    ↳ ... 还有 ${unused.length - 10} 条未列出`);

if (ratio < 0.6) {
  fail(`local-file 素材引用率 ${pct}% < 60%，业务代码没真的用起来（可能只在 manifest 登记了但 scenes/main.js 里 0 次消费）`);
} else {
  ok(`local-file 素材引用率 ${pct}% ≥ 60%`);
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

const patterns = engineConsumerPatterns[engineId];
if (!patterns) {
  warn(`未识别的 engineId=${engineId}，跳过消费调用检查`);
} else {
  // 在业务源码（排除 adapter/manifest）里查消费调用
  const hits = patterns.map((re) => re.test(businessSrc));
  const hitIdx = hits.findIndex(Boolean);
  if (hitIdx === -1) {
    fail(`[ENGINE-${engineId}] 业务代码中未找到引擎级素材消费调用（需至少一处：${patterns.map((r) => r.source).join(" | ")}）；仅在 manifest 注册不算消费`);
  } else {
    ok(`[ENGINE-${engineId}] 业务代码存在引擎级消费调用（匹配模式 ${hitIdx}）`);
  }
}

function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

finish();
