#!/usr/bin/env node
/**
 * check_difficulty_curve.js — content/progression difficulty gate.
 *
 * CLI:
 *   node check_difficulty_curve.js <case-dir> [--stage <N>] [--log <path>]
 *
 * Exit codes:
 *   0 = difficulty curve passed
 *   1 = content or replay threshold failed
 *   3 = environment failure
 */

import { existsSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { join, resolve } from "path";
import yaml from "js-yaml";
import { resolveLaunchTarget } from "./_run_mode.js";
import { createLogger, parseLogArg } from "./_logger.js";

function usage() {
  return [
    "Usage: node check_difficulty_curve.js <case-dir> [--stage <N>] [--log <path>]",
    "",
    "Checks specs/data.yaml levels[] monotonic difficulty, unique layouts, and Stage 5 replay win-rate.",
  ].join("\n");
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const caseDir = resolve(firstPositional(args) ?? ".");
const gameDir = join(caseDir, "game");
const stage = readNumberFlag(args, "--stage", null);
const replayCount = readNumberFlag(args, "--replays", 10);
const replayTimeoutMs = readNumberFlag(args, "--replay-timeout-ms", 15000);
const log = createLogger(parseLogArg(process.argv));
const errors = [];
const warnings = [];
const oks = [];

function ok(msg) { console.log(`  ✓ ${msg}`); oks.push(msg); }
function warn(msg) { console.log(`  ⚠ ${msg}`); warnings.push(msg); }
function fail(msg) { console.log(`  ✗ ${msg}`); errors.push(msg); }

console.log(`Difficulty curve check: ${caseDir}${stage ? ` [stage=${stage}]` : ""}`);

const dataPath = join(caseDir, "specs/data.yaml");
if (!existsSync(dataPath)) {
  fail(`data.yaml 不存在: ${dataPath}`);
  finish(3, null);
}

const data = readYaml(dataPath);
if (!data) finish(3, null);
const levels = collectLevels(data);
if (levels.length < 2) {
  fail(`levels[] 至少需要 2 关才能验证难度曲线（actual=${levels.length}）`);
} else {
  ok(`levels = ${levels.length}`);
  checkMonotonicDimension(levels);
  checkUniqueLayouts(levels);
}

let replaySummary = null;
if (stage === 5) {
  replaySummary = await runStage5Replays();
}

finish(errors.length ? 1 : 0, replaySummary);

function collectLevels(dataDoc) {
  if (Array.isArray(dataDoc?.levels)) return dataDoc.levels;
  if (Array.isArray(dataDoc?.["level-data"]?.levels)) return dataDoc["level-data"].levels;
  if (Array.isArray(dataDoc?.stages)) return dataDoc.stages;
  if (Array.isArray(dataDoc?.content?.levels)) return dataDoc.content.levels;
  return [];
}

function checkMonotonicDimension(levelsArr) {
  const dimensions = [
    ["step-cap", ["step-cap", "stepCap", "steps", "max-steps", "move-limit"]],
    ["time-cap", ["time-cap", "timeCap", "time-limit", "timeLimit", "timeLimitMs", "duration-ms"]],
    ["obstacle-density", ["obstacle-density", "obstacleDensity", "obstacles", "obstacle-count"]],
    ["enemy-count", ["enemy-count", "enemyCount", "enemies", "mole-count", "spawn-count"]],
  ];
  const passing = [];
  for (const [label, keys] of dimensions) {
    const values = levelsArr.map((level) => findNumber(level, keys));
    if (values.some((value) => !Number.isFinite(value))) continue;
    if (isNonDecreasing(values)) passing.push({ label, values });
  }
  if (passing.length === 0) {
    fail("没有任何难度维度满足单调递增/相等：step-cap / time-cap / obstacle-density / enemy-count");
  } else {
    const first = passing[0];
    ok(`${first.label} 单调: ${first.values.join(" -> ")}`);
  }
}

function checkUniqueLayouts(levelsArr) {
  const hashes = [];
  for (const [idx, level] of levelsArr.entries()) {
    const layout = pickLayout(level);
    if (layout === undefined) {
      fail(`levels[${idx}] 缺少 layout 或等价字段`);
      continue;
    }
    hashes.push(hashStable(layout));
  }
  const unique = new Set(hashes);
  if (hashes.length > 0 && unique.size === hashes.length) ok(`每关 layout hash 互不相同 (${unique.size}/${hashes.length})`);
  else if (hashes.length > 0) fail(`layout hash 存在重复 (${unique.size}/${hashes.length})`);
}

async function runStage5Replays() {
  if (!existsSync(join(gameDir, "index.html"))) {
    fail(`game/index.html 不存在: ${join(gameDir, "index.html")}`);
    return null;
  }
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    fail("playwright 未安装。请先运行: npm i -D playwright && npx playwright install chromium");
    return null;
  }

  const browser = await chromium.launch({ headless: true });
  const outcomes = [];
  let launch;
  try {
    launch = await resolveLaunchTarget(gameDir);
    for (let i = 0; i < replayCount; i += 1) {
      const page = await browser.newPage();
      try {
        await page.goto(launch.url, { waitUntil: "networkidle", timeout: 8000 });
        await page.waitForFunction(() => window.gameState !== undefined, { timeout: 3000 }).catch(() => {});
        await tryStart(page);
        outcomes.push(await runReplay(page));
      } finally {
        await page.close().catch(() => {});
      }
    }
  } catch (err) {
    fail(`Stage 5 replay 环境失败: ${err.message}`);
    await browser.close();
    if (launch) await launch.close();
    finish(3, null);
  }
  if (launch) await launch.close();
  await browser.close();

  const wins = outcomes.filter((item) => item === "win").length;
  const winRate = outcomes.length > 0 ? wins / outcomes.length : 0;
  if (winRate >= 0.3 && winRate <= 0.7) ok(`Stage 5 replay 胜率 ${(winRate * 100).toFixed(0)}% in [30%, 70%]`);
  else fail(`Stage 5 replay 胜率 ${(winRate * 100).toFixed(0)}% 不在 [30%, 70%] (${wins}/${outcomes.length})`);
  return { replays: outcomes.length, wins, winRate, outcomes };
}

async function runReplay(page) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < replayTimeoutMs) {
    const phase = await readPhase(page);
    if (isWinPhase(phase)) return "win";
    if (isLosePhase(phase)) return "loss";
    await clickRandomTarget(page);
    await page.waitForTimeout(350);
  }
  return "timeout";
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
  await clickRandomTarget(page);
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
  if (target) await page.mouse.click(target.x, target.y).catch(() => {});
}

