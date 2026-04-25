#!/usr/bin/env node
/**
 * check_asset_paths.js — 素材路径存在性校验（Phase 4 硬门槛）
 *
 * 用法: node check_asset_paths.js <case-dir>
 *
 * 目的：阻断"LLM 在业务代码中硬编码素材路径时写错文件名或目录"的问题。
 * 典型场景：dom-ui / canvas 引擎直接在 index.html 中用字面量路径引用素材，
 * LLM 没有严格按 manifest 的 basePath + src 拼接，而是自行推断/简化了文件名
 * （如 crown.png → crown_a.png，board-icons/medal.png → game-icons/medal1.png）。
 *
 * 检查逻辑：
 *   A) 硬编码路径扫描（dom-ui / canvas 引擎）：
 *     1. 扫描 game/index.html + game/src/**\/*.js 中所有匹配
 *        assets/library_2d/... 或 assets/library_3d/... 的路径字面量
 *     2. 将每条路径解析为磁盘绝对路径，检查文件是否存在
 *     3. 如果不存在，尝试模糊匹配同目录下的近似文件名，给出修复建议
 *
 *   B) manifest 路径校验（phaser / pixijs 等 registry 模式引擎）：
 *     1. 查找 game/ 下所有 assets.manifest.json
 *     2. 读取 basePath + 每条 local-file 的 src，拼成相对于 game/ 的完整路径
 *     3. 检查文件是否在磁盘上存在（含大小写敏感检查）
 *     4. 如果不存在，模糊匹配给出修复建议
 *
 *   任何路径不存在 → FAIL
 *
 * 退出码: 0 = OK, 1 = FAIL
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { createLogger, parseLogArg } from "./_logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const _logPath = parseLogArg(process.argv);
const log = createLogger(_logPath);

const caseDir = resolve(process.argv[2] ?? "cases/demo/");
const gameDir = join(caseDir, "game");

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
    step: "asset-paths",
    script: "check_asset_paths.js",
    exit_code: errors.length > 0 ? 1 : 0,
    errors,
    warnings,
  });
  process.exit(errors.length > 0 ? 1 : 0);
}

console.log(`素材路径存在性校验: ${caseDir}`);

if (!existsSync(gameDir)) {
  fail(`game/ 目录不存在: ${gameDir}`);
  finish();
}

// ── 1. 收集业务源码文件 ──────────────────────────────────────────
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

const filesToScan = [];
const htmlPath = join(gameDir, "index.html");
if (existsSync(htmlPath)) filesToScan.push(htmlPath);
filesToScan.push(...walkJs(join(gameDir, "src")).filter(
  // 排除 manifest JSON（虽然扩展名不是 .js 但保险起见）和 adapter 粘合层
  p => !/assets\.manifest\.json$/.test(p)
));

// ── 2. 提取所有素材路径字面量 ────────────────────────────────────
// 匹配 '...assets/library_2d/...' 或 "...assets/library_3d/..." 等字面量
// 支持前面有任意数量的 ../ 前缀
const pathPattern = /['"`]((?:\.\.\/)*assets\/library_(?:2d|3d)\/[^'"`\s]+)['"`]/g;

const allPaths = new Map(); // path → Set<file>
for (const file of filesToScan) {
  const content = readFileSync(file, "utf-8");
  let m;
  while ((m = pathPattern.exec(content)) !== null) {
    const relPath = m[1];
    if (!allPaths.has(relPath)) allPaths.set(relPath, new Set());
    allPaths.get(relPath).add(file);
  }
}

// ── Part A: 硬编码路径扫描（dom-ui / canvas） ────────────────────
let hardcodedValid = 0;
let hardcodedInvalid = 0;

if (allPaths.size === 0) {
  ok("业务代码中未发现 assets/library_* 的直接路径引用");
} else {
  for (const [relPath, files] of allPaths) {
    // 路径是相对于 game/ 目录的（因为 index.html 在 game/ 下）
    const absPath = resolve(gameDir, relPath);
    if (existsSync(absPath)) {
      hardcodedValid++;
      continue;
    }

    // 文件不存在 → 尝试模糊匹配给出建议
    hardcodedInvalid++;
    const suggestion = fuzzyMatch(absPath);
    const fileList = [...files].map(f => basename(f)).join(", ");
    fail(`素材文件不存在: ${relPath}（引用于 ${fileList}）${suggestion}`);
  }

  const total = hardcodedValid + hardcodedInvalid;
  console.log(`  • [硬编码路径] 检查了 ${total} 条：${hardcodedValid} 条有效，${hardcodedInvalid} 条不存在`);
  if (hardcodedInvalid === 0) {
    ok(`所有 ${total} 条硬编码素材路径均指向存在的文件`);
  }
}

// ── Part B: manifest 路径校验（phaser / pixijs 等 registry 模式） ──
function walkJson(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walkJson(p));
    else if (f === "assets.manifest.json") out.push(p);
  }
  return out;
}

const manifestFiles = walkJson(gameDir);
let manifestValid = 0;
let manifestInvalid = 0;

if (manifestFiles.length === 0) {
  ok("未发现 assets.manifest.json，跳过 manifest 路径校验");
} else {
  for (const mfPath of manifestFiles) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(mfPath, "utf-8"));
    } catch (e) {
      fail(`manifest 解析失败: ${mfPath}（${e.message}）`);
      continue;
    }

    const basePath = manifest.basePath ?? "";
    const mfLabel = mfPath.replace(gameDir + "/", "");

    // basePath 是运行时相对于 HTML 页面（game/index.html）解析的，
    // 不是相对于 manifest 文件本身。因此以 gameDir 为基准解析。
    const resolveBase = gameDir;

    // 遍历 images / audio / spritesheets 中的 local-file 条目
    for (const section of ["images", "audio", "spritesheets"]) {
      const list = manifest[section] ?? [];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item || item.type !== "local-file" || !item.src) continue;

        // 拼接路径：basePath + src，相对于 game/ 目录（HTML 所在目录）
        const relFromHtml = basePath.replace(/\/$/, "") + "/" + item.src.replace(/^\//, "");
        const absPath = resolve(resolveBase, relFromHtml);

        if (existsSync(absPath)) {
          manifestValid++;
        } else {
          manifestInvalid++;
          const suggestion = fuzzyMatch(absPath);
          fail(`[manifest] 素材文件不存在: ${item.id} → ${relFromHtml}（manifest: ${mfLabel}）${suggestion}`);
        }
      }
    }
  }

  const total = manifestValid + manifestInvalid;
  console.log(`  • [manifest路径] 检查了 ${total} 条：${manifestValid} 条有效，${manifestInvalid} 条不存在`);
  if (manifestInvalid === 0 && total > 0) {
    ok(`所有 ${total} 条 manifest 素材路径均指向存在的文件`);
  }
}

// ── 公共：模糊匹配建议 ───────────────────────────────────────────
function fuzzyMatch(absPath) {
  const dir = dirname(absPath);
  const name = basename(absPath);

  if (existsSync(dir)) {
    const siblings = readdirSync(dir).filter(f => {
      try { return statSync(join(dir, f)).isFile(); } catch { return false; }
    });
    const stem = name.replace(/\.\w+$/, "");
    const candidates = siblings.filter(s =>
      s.toLowerCase().includes(stem.toLowerCase()) ||
      stem.toLowerCase().includes(s.replace(/\.\w+$/, "").toLowerCase())
    );
    if (candidates.length > 0) {
      return ` → 同目录下存在近似文件: ${candidates.join(", ")}`;
    } else if (siblings.length > 0 && siblings.length <= 20) {
      return ` → 该目录下有: ${siblings.join(", ")}`;
    }
  } else {
    const parentDir = dirname(dir);
    if (existsSync(parentDir)) {
      const siblingDirs = readdirSync(parentDir).filter(f => {
        try { return statSync(join(parentDir, f)).isDirectory(); } catch { return false; }
      });
      if (siblingDirs.length > 0 && siblingDirs.length <= 20) {
        return ` → 目录不存在，上级目录下有: ${siblingDirs.join(", ")}`;
      }
    }
  }
  return "";
}

finish();
