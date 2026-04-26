#!/usr/bin/env node
/**
 * check_project.js — 工程侧校验
 *
 * 用法: node check_project.js <game-dir>
 *
 * 检查:
 *   1. index.html 存在且有 <!-- ENGINE: ... --> 标识
 *   2. 所有 <script src="..."> 指向 CDN 时 pin 主版本（禁 @latest）
 *   3. 所有 <script src="./src/..."> 文件存在
 *   4. 所有 *.js 文件通过 node --check
 *   5. 至少一处 window.gameState 暴露
 *   6. 链式运行 implementation-contract / asset-selection / asset-usage / asset-paths gate
 *
 * 退出码: 0 = OK, 1 = 有错误
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join, dirname, relative } from "path";
import { execSync } from "child_process";
import { readGameMeta } from "./_run_mode.js";
import { createLogger, parseLogArg } from "./_logger.js";

const _logPath = parseLogArg(process.argv);
const log = createLogger(_logPath);

const gameDir = resolve(process.argv[2] ?? "game/");
// case-dir 推断：gameDir 形如 cases/{slug}/game/ → case-dir = gameDir/..
const caseDir = resolve(gameDir, "..");
const errors = [];

function err(msg) { errors.push(msg); }
function ok(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.log(`  ✗ ${msg}`); err(msg); }
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

console.log(`工程侧校验: ${gameDir}`);

// 1. index.html
let meta;
try {
  meta = readGameMeta(gameDir);
} catch (e) {
  fail(e.message);
  report(); process.exit(1);
}
const { htmlPath, html, marker, runMode } = meta;

// 2. ENGINE 标识
if (!marker?.engineId) fail("缺少 <!-- ENGINE: ... --> 标识注释");
else ok(`ENGINE 标识: ${marker.engineId}  (run-mode=${runMode})`);

// 3. CDN 版本锁
const cdnScripts = [...html.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map((m) => m[1]);
const cdnRemote = cdnScripts.filter((s) => /^https?:\/\//.test(s));
for (const url of cdnRemote) {
  if (/@latest/.test(url)) fail(`CDN 使用 @latest: ${url}`);
  else {
    const pinned = /(@\d+(\.\d+)*|@next|@[a-z]+@\d+)/.test(url);
    if (!pinned) fail(`CDN 未 pin 主版本: ${url}`);
    else ok(`CDN pin 主版本: ${url.slice(0, 80)}`);
  }
}

// 4. importmap 检查
const importMapMatch = html.match(/<script\s+type="importmap"[^>]*>([\s\S]*?)<\/script>/);
if (importMapMatch) {
  try {
    const m = JSON.parse(importMapMatch[1]);
    for (const [k, v] of Object.entries(m.imports ?? {})) {
      if (/@latest/.test(v)) fail(`importmap 使用 @latest: ${k}`);
      else ok(`importmap pin: ${k} → ${v.slice(0, 60)}`);
    }
  } catch (e) {
    fail(`importmap JSON 解析失败: ${e.message}`);
  }
}

// 5. 本地 script 文件存在
const localScripts = cdnScripts.filter((s) => !/^https?:\/\//.test(s));
for (const rel of localScripts) {
  const p = resolve(dirname(htmlPath), rel);
  if (!existsSync(p)) fail(`本地脚本不存在: ${rel}`);
  else ok(`本地脚本存在: ${rel}`);
}

// 6. 遍历 src/ 跑 node --check（可选 - 仅用于多文件项目；单文件模板跳过）
function walkJs(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walkJs(p));
    else if (f.endsWith(".js")) out.push(p);
  }
  return out;
}
const jsFiles = walkJs(join(gameDir, "src"));
const gamePackagePath = join(gameDir, "package.json");
const usesEsmSyntax = jsFiles.some((p) => /\bimport\s|^\s*export\b/m.test(readFileSync(p, "utf-8")));

if (runMode === "local-http" && usesEsmSyntax) {
  if (!existsSync(gamePackagePath)) {
    fail('local-http 多文件 ESM 项目缺少 game/package.json；请声明 {"type":"module"} 以便 node --check 校验');
  } else {
    try {
      const pkg = JSON.parse(readFileSync(gamePackagePath, "utf-8"));
      if (pkg.type !== "module") {
        fail('game/package.json 未声明 {"type":"module"}，local-http 的 ESM 校验会失败');
      } else {
        ok('game/package.json 已声明 {"type":"module"}');
      }
    } catch (e) {
      fail(`game/package.json 解析失败: ${e.message}`);
    }
  }
}

for (const p of jsFiles) {
  try {
    execSync(`node --check "${p}"`, { stdio: "pipe" });
    ok(`node --check ${relative(gameDir, p)}`);
  } catch (e) {
    fail(`node --check ${relative(gameDir, p)} 失败: ${e.stderr?.toString().slice(0, 200)}`);
  }
}

// 6.1 file 模式下禁止本地 module src；local-http 模式允许多文件 ESM。
const externalModuleRefs = [...html.matchAll(/<script[^>]*type=["']module["'][^>]*src=["']\.\/([^"']+)["']/g)];
for (const m of externalModuleRefs) {
  if (runMode === "file") {
    fail(`外部模块脚本 ./${m[1]} 在 file 模式下可能触发 CORS；请改 RUN: local-http 或改 classic/inline script`);
  } else {
    ok(`local-http 允许外部模块脚本: ./${m[1]}`);
  }
}

// 7. window.gameState 暴露
let exposed = false;
const check = (f) => /window\.gameState\s*=/.test(readFileSync(f, "utf-8"));
if (jsFiles.some(check)) exposed = true;
if (/window\.gameState\s*=/.test(html)) exposed = true;
if (!exposed) fail("未找到 window.gameState 暴露（检查桥缺失）");
else ok("window.gameState 已暴露");

// ─── 8. 引擎专属静态检查 ────────────────────────────────────────────────────
const engineId = marker?.engineId?.toLowerCase() ?? "";
// 收集所有源码（inline + 外部 JS）
const allSrc = jsFiles.map(f => readFileSync(f, "utf-8")).join("\n") + "\n" + html;

if (engineId === "phaser3" || engineId === "phaser") {
  if (!/window\.game\s*=/.test(allSrc))
    fail("[ENGINE-PHASER] 缺少 window.game 暴露（Phaser.Game 实例）");
  else ok("[ENGINE-PHASER] window.game 已暴露");

  // 禁止场景级透明矩形做点击热区（常见 LLM 反模式）
  if (/new\s+Phaser\.GameObjects\.Rectangle\s*\([^)]*0x000000[^)]*\)\s*\.setAlpha\s*\(\s*0\s*\)/.test(allSrc) ||
      /this\.add\.rectangle\s*\([^)]*\)\s*\.setAlpha\s*\(\s*0\s*\)/.test(allSrc))
    fail("[ENGINE-PHASER] 禁止用场景级透明矩形做点击热区；请用 setInteractive() 绑定到具体 Container/Sprite");
  else ok("[ENGINE-PHASER] 无场景级透明矩形热区反模式");

  const interactiveContainerIssues = [];
  const containerVars = [...allSrc.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:this|scene)\.add\.container\s*\(/g)]
    .map((m) => m[1]);
  for (const name of containerVars) {
    const n = escapeRegExp(name);
    const usesInteractive = new RegExp(`\\b${n}\\.setInteractive\\s*\\(`).test(allSrc);
    if (!usesInteractive) continue;
    const hasSize = new RegExp(`\\b${n}\\.setSize\\s*\\(`).test(allSrc);
    const explicitHitArea = new RegExp(`\\b${n}\\.setInteractive\\s*\\(\\s*(?:new\\s+)?Phaser\\.Geom\\.|\\b${n}\\.input\\.hitArea\\b`).test(allSrc);
    if (!hasSize && !explicitHitArea) {
      interactiveContainerIssues.push(name);
    }
  }
  const chainedBadContainer = /(?:this|scene)\.add\.container\s*\([\s\S]{0,240}?\)(?![\s\S]{0,160}?\.setSize\s*\()[\s\S]{0,160}?\.setInteractive\s*\(/.test(allSrc);
  if (interactiveContainerIssues.length > 0 || chainedBadContainer) {
    const names = interactiveContainerIssues.length > 0 ? ` (${interactiveContainerIssues.join(", ")})` : "";
    fail(`[ENGINE-PHASER] Container setInteractive 必须先 setSize(w,h) 或显式 hitArea${names}`);
  } else {
    ok("[ENGINE-PHASER] Container 交互包含 setSize 或显式 hitArea");
  }
}

if (engineId === "pixijs" || engineId === "pixi") {
  if (!/window\.app\s*=/.test(allSrc))
    fail("[ENGINE-PIXI] 缺少 window.app 暴露（Application 实例）");
  else ok("[ENGINE-PIXI] window.app 已暴露");

  if (!/await\s+app\.init\s*\(/.test(allSrc))
    fail("[ENGINE-PIXI] PixiJS v8 必须使用 await app.init()");
  else ok("[ENGINE-PIXI] 使用了 await app.init()");

  if (/app\.view(?!port)/.test(allSrc))
    fail("[ENGINE-PIXI] PixiJS v8 禁止 app.view（已废弃），请用 app.canvas");
  else ok("[ENGINE-PIXI] 无 app.view 废弃用法");

  // Container 交互必须有 eventMode 或 hitArea
  const containerInteractive = allSrc.match(/\.on\s*\(\s*['"]pointer|\.on\s*\(\s*['"]click/g);
  if (containerInteractive && containerInteractive.length > 0) {
    if (!/eventMode\s*=\s*["']static["']/.test(allSrc) && !/hitArea/.test(allSrc))
      fail("[ENGINE-PIXI] 有交互事件绑定但缺少 eventMode='static' 或 hitArea 设置");
    else ok("[ENGINE-PIXI] 交互对象有 eventMode 或 hitArea");
  }
}

if (engineId === "three") {
  if (!/window\.app\s*=/.test(allSrc))
    fail("[ENGINE-THREE] 缺少 window.app 暴露（应含 { renderer, camera, active }）");
  else ok("[ENGINE-THREE] window.app 已暴露");

  // importmap 必须 pin three@0.160（或 three@0.x 精确版本），禁止缺省或 @latest
  const importMapM = html.match(/<script\s+type="importmap"[^>]*>([\s\S]*?)<\/script>/);
  if (!importMapM) {
    fail("[ENGINE-THREE] 缺少 importmap（Three.js ESM 必须通过 importmap 解析 bare import 'three'）");
  } else {
    try {
      const im = JSON.parse(importMapM[1]);
      const threeUrl = im.imports?.["three"];
      if (!threeUrl) {
        fail("[ENGINE-THREE] importmap.imports 缺少 key 'three'");
      } else if (!/three@\d+\.\d+/.test(threeUrl)) {
        fail(`[ENGINE-THREE] importmap 中 three 未 pin 精确版本: ${threeUrl}（要求形如 three@0.160）`);
      } else {
        ok(`[ENGINE-THREE] importmap three 已 pin: ${threeUrl.slice(0, 80)}`);
      }
    } catch (e) {
      fail(`[ENGINE-THREE] importmap JSON 解析失败: ${e.message}`);
    }
  }

  // 禁止 CommonJS require("three") 反模式
  if (/require\s*\(\s*["']three["']\s*\)/.test(allSrc))
    fail("[ENGINE-THREE] 禁止 require(\"three\")；浏览器端只能用 ESM import");
  else ok("[ENGINE-THREE] 无 require(\"three\") 反模式");

  // 禁止 three@latest
  if (/three@latest/.test(allSrc) || /three@latest/.test(html))
    fail("[ENGINE-THREE] 禁止 three@latest，请 pin three@0.160");
  else ok("[ENGINE-THREE] 无 three@latest 用法");
}

// ─── 8.1 mechanics → code 语义落点检查 ────────────────────────────────
const mechanicsPath = join(caseDir, "specs/mechanics.yaml");
if (existsSync(mechanicsPath)) {
  const mechanicsRaw = readFileSync(mechanicsPath, "utf-8");
  const hasGridRaycast = /primitive:\s*ray-cast@v1[\s\S]{0,700}coord-system:\s*grid/.test(mechanicsRaw);
  if (hasGridRaycast) {
    if (!/\bgridPosition\b/.test(allSrc)) {
      fail("[MECHANICS-RAYCAST] grid ray-cast 必须从 source.gridPosition 投射；代码中未发现 gridPosition");
    } else {
      ok("[MECHANICS-RAYCAST] 代码包含 gridPosition 语义");
    }
    if (/startRow\s*=.*segmentId[\s\S]{0,160}startCol\s*=.*segmentId/.test(allSrc) &&
        !/current(Row|Col)\s*=.*gridPosition|gridPosition\.(row|col)[\s\S]{0,160}current(Row|Col)/.test(allSrc)) {
      fail("[MECHANICS-RAYCAST] 检测到按 segment 固定整行/整列起点扫描，未从 source.gridPosition + direction 逐格投射");
    }
  }

  if (/shape:\s*rect-loop/.test(mechanicsRaw) &&
      /draw\w*(?:Conveyor|Track|Path)?[\s\S]{0,1200}\.arc\s*\(/i.test(allSrc)) {
    fail("[MECHANICS-TRACK] rect-loop 轨道必须画直角闭环，不能在轨道绘制函数里使用 arc() 画圆");
  }
}

if (engineId === "dom-ui" || engineId === "dom") {
  const renderRebuildsWholeApp = /function\s+render\s*\([^)]*\)\s*{[\s\S]{0,2500}\b\w+\.innerHTML\s*=/.test(allSrc);
  const tickCallsRender = /(setInterval|requestAnimationFrame)\s*\([\s\S]{0,1200}\brender\s*\(/.test(allSrc) ||
    /function\s+gameTick\s*\([^)]*\)\s*{[\s\S]{0,1200}\brender\s*\(/.test(allSrc);
  if (renderRebuildsWholeApp && tickCallsRender) {
    fail("[ENGINE-DOM] tick/RAF 中反复 render() 且 render() 重写 innerHTML，容易闪烁并丢事件绑定；请改为静态 shell + keyed update");
  } else {
    ok("[ENGINE-DOM] 未发现 tick 中整页 innerHTML 重建反模式");
  }
}

// 通用：Canvas / Pixi / Phaser / Three 引擎必须暴露测试 API
if (["phaser3", "phaser", "pixijs", "pixi", "canvas", "three"].includes(engineId)) {
  const hasTestApi = /window\.gameTest\s*=/.test(allSrc) ||
                     /window\.simulateCorrectMatch\s*=/.test(allSrc) ||
                     /simulateCorrectMatch/.test(allSrc);
  if (!hasTestApi)
    fail(`[ENGINE-TEST] ${engineId} 引擎必须暴露 window.gameTest 或 simulateCorrectMatch 测试 API（见 verify-hooks.md）`);
  else ok(`[ENGINE-TEST] 测试 API 已暴露`);
}

// 通用：交互/匹配类玩法必须有异步锁
if (/match|select|click.*card|配对|消除/.test(allSrc.toLowerCase())) {
  const hasLock = /isProcessing|_locked|inputLocked|isAnimating|canInteract/.test(allSrc);
  if (!hasLock)
    fail("[ASYNC-LOCK] 检测到匹配/选择玩法但未找到 isProcessing 或等效异步锁字段");
  else ok("[ASYNC-LOCK] 异步锁字段存在");
}

// ─── 9. 素材选择校验（链式调用 check_asset_selection.js）──────────────────
const assetsYamlPath = join(caseDir, "specs/assets.yaml");
if (existsSync(assetsYamlPath)) {
  const contractChecker = resolve(dirname(new URL(import.meta.url).pathname), "check_implementation_contract.js");
  try {
    const logArg = _logPath ? ` --log "${_logPath}"` : "";
    execSync(`node "${contractChecker}" "${caseDir}" --stage codegen${logArg}`, { stdio: "inherit" });
    ok("[CONTRACT] implementation-contract 校验通过");
  } catch (e) {
    fail("[CONTRACT] implementation-contract 校验失败（详见上方 check_implementation_contract 输出）");
  }

  const assetChecker = resolve(dirname(new URL(import.meta.url).pathname), "check_asset_selection.js");
  try {
    execSync(`node "${assetChecker}" "${caseDir}"`, { stdio: "inherit" });
    ok("[ASSETS] 素材选择校验通过");
  } catch (e) {
    fail("[ASSETS] 素材选择校验失败（详见上方 check_asset_selection 输出）");
  }

  // ── 9.1 素材消费校验（硬门槛）：business 代码是否真的用了 local-file 素材 ──
  const usageChecker = resolve(dirname(new URL(import.meta.url).pathname), "check_asset_usage.js");
  try {
    execSync(`node "${usageChecker}" "${caseDir}"`, { stdio: "inherit" });
    ok("[ASSETS] 素材消费校验通过");
  } catch (e) {
    fail("[ASSETS] 素材消费校验失败（详见上方 check_asset_usage 输出）");
  }

  // ── 9.2 素材路径存在性校验（硬门槛）：业务代码中硬编码的路径是否指向真实文件 ──
  const pathChecker = resolve(dirname(new URL(import.meta.url).pathname), "check_asset_paths.js");
  try {
    const logArg2 = _logPath ? ` --log "${_logPath}"` : "";
    execSync(`node "${pathChecker}" "${caseDir}"${logArg2}`, { stdio: "inherit" });
    ok("[ASSETS] 素材路径存在性校验通过");
  } catch (e) {
    fail("[ASSETS] 素材路径存在性校验失败（详见上方 check_asset_paths 输出）");
  }
} else {
  // 未跑 expand 的老案例不拦截，仅提示
  console.log(`  · 无 specs/assets.yaml，跳过素材选择/消费校验`);
}

function report() {
  console.log(`\n${errors.length === 0 ? "✓ 通过" : `✗ ${errors.length} 个错误`}`);
}

report();
log.entry({
  type: "check-run",
  phase: "verify",
  step: "project",
  script: "check_project.js",
  exit_code: errors.length > 0 ? 1 : 0,
  errors,
});
process.exit(errors.length > 0 ? 1 : 0);
