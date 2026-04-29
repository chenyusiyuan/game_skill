#!/usr/bin/env node
/**
 * check_playthrough.js — 产品侧校验（Playwright 走通主流程）
 *
 * 用法: node check_playthrough.js <game-dir> --profile <case-id>
 *
 * T4/T5/T7 改写后的判定模型：
 *   profile 只负责"驱动脚本"（setup），不允许承担答卷（expect 已废弃）。
 *   真相来源 = (a) window.__trace 覆盖 PRD 的 @rule
 *             (b) 全程无 console.error / pageerror
 *             (c) profile 至少 1 条 action: click（真 DOM click 或 canvas 坐标）
 *             (d) 每条交互类 assertion 自身包含真实用户输入，不能只调 window.gameTest
 *
 * 退出码:
 *   0 = 全部关键检查通过
 *   1 = trace 覆盖不足 / 有 console.error / profile 形状不合规
 *   2 = hard-rule setup 失败
 *   3 = 环境问题（Playwright 未装）
 *   4 = Profile 覆盖率不足（PRD 中有 @check 未被 profile 覆盖）
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { resolveLaunchTarget } from "./_run_mode.js";
import { createLogger, parseLogArg } from "./_logger.js";
import { guardProfileSha } from "./_profile_guard.js";
import { detectAntiCheatHits } from "./_profile_anti_cheat.js";

const _logPath = parseLogArg(process.argv);
const log = createLogger(_logPath);

const argv = process.argv.slice(2);
const gameDir = resolve(argv[0] ?? "game/");
const profileIdx = argv.indexOf("--profile");
const profileId = profileIdx >= 0 ? argv[profileIdx + 1] : null;
const skipCoverageCheck = argv.includes("--skip-coverage");

if (!profileId) {
  console.error("用法: check_playthrough.js <game-dir> --profile <case-id>");
  process.exit(3);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const profilePath = resolve(scriptDir, "profiles", `${profileId}.json`);
const htmlPath = join(gameDir, "index.html");

if (!existsSync(profilePath)) {
  console.error(`✗ profile 不存在: ${profilePath}`);
  process.exit(3);
}
if (!existsSync(htmlPath)) {
  console.error(`✗ game/index.html 不存在: ${htmlPath}`);
  process.exit(1);
}

// T6: profile SHA 写锁 —— Phase 5 入口校验正式 profile 自 freeze 以来未被篡改
guardProfileSha({ caseDir: resolve(gameDir, ".."), profilePath });

const profile = JSON.parse(readFileSync(profilePath, "utf-8"));
const profileAssertions = Array.isArray(profile.assertions) ? profile.assertions : [];
const hardRuleAssertions = Array.isArray(profile.hard_rule_assertions) ? profile.hard_rule_assertions : [];
const allAssertions = [...profileAssertions, ...hardRuleAssertions];
const profileShapeErrors = [];
const profileShapeWarnings = [];
const DEPRECATED_FLAT_PROFILE_DEADLINE = "2026-06-01";
const deprecatedFlatProfileDeadline = new Date(DEPRECATED_FLAT_PROFILE_DEADLINE);
const deprecatedFlatProfileEnforced = new Date() >= deprecatedFlatProfileDeadline;

// T5: profile 只能是驱动脚本；expect 会让 profile 重新变成"自带答案"。
const hasExpectField = allAssertions.some((a) => a.expect !== undefined);
if (hasExpectField) {
  profileShapeErrors.push(`[PROFILE] profile 包含 expect 段；新链路中 profile 只能写 setup，产品判定由 window.__trace + runtime errors 承担`);
}

function assertionText(a) {
  return [
    a.id,
    a.check_id,
    a.hard_rule_id,
    a.description,
  ].filter(Boolean).join(" ").toLowerCase();
}

function hasRealClickStep(a) {
  for (const s of a.setup ?? []) {
    if (s.action === "click" && s.selector) return true;
    if (s.action === "click" && Number.isFinite(s.x) && Number.isFinite(s.y)) return true;
  }
  return false;
}

function hasRealUserInputStep(a) {
  for (const s of a.setup ?? []) {
    if (s.action === "click" && (s.selector || (Number.isFinite(s.x) && Number.isFinite(s.y)))) return true;
    if (s.action === "press" && s.key) return true;
    if (s.action === "fill" && s.selector) return true;
  }
  return false;
}

function isInteractionAssertion(a) {
  const text = assertionText(a);
  return a.kind === "interaction" ||
    /(^|[-_\s])(click|tap|press|drag|input|select|choose|dispatch|start|retry|next|slot|card|tile|button|pig)([-_\s]|$)/i.test(text) ||
    /点击|点按|拖拽|输入|选择|派出|开始|重试|下一关|按钮|小猪|卡片|槽位|格子|棋子/.test(text);
}

function isClickLikeAssertion(a) {
  const text = assertionText(a);
  return /(^|[-_\s])(click|tap|dispatch|select|choose|start|retry|next|slot|card|tile|button|pig)([-_\s]|$)/i.test(text) ||
    /点击|点按|选择|派出|开始|重试|下一关|按钮|小猪|卡片|槽位|格子|棋子/.test(text);
}

function hasGameTestBridgeStep(a) {
  return (a.setup ?? []).some((s) => {
    if (s.action !== "eval") return false;
    const code = String(s.js ?? s.code ?? "");
    return /window\.gameTest\.(?:click|dispatch|select|choose|start|retry|next|simulate|spawn|open|press|tap)/.test(code);
  });
}

function evalCodeSteps(a) {
  return (a.setup ?? [])
    .filter((s) => s.action === "eval")
    .map((s) => String(s.js ?? s.code ?? ""));
}

function scanProfileHookNamespaces(a) {
  const calls = [];
  for (const code of evalCodeSteps(a)) {
    for (const m of code.matchAll(/window\.gameTest\.(observers|drivers|probes)\.([A-Za-z_$][\w$]*)/g)) {
      calls.push({ namespace: m[1], name: m[2], match: m[0] });
    }
    for (const m of code.matchAll(/window\.gameTest\.(?!observers\.|drivers\.|probes\.)([A-Za-z_$][\w$]*)/g)) {
      calls.push({ namespace: "legacy-flat", name: m[1], match: m[0] });
    }
  }
  return calls;
}

function recordHookNamespace(a, namespace, violation, match) {
  log.entry({
    type: "profile-hook-namespace",
    phase: "verify",
    step: "profile-hook-namespace",
    script: "check_playthrough.js",
    assertionId: a.id ?? "<unknown>",
    namespace,
    violation,
    match,
  });
}

// P0.1: profile eval 反作弊——禁止直接改产品真值、补 trace、调 probes。
// 规则定义在 _profile_anti_cheat.js；此处只调用 detectAntiCheatHits。

// T7: profile 必须包含真实用户输入；交互类 assertion 不能只用 window.gameTest 绕过 UI。
const clickOk = allAssertions.some(hasRealClickStep);
if (!clickOk) {
  profileShapeErrors.push(`[PROFILE] profile 中没有任何真实 action: click 步骤——必须至少 1 条 selector click 或 x/y 坐标 click，否则无法暴露 hitArea/按钮错位类 bug`);
}

// SB-1 启发式（2026-04-29）：反"陪衬 click + drivers.* 替代业务"模式。
// 当 3+ 条 interaction 类 assertion 共享同一 (x,y) click 坐标时，几乎可以肯定坐标打到空地，
// 真实业务推进靠 drivers.*。此时 click 虽存在但语义失效，profile 无法验证 UI 对齐/按钮位置。
{
  const coordUse = new Map(); // "x,y" → [assertionId...]
  for (const a of allAssertions) {
    if (a.kind !== "interaction") continue;
    for (const s of a.setup ?? []) {
      if (s.action !== "click") continue;
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue; // 只 heuristic 坐标 click，selector 不在此规则
      const key = `${s.x},${s.y}`;
      if (!coordUse.has(key)) coordUse.set(key, []);
      coordUse.get(key).push(a.id);
    }
  }
  for (const [coord, ids] of coordUse) {
    const unique = [...new Set(ids)];
    if (unique.length >= 3) {
      profileShapeErrors.push(
        `[PROFILE] 反陪衬 click 启发式命中：${unique.length} 条 interaction assertion 共用同一坐标 (${coord}): ${unique.slice(0, 5).join(", ")}${unique.length > 5 ? " ..." : ""}。真实 UI 驱动不会让这么多不同语义的动作落到同一坐标，典型反模式是 drivers.* 接管业务、click 坐标只是陪衬。请为每条 assertion 用真实命中元素的 selector/坐标，或改成 selector click。`,
      );
    }
  }
}

for (const a of allAssertions) {
  const hookCalls = scanProfileHookNamespaces(a);
  const hasDriverCall = hookCalls.some((h) => h.namespace === "drivers");
  for (const h of hookCalls) {
    if (h.namespace === "observers") {
      recordHookNamespace(a, h.namespace, null, h.match);
      continue;
    }
    if (h.namespace === "probes") {
      const violation = "profile-probe-forbidden";
      recordHookNamespace(a, h.namespace, violation, h.match);
      profileShapeErrors.push(`[PROFILE][test-hooks] assertion "${a.id}" 禁止调用 window.gameTest.probes.*；probe 只允许 runtime_semantics checker 使用`);
      continue;
    }
    if (h.namespace === "drivers") {
      const violation = hasRealUserInputStep(a) ? null : "driver-without-real-ui-action";
      recordHookNamespace(a, h.namespace, violation, h.match);
      if (violation) {
        profileShapeErrors.push(`[PROFILE][test-hooks] assertion "${a.id}" 调用了 window.gameTest.drivers.${h.name}，但同一 assertion 缺少真实 UI action: click/press/fill`);
      }
      continue;
    }
    if (h.namespace === "legacy-flat") {
      const violation = "deprecated-flat-gameTest-hook";
      recordHookNamespace(a, h.namespace, violation, h.match);
      log.entry({
        type: "deprecated-flat-gameTest-hook",
        phase: "verify",
        step: "profile-hook-namespace",
        script: "check_playthrough.js",
        assertionId: a.id ?? "<unknown>",
        deadline: DEPRECATED_FLAT_PROFILE_DEADLINE,
        enforced: deprecatedFlatProfileEnforced,
        match: h.match,
      });
      if (deprecatedFlatProfileEnforced) {
        profileShapeErrors.push(`[PROFILE][test-hooks] deprecated-flat-gameTest-hook 死线 ${DEPRECATED_FLAT_PROFILE_DEADLINE} 已过；assertion "${a.id}" 必须迁移到 observers/drivers/probes`);
      } else {
        profileShapeWarnings.push(`[PROFILE][test-hooks] assertion "${a.id}" 使用旧平铺 ${h.match}；请在 ${DEPRECATED_FLAT_PROFILE_DEADLINE} 前迁移到 observers/drivers/probes 三分类命名空间`);
      }
    }
  }

  // P0.1: 反作弊优先——无论是否交互类 assertion，都禁止这些 pattern。
  const cheats = detectAntiCheatHits(a);
  for (const h of cheats) {
    profileShapeErrors.push(
      `[PROFILE][anti-cheat] assertion "${a.id}" 的 eval 步骤命中禁用 pattern: ${h.kind}（匹配: ${h.match}）。profile 只能驱动 UI，不能直写结果/补 trace/调 probes。`
    );
  }

  if (!isInteractionAssertion(a)) continue;
  if (isClickLikeAssertion(a) && !hasRealClickStep(a)) {
    profileShapeErrors.push(`[PROFILE] 交互类 assertion "${a.id}" 缺少真实 action: click；不能只用 window.gameTest 或直接改 state 绕过 UI`);
  } else if (!hasRealUserInputStep(a)) {
    profileShapeErrors.push(`[PROFILE] 交互类 assertion "${a.id}" 缺少真实用户输入步骤；至少需要 click/press/fill 之一`);
  }
  if (!hasRealUserInputStep(a) && hasGameTestBridgeStep(a)) {
    profileShapeWarnings.push(`[PROFILE][deprecated] assertion "${a.id}" 命中旧 window.gameTest 驱动正则；过渡期仅 warning，请迁移到 drivers.* 并保留真实 click/press/fill`);
  }
}

// === Pre-flight: PRD @check coverage validation ===
if (!skipCoverageCheck) {
  // Locate game-prd.md relative to game dir (game-dir is cases/{slug}/game/)
  const caseDir = resolve(gameDir, "..");
  const prdPath = join(caseDir, "docs", "game-prd.md");

  if (existsSync(prdPath)) {
    const prdContent = readFileSync(prdPath, "utf-8");
    // Extract @check entries with layer: product
    const checkRegex = /###\s+@check\(([^)]+)\)\s+(.+)\n(?:>.*\n)*>.*layer:\s*product/g;
    const prdChecks = [];
    let m;
    while ((m = checkRegex.exec(prdContent)) !== null) {
      prdChecks.push({ id: m[1], title: m[2].trim() });
    }

    if (prdChecks.length > 0) {
      const assertionIds = profileAssertions.map(a => a.id.toLowerCase());
      const assertionDescs = profileAssertions.map(a => a.description.toLowerCase());
      // 新：显式反向绑定集合
      const assertionCheckIds = new Set(
        profileAssertions
          .map(a => (a.check_id ?? "").toString().toLowerCase())
          .filter(Boolean)
      );
      const missing = [];

      for (const check of prdChecks) {
        const checkId = check.id.toLowerCase();
        const checkTitle = check.title.toLowerCase();
        const covered =
          assertionCheckIds.has(checkId) ||
          assertionIds.some(id => id.includes(checkId) || checkId.includes(id)) ||
          assertionDescs.some(desc => desc.includes(checkTitle) || checkTitle.includes(desc));
        if (!covered) {
          missing.push(check);
        }
      }

      if (profile.prd_hash) {
        const currentHash = createHash("sha1").update(prdContent).digest("hex");
        if (currentHash !== profile.prd_hash) {
          console.warn(`⚠ profile.prd_hash 与当前 PRD 不一致（profile=${profile.prd_hash.slice(0,12)}... current=${currentHash.slice(0,12)}...）`);
          log.entry({
            type: "profile-drift",
            profile_id: profileId,
            profile_hash: profile.prd_hash,
            current_hash: currentHash,
          });
        }
      }

      if (missing.length > 0) {
        console.log(`\n⚠ 以下 PRD @check(layer: product) 条目在 profile 中没有对应 assertion:`);
        for (const c of missing) {
          console.log(`  ✗ @check(${c.id}) ${c.title}`);
        }
        // 给 agent 可操作的修复指引
        console.log(`\n修复方法:`);
        console.log(`  1. 为每个缺失的 @check 在 profile 中添加对应的 assertion，assertion.check_id 必须与 @check id 一致`);
        console.log(`  2. 每条 assertion 必须包含至少 1 个 action: click 的 setup 步骤（真实 DOM click 或 canvas x/y 坐标）`);
        console.log(`  3. 更新 profile.prd_hash 为当前 PRD 的 SHA1: ${createHash("sha1").update(prdContent).digest("hex")}`);
        console.log(`  4. assertion 结构示例:`);
        for (const c of missing.slice(0, 2)) {
          console.log(`     { "id": "${c.id}", "check_id": "${c.id}", "description": "${c.title}", "setup": [{ "action": "click", "selector": "#对应按钮或元素" }] }`);
        }
        process.exit(4);
      }

      console.log(`✓ PRD @check 覆盖率: ${prdChecks.length}/${prdChecks.length}`);
    }
  }
}

if (profileShapeWarnings.length > 0) {
  console.log(`\n⚠ profile test-hooks 过渡期 warning:`);
  for (const w of profileShapeWarnings) console.log("  " + w);
  log.entry({
    type: "profile-warning",
    phase: "verify",
    step: "playthrough",
    script: "check_playthrough.js",
    profile_warnings: profileShapeWarnings,
  });
}

if (profileShapeErrors.length > 0) {
  console.log(`\n✗ profile 形状不合规:`);
  for (const e of profileShapeErrors) console.log("  " + e);
  log.entry({
    type: "profile-invalid",
    phase: "verify",
    step: "playthrough",
    script: "check_playthrough.js",
    exit_code: 4,
    profile_errors: profileShapeErrors,
  });
  process.exit(4);
}

// Dynamic import playwright
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
let launch;

const consoleErrors = [];
const assetHttpErrors = [];
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
page.on("response", (response) => {
  const url = response.url();
  if (response.status() >= 400 && /\/assets\/library_(?:2d|3d)\//.test(url)) {
    assetHttpErrors.push(`${response.status()} ${url}`);
  }
});
page.on("console", (msg) => {
  if (msg.type() === "error") {
    const text = msg.text();
    const url = msg.location()?.url ?? "";
    if ((text.includes("404") || text.includes("Failed to load resource")) &&
        !/\/assets\/library_(?:2d|3d)\//.test(url)) {
      return;
    }
    consoleErrors.push("console: " + text);
  }
});

try {
  launch = await resolveLaunchTarget(gameDir);
  await page.goto(launch.url, { waitUntil: "networkidle", timeout: profile.boot_timeout_ms ?? 5000 });
  await page.waitForFunction(() => window.gameState !== undefined, { timeout: 3000 }).catch(() => {});
} catch (e) {
  console.error(`✗ 页面加载失败: ${e.message}`);
  if (launch) await launch.close();
  await browser.close();
  process.exit(3);
}

let stateFails = 0;
let hardFails = 0;
const results = [];
const aggregateTrace = [];

async function collectTraceSnapshot() {
  const trace = await page.evaluate(() => Array.isArray(window.__trace) ? window.__trace : null).catch(() => null);
  if (Array.isArray(trace)) aggregateTrace.push(...trace);
}

async function loadFreshPage() {
  await page.goto(launch.url, { waitUntil: "networkidle", timeout: profile.boot_timeout_ms ?? 5000 });
  await page.waitForFunction(() => window.gameState !== undefined, { timeout: 3000 }).catch(() => {});
}

// P1-2/P1-3: 新链路必须接入 trace 基线。
const caseDir = resolve(gameDir, "..");
const eventGraphPath = join(caseDir, "specs/event-graph.yaml");
let expectedRuleIds = [];
try {
  const raw = readFileSync(eventGraphPath, "utf-8");
  const body = raw.split(/^rule-traces:/m)[1];
  if (body) {
    expectedRuleIds = [...body.matchAll(/^\s*-\s*rule-id:\s*([\w-]+)/gm)].map((m) => m[1]);
  }
} catch {}
const hasTraceBaseline = expectedRuleIds.length > 0;

// 运行 profile 驱动脚本（每条 assertion 跑一遍 setup）
for (let idx = 0; idx < allAssertions.length; idx++) {
  const a = allAssertions[idx];
  const label = `[${a.id}] ${a.description}`;
  try {
    if (idx > 0) {
      await collectTraceSnapshot();
      await loadFreshPage();
    }
    for (const step of a.setup ?? []) {
      if (step.action === "click") {
        if (step.selector) {
          const options = { timeout: 2000 };
          if (Number.isFinite(step.x) && Number.isFinite(step.y)) {
            options.position = { x: step.x, y: step.y };
          }
          await page.click(step.selector, options);
        } else if (Number.isFinite(step.x) && Number.isFinite(step.y)) {
          await page.mouse.click(step.x, step.y);
        } else {
          throw new Error("click step 需要 selector 或 x/y 坐标");
        }
      } else if (step.action === "wait") {
        await page.waitForTimeout(step.ms ?? 100);
      } else if (step.action === "eval") {
        await page.evaluate(step.js ?? step.code);
      } else if (step.action === "fill") {
        await page.fill(step.selector, step.value);
      } else if (step.action === "press") {
        await page.keyboard.press(step.key);
      }
    }
    console.log(`  ✓ [setup] ${label} 已驱动`);
    results.push({ id: a.id, kind: a.kind, pass: true });
  } catch (e) {
    console.log(`  ✗ ${label} — setup error: ${e.message}`);
    results.push({ id: a.id, kind: a.kind, pass: false, error: e.message });
    if (a.kind === "hard-rule") hardFails++;
    else stateFails++;
  }
}
await collectTraceSnapshot();

// ── T4 核心：trace 覆盖率判定 ──
const trace = aggregateTrace.length > 0 ? aggregateTrace : null;

let traceCoverage = null;
const traceErrors = [];
if (!hasTraceBaseline) {
  traceErrors.push(`[TRACE] specs/event-graph.yaml 缺少 rule-traces 段；新链路必须先跑 extract_game_prd.js --emit-rule-traces`);
} else if (trace === null) {
  traceErrors.push(`[TRACE] window.__trace 未定义；codegen 必须在每条 @rule 触发处 push({rule, before, after, t})`);
} else {
  const hit = new Set(trace.map((t) => t?.rule).filter(Boolean));
  const covered = expectedRuleIds.filter((r) => hit.has(r));
  traceCoverage = { total: expectedRuleIds.length, covered: covered.length, ratio: covered.length / expectedRuleIds.length, missing: expectedRuleIds.filter((r) => !hit.has(r)) };
  const pct = (traceCoverage.ratio * 100).toFixed(0);
  console.log(`  ${traceCoverage.ratio >= 0.8 ? "✓" : "✗"} [TRACE] @rule 覆盖率 ${traceCoverage.covered}/${traceCoverage.total} (${pct}%)`);
  if (traceCoverage.ratio < 0.8) {
    traceErrors.push(`[TRACE] @rule 覆盖率 ${pct}% < 80%（缺: ${traceCoverage.missing.slice(0, 8).join(", ")}${traceCoverage.missing.length > 8 ? "..." : ""}）`);
  }
}

// T7: 真 DOM click 检查
if (clickOk) {
  console.log(`  ✓ [PROFILE] 至少 1 条 action: click`);
}

// console error 计入 exit code（不只是 log）
if (consoleErrors.length > 0) {
  console.log(`\n✗ playthrough 期间 ${consoleErrors.length} 条 console error/pageerror:`);
  for (const e of consoleErrors.slice(0, 8)) console.log(`    ${e.slice(0, 140)}`);
  traceErrors.push(`[RUNTIME] ${consoleErrors.length} 条 console error，游戏运行期有异常`);
}
if (assetHttpErrors.length > 0) {
  console.log(`\n✗ playthrough 期间 ${assetHttpErrors.length} 条素材 HTTP 错误:`);
  for (const e of assetHttpErrors.slice(0, 5)) console.log(`    ${e}`);
  traceErrors.push(`[ASSET] ${assetHttpErrors.length} 条素材 4xx/5xx`);
}

await launch.close();
await browser.close();

console.log(`\n结果: setup ${allAssertions.length} 条 / hard-rule fail ${hardFails} / state fail ${stateFails} / trace+click 问题 ${traceErrors.length}`);

const exitCode = traceErrors.length > 0 ? 1 : (hardFails > 0 ? 2 : (stateFails > 0 ? 1 : 0));

log.entry({
  type: "check-run",
  phase: "verify",
  step: "playthrough",
  script: "check_playthrough.js",
  exit_code: exitCode,
  assertions_total: results.length,
  assertions_passed: results.filter((r) => r.pass).length,
  hard_rule_fails: hardFails,
  state_fails: stateFails,
  trace_coverage: traceCoverage,
  real_click: clickOk,
  console_errors: consoleErrors.length,
  asset_http_errors: assetHttpErrors.length,
  trace_errors: traceErrors,
});

if (traceErrors.length > 0) {
  console.log("\n✗ 关键信号未通过:");
  for (const e of traceErrors) console.log("  " + e);
  process.exit(1);
}
if (hardFails > 0) process.exit(2);
if (stateFails > 0) process.exit(1);
process.exit(0);
