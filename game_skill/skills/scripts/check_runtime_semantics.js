#!/usr/bin/env node
/**
 * check_runtime_semantics.js — P0.2 运行时语义校验
 *
 * 读 specs/mechanics.yaml → 若含 ray-cast@v1 高危组合 → 启动 Playwright 加载 game/index.html
 * → 注入 probe scenario → 捕获 window.__trace → 用 reducer 复算 before/after → 不匹配 fail。
 *
 * 本 checker 不读产品 profile，不过 guardProfileSha。它只依赖 game + mechanics.yaml + primitive reducer。
 *
 * 用法: node check_runtime_semantics.js <case-dir>
 *
 * 退出码:
 *   0 = passed（含"无 applicable probes → ok-skip"）
 *   1 = 语义违规 / expected-trace 未满足
 *   3 = 环境问题（Playwright 没装 / index.html 不存在）
 */

import { readFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";
import { resolveLaunchTarget } from "./_run_mode.js";
import {
  selectApplicableProbes,
  traceEventMatches,
} from "./_runtime_probes.js";
import { replayEvent, indexMechanics } from "./_runtime_replay.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const _logPath = parseLogArg(process.argv);
const log = createLogger(_logPath);

const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const gameDir = join(caseDir, "game");

const errors = [];
const warnings = [];
const oks = [];

const title = `Runtime semantics 校验: ${caseDir}`;
console.log(title);

const mechPath = join(caseDir, "specs/mechanics.yaml");
if (!existsSync(mechPath)) {
  console.log("  · mechanics.yaml 不存在，跳过 runtime_semantics（非 ray-cast 类 case）");
  finish(0, "no-mechanics");
}

let mech;
try {
  mech = yaml.load(readFileSync(mechPath, "utf-8"));
} catch (e) {
  fail(`读取 mechanics.yaml 失败: ${e.message}`);
  finish(1, "mechanics-parse-error");
}

const probes = selectApplicableProbes(mech);
if (probes.length === 0) {
  ok(`当前 case 的 mechanics 不含 ray-cast@v1 高危组合，跳过 runtime_semantics`);
  finish(0, "no-applicable-probes");
}
console.log(`  · 匹配 ${probes.length} 个 probe:`, probes.map((p) => p.id).join(", "));

const htmlPath = join(gameDir, "index.html");
if (!existsSync(htmlPath)) {
  fail(`game/index.html 不存在: ${htmlPath}`);
  finish(3, "missing-html");
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  fail(`playwright 未安装；runtime_semantics 需要 playwright (npm i -D playwright)`);
  finish(3, "missing-playwright");
}

// 动态 reducer 加载集中在 _runtime_replay.js（P1.5 起覆盖全部 runtime-backed primitive）

// 启动 Playwright 执行 probe
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

  // 有适用 probe 时，缺 probes API 代表运行时语义不可观测，必须 fail。
  const hasProbes = await page
    .waitForFunction(
      () => typeof window?.gameTest?.probes?.resetWithScenario === "function",
      null,
      { timeout: 3000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!hasProbes) {
    fail(`window.gameTest.probes.resetWithScenario 未暴露；mechanics 匹配 ${probes.length} 个 runtime probe，不能跳过`);
    await browser.close();
    if (launch?.close) await launch.close();
    finish(1, "no-probes-api");
  }

  for (const probe of probes) {
    console.log(`  ▶ probe: ${probe.id}`);

    // 1) reset trace
    await page.evaluate(() => { window.__trace = []; });

    // 2) reset state + 执行 actions
    try {
      await page.evaluate((state) => window.gameTest.probes.resetWithScenario(state), probe.state);
    } catch (e) {
      fail(`[${probe.id}] resetWithScenario 抛错: ${e.message}`);
      continue;
    }
    const baselineSnapshot = await readRuntimeSnapshot(page);

    for (const act of probe.actions ?? []) {
      if (act.driver === "__probe") {
        const [name, ...args] = act.args;
        try {
          await page.evaluate(({ name, args }) => window.gameTest.probes[name](...args), { name, args });
        } catch (e) {
          fail(`[${probe.id}] probe.${act.args[0]} 不可用: ${e.message}`);
        }
        continue;
      }
      try {
        await page.evaluate(
          ({ driver, args }) => {
            const fn = window.gameTest.drivers?.[driver] ?? window.gameTest[driver];
            if (typeof fn !== "function") throw new Error(`driver ${driver} not found`);
            return fn(...args);
          },
          { driver: act.driver, args: act.args ?? [] },
        );
      } catch (e) {
        fail(`[${probe.id}] driver ${act.driver} 抛错: ${e.message}`);
      }
    }

    // 3) settle
    await page.waitForTimeout(Math.max(50, (probe.settleTicks ?? 60) * 8)); // 8ms/tick 粗估

    // 4) 取 trace
    const trace = await page.evaluate(() => Array.isArray(window.__trace) ? window.__trace.slice() : []);
    console.log(`    · trace events: ${trace.length}`);
    if (trace.length === 0) {
      fail(`[${probe.id}] 未产生任何 runtime trace；无法证明 primitive 被真实执行`);
      continue;
    }

    // 5) 语义复算每条 trace 事件（P1.5：所有 runtime-backed primitive）
    const mechIndex = indexMechanics(mech);
    let skippedCount = 0;
    let violationCount = 0;
    let replayedCount = 0;
    for (let i = 0; i < trace.length; i++) {
      const ev = trace[i];
      if (!ev?.primitive) continue;
      const res = await replayEvent(ev, {
        mechNodesByNode: mechIndex.byNode,
        mechByPrimitive: mechIndex.byPrimitive,
      });
      if (res.ok === null) {
        skippedCount++;
        fail(`[${probe.id}][trace#${i}][${ev.primitive}] 复算缺证据: ${res.reason}`);
        continue;
      }
      replayedCount++;
      if (res.ok === false) {
        violationCount++;
        fail(`[${probe.id}][trace#${i}][${ev.primitive}] 复算不符: ${res.reason}`);
      }
    }
    if (skippedCount > 0) {
      fail(`[${probe.id}] ${skippedCount} 条 trace 事件缺 before/after 或 primitive 复算支持，不能作为 runtime 语义证据`);
    }

    // 6) expected-trace 断言
    for (const assertion of probe.expect?.traceContains ?? []) {
      const hit = trace.some((ev) => traceEventMatches(ev, assertion));
      if (hit) {
        ok(`[${probe.id}] traceContains 命中: ${JSON.stringify(assertion)}`);
      } else {
        fail(`[${probe.id}] traceContains 未命中: ${JSON.stringify(assertion)}`);
      }
    }

    for (const assertion of probe.expect?.traceNotContains ?? []) {
      const hit = trace.some((ev) => traceEventMatches(ev, assertion));
      if (hit) {
        fail(`[${probe.id}] traceNotContains 被命中: ${JSON.stringify(assertion)}`);
      } else {
        ok(`[${probe.id}] traceNotContains 未命中: ${JSON.stringify(assertion)}`);
      }
    }

    await checkProbeStateExpectations(probe, baselineSnapshot, page);

    if (violationCount === 0) ok(`[${probe.id}] ${trace.length} events, reducer 复算 ${replayedCount} 条全部通过（skipped=${skippedCount}）`);
  }
} finally {
  await browser.close();
  if (launch?.close) await launch.close();
}

finish(errors.length === 0 ? 0 : 1, "done");

// ---------- impl ----------

function ok(msg) { oks.push(msg); console.log(`  ✓ ${msg}`); }
function warn(msg) { warnings.push(msg); console.log(`  ⚠ ${msg}`); }
function fail(msg) { errors.push(msg); console.log(`  ✗ ${msg}`); }

async function readRuntimeSnapshot(page) {
  return page.evaluate(() => {
    try {
      const obs = window?.gameTest?.observers?.getSnapshot;
      if (typeof obs === "function") return obs();
      if (window?.gameState !== undefined) return JSON.parse(JSON.stringify(window.gameState));
    } catch {}
    return null;
  }).catch(() => null);
}

async function checkProbeStateExpectations(probe, baselineSnapshot, page) {
  const ids = probe.expect?.nonMutation ?? [];
  if (!Array.isArray(ids) || ids.length === 0) return;
  if (!baselineSnapshot) {
    fail(`[${probe.id}] nonMutation 需要 gameTest.observers.getSnapshot() 或 window.gameState snapshot`);
    return;
  }
  const afterSnapshot = await readRuntimeSnapshot(page);
  if (!afterSnapshot) {
    fail(`[${probe.id}] nonMutation 无法读取 actions 后 snapshot`);
    return;
  }
  for (const id of ids) {
    const beforeEntity = findEntityById(baselineSnapshot, id);
    const afterEntity = findEntityById(afterSnapshot, id);
    if (!beforeEntity) {
      fail(`[${probe.id}] nonMutation baseline 找不到 entity id=${id}`);
      continue;
    }
    if (!afterEntity) {
      fail(`[${probe.id}] nonMutation entity id=${id} 在 actions 后消失`);
      continue;
    }
    const changed = changedSemanticFields(beforeEntity, afterEntity);
    if (changed.length > 0) {
      fail(`[${probe.id}] nonMutation entity id=${id} 字段变化: ${changed.join(", ")}`);
    } else {
      ok(`[${probe.id}] nonMutation entity id=${id} 核心字段未变`);
    }
  }
}

function findEntityById(value, id, seen = new Set()) {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (String(value.id ?? "") === String(id)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findEntityById(item, id, seen);
      if (found) return found;
    }
    return null;
  }
  for (const item of Object.values(value)) {
    const found = findEntityById(item, id, seen);
    if (found) return found;
  }
  return null;
}

function changedSemanticFields(before, after) {
  const fields = [
    "alive",
    "durability",
    "hp",
    "health",
    "ammo",
    "lifecycle",
    "state",
    "phase",
    "row",
    "col",
    "gridPosition",
    "position",
  ];
  const changed = [];
  for (const f of fields) {
    if (before[f] === undefined && after[f] === undefined) continue;
    if (JSON.stringify(before[f]) !== JSON.stringify(after[f])) {
      changed.push(`${f}: ${JSON.stringify(before[f])} -> ${JSON.stringify(after[f])}`);
    }
  }
  return changed;
}

function finish(code, tag) {
  const summary = errors.length === 0
    ? `✓ runtime_semantics passed (${oks.length} ok, ${warnings.length} warn) [${tag}]`
    : `✗ ${errors.length} 个错误 (${warnings.length} warn) [${tag}]`;
  console.log(`\n${summary}`);
  log.entry({
    type: "check-run",
    phase: "verify",
    step: "runtime-semantics",
    script: "check_runtime_semantics.js",
    exit_code: code,
    tag,
    oks: oks.length,
    warnings: warnings.length,
    errors,
  });
  process.exit(code);
}
