#!/usr/bin/env node
/**
 * check_decision_graph.js — runtime decision-depth probe.
 *
 * CLI:
 *   node check_decision_graph.js <case-dir> [--log <path>]
 *
 * Exit codes:
 *   0 = decision graph satisfies design-strategy
 *   1 = options below design declaration
 *   3 = environment failure or missing runtime hook
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import yaml from "js-yaml";
import { resolveLaunchTarget } from "./_run_mode.js";
import { createLogger, parseLogArg } from "./_logger.js";

function usage() {
  return [
    "Usage: node check_decision_graph.js <case-dir> [--log <path>]",
    "",
    "Reads docs/design-strategy.yaml and probes window.gameTest.getAvailableActions() for 10 ticks.",
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
const errors = [];
const warnings = [];
const oks = [];

function ok(msg) { console.log(`  ✓ ${msg}`); oks.push(msg); }
function warn(msg) { console.log(`  ⚠ ${msg}`); warnings.push(msg); }
function fail(msg) { console.log(`  ✗ ${msg}`); errors.push(msg); }

console.log(`Decision graph check: ${caseDir}`);

const strategyPath = join(caseDir, "docs/design-strategy.yaml");
if (!existsSync(strategyPath)) {
  fail(`design-strategy.yaml 不存在: ${strategyPath}`);
  finish(3);
}
if (!existsSync(join(gameDir, "index.html"))) {
  fail(`game/index.html 不存在: ${join(gameDir, "index.html")}`);
  finish(3);
}

const strategy = readYaml(strategyPath);
if (!strategy) finish(3);
const points = Array.isArray(strategy["decision-points"]) ? strategy["decision-points"] : [];
if (points.length === 0) {
  fail("design-strategy.yaml 缺少 decision-points[]");
  finish(1);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  fail("playwright 未安装。请先运行: npm i -D playwright && npx playwright install chromium");
  finish(3);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let launch;

try {
  launch = await resolveLaunchTarget(gameDir);
  await page.goto(launch.url, { waitUntil: "networkidle", timeout: 8000 });
  await page.waitForFunction(() => window.gameState !== undefined, { timeout: 3000 }).catch(() => {});
  const hasHook = await page.evaluate(() => typeof window.gameTest?.getAvailableActions === "function").catch(() => false);
  if (!hasHook) {
    fail("缺少 window.gameTest.getAvailableActions()");
    await browser.close();
    if (launch) await launch.close();
    finish(3);
  }
  await tryStart(page);

  for (let tick = 1; tick <= 10; tick += 1) {
    await page.waitForTimeout(300);
    const actions = await page.evaluate(() => window.gameTest.getAvailableActions()).catch(() => null);
    if (!Array.isArray(actions)) {
      fail(`tick ${tick}: getAvailableActions() 未返回数组`);
      continue;
    }
    const count = actions.length;
    for (const [idx, point] of points.entries()) {
      const expected = Number(point?.options);
      if (!Number.isFinite(expected)) {
        fail(`decision-points[${idx}].options 不是数字`);
        continue;
      }
      if (count < expected) {
        fail(`tick ${tick}: actions=${count} < decision-points[${idx}](${point?.id ?? idx}).options=${expected}`);
      }
    }
  }
} catch (err) {
  fail(`decision graph runtime probe 失败: ${err.message}`);
  await browser.close();
  if (launch) await launch.close();
  finish(3);
}

if (launch) await launch.close();
await browser.close();

if (errors.length === 0) ok(`10 ticks 满足 ${points.length} 个 decision point 的 options 下限`);
finish(errors.length ? 1 : 0);

function readYaml(path) {
  try {
    return yaml.load(readFileSync(path, "utf-8")) ?? {};
  } catch (err) {
    fail(`读取 ${path} 失败: ${err.message}`);
    return null;
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
    return;
  }
  const startButton = await page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    for (const el of document.querySelectorAll("button,[role='button'],a")) {
      const label = (el.innerText || el.getAttribute("aria-label") || "").trim();
      if (visible(el) && /^(start|play|开始)$/i.test(label)) {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    return null;
  }).catch(() => null);
  if (startButton) await page.mouse.click(startButton.x, startButton.y).catch(() => {});
}

function firstPositional(argv) {
  const valueFlags = new Set(["--log"]);
  for (let i = 0; i < argv.length; i += 1) {
    if (valueFlags.has(argv[i])) {
      i += 1;
      continue;
    }
    if (!argv[i].startsWith("--")) return argv[i];
  }
  return null;
}

function finish(code) {
  log.entry({
    type: "check-run",
    phase: "stage",
    step: "decision-graph",
    script: "check_decision_graph.js",
    exit_code: code,
    oks,
    warnings,
    errors,
  });
  process.exit(code);
}
