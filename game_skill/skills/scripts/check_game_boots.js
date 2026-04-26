#!/usr/bin/env node
/**
 * check_game_boots.js — 轻量级"游戏能起"冒烟测试
 *
 * 用法: node check_game_boots.js <game-dir>
 *
 * 目的: 不依赖 profile，不做规则校验，**只回答一个问题**：
 *   「游戏打开后能不能正常渲染，有没有 console error」
 * 这是 Phase 5 verify 的第一关。能过这关，至少不是白屏。
 * 过不了这关，后面一切都是空谈。
 *
 * 退出码:
 *   0 = boot OK（页面有内容 + window.gameState 暴露 + 无 console error）
 *   1 = boot 失败（白屏 / console 红 / gameState 缺失 / CORS 阻止）
 *   3 = playwright/chromium 未安装
 */

import { existsSync, readFileSync } from "fs";
import { basename, join, resolve } from "path";
import yaml from "js-yaml";
import { resolveLaunchTarget } from "./_run_mode.js";
import { createLogger, parseLogArg } from "./_logger.js";

const _logPath = parseLogArg(process.argv);
const log = createLogger(_logPath);

const gameDir = resolve(process.argv[2] ?? "game/");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("✗ playwright 未安装。跑 `npm i -D playwright && npx playwright install chromium`");
  process.exit(3);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleErrors = [];
const networkFails = [];
const assetHttpErrors = [];
const assetHttpResponses = [];
let launch;
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
page.on("response", (response) => {
  const url = response.url();
  if (/\/assets\/library_(?:2d|3d)\//.test(url)) {
    assetHttpResponses.push({ status: response.status(), url });
    if (response.status() >= 400) {
      assetHttpErrors.push(`${response.status()} ${url}`);
    }
  }
});
page.on("console", (m) => {
  if (m.type() === "error") {
    const text = m.text();
    const url = m.location()?.url ?? "";
    // 非项目素材的外部资源错误不阻断；项目素材 404 会由 response 监听硬失败。
    if ((text.includes("404") || text.includes("Failed to load resource")) &&
        !/\/assets\/library_(?:2d|3d)\//.test(url)) {
      return;
    }
    consoleErrors.push("console: " + text);
  }
});
page.on("requestfailed", (r) => networkFails.push(`${r.url().slice(0,80)} :: ${r.failure().errorText}`));

try {
  launch = await resolveLaunchTarget(gameDir);
  console.log(`Boot test: ${launch.url} [run-mode=${launch.runMode}]`);
  await page.goto(launch.url, { waitUntil: "load", timeout: 8000 });
  // Give scripts time to execute and render initial UI
  await page.waitForTimeout(1500);
} catch (e) {
  console.error(`✗ 页面加载失败: ${e.message}`);
  if (launch) await launch.close();
  await browser.close();
  process.exit(1);
}

const errors = [];

// 1. Console / page errors
if (consoleErrors.length > 0) {
  errors.push(`发现 ${consoleErrors.length} 条 console error:`);
  consoleErrors.slice(0, 5).forEach((e) => errors.push("    " + e.slice(0, 150)));
}

// 2. Network failures — 尤其是 file:// 下 CORS 阻止本地模块
if (networkFails.length > 0) {
  errors.push(`发现 ${networkFails.length} 条请求失败:`);
  networkFails.slice(0, 5).forEach((e) => errors.push("    " + e));
  if (networkFails.some((f) => /ERR_FAILED|CORS/i.test(f))) {
    if (launch.runMode === "file") {
      errors.push("  ⚠️ 检测到 file 模式下的 CORS/net 错误，常见原因是本地 ES module / importmap / 相对模块引用。");
      errors.push("  ⚠️ 可切到 `RUN: local-http`，或改成 classic script / 单文件内联。");
    } else {
      errors.push("  ⚠️ 检测到 local-http 模式下的 net 错误，优先检查 import 路径、资源路径和 server root。");
    }
  }
}
if (assetHttpErrors.length > 0) {
  errors.push(`发现 ${assetHttpErrors.length} 条项目素材 HTTP 错误:`);
  assetHttpErrors.slice(0, 10).forEach((e) => errors.push("    " + e));
}