async function readPhase(page) {
  return await page.evaluate(() => String(window.gameState?.phase ?? "")).catch(() => "");
}

function isWinPhase(phase) {
  return /^(win|won|victory|complete|completed|success)$/i.test(String(phase));
}

function isLosePhase(phase) {
  return /^(lose|lost|gameover|game-over|failed|failure)$/i.test(String(phase));
}

function findNumber(obj, keys) {
  for (const key of keys) {
    const value = lookup(obj, key);
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function lookup(obj, key) {
  if (!obj || typeof obj !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = lookup(value, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function pickLayout(level) {
  for (const key of ["layout", "grid", "map", "tiles", "board", "cells"]) {
    const value = lookup(level, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function isNonDecreasing(values) {
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] < values[i - 1]) return false;
  }
  return true;
}

function hashStable(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function readYaml(path) {
  try {
    return yaml.load(readFileSync(path, "utf-8")) ?? {};
  } catch (err) {
    fail(`读取 ${path} 失败: ${err.message}`);
    return null;
  }
}

function firstPositional(argv) {
  const valueFlags = new Set(["--stage", "--log", "--replays", "--replay-timeout-ms"]);
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
  return Number.isFinite(value) ? value : fallback;
}

function finish(code, replaySummary) {
  log.entry({
    type: "check-run",
    phase: "stage",
    step: "difficulty-curve",
    script: "check_difficulty_curve.js",
    stage,
    exit_code: code,
    oks,
    warnings,
    errors,
    replaySummary,
  });
  process.exit(code);
}
