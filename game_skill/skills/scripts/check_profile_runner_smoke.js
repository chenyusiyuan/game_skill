#!/usr/bin/env node
/**
 * check_profile_runner_smoke.js — Phase 5 entry smoke for the profile runner.
 *
 * Usage: node check_profile_runner_smoke.js <game-dir> [--log <jsonl>]
 *
 * It opens the generated game, discovers one real interactive target, drives it
 * through the same setup-step runner used by check_playthrough.js, and requires
 * window.__trace.length to grow. The generated click step uses
 * `selector: "canvas" + options.position` for canvas targets, so this catches
 * runner shape drift before the real profile is evaluated.
 */

import { resolve } from "path";
import { resolveLaunchTarget } from "./_run_mode.js";
import { createLogger, parseLogArg } from "./_logger.js";
import { runProfileRunnerSmoke } from "./_interaction_smoke.js";

const _logPath = parseLogArg(process.argv);
const log = createLogger(_logPath);
const gameDir = resolve(process.argv[2] ?? "game/");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("✗ playwright 未安装。请先运行: npm i -D playwright && npx playwright install chromium");
  process.exit(3);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const consoleErrors = [];
let launch;

page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
page.on("console", (msg) => {
  if (msg.type() !== "error") return;
  const text = msg.text();
  const url = msg.location()?.url ?? "";
  if ((text.includes("404") || text.includes("Failed to load resource")) &&
      !/\/assets\/library_(?:2d|3d)\//.test(url)) {
    return;
  }
  consoleErrors.push("console: " + text);
});

try {
  launch = await resolveLaunchTarget(gameDir);
  console.log(`Profile runner smoke: ${launch.url} [run-mode=${launch.runMode}]`);
  await page.goto(launch.url, { waitUntil: "networkidle", timeout: 8000 });
  await page.waitForFunction(() => window.gameState !== undefined, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(500);
} catch (e) {
  console.error(`✗ 页面加载失败: ${e.message}`);
  if (launch) await launch.close();
  await browser.close();
  process.exit(3);
}

const smoke = await runProfileRunnerSmoke(page, {
  maxAttempts: 5,
  waitAfterClickMs: 750,
  settleBetweenAttemptsMs: 700,
});

if (launch) await launch.close();
await browser.close();

const attempts = smoke.attempts.map((attempt) => {
  if (attempt.missingTarget) return { missing_target: true };
  return {
    target: {
      kind: attempt.target?.kind,
      label: attempt.target?.label,
      x: Math.round(attempt.target?.pageX ?? 0),
      y: Math.round(attempt.target?.pageY ?? 0),
    },
    trace_before: attempt.before?.traceLength,
    trace_after: attempt.after?.traceLength,
    trace_delta: attempt.traceDelta,
    state_changed: attempt.stateChanged,
  };
});

if (consoleErrors.length > 0) {
  console.log(`\n✗ profile-smoke 期间 ${consoleErrors.length} 条 console error/pageerror:`);
  for (const e of consoleErrors.slice(0, 8)) console.log(`    ${e.slice(0, 140)}`);
}

log.entry({
  type: "check-run",
  phase: "verify",
  step: "profile-runner-smoke",
  script: "check_profile_runner_smoke.js",
  exit_code: smoke.ok && consoleErrors.length === 0 ? 0 : 1,
  smoke_status: smoke.ok ? (smoke.warning ? "warning" : "passed") : "failed",
  attempts,
  console_errors: consoleErrors.length,
});

if (!smoke.ok) {
  console.log(`\n✗ profile runner smoke 失败: ${smoke.message}`);
  process.exit(1);
}
if (consoleErrors.length > 0) process.exit(1);

const icon = smoke.warning ? "⚠" : "✓";
console.log(`${icon} profile runner smoke OK: ${smoke.message}`);
process.exit(0);
