#!/usr/bin/env node
/**
 * check_game_feel.js — runtime game-feel acceptance.
 *
 * CLI:
 *   node check_game_feel.js <case-dir> [--log <path>]
 *
 * Exit codes:
 *   0 = thresholds passed
 *   1 = feel thresholds failed
 *   3 = environment failure
 */

import { existsSync } from "fs";
import { join, resolve } from "path";
import { resolveLaunchTarget } from "./_run_mode.js";
import { createLogger, parseLogArg } from "./_logger.js";

function usage() {
  return [
    "Usage: node check_game_feel.js <case-dir> [--log <path>]",
    "",
    "Runs at least two 30s sessions and checks MDPM, click-to-frame latency, and first-loss retry.",
  ].join("\n");
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const caseDir = resolve(firstPositional(args) ?? ".");
const gameDir = join(caseDir, "game");
const log = createLogger(parseLogArg(process.argv));
const durationMs = readNumberFlag(args, "--duration-ms", 30000);
const sessions = Math.max(2, readNumberFlag(args, "--sessions", 2));
const tickMs = readNumberFlag(args, "--tick-ms", 500);

const errors = [];
const warnings = [];
const oks = [];

function ok(msg) { console.log(`  ✓ ${msg}`); oks.push(msg); }
function warn(msg) { console.log(`  ⚠ ${msg}`); warnings.push(msg); }
function fail(msg) { console.log(`  ✗ ${msg}`); errors.push(msg); }

console.log(`Game-feel check: ${caseDir}`);

if (!existsSync(join(gameDir, "index.html"))) {
  fail(`game/index.html 不存在: ${join(gameDir, "index.html")}`);
  finish(3, []);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  fail("playwright 未安装。请先运行: npm i -D playwright && npx playwright install chromium");
  finish(3, []);
}

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (let i = 0; i < sessions; i += 1) {
    results.push(await runSession(i + 1));
  }
} catch (err) {
  fail(`运行 game-feel session 失败: ${err.message}`);
  await browser.close();
  finish(3, results);
}

await browser.close();

const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
const totalDecisionChanges = results.reduce((sum, r) => sum + r.decisionChanges, 0);
const mdpm = totalDuration > 0 ? totalDecisionChanges * 60000 / totalDuration : 0;
const latencies = results.flatMap((r) => r.latencies).filter(Number.isFinite);
const p50 = percentile(latencies, 50);
const p95 = percentile(latencies, 95);
const retryRate = results.length > 0
  ? results.filter((r) => r.retryObserved).length / results.length
  : 0;
const firstLosses = results.filter((r) => r.firstLossObserved).length;

if (mdpm >= 5) ok(`MDPM ${mdpm.toFixed(2)} >= 5`);
else fail(`MDPM ${mdpm.toFixed(2)} < 5`);

if (latencies.length === 0) {
  fail("未采集到 click → requestAnimationFrame 延迟样本");
} else {
  if (p50 <= 100) ok(`action-feedback p50 ${p50.toFixed(1)}ms <= 100ms`);
  else fail(`action-feedback p50 ${p50.toFixed(1)}ms > 100ms`);
  if (p95 <= 200) ok(`action-feedback p95 ${p95.toFixed(1)}ms <= 200ms`);
  else fail(`action-feedback p95 ${p95.toFixed(1)}ms > 200ms`);
}

if (firstLosses === 0) {
  fail("两次 session 内未观察到 first loss，无法验证首败重试率");
} else if (retryRate >= 0.4) {
  ok(`首败重试率 ${(retryRate * 100).toFixed(0)}% >= 40%`);
} else {
  fail(`首败重试率 ${(retryRate * 100).toFixed(0)}% < 40%`);
}

for (const r of results) {
  if (r.consoleErrors.length > 0) {
    fail(`session ${r.session} 有 ${r.consoleErrors.length} 条 console/page error`);
  }
  if (!r.hasAvailableActions) {
    fail(`session ${r.session} 未暴露 window.gameTest.getAvailableActions()`);
  }
}

finish(errors.length ? 1 : 0, results);

async function runSession(session) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`console: ${msg.text()}`);
  });

  let launch;
  try {
    launch = await resolveLaunchTarget(gameDir);
    await page.goto(launch.url, { waitUntil: "networkidle", timeout: 8000 });
    await page.waitForFunction(() => window.gameState !== undefined, { timeout: 3000 }).catch(() => {});
    await tryStart(page);

    const result = {
      session,
      durationMs,
      decisionChanges: 0,
      latencies: [],
      firstLossObserved: false,
      retryObserved: false,
      hasAvailableActions: false,
      consoleErrors,
    };

    let lastActions = null;
    const startedAt = Date.now();
    let firstLossAt = null;

    while (Date.now() - startedAt < durationMs) {
      const actions = await getAvailableActions(page);
      if (Array.isArray(actions)) {
        result.hasAvailableActions = true;
        const key = fingerprint(actions);
        if (lastActions !== null && key !== lastActions) result.decisionChanges += 1;
        lastActions = key;
      }

      const latency = await clickRandomTarget(page);
      if (Number.isFinite(latency)) result.latencies.push(latency);

      const phase = await readPhase(page);
      if (!firstLossAt && isLosePhase(phase)) {
        firstLossAt = Date.now();
        result.firstLossObserved = true;
        await tryRetry(page);
      }
      if (firstLossAt && !result.retryObserved && Date.now() - firstLossAt <= 15000) {
        const nextPhase = await readPhase(page);
        if (isPlayingPhase(nextPhase)) result.retryObserved = true;
      }
      await page.waitForTimeout(tickMs);
    }

    if (firstLossAt && !result.retryObserved && Date.now() - firstLossAt < 15000) {
      while (Date.now() - firstLossAt < 15000 && !result.retryObserved) {
        await tryRetry(page);
        await clickRandomTarget(page);
        const phase = await readPhase(page);
        if (isPlayingPhase(phase)) result.retryObserved = true;
        await page.waitForTimeout(tickMs);
      }
    }

    console.log(`  session ${session}: decisions=${result.decisionChanges}, latency_samples=${result.latencies.length}, first_loss=${result.firstLossObserved ? "yes" : "no"}, retry=${result.retryObserved ? "yes" : "no"}`);
    return result;
  } finally {
    if (launch) await launch.close();
    await page.close().catch(() => {});
  }
}

