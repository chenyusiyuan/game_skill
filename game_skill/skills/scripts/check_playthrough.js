#!/usr/bin/env node
/**
 * check_playthrough.js — 产品侧校验（Playwright 走通主流程）
 *
 * 用法: node check_playthrough.js <game-dir> --profile <case-id>
 *
 * 退出码:
 *   0 = 全部 assertion 通过
 *   1 = 至少 1 条 state assertion 失败
 *   2 = 至少 1 条 hard-rule assertion 失败
 *   3 = 环境问题（Playwright 未装 / Chromium 缺失）
 *   4 = Profile 覆盖率不足（PRD 中有 @check 未被 profile assertion 覆盖）
 *
 * 依赖: playwright（若未装，退出码 3，提示用户先装）
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { resolveLaunchTarget } from "./_run_mode.js";
import { createLogger, parseLogArg } from "./_logger.js";

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

const profile = JSON.parse(readFileSync(profilePath, "utf-8"));

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
      const assertionIds = profile.assertions.map(a => a.id.toLowerCase());
      const assertionDescs = profile.assertions.map(a => a.description.toLowerCase());
      // 新：显式反向绑定集合
      const assertionCheckIds = new Set(
        profile.assertions
          .map(a => (a.check_id ?? "").toString().toLowerCase())
          .filter(Boolean)
      );
      const missing = [];

      for (const check of prdChecks) {
        const checkId = check.id.toLowerCase();
        const checkTitle = check.title.toLowerCase();
        // 优先显式反向绑定；否则回退到 substring 匹配（兼容旧 profile）
        const covered =
          assertionCheckIds.has(checkId) ||
          assertionIds.some(id => id.includes(checkId) || checkId.includes(id)) ||
          assertionDescs.some(desc => desc.includes(checkTitle) || checkTitle.includes(desc));
        if (!covered) {
          missing.push(check);
        }
      }

      // 新：PRD hash 漂移检查
      if (profile.prd_hash) {
        const currentHash = createHash("sha1").update(prdContent).digest("hex");
        if (currentHash !== profile.prd_hash) {
          console.warn(
            `⚠ profile.prd_hash (${profile.prd_hash.slice(0, 12)}...) 与当前 PRD 不一致 (${currentHash.slice(0, 12)}...)`
          );
          console.warn(`  PRD 已变更，profile 可能需要同步。用 extract_game_prd.js --profile-skeleton 重新生成骨架后合并。`);
          log.entry({
            type: "profile-drift",
            profile_id: profileId,
            profile_hash: profile.prd_hash,
            current_hash: currentHash,
          });
        }
      }

      // 新：每条 assertion 的 check_id 必须指向真实的 PRD check（若有 check_id 字段）
      const validCheckIds = new Set(prdChecks.map(c => c.id.toLowerCase()));
      const orphanAssertions = profile.assertions.filter(
        a => a.check_id && !validCheckIds.has(a.check_id.toLowerCase())
      );
      if (orphanAssertions.length > 0) {
        console.warn(`⚠ profile 中有 ${orphanAssertions.length} 条 assertion 的 check_id 指向不存在的 @check:`);
        for (const a of orphanAssertions) {
          console.warn(`    - ${a.id} → check_id: ${a.check_id}`);
        }
      }

      // 检查交互类 assertion 质量
      // 真实交互 = 包含 click 操作 或 eval 中调用游戏函数（非直接赋值 gameState）
      const directAssignPattern = /window\.gameState\.\w+\s*[\+\-\*]?=/;
      const gameApiFnPattern = /(?:simulateCorrectMatch|simulateWrongMatch|simulateCompleteLevel|selectCard|startGame|clickStartButton|clickRetryButton|clickNextLevelButton|window\.gameTest\.\w+|window\.game\.scene)/;

      function isRealInteraction(assertion) {
        if (!assertion.setup || assertion.setup.length === 0) return false;
        return assertion.setup.some(s => {
          if (s.action === "click") return true;
          const js = s.js ?? s.code ?? "";
          if (s.action === "eval" && js) {
            // eval 中调用了游戏暴露的函数 → 算真实交互
            if (gameApiFnPattern.test(js)) return true;
          }
          return false;
        });
      }

      function isSelfGradingEval(assertion) {
        if (!assertion.setup || assertion.setup.length === 0) return false;
        const evalSteps = assertion.setup.filter(s => s.action === "eval");
        if (evalSteps.length === 0) return false;
        // 所有 eval 都只是直接赋值 gameState，没有调用任何游戏函数
        return evalSteps.every(s => {
          const js = s.js ?? s.code ?? "";
          // 移除注释和字符串
          const stripped = js.replace(/\/\/.*$/gm, "").replace(/'[^']*'/g, "").replace(/"[^"]*"/g, "");
          // 检查是否只包含 gameState 赋值操作
          const hasGameApiCall = gameApiFnPattern.test(stripped);
          const hasDirectAssign = directAssignPattern.test(stripped);
          return hasDirectAssign && !hasGameApiCall;
        });
      }

      const hasRealInteraction = profile.assertions.some(a => isRealInteraction(a));
      const selfGradingAssertions = profile.assertions.filter(a =>
        a.kind === "interaction" && isSelfGradingEval(a)
      );

      console.log(`\n=== PRD @check 覆盖率检查 ===`);
      console.log(`PRD product checks: ${prdChecks.length}`);
      console.log(`Profile assertions:  ${profile.assertions.length}`);
      console.log(`真实交互 assertions: ${hasRealInteraction ? "有" : "⚠ 无（所有 'interaction' 断言都是 eval 直接赋值 gameState，未测试真实交互链路）"}`);

      if (selfGradingAssertions.length > 0) {
        console.log(`\n⚠ 以下 assertion 的 setup 只通过 eval 直接修改 gameState 然后 expect 检查自己修改的值，无法验证真实游戏逻辑：`);
        for (const a of selfGradingAssertions) {
          console.log(`  ⚠ [${a.id}] ${a.description}`);
        }
        console.log(`  建议: 改用 click 操作真实 UI 元素，或调用游戏暴露的 API 函数（如 simulateCorrectMatch）`);
      }

      if (missing.length > 0) {
        console.log(`\n⚠ 以下 PRD @check(layer: product) 条目在 profile 中没有对应 assertion:`);
        for (const c of missing) {
          console.log(`  ✗ @check(${c.id}) ${c.title}`);
        }
        console.log(`\n请在 ${profilePath} 中补充对应的 assertions。`);
        console.log(`提示: 核心交互 assertion 必须有 setup 操作步骤（click/eval），不能只做静态状态检查。\n`);
        process.exit(4);
      }

      if (!hasRealInteraction) {
        console.log(`\n⚠ Profile 中没有任何真实交互类 assertion。`);
        console.log(`所有标记为 interaction 的 assertion 都只通过 eval 直接修改 gameState，`);
        console.log(`这等同于"自己出题自己答"，无法检出交互链路 bug（如 isProcessing 不重置、事件绑定错误等）。`);
        console.log(`请至少补充一条包含 click 操作或调用游戏 API 函数的 assertion。\n`);
        process.exit(4);
      }

      console.log(`✓ 所有 PRD @check(layer: product) 条目均已覆盖\n`);
    }
  }
}

// Dynamic import playwright (may fail if not installed)
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
page.on("pageerror", (e) => consoleErrors.push(e.message));
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
    // 非项目素材的外部资源错误不阻断；项目素材 404 会由 response 监听硬失败。
    if ((text.includes("404") || text.includes("Failed to load resource")) &&
        !/\/assets\/library_(?:2d|3d)\//.test(url)) {
      return;
    }
    consoleErrors.push(text);
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

if (consoleErrors.length > 0) {
  console.error("✗ 页面加载时有 console error:");
  for (const e of consoleErrors) console.error(`  ${e}`);
  await launch.close();
  await browser.close();
  process.exit(1);
}

let stateFails = 0;
let hardFails = 0;
const results = [];

async function loadFreshPage() {
  await page.goto(launch.url, { waitUntil: "networkidle", timeout: profile.boot_timeout_ms ?? 5000 });
  await page.waitForFunction(() => window.gameState !== undefined, { timeout: 3000 }).catch(() => {});
}

async function evalExpr(expr) {
  if (!expr) throw new Error("assertion expect 缺少 selector/eval 表达式");
  return await page.evaluate(`(() => (${expr}))()`);
}

function compare(actual, op, expected) {
  switch (op) {
    case "eq": return actual === expected;
    case "equals": return actual === expected;
    case "neq": return actual !== expected;
    case "gte": return actual >= expected;
    case "lte": return actual <= expected;
    case "gt": return actual > expected;
    case "lt": return actual < expected;
    case "in": return Array.isArray(expected) && expected.includes(actual);
    case "truthy": return !!actual;
    case "falsy": return !actual;
    default: throw new Error(`unknown op: ${op}`);
  }
}

for (let assertionIndex = 0; assertionIndex < profile.assertions.length; assertionIndex++) {
  const a = profile.assertions[assertionIndex];
  const label = `[${a.id}] ${a.description}`;
  try {
    if (assertionIndex > 0) await loadFreshPage();
    for (const step of a.setup ?? []) {
      if (step.action === "click") {
        await page.click(step.selector, { timeout: 2000 });
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
    const actual = await evalExpr(a.expect.selector ?? a.expect.eval);
    const pass = compare(actual, a.expect.op, a.expect.value);
    results.push({ id: a.id, kind: a.kind, pass, actual, expected: a.expect.value });
    if (pass) {
      console.log(`  ✓ ${label}`);
    } else {
      console.log(`  ✗ ${label}`);
      console.log(`    actual=${JSON.stringify(actual)}  expected ${a.expect.op} ${JSON.stringify(a.expect.value)}`);
      if (a.kind === "hard-rule") hardFails++;
      else stateFails++;
    }
  } catch (e) {
    console.log(`  ✗ ${label} — error: ${e.message}`);
    if (a.kind === "hard-rule") hardFails++;
    else stateFails++;
  }
}

// 检查 playthrough 期间的 console errors
if (consoleErrors.length > 0) {
  console.log(`\n⚠ Playthrough 期间出现 ${consoleErrors.length} 个 console error:`);
  for (const e of consoleErrors) console.log(`  ${e}`);
  console.log(`这些运行时错误可能影响游戏的真实可玩性。\n`);
}
if (assetHttpErrors.length > 0) {
  console.log(`\n✗ Playthrough 期间出现 ${assetHttpErrors.length} 个项目素材 HTTP 错误:`);
  for (const e of assetHttpErrors.slice(0, 10)) console.log(`  ${e}`);
  stateFails++;
}

await launch.close();
await browser.close();

console.log(`\n结果: ${results.length - stateFails - hardFails}/${results.length} passed`);
if (hardFails > 0) console.log(`  hard-rule 失败: ${hardFails}`);
if (stateFails > 0) console.log(`  state 失败: ${stateFails}`);

const exitCode = hardFails > 0 ? 2 : stateFails > 0 ? 1 : 0;
log.entry({
  type: "check-run",
  phase: "verify",
  step: "playthrough",
  script: "check_playthrough.js",
  exit_code: exitCode,
  assertions_total: results.length,
  assertions_passed: results.length - stateFails - hardFails,
  hard_rule_fails: hardFails,
  state_fails: stateFails,
  failures: results.filter(r => !r.pass).map(r => ({
    id: r.id, kind: r.kind, actual: r.actual, expected: r.expected,
  })),
  console_errors: consoleErrors,
});

if (hardFails > 0) process.exit(2);
if (stateFails > 0) process.exit(1);
process.exit(0);