// 3. 首屏内容：文本或可见画布 / 节点都算启动成功
const pageStats = await page.evaluate(() => {
  const bodyText = document.body.innerText.trim();
  const visualNodes = [...document.body.children].filter((el) => el.tagName !== "SCRIPT");
  const hasVisibleNode = visualNodes.some((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  return {
    bodyText,
    canvasCount: document.querySelectorAll("canvas").length,
    visibleNodeCount: visualNodes.length,
    hasVisibleNode,
  };
});
if (pageStats.bodyText.length < 5 && pageStats.canvasCount === 0 && !pageStats.hasVisibleNode) {
  errors.push(`首屏没有可见文本或画布（text=${pageStats.bodyText.length}, canvas=${pageStats.canvasCount}, nodes=${pageStats.visibleNodeCount}）——典型白屏`);
}

// 3.5 T16/L2：DOM-UI 型项目 body 文本内容太少预警（抓 dom_ui phase=start 卡住那类）
// engine 项目主要在 canvas 里渲染，body 可能就是空——跳过
// DOM-UI 项目如果 body 文本 < 50 字符，说明 UI 根本没渲染出来
if (pageStats.canvasCount === 0 && pageStats.bodyText.length < 50) {
  errors.push(`DOM 型项目 body 文本仅 ${pageStats.bodyText.length} 字符，UI 大概率未完整渲染（可能开始按钮失效 / 脚本错误 / 样式丢失）`);
}

// 4. window.gameState 暴露
const hasGameState = await page.evaluate(() => typeof window.gameState !== "undefined");
if (!hasGameState) {
  errors.push("window.gameState 未定义（Phase 5 断言无法工作）");
}

// 4.5 implementation-contract 要求的 required local-file 必须真的发起加载请求。
// 这里验证的是 runtime load success，不替代 check_implementation_contract 的业务消费证据。
const requiredAssetSources = readRequiredAssetSources(resolve(gameDir, ".."));
if (requiredAssetSources.length > 0 && launch?.runMode === "local-http") {
  const loadedUrls = assetHttpResponses
    .filter((r) => r.status < 400)
    .map((r) => decodeURIComponent(new URL(r.url).pathname));
  const missing = requiredAssetSources.filter((src) => {
    const urlNeedle = "/" + src.replace(/^assets\/library_(?:2d|3d)\//, "assets/library_2d/");
    const altNeedle = "/" + src;
    const base = basename(src);
    return !loadedUrls.some((u) => u.includes(altNeedle) || u.includes(urlNeedle) || u.endsWith("/" + base));
  });
  if (missing.length > 0) {
    errors.push(`implementation-contract required local-file 未在运行时成功加载: ${missing.slice(0, 8).join(", ")}`);
  } else {
    console.log(`  ✓ [ASSET-RUNTIME] required local-file 加载成功 (${requiredAssetSources.length}/${requiredAssetSources.length})`);
  }
}

// 4.6 运行期画布健康度检查（T16/L2）
// 对所有 genre 通用，直接读 DOM/引擎运行期状态，模型没法作弊
// 先把 engineMarker 提到这里用
const engineMarker = await page.evaluate(() => {
  const comments = document.head?.innerHTML?.match(/ENGINE:\s*(\w+)/);
  return comments ? comments[1].toLowerCase() : "";
});

// 给渲染一点额外缓冲：Pixi / Phaser 的 texture 加载是异步的
await page.waitForTimeout(1000);

const canvasHealth = await page.evaluate((engine) => {
  const report = {
    engine,
    missingTextures: [],   // Phaser/Pixi 引擎: 被引用但实际是 missing/empty 的 texture
    brokenImages: [],      // Canvas/DOM: img.naturalWidth === 0
    overflowNodes: [],     // DOM 可见节点 bbox 不在 viewport 80% 内
    canvasAreaRatio: null, // canvas 面积 / viewport 面积
    viewport: { w: window.innerWidth, h: window.innerHeight },
  };
  const vw = window.innerWidth, vh = window.innerHeight;

  // (1) Phaser: window.game.textures，检查被引用的 texture key 是否是 __MISSING/__DEFAULT
  if (engine === "phaser3" || engine === "phaser") {
    try {
      const g = window.game;
      if (g?.textures) {
        const keys = g.textures.getTextureKeys?.() ?? [];
        for (const k of keys) {
          if (k === "__MISSING" || k === "__DEFAULT" || k === "__WHITE") continue;
          const t = g.textures.get(k);
          // Phaser missing: key 虽存在但 source 是默认占位
          if (!t || t.key === "__MISSING") report.missingTextures.push(k);
          else if (t.source?.[0]?.image?.width === 0) report.missingTextures.push(k);
        }
      }
    } catch (e) { report.textureCheckError = String(e.message); }
  }

  // (2) PixiJS: 遍历 stage 找 Sprite，看 texture 是否真的缺数据源
  // P1-1: Pixi v8 正常 Sprite 的 texture 没有 baseTexture 字段而是 source，需兼容
  if (engine === "pixijs" || engine === "pixi") {
    try {
      const app = window.app ?? window.pixiApp ?? window.game;
      const stage = app?.stage;
      if (stage) {
        const walk = (node) => {
          const ctor = node?.constructor?.name ?? "";
          const isSpriteLike =
            ctor === "Sprite" ||
            ctor === "TilingSprite" ||
            ctor === "AnimatedSprite" ||
            ctor.endsWith("Sprite");
          if (isSpriteLike && node?.texture) {
            const tex = node.texture;
            // v8: tex.source 是 TextureSource；v7: tex.baseTexture 是 BaseTexture。
            // noFrame 只表示使用整张图，不等于纹理缺失。
            const source = tex.source ?? tex.baseTexture;
            const hasSource = Boolean(source);
            // 明确的 EMPTY 占位：1x1 默认纹理
            const is1x1Placeholder = tex.width === 1 && tex.height === 1;
            // 只在 Sprite-like 节点上报"完全没有数据源"或"明确是 EMPTY 占位"。
            // Graphics 等程序化绘制节点也可能携带内部 1x1 默认纹理，不能当成素材缺失。
            if (!hasSource || is1x1Placeholder) {
              report.missingTextures.push(node.label ?? node.name ?? ctor);
            }
          }
          for (const c of (node.children ?? [])) walk(c);
        };
        walk(stage);
      }
    } catch (e) { report.textureCheckError = String(e.message); }
  }

  // (3) Canvas/DOM 都可能用 <img>
  const imgs = [...document.querySelectorAll("img")];
  for (const img of imgs) {
    if (img.naturalWidth === 0 && img.src) {
      report.brokenImages.push(img.src.slice(-60));
    }
  }

  // (4) DOM 可见元素 bbox 检查：至少 80% 面积在 viewport 内
  // 检查所有有实际尺寸的可见元素；不筛"叶子/内容"——外层容器溢出也要抓
  const vis = [...document.body.querySelectorAll("*")].filter(el => {
    if (["SCRIPT", "STYLE", "META", "LINK", "HEAD"].includes(el.tagName)) return false;
    const cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return false;
    // 跳过纯布局的 body/html 自身
    if (el === document.body || el === document.documentElement) return false;
    return true;
  });
  for (const el of vis) {
    const r = el.getBoundingClientRect();
    // 计算 bbox 和 viewport 的交集面积占 bbox 自身的比例
    const ix0 = Math.max(0, r.left), iy0 = Math.max(0, r.top);
    const ix1 = Math.min(vw, r.right), iy1 = Math.min(vh, r.bottom);
    const iw = Math.max(0, ix1 - ix0), ih = Math.max(0, iy1 - iy0);
    const inside = iw * ih, total = r.width * r.height;
    if (total > 0 && inside / total < 0.8) {
      report.overflowNodes.push({
        tag: el.tagName,
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        inside: +(inside / total).toFixed(2),
        text: (el.textContent ?? "").trim().slice(0, 30),
      });
    }
  }

  // (5) Canvas 面积占比（engine 项目才检查，DOM-UI 跳过）
  if (["phaser3", "phaser", "pixijs", "pixi", "canvas", "three"].includes(engine)) {
    const canvases = [...document.querySelectorAll("canvas")];
    let totalArea = 0;
    for (const c of canvases) {
      const r = c.getBoundingClientRect();
      totalArea += r.width * r.height;
    }
    report.canvasAreaRatio = +(totalArea / (vw * vh)).toFixed(3);
  }

  return report;
}, engineMarker);

// 阈值判定
if (canvasHealth.missingTextures.length > 0) {
  const list = canvasHealth.missingTextures.slice(0, 8).join(", ");
  const more = canvasHealth.missingTextures.length > 8 ? ` ...+${canvasHealth.missingTextures.length - 8}` : "";
  errors.push(`[CANVAS] ${canvasHealth.missingTextures.length} 个 texture 是 missing/empty: ${list}${more}`);
}
if (canvasHealth.brokenImages.length > 0) {
  errors.push(`[CANVAS] ${canvasHealth.brokenImages.length} 张 <img> naturalWidth=0（加载失败）:`);
  canvasHealth.brokenImages.slice(0, 5).forEach(s => errors.push("    " + s));
}
if (canvasHealth.overflowNodes.length > 0) {
  // 排除极端 overflow 误报：只报 top 5 最严重
  const worst = canvasHealth.overflowNodes
    .sort((a, b) => a.inside - b.inside)
    .slice(0, 5);
  errors.push(`[CANVAS] ${canvasHealth.overflowNodes.length} 个可见元素 bbox <80% 在 viewport 内（HUD 溢出/偏移/按钮移出）:`);
  for (const n of worst) {
    errors.push(`    <${n.tag}> ${n.inside * 100 | 0}% inside rect=${JSON.stringify(n.rect)} text="${n.text}"`);
  }
}
if (canvasHealth.canvasAreaRatio !== null && canvasHealth.canvasAreaRatio < 0.1) {
  errors.push(`[CANVAS] canvas 总面积仅占 viewport ${(canvasHealth.canvasAreaRatio * 100).toFixed(1)}% (<10%)——引擎可能未正确初始化或被遮挡`);
}
if (canvasHealth.textureCheckError) {
  console.log(`  ⚠ [CANVAS] texture 遍历时报错（不阻断）: ${canvasHealth.textureCheckError}`);
}
if (canvasHealth.missingTextures.length === 0 && canvasHealth.brokenImages.length === 0 &&
    canvasHealth.overflowNodes.length === 0 &&
    (canvasHealth.canvasAreaRatio === null || canvasHealth.canvasAreaRatio >= 0.1)) {
  console.log(`  ✓ [CANVAS] 画布健康度通过 (canvas 占比 ${canvasHealth.canvasAreaRatio ?? "-"}, overflow=0, missing=0)`);
}

// 5. 引擎型项目运行时检查：测试 API + "能开始一局"
const isEngineProject = ["phaser3", "phaser", "pixijs", "pixi", "canvas", "three"].includes(engineMarker);

if (isEngineProject) {
  // 5a. window.gameTest 存在
  const hasGameTest = await page.evaluate(() =>
    typeof window.gameTest !== "undefined" ||
    typeof window.simulateCorrectMatch === "function"
  );
  if (!hasGameTest) {
    errors.push(`[BOOT-TEST-API] ${engineMarker} 引擎项目但 window.gameTest / simulateCorrectMatch 未暴露`);
  } else {
    console.log(`  ✓ [BOOT-TEST-API] 测试 API 已暴露`);
  }

  // 5b. "能开始一局"：尝试点击开始按钮，验证 phase 变为 playing
  const canStartGame = await page.evaluate(async () => {
    // 方式 1：通过 gameTest.clickStartButton
    if (window.gameTest?.clickStartButton) {
      try {
        await window.gameTest.clickStartButton();
        await new Promise(r => setTimeout(r, 500));
        return { phase: window.gameState?.phase, method: "gameTest.clickStartButton" };
      } catch (e) {
        return { error: e.message, method: "gameTest.clickStartButton" };
      }
    }
    // 方式 2：找可见的开始按钮点击
    const btnTexts = ["start", "开始", "play", "begin"];
    const buttons = [...document.querySelectorAll("button, [role=button], [data-action]")];
    for (const btn of buttons) {
      const text = btn.textContent?.toLowerCase() ?? "";
      if (btnTexts.some(t => text.includes(t))) {
        btn.click();
        await new Promise(r => setTimeout(r, 500));
        return { phase: window.gameState?.phase, method: "dom-click:" + btn.textContent.trim() };
      }
    }
    // 无法找到按钮：如果已经是 playing 状态（无需开始按钮的游戏）也算通过
    if (window.gameState?.phase === "playing") {
      return { phase: "playing", method: "already-playing" };
    }
    return { phase: window.gameState?.phase, method: "no-start-button-found" };
  });

  if (canStartGame.error) {
    errors.push(`[BOOT-START] clickStartButton 报错: ${canStartGame.error}`);
  } else if (canStartGame.phase === "playing") {
    console.log(`  ✓ [BOOT-START] 能开始一局 (method=${canStartGame.method}, phase=${canStartGame.phase})`);

    // 5c. T16/L2 扩展：进入 playing 后再采一次 overflow，抓"游戏中 HUD 溢出/棋盘偏移"
    await page.waitForTimeout(1500);
    const inGameHealth = await page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const overflowNodes = [];
      const brokenImages = [];
      const vis = [...document.body.querySelectorAll("*")].filter(el => {
        if (["SCRIPT", "STYLE", "META", "LINK", "HEAD"].includes(el.tagName)) return false;
        const cs = window.getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 20) return false;
        if (el === document.body || el === document.documentElement) return false;
        return true;
      });
      for (const el of vis) {
        const r = el.getBoundingClientRect();
        const ix0 = Math.max(0, r.left), iy0 = Math.max(0, r.top);
        const ix1 = Math.min(vw, r.right), iy1 = Math.min(vh, r.bottom);
        const iw = Math.max(0, ix1 - ix0), ih = Math.max(0, iy1 - iy0);
        const inside = iw * ih, total = r.width * r.height;
        if (total > 0 && inside / total < 0.8) {
          overflowNodes.push({
            tag: el.tagName,
            rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
            inside: +(inside / total).toFixed(2),
            text: (el.textContent ?? "").trim().slice(0, 30),
          });
        }
      }
      for (const img of document.querySelectorAll("img")) {
        if (img.naturalWidth === 0 && img.src) brokenImages.push(img.src.slice(-60));
      }
      return { overflowNodes, brokenImages, viewport: { w: vw, h: vh } };
    });
    if (inGameHealth.overflowNodes.length > 0) {
      const worst = inGameHealth.overflowNodes.sort((a, b) => a.inside - b.inside).slice(0, 5);
      errors.push(`[CANVAS:IN-GAME] ${inGameHealth.overflowNodes.length} 个元素在 playing 状态下 bbox <80% 在 viewport 内（游戏中 HUD/棋盘溢出）:`);
      for (const n of worst) {
        errors.push(`    <${n.tag}> ${n.inside * 100 | 0}% inside rect=${JSON.stringify(n.rect)} text="${n.text}"`);
      }
    }
    if (inGameHealth.brokenImages.length > 0) {
      errors.push(`[CANVAS:IN-GAME] ${inGameHealth.brokenImages.length} 张 <img> 在 playing 状态下加载失败:`);
      inGameHealth.brokenImages.slice(0, 5).forEach(s => errors.push("    " + s));
    }
    if (inGameHealth.overflowNodes.length === 0 && inGameHealth.brokenImages.length === 0) {
      console.log(`  ✓ [CANVAS:IN-GAME] playing 状态下 DOM 健康度通过`);
    }
  } else if (canStartGame.method === "no-start-button-found") {
    // 非阻断：只是 warning
    console.log(`  ⚠ [BOOT-START] 未找到开始按钮且 phase=${canStartGame.phase}，请确认游戏流程是否正确`);
  } else {
    errors.push(`[BOOT-START] 点击开始后 phase=${canStartGame.phase}（期望 playing）method=${canStartGame.method}`);
  }
}

await launch.close();
await browser.close();

if (errors.length === 0) {
  console.log(`✓ boot OK  body=${pageStats.bodyText.length}字符  canvas=${pageStats.canvasCount}  gameState=exposed`);
  log.entry({ type: "check-run", phase: "verify", step: "boot", script: "check_game_boots.js", exit_code: 0, errors: [] });
  process.exit(0);
} else {
  console.log("\n✗ boot 失败:");
  for (const e of errors) console.log("  " + e);
  log.entry({ type: "check-run", phase: "verify", step: "boot", script: "check_game_boots.js", exit_code: 1, errors });
  process.exit(1);
}

function readRequiredAssetSources(caseDir) {
  const contractPath = join(caseDir, "specs/implementation-contract.yaml");
  if (!existsSync(contractPath)) return [];
  try {
    const contract = yaml.load(readFileSync(contractPath, "utf-8")) ?? {};
    return (contract["asset-bindings"] ?? [])
      .filter((b) => b.type === "local-file" && b["must-render"] === true && ["images", "spritesheets", "audio"].includes(b.section))
      .map((b) => b.source)
      .filter(Boolean);
  } catch {
    return [];
  }
}
