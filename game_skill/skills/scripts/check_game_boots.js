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

// 5. 引擎型项目运行时检查：测试 API + "能开始一局"
const engineMarker = await page.evaluate(() => {
  // 读 ENGINE 标识
  const comments = document.head?.innerHTML?.match(/ENGINE:\s*(\w+)/);
  return comments ? comments[1].toLowerCase() : "";
});
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