async function tryStart(page) {
  const handled = await page.evaluate(() => {
    const g = window.gameTest;
    if (typeof g?.clickStartButton === "function") { g.clickStartButton(); return true; }
    if (typeof g?.drivers?.clickStartButton === "function") { g.drivers.clickStartButton(); return true; }
    if (typeof g?.start === "function") { g.start(); return true; }
    if (typeof g?.drivers?.start === "function") { g.drivers.start(); return true; }
    return false;
  }).catch(() => false);
  if (handled) {
    await page.waitForTimeout(150);
    return true;
  }
  return await clickButtonByText(page, /^(start|play|restart|retry|开始|重试|再来|重新开始)$/i);
}

async function tryRetry(page) {
  const handled = await page.evaluate(() => {
    const g = window.gameTest;
    if (typeof g?.clickStartButton === "function") { g.clickStartButton(); return true; }
    if (typeof g?.drivers?.clickStartButton === "function") { g.drivers.clickStartButton(); return true; }
    if (typeof g?.retry === "function") { g.retry(); return true; }
    if (typeof g?.drivers?.retry === "function") { g.drivers.retry(); return true; }
    if (typeof g?.restart === "function") { g.restart(); return true; }
    if (typeof g?.drivers?.restart === "function") { g.drivers.restart(); return true; }
    return false;
  }).catch(() => false);
  if (handled) {
    await page.waitForTimeout(150);
    return true;
  }
  return await clickButtonByText(page, /^(restart|retry|play again|start|重试|再来|重新开始|开始)$/i);
}

async function clickButtonByText(page, pattern) {
  const target = await page.evaluate((source) => {
    const re = new RegExp(source, "i");
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    for (const el of document.querySelectorAll("button,[role='button'],a,input[type='button'],input[type='submit']")) {
      const label = el.innerText || el.value || el.getAttribute("aria-label") || "";
      if (visible(el) && re.test(label.trim())) {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    return null;
  }, pattern.source).catch(() => null);
  if (!target) return false;
  await page.mouse.click(target.x, target.y).catch(() => {});
  await page.waitForTimeout(150);
  return true;
}

async function getAvailableActions(page) {
  return await page.evaluate(() => {
    const fn = window.gameTest?.getAvailableActions;
    if (typeof fn !== "function") return null;
    const value = fn();
    return Array.isArray(value) ? value : null;
  }).catch(() => null);
}

async function clickRandomTarget(page) {
  const target = await page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const candidates = Array.from(document.querySelectorAll("button,[role='button'],a,input,select,textarea,canvas,[tabindex]"))
      .filter(visible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          x: r.left + Math.max(1, r.width) * (0.2 + Math.random() * 0.6),
          y: r.top + Math.max(1, r.height) * (0.2 + Math.random() * 0.6),
        };
      });
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }).catch(() => null);
  if (!target) return null;

  await page.evaluate(() => {
    window.__codexGameFeelLatency = new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        window.removeEventListener("click", handler, true);
        resolve(value);
      };
      const handler = () => {
        const started = performance.now();
        requestAnimationFrame(() => finish(performance.now() - started));
      };
      window.addEventListener("click", handler, true);
      setTimeout(() => finish(null), 500);
    });
  }).catch(() => {});
  await page.mouse.click(target.x, target.y).catch(() => {});
  return await page.evaluate(() => window.__codexGameFeelLatency).catch(() => null);
}

async function readPhase(page) {
  return await page.evaluate(() => String(window.gameState?.phase ?? "")).catch(() => "");
}

function isLosePhase(phase) {
  return /^(lose|lost|gameover|game-over|failed|failure)$/i.test(String(phase));
}

function isPlayingPhase(phase) {
  return /^(playing|play|running|active)$/i.test(String(phase));
}

function fingerprint(value) {
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "function") return "[function]";
    return v;
  });
}

function percentile(values, p) {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function firstPositional(argv) {
  const valueFlags = new Set(["--log", "--duration-ms", "--sessions", "--tick-ms"]);
  for (let i = 0; i < argv.length; i += 1) {
    if (valueFlags.has(argv[i])) {
      i += 1;
      continue;
    }
    if (!argv[i].startsWith("--")) return argv[i];
  }
  return null;
}

function readNumberFlag(argv, flag, fallback) {
  const idx = argv.indexOf(flag);
  if (idx < 0) return fallback;
  const value = Number(argv[idx + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finish(code, sessionResults) {
  log.entry({
    type: "check-run",
    phase: "stage",
    step: "game-feel",
    script: "check_game_feel.js",
    exit_code: code,
    oks,
    warnings,
    errors,
    sessions: sessionResults.map((r) => ({
      session: r.session,
      decisionChanges: r.decisionChanges,
      latencySamples: r.latencies.length,
      firstLossObserved: r.firstLossObserved,
      retryObserved: r.retryObserved,
      consoleErrors: r.consoleErrors.length,
    })),
  });
  process.exit(code);
}
