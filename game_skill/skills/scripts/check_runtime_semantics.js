#!/usr/bin/env node
/**
 * check_runtime_semantics.js — 动态 runtime trace 结构校验
 *
 * v2 mechanics 不再用固定 reducer 复算。此 checker 读取 case 内
 * game/src/mechanics/*.runtime.mjs，启动游戏后校验 window.__trace 中每条记录
 * 都包含 { type, rule, node, before, after }。
 *
 * 用法: node check_runtime_semantics.js <case-dir>
 *
 * 退出码:
 *   0 = passed / ok-skip
 *   1 = trace 结构违规
 *   3 = 环境问题（Playwright 未装 / index.html 不存在）
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";
import { resolveLaunchTarget } from "./_run_mode.js";

const _logPath = parseLogArg(process.argv);
const log = createLogger(_logPath);

const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const gameDir = join(caseDir, "game");

const errors = [];
const warnings = [];
const oks = [];

console.log(`Runtime semantics 校验: ${caseDir}`);

const mechPath = join(caseDir, "specs/mechanics.yaml");
if (!existsSync(mechPath)) {
  ok("mechanics.yaml 不存在，跳过 runtime_semantics");
  finish(0, "no-mechanics");
}

let mech;
try {
  mech = yaml.load(readFileSync(mechPath, "utf-8")) ?? {};
} catch (e) {
  fail(`读取 mechanics.yaml 失败: ${e.message}`);
  finish(1, "mechanics-parse-error");
}

const runtimeModules = collectRuntimeModules(mech);
if (runtimeModules.length === 0 || mech.mode !== "dynamic-generated") {
  ok("mechanics 未声明 dynamic-generated runtime-module，跳过 runtime_semantics");
  finish(0, "no-dynamic-runtime");
}

for (const mod of runtimeModules) {
  const abs = resolveRuntimeModule(mod);
  if (!existsSync(abs)) fail(`runtime-module 不存在: ${mod}`);
  else ok(`runtime-module 存在: ${relative(caseDir, abs)}`);
}
if (errors.length) finish(1, "missing-runtime-module");

const htmlPath = join(gameDir, "index.html");
if (!existsSync(htmlPath)) {
  fail(`game/index.html 不存在: ${htmlPath}`);
  finish(3, "missing-html");
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  fail("playwright 未安装；runtime_semantics 需要 playwright");
  finish(3, "missing-playwright");
}

const launch = await resolveLaunchTarget(gameDir);
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

page.on("pageerror", (e) => fail(`[runtime] pageerror: ${e.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") fail(`[runtime] console.error: ${msg.text()}`);
});

try {
  await page.goto(launch.url, { waitUntil: "load", timeout: 10000 });
  await page.waitForTimeout(300);
  const trace = await page.evaluate(() => Array.isArray(window.__trace) ? window.__trace.slice() : []);
  if (trace.length === 0) {
    warn("window.__trace 为空；本轮只验证 runtime-module 存在性");
  } else {
    ok(`trace events = ${trace.length}`);
    checkTraceShape(trace);
  }
} finally {
  await browser.close();
  if (launch?.close) await launch.close();
}

finish(errors.length === 0 ? 0 : 1, "done");

function collectRuntimeModules(mechanics) {
  const out = [];
  for (const node of mechanics?.mechanics ?? []) {
    if (node?.["runtime-module"]) out.push(String(node["runtime-module"]));
  }
  const dir = join(gameDir, "src/mechanics");
  if (existsSync(dir)) {
    for (const file of collectFiles(dir)) {
      if (/\.runtime\.mjs$/.test(file)) out.push(relative(gameDir, file));
    }
  }
  return [...new Set(out)];
}

function collectFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...collectFiles(p));
    else out.push(p);
  }
  return out;
}

function resolveRuntimeModule(rel) {
  const raw = String(rel);
  if (raw.startsWith("/")) return raw;
  const clean = raw.replace(/^\.?\//, "");
  if (clean.startsWith("game/")) return join(caseDir, clean);
  return join(gameDir, clean);
}

function checkTraceShape(trace) {
  for (let i = 0; i < trace.length; i++) {
    const ev = trace[i];
    const missing = ["type", "rule", "node", "before", "after"].filter((key) => ev?.[key] === undefined);
    if (missing.length > 0) {
      fail(`[trace#${i}] 缺字段: ${missing.join(", ")}`);
    }
  }
  if (errors.length === 0) ok("trace 结构满足 {type, rule, node, before, after}");
}

function ok(msg) { oks.push(msg); console.log(`  ✓ ${msg}`); }
function warn(msg) { warnings.push(msg); console.log(`  ⚠ ${msg}`); }
function fail(msg) { errors.push(msg); console.log(`  ✗ ${msg}`); }

function finish(code, tag) {
  console.log(code === 0
    ? `✓ runtime_semantics passed (${oks.length} ok, ${warnings.length} warn) [${tag}]`
    : `✗ runtime_semantics failed (${errors.length} errors) [${tag}]`);
  log.entry({
    type: "check-run",
    phase: "verify",
    step: "runtime-semantics",
    script: "check_runtime_semantics.js",
    exit_code: code,
    tag,
    errors,
    warnings,
  });
  process.exit(code);
}
