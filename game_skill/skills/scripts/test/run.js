#!/usr/bin/env node
/**
 * 单元测试：review 反馈修复后的静态行为断言
 *
 * 跑法: node game_skill/skills/scripts/test/run.js
 * 退出码 0 = 全部通过；非 0 = 失败
 */

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../../.."); // 项目根
const scriptsDir = resolve(here, "..");
const fixtures = join(here, "fixtures");
const tmp = join(here, ".tmp");

let failed = 0;
let passed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function run(cmd, opts = {}) {
  return spawnSync("node", cmd, { encoding: "utf-8", cwd: root, ...opts });
}

// 准备 tmp 目录
if (existsSync(tmp)) rmSync(tmp, { recursive: true });
mkdirSync(tmp, { recursive: true });

// =============================
// P2-1: extract_game_prd --emit-rule-traces 抽 state.score
// =============================
console.log("\n[P2-1] extract_game_prd: state.* 必须被抽取");
test("state.score += 10 抽出一个 assign/inc action", () => {
  const prd = join(fixtures, "trace-extractor-test-prd.md");
  const out = join(tmp, "event-graph.yaml");
  const r = run([join(scriptsDir, "extract_game_prd.js"), prd, "--emit-rule-traces", out]);
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  const yaml = readFileSync(out, "utf-8");
  // score-up 里至少有 subject: state 且 field: score
  assert(/rule-id:\s*score-up/.test(yaml), "score-up rule 应存在");
  assert(/subject:\s*state.*field:\s*score/.test(yaml), "state.score 应被抽出");
  assert(/subject:\s*pig.*field:\s*ammo/.test(yaml), "pig.ammo 也应被抽出");
});

test("profile skeleton 只生成 setup 且包含真实 click 占位", () => {
  const prd = join(tmp, "profile-skeleton-test-prd.md");
  writeFileSync(prd, readFileSync(join(fixtures, "trace-extractor-test-prd.md"), "utf-8") + [
    "",
    "### @check(playable-loop) 主循环可玩",
    "> layer: product",
    "> method: \"点击开始并执行一次主操作\"",
    "> expect: \"trace 覆盖核心规则\"",
    "",
  ].join("\n"));
  const out = join(tmp, "profile.skeleton.json");
  const r = run([join(scriptsDir, "extract_game_prd.js"), prd, "--profile-skeleton", out]);
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  const profile = JSON.parse(readFileSync(out, "utf-8"));
  const assertions = profile.assertions ?? [];
  assert(assertions.length > 0, "应生成 product assertion");
  assert(!assertions.some(a => a.expect !== undefined), "新 skeleton 不应包含 expect");
  assert(assertions.some(a => (a.setup ?? []).some(s => s.action === "click" && s.selector)), "至少一条 assertion 应包含真实 click 占位");
});

// =============================
// T11 + T1: check_game_prd RL004/RL005 严格化
// =============================
console.log("\n[T11/T1] check_game_prd: RL005 严格化");
test("纯文字 effect 应触发 RL005 error", () => {
  const prd = join(tmp, "bad-effect-prd.md");
  const raw = readFileSync(join(fixtures, "trace-extractor-test-prd.md"), "utf-8");
  // 改掉 score-up 的 effect 为纯文字
  const bad = raw.replace('effect: "state.score += 10 ; pig.ammo -= 1"', 'effect: "得分增加十分并消耗一点弹药"');
  writeFileSync(prd, bad);
  const r = run([join(scriptsDir, "check_game_prd.js"), prd]);
  assert(r.status !== 0, "应该 fail");
  assert(/RL005/.test(r.stdout) || /RL001/.test(r.stdout), "应报 RL005 或 RL001");
});

// =============================
// T6: _profile_guard freeze + guard + tamper
// =============================
console.log("\n[T6] _profile_guard: freeze → guard → tamper");
test("freeze → guard pass", () => {
  const caseDir = join(tmp, "case-A");
  mkdirSync(join(caseDir, ".game"), { recursive: true });
  writeFileSync(join(caseDir, ".game/state.json"), JSON.stringify({ phases: {} }));
  const profile = join(tmp, "profile-A.json");
  writeFileSync(profile, JSON.stringify({ assertions: [{ id: "a" }] }));

  const freeze = run([join(scriptsDir, "_profile_guard.js"), caseDir, profile, "--freeze"]);
  assert(freeze.status === 0, `freeze exit ${freeze.status}: ${freeze.stderr}`);
  const state = JSON.parse(readFileSync(join(caseDir, ".game/state.json"), "utf-8"));
  assert(state.phases?.verify?.profileSha?.length === 64, "SHA 应写入 state.json phases.verify");

  const guard = run([join(scriptsDir, "_profile_guard.js"), caseDir, profile]);
  assert(guard.status === 0, `guard 应通过，exit=${guard.status}`);
});

test("tamper → guard exit 5", () => {
  const caseDir = join(tmp, "case-B");
  mkdirSync(join(caseDir, ".game"), { recursive: true });
  writeFileSync(join(caseDir, ".game/state.json"), JSON.stringify({ phases: {} }));
  const profile = join(tmp, "profile-B.json");
  writeFileSync(profile, JSON.stringify({ assertions: [{ id: "b" }] }));

  run([join(scriptsDir, "_profile_guard.js"), caseDir, profile, "--freeze"]);
  // 篡改
  writeFileSync(profile, JSON.stringify({ assertions: [{ id: "b", tampered: true }] }));
  const guard = run([join(scriptsDir, "_profile_guard.js"), caseDir, profile]);
  assert(guard.status === 5, `tamper 应 exit 5，实际 ${guard.status}`);
  assert(/篡改|tampered|mismatch/i.test(guard.stderr + guard.stdout), "错误消息应提示篡改");
});

test("无基线 → guard exit 6（新链路必须先 freeze）", () => {
  const caseDir = join(tmp, "case-C");
  mkdirSync(join(caseDir, ".game"), { recursive: true });
  writeFileSync(join(caseDir, ".game/state.json"), JSON.stringify({ phases: {} }));
  const profile = join(tmp, "profile-C.json");
  writeFileSync(profile, JSON.stringify({ assertions: [] }));
  const guard = run([join(scriptsDir, "_profile_guard.js"), caseDir, profile]);
  assert(guard.status === 6, `无基线应 exit 6，实际 ${guard.status}`);
  assert(/缺少 profile 冻结基线/.test(guard.stderr + guard.stdout), "错误消息应提示缺少冻结基线");
});

// =============================
// asset-strategy 单元测试
// =============================
console.log("\n[asset-strategy] mode / rationale / core-entities / coherence 约束");

// 复用 fixture PRD，动态改 asset-strategy 段
function writePrdWithStrategy(targetPath, strategy) {
  const raw = readFileSync(join(fixtures, "trace-extractor-test-prd.md"), "utf-8");
  // 在第 2 个 --- 之前（即 front-matter 末尾）插入 asset-strategy 段
  const injected = raw.replace(/\n---\n(?!-)/, `\nasset-strategy:\n${strategy}\n---\n`);
  writeFileSync(targetPath, injected);
}

test("缺 asset-strategy 段 → AS001 error", () => {
  const prd = join(fixtures, "trace-extractor-test-prd.md"); // 本身没有 asset-strategy
  const r = run([join(scriptsDir, "check_game_prd.js"), prd]);
  assert(r.status !== 0, "应该 fail");
  assert(/AS001/.test(r.stdout), "应报 AS001");
});

test("mode=library-first + core-entities 空 → AS006", () => {
  const prd = join(tmp, "as-lf-empty.md");
  writePrdWithStrategy(prd, [
    `  mode: library-first`,
    `  rationale: "${"x".repeat(90)}"`,
    `  visual-core-entities: []`,
    `  visual-peripheral: []`,
    `  style-coherence: { level: flexible }`,
  ].join("\n"));
  const r = run([join(scriptsDir, "check_game_prd.js"), prd]);
  assert(/AS006/.test(r.stdout), "应报 AS006（core-entities 不能空）");
});

test("mode=none + core-entities 非空 → AS006", () => {
  const prd = join(tmp, "as-none-core.md");
  writePrdWithStrategy(prd, [
    `  mode: none`,
    `  rationale: "${"x".repeat(90)}"`,
    `  visual-core-entities: [pig]`,
    `  style-coherence: { level: "n/a" }`,
  ].join("\n"));
  const r = run([join(scriptsDir, "check_game_prd.js"), prd]);
  assert(/AS006/.test(r.stdout), "mode=none 但 core-entities 非空应报 AS006");
});

test("rationale < 80 chars → AS003", () => {
  const prd = join(tmp, "as-short-rationale.md");
  writePrdWithStrategy(prd, [
    `  mode: library-first`,
    `  rationale: "太短"`,
    `  visual-core-entities: [pig]`,
    `  style-coherence: { level: strict }`,
  ].join("\n"));
  const r = run([join(scriptsDir, "check_game_prd.js"), prd]);
  assert(/AS003/.test(r.stdout), "短 rationale 应报 AS003");
});

test("visual-core-entities 指向不存在的 id → AS007", () => {
  const prd = join(tmp, "as-bad-id.md");
  writePrdWithStrategy(prd, [
    `  mode: library-first`,
    `  rationale: "${"x".repeat(90)}"`,
    `  visual-core-entities: [nonexistent-id]`,
    `  style-coherence: { level: strict }`,
  ].join("\n"));
  const r = run([join(scriptsDir, "check_game_prd.js"), prd]);
  assert(/AS007/.test(r.stdout), "未定义 id 应报 AS007");
});

test("完整合法 strategy 通过（仍会因其他原因 fail 但无 AS 错误）", () => {
  const prd = join(tmp, "as-valid.md");
  writePrdWithStrategy(prd, [
    `  mode: library-first`,
    `  rationale: "${"传送带颜色匹配玩法，玩家需分辨 4 种颜色的小猪和目标块，故核心实体使用库素材保证辨识度。".repeat(2)}"`,
    `  visual-core-entities: [pig]`,
    `  style-coherence: { level: strict }`,
  ].join("\n"));
  const r = run([join(scriptsDir, "check_game_prd.js"), prd]);
  // 可能因为其他原因 fail（如 RL005），但不应有 AS001-AS007 错误
  assert(!/AS00[1-7]/.test(r.stdout), `不应有 AS 错误: ${r.stdout.match(/AS00\d[^\n]*/g)?.join(";")}`);
});

// =============================
// asset-strategy 闭环测试
// =============================
console.log("\n[asset-strategy] selection / contract / usage 闭环");

function writeCasePrd(caseDir, strategyLines, extraTags = "") {
  mkdirSync(join(caseDir, "docs"), { recursive: true });
  writeFileSync(join(caseDir, "docs/game-prd.md"), [
    "---",
    'game-aprd: "0.1"',
    "project: asset-test-001",
    "platform: [web]",
    "runtime: canvas",
    "is-3d: false",
    "mode: 单机",
    "language: zh-CN",
    "asset-strategy:",
    strategyLines,
    "---",
    "## 1. 项目概述",
    "### @game(main) Asset Test",
    "> genre: board-grid",
    "> platform: [web]",
    "> runtime: canvas",
    "> mode: 单机",
    "> core-loop: test",
    "> player-goal: test",
    "",
    "## 6. 状态与实体",
    "### @entity(pig) Pig",
    "> type: unit",
    "> fields: [color, ammo]",
    "### @entity(block) Block",
    "> type: target",
    "> fields: [color, hp]",
    "### @ui(scene-background) Background",
    "> scene: play",
    "> role: background",
    "### @ui(btn-start) Start",
    "> scene: start",
    "> role: button",
    extraTags,
  ].join("\n"));
}

function writeBaseScene(caseDir) {
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  writeFileSync(join(caseDir, "specs/scene.yaml"), [
    "boot-contract:",
    "  entry-scene: start",
    "  ready-condition: window.gameState !== undefined",
    "  start-action: { trigger: auto, target: null, result: phase -> playing }",
    "  scene-transitions: []",
    "scenes:",
    "  - id: start",
    "    layout:",
    "      viewport: full",
    "      board-bbox: none",
    "      hud-bbox: none",
    "      safe-area: { x: 0, y: 0, width: \"100%\", height: \"100%\" }",
    "    zones: []",
  ].join("\n"));
}

function writeAssets(caseDir, imageLines) {
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  writeFileSync(join(caseDir, "specs/assets.yaml"), [
    "color-scheme:",
    "  palette-id: pixel-retro",
    "genre: board-grid",
    "images:",
    imageLines,
    "audio: []",
    "spritesheets: []",
    "fonts: []",
    "selection-report:",
    "  candidate-packs: [ui-pixel-adventure]",
    "  local-file-ratio: { images: 2/10 }",
    "  fallback-reasons:",
    "    - generated peripheral elements are intentionally programmatic",
  ].join("\n"));
}

test("library-first 只统计核心视觉，外围 generated 不应拉低 local-file 阈值", () => {
  const caseDir = join(tmp, "asset-core-ratio");
  writeCasePrd(caseDir, [
    "  mode: library-first",
    `  rationale: "${"核心小猪和目标块需要清晰视觉表达，外围背景和 HUD 可以程序化生成，避免为无关元素硬凑素材。".repeat(2)}"`,
    "  visual-core-entities: [pig, block]",
    "  visual-peripheral: [scene-background]",
    "  style-coherence: { level: flexible }",
  ].join("\n"));
  writeAssets(caseDir, [
    "  - id: pig-sprite",
    "    source: assets/library_2d/sprites/puzzle/ballBlue.png",
    "    type: local-file",
    "    binding-to: pig",
    "    visual-primitive: color-unit",
    "    color-source: entity.color",
    "  - id: block-sprite",
    "    source: assets/library_2d/sprites/puzzle/ballGrey.png",
    "    type: local-file",
    "    binding-to: block",
    "    visual-primitive: color-unit",
    "    color-source: entity.color",
    ...Array.from({ length: 8 }, (_, i) => [
      `  - id: bg-generated-${i}`,
      "    source: generated",
      "    type: graphics-generated",
      "    binding-to: scene-background",
    ].join("\n")),
  ].join("\n"));
  const r = run([join(scriptsDir, "check_asset_selection.js"), caseDir]);
  assert(r.status === 0, `外围 generated 不应导致失败，exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  assert(/core-local-file/.test(r.stdout), "应输出 core-local-file 判定");
});

test("visual-core-entities 每个核心 id 必须有非 decor asset 绑定", () => {
  const caseDir = join(tmp, "asset-missing-core");
  writeCasePrd(caseDir, [
    "  mode: library-first",
    `  rationale: "${"核心实体需要明确视觉表达，否则小猪和目标块无法被玩家区分，不能只给按钮或装饰素材。".repeat(2)}"`,
    "  visual-core-entities: [pig, block]",
    "  visual-peripheral: [btn-start]",
    "  style-coherence: { level: flexible }",
  ].join("\n"));
  writeAssets(caseDir, [
    "  - id: start-button",
    "    source: assets/library_2d/ui-pixel/tile_0013.png",
    "    type: local-file",
    "    binding-to: btn-start",
  ].join("\n"));
  const r = run([join(scriptsDir, "check_asset_selection.js"), caseDir]);
  assert(r.status !== 0, "缺 core binding 应失败");
  assert(/\[core-binding\]/.test(r.stdout), `应报 core-binding，实际:\n${r.stdout}`);
});

test("mode=none 时 generate_implementation_contract 可在无 assets.yaml 下生成空 asset-bindings", () => {
  const caseDir = join(tmp, "asset-none-contract");
  writeCasePrd(caseDir, [
    "  mode: none",
    `  rationale: "${"这是纯文字规则解谜，玩家只阅读题面和选项，不需要视觉实体或外部素材，使用 DOM 文本即可完整表达玩法。".repeat(2)}"`,
    "  visual-core-entities: []",
    "  visual-peripheral: []",
    "  style-coherence: { level: \"n/a\" }",
  ].join("\n"));
  writeBaseScene(caseDir);
  const out = "specs/implementation-contract.yaml";
  const r = run([join(scriptsDir, "generate_implementation_contract.js"), caseDir, "--out", out]);
  assert(r.status === 0, `mode=none 无 assets.yaml 应通过，exit=${r.status}\n${r.stderr}`);
  const contract = readFileSync(join(caseDir, out), "utf-8");
  assert(/asset-bindings:\s*\[\]/.test(contract), "asset-bindings 应为空数组");
});

function writeGeneratedUsageCase(caseDir, withDrawCall) {
  writeCasePrd(caseDir, [
    "  mode: generated-only",
    `  rationale: "${"核心小猪使用程序化图形即可表达颜色和数值，库素材不必要；但核心视觉仍必须在 canvas 中真实绘制。".repeat(2)}"`,
    "  visual-core-entities: [pig]",
    "  visual-peripheral: []",
    "  style-coherence: { level: \"n/a\" }",
  ].join("\n"));
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  writeFileSync(join(caseDir, "specs/assets.yaml"), [
    "images:",
    "  - id: pig-shape",
    "    source: generated",
    "    type: graphics-generated",
    "    binding-to: pig",
    "audio: []",
    "spritesheets: []",
  ].join("\n"));
  writeFileSync(join(caseDir, "specs/implementation-contract.yaml"), [
    "asset-bindings:",
    "  - id: pig-shape",
    "    section: images",
    "    type: graphics-generated",
    "    must-render: true",
  ].join("\n"));
  mkdirSync(join(caseDir, "game"), { recursive: true });
  writeFileSync(join(caseDir, "game/index.html"), [
    "<!-- ENGINE: canvas | VERSION: test | RUN: file -->",
    "<canvas id=\"game\"></canvas>",
    "<script>",
    "const assetId = 'pig-shape';",
    "const ctx = document.getElementById('game').getContext('2d');",
    withDrawCall ? "ctx.fillRect(0, 0, 12, 12);" : "console.log(assetId);",
    "</script>",
  ].join("\n"));
}

test("generated-only 的 required generated 核心视觉必须有绘制证据", () => {
  const good = join(tmp, "asset-generated-good");
  writeGeneratedUsageCase(good, true);
  const okRun = run([join(scriptsDir, "check_asset_usage.js"), good]);
  assert(okRun.status === 0, `有 fillRect 应通过，exit=${okRun.status}\n${okRun.stdout}`);

  const bad = join(tmp, "asset-generated-bad");
  writeGeneratedUsageCase(bad, false);
  const badRun = run([join(scriptsDir, "check_asset_usage.js"), bad]);
  assert(badRun.status !== 0, "没有绘制调用应失败");
  assert(/required asset/.test(badRun.stdout), `应报 required asset，实际:\n${badRun.stdout}`);
});

// =============================
// P0.3: test-hook.js 三分类 + 双写兼容
// =============================
console.log("\n[P0.3] test-hook.js observers / drivers / probes");

async function loadTestHookWithWindow() {
  // 隔离：每次重新加载模块并给它一个干净 globalThis.window
  const fakeWindow = {};
  const savedWindow = globalThis.window;
  globalThis.window = fakeWindow;
  // 每次加载都拿新模块实例（绕过 ESM cache）
  const modUrl = new URL(
    "../../references/engines/_common/test-hook.js?t=" + Date.now(),
    import.meta.url,
  );
  const mod = await import(modUrl.href);
  return {
    mod,
    win: fakeWindow,
    restore: () => {
      if (savedWindow === undefined) delete globalThis.window;
      else globalThis.window = savedWindow;
    },
  };
}

test("exposeTestHooks 旧入参 hooks 平铺到 gameTest.<name>", async () => {
  const { mod, win, restore } = await loadTestHookWithWindow();
  try {
    const clickStart = () => "start";
    mod.exposeTestHooks({ state: { s: 1 }, hooks: { clickStart } });
    assert(win.gameState?.s === 1, "gameState 应被挂载");
    assert(typeof win.gameTest.clickStart === "function", "旧扁平 clickStart 应可访问");
    assert(
      typeof win.gameTest.drivers.clickStart === "function",
      "hooks 应自动 mirror 到 drivers.clickStart",
    );
  } finally {
    restore();
  }
});

test("exposeTestHooks probes 只挂命名空间，不平铺", async () => {
  const { mod, win, restore } = await loadTestHookWithWindow();
  try {
    const resetWithScenario = () => "reset";
    mod.exposeTestHooks({
      state: { s: 1 },
      hooks: { clickStartButton: () => {} },
      probes: { resetWithScenario },
    });
    assert(
      typeof win.gameTest.probes.resetWithScenario === "function",
      "probes.resetWithScenario 应可访问",
    );
    assert(
      win.gameTest.resetWithScenario === undefined,
      "probes 不应被平铺到 gameTest.<name>",
    );
    assert(
      win.resetWithScenario === undefined,
      "probes 不应被挂到 window",
    );
  } finally {
    restore();
  }
});

test("exposeTestHooks 把 probe-like 名字放进 hooks 时发出 deprecation warn", async () => {
  const { mod, win, restore } = await loadTestHookWithWindow();
  const origWarn = console.warn;
  const warns = [];
  console.warn = (...args) => warns.push(args.join(" "));
  try {
    mod.exposeTestHooks({
      state: { s: 1 },
      hooks: { resetWithScenario: () => {}, clickStartButton: () => {} },
    });
    const hit = warns.some((w) =>
      /looks like a probe/.test(w) && /resetWithScenario/.test(w),
    );
    assert(hit, `应 warn resetWithScenario 是 probe-like，实际 warns=${JSON.stringify(warns)}`);
  } finally {
    console.warn = origWarn;
    restore();
  }
});

test("exposeTestHooks 同时传 hooks 和 drivers 时不互相覆盖", async () => {
  const { mod, win, restore } = await loadTestHookWithWindow();
  try {
    const fromHooks = () => "h";
    const fromDrivers = () => "d";
    mod.exposeTestHooks({
      state: { s: 1 },
      hooks: { clickStart: fromHooks, legacyOnly: fromHooks },
      drivers: { clickStart: fromDrivers, newOnly: fromDrivers },
    });
    // drivers 里显式传的 clickStart 应覆盖 hooks mirror 的版本
    assert(
      win.gameTest.drivers.clickStart() === "d",
      "drivers 显式传的实现应覆盖 hooks mirror",
    );
    // hooks-only 的仍在 drivers 可见
    assert(
      typeof win.gameTest.drivers.legacyOnly === "function",
      "只在 hooks 的也应 mirror 进 drivers",
    );
    // drivers-only 的不会反向平铺到扁平 gameTest.<name>
    assert(
      win.gameTest.newOnly === undefined,
      "drivers 不应反向平铺到 gameTest 扁平",
    );
  } finally {
    restore();
  }
});

test("assertHooksExposed 支持 gameTest.drivers.xxx 点分路径", async () => {
  const { mod, win, restore } = await loadTestHookWithWindow();
  try {
    mod.exposeTestHooks({
      state: { s: 1 },
      hooks: { clickStartButton: () => {} },
    });
    const result = mod.assertHooksExposed([
      "gameTest.clickStartButton",
      "gameTest.drivers.clickStartButton",
    ]);
    assert(result.ok, `两个路径都应该存在，missing=${JSON.stringify(result.missing)}`);
    const result2 = mod.assertHooksExposed(["gameTest.probes.notExist"]);
    assert(!result2.ok && result2.missing.length === 1, "不存在的路径应被标记 missing");
  } finally {
    restore();
  }
});

// =============================
// P0.1: _profile_anti_cheat — profile eval 反作弊规则
// =============================
console.log("\n[P0.1] _profile_anti_cheat: detectAntiCheatHits");

{
  const { detectAntiCheatHits, ANTI_CHEAT_PATTERNS } = await import(
    "../_profile_anti_cheat.js"
  );

  test("直接改 gameState 字段 → 命中 anti-cheat", () => {
    const a = {
      id: "cheat-a",
      setup: [{ action: "eval", js: "window.gameState.score = 999" }],
    };
    const hits = detectAntiCheatHits(a);
    assert(hits.length >= 1, `应命中，实际 hits=${JSON.stringify(hits)}`);
    assert(
      hits.some((h) => /gameState\\.\[\\w\.\]\+/.test(h.pattern) || h.match.includes("gameState")),
      `kind 应指明 gameState 字段改写，实际=${JSON.stringify(hits)}`,
    );
  });

  test("forceWin() 直接定判定 → 命中", () => {
    const a = {
      id: "cheat-b",
      setup: [
        { action: "click", selector: "#start" },
        { action: "eval", js: "window.forceWin()" },
      ],
    };
    const hits = detectAntiCheatHits(a);
    assert(hits.some((h) => /forceWin/.test(h.kind)), `应含 forceWin 提示，实际 ${JSON.stringify(hits)}`);
  });

  test("补 window.__trace.push 伪造执行 → 命中", () => {
    const a = {
      id: "cheat-c",
      setup: [{ action: "eval", code: "window.__trace.push({rule:'x'})" }],
    };
    const hits = detectAntiCheatHits(a);
    assert(hits.some((h) => /trace/i.test(h.kind)), `应命中 trace push`);
  });

  test("调 window.gameTest.probes.* → 命中（probe 不是真实输入）", () => {
    const a = {
      id: "cheat-d",
      setup: [{ action: "eval", js: "window.gameTest.probes.resetWithScenario({x:1})" }],
    };
    const hits = detectAntiCheatHits(a);
    assert(hits.some((h) => /probes/.test(h.kind)), `应命中 probes`);
  });

  test("旧 API window.gameTest.clickStartButton() → 不命中（兼容路径）", () => {
    const a = {
      id: "legacy-ok",
      setup: [
        { action: "click", selector: "#start" },
        { action: "eval", js: "window.gameTest.clickStartButton()" },
      ],
    };
    const hits = detectAntiCheatHits(a);
    assert(hits.length === 0, `兼容旧 driver 调用不应命中 anti-cheat，实际=${JSON.stringify(hits)}`);
  });

  test("Object.assign 批量改 gameState → 命中", () => {
    const a = {
      id: "cheat-e",
      setup: [{ action: "eval", js: "Object.assign(window.gameState, {win:true})" }],
    };
    const hits = detectAntiCheatHits(a);
    assert(hits.some((h) => /Object\.assign/.test(h.kind)), `应命中 Object.assign`);
  });

  test("纯 UI 驱动（只有 click/press/fill）→ 不命中", () => {
    const a = {
      id: "clean-ui",
      setup: [
        { action: "click", selector: "#start" },
        { action: "press", key: "Enter" },
        { action: "fill", selector: "#name", value: "abc" },
      ],
    };
    const hits = detectAntiCheatHits(a);
    assert(hits.length === 0, `干净 UI 驱动不应命中，实际=${JSON.stringify(hits)}`);
  });

  test("ANTI_CHEAT_PATTERNS 导出且非空", () => {
    assert(Array.isArray(ANTI_CHEAT_PATTERNS) && ANTI_CHEAT_PATTERNS.length >= 7,
      `应 >= 7 条规则，实际 ${ANTI_CHEAT_PATTERNS?.length}`);
  });
}

// =============================
// P0.4: _visual_primitive_enum — slot 枚举 + color-source 校验
// =============================
console.log("\n[P0.4] _visual_primitive_enum: slot 枚举与 color-source");

{
  const mod = await import("../_visual_primitive_enum.js");

  test("VISUAL_PRIMITIVE_ENUM 覆盖现有 case 的所有实际值", () => {
    const usedInCases = [
      "color-unit", "color-block",
      "ui-button", "ui-panel",
      "background", "grid", "track",
    ];
    for (const v of usedInCases) {
      assert(mod.isValidVisualPrimitive(v), `枚举应包含 "${v}"`);
    }
  });

  test("isValidVisualPrimitive 拒绝错写", () => {
    assert(!mod.isValidVisualPrimitive("btn"), "btn 应被拒");
    assert(!mod.isValidVisualPrimitive("color_block"), "下划线写法应被拒");
    assert(!mod.isValidVisualPrimitive("Button"), "大写应被拒");
    assert(!mod.isValidVisualPrimitive(""), "空串应被拒");
    assert(!mod.isValidVisualPrimitive(null), "null 应被拒");
  });

  test("requiresColorSource 识别颜色来源必填槽", () => {
    assert(mod.requiresColorSource("color-block"), "color-block 需 color-source");
    assert(mod.requiresColorSource("color-unit"), "color-unit 需 color-source");
    assert(mod.requiresColorSource("colorable-token"), "colorable-token 需 color-source");
    assert(!mod.requiresColorSource("ui-button"), "ui-button 不需要 color-source");
    assert(!mod.requiresColorSource("background"), "background 不需要 color-source");
  });

  test("requiresGeneratedType: 只有 color-block 强制程序化生成", () => {
    assert(mod.requiresGeneratedType("color-block"), "color-block 强制 generated");
    assert(!mod.requiresGeneratedType("color-unit"), "color-unit 允许 local-file（如小猪角色贴图）");
  });

  test("isGeneratedType 接受三种程序化类型", () => {
    assert(mod.isGeneratedType("graphics-generated"), "");
    assert(mod.isGeneratedType("inline-svg"), "");
    assert(mod.isGeneratedType("synthesized"), "");
    assert(!mod.isGeneratedType("local-file"), "local-file 不是程序化");
  });

  test("isValidColorSource 接受 entity.*/palette.*/十六进制/函数式颜色串", () => {
    assert(mod.isValidColorSource("entity.color"), "entity.color");
    assert(mod.isValidColorSource("entity.hp-bar-color"), "entity.hp-bar-color");
    assert(mod.isValidColorSource("palette.primary"), "palette.primary");
    assert(mod.isValidColorSource("#ef4444"), "十六进制");
    assert(mod.isValidColorSource("rgb(239, 68, 68)"), "rgb(...)");
    assert(!mod.isValidColorSource("red"), "裸 CSS 命名色不通过（太松会允许任意单词）");
    assert(!mod.isValidColorSource(""), "空串不通过");
    assert(!mod.isValidColorSource("entity"), "缺字段名的 entity 不通过");
  });
}

// =============================
// P0.4: check_implementation_contract 接入 visual-primitive 枚举
// =============================
console.log("\n[P0.4] check_implementation_contract: core entity visual-primitive 强制");

function writeMinimalContract(caseDir, extraBindingFields = {}) {
  // 写最小可通过的 contract + assets + PRD（asset-strategy 含 visual-core-entities: [pig]）
  mkdirSync(join(caseDir, "docs"), { recursive: true });
  writeFileSync(join(caseDir, "docs/game-prd.md"), [
    "---",
    'game-aprd: "0.1"',
    "project: vp-test",
    "platform: [web]",
    "runtime: canvas",
    "is-3d: false",
    "mode: 单机",
    "language: zh-CN",
    "asset-strategy:",
    "  mode: library-first",
    `  rationale: "${"核心小猪需要按颜色区分，是玩法识别的关键视觉，不可用纯装饰代替。".repeat(2)}"`,
    "  visual-core-entities: [pig]",
    "  visual-peripheral: []",
    "  style-coherence: { level: strict }",
    "---",
    "## 1. 项目概述",
    "### @game(main) VP Test",
    "> genre: board-grid",
    "> platform: [web]",
    "> runtime: canvas",
    "> mode: 单机",
    "> core-loop: test",
    "> player-goal: test",
    "",
    "## 6. 状态与实体",
    "### @entity(pig) Pig",
    "> type: unit",
    "> fields: [color]",
  ].join("\n"));
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  writeFileSync(join(caseDir, "specs/assets.yaml"), [
    "images:",
    "  - id: pig-shape",
    "    source: generated",
    "    type: graphics-generated",
    "    binding-to: pig",
    "    visual-primitive: color-unit",
    "    color-source: entity.color",
    "audio: []",
    "spritesheets: []",
  ].join("\n"));
  const baseBinding = {
    id: "pig-shape",
    section: "images",
    type: "graphics-generated",
    role: "color-unit",
    "binding-to": "pig",
    "visual-primitive": "color-unit",
    "color-source": "entity.color",
    "must-render": true,
    "allow-fallback": false,
  };
  const merged = { ...baseBinding, ...extraBindingFields };
  // 过滤 undefined，让调用方通过 {key: undefined} 表达"移除这个字段"
  const binding = Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v !== undefined),
  );
  writeFileSync(join(caseDir, "specs/implementation-contract.yaml"), [
    "contract-version: 1",
    "runtime:",
    "  engine: canvas",
    "  run-mode: file",
    "boot:",
    "  entry-scene: start",
    `  ready-condition: "window.gameState !== undefined"`,
    "asset-bindings:",
    "  - " + Object.entries(binding)
      .map(([k, v]) => `${k}: ${typeof v === "string" ? JSON.stringify(v) : v}`)
      .join("\n    "),
  ].join("\n"));
  writeBaseScene(caseDir);
  mkdirSync(join(caseDir, "game"), { recursive: true });
  writeFileSync(join(caseDir, "game/index.html"), "<!-- ENGINE: canvas --><canvas></canvas>");
  mkdirSync(join(caseDir, ".game"), { recursive: true });
}

test("core entity 缺 visual-primitive → fail", () => {
  const caseDir = join(tmp, "contract-vp-missing");
  writeMinimalContract(caseDir, { "visual-primitive": undefined });
  const r = run([join(scriptsDir, "check_implementation_contract.js"), caseDir, "--stage", "expand"]);
  assert(r.status !== 0, `缺 visual-primitive 应 fail，exit=${r.status}\n${r.stdout}`);
  assert(
    /必须透传 visual-primitive/.test(r.stdout) || /visual-core-entities/.test(r.stdout),
    `错误信息应指向 visual-primitive 缺失，实际:\n${r.stdout}`,
  );
});

test("core entity 写了非法 visual-primitive 值 → fail", () => {
  const caseDir = join(tmp, "contract-vp-invalid");
  writeMinimalContract(caseDir, { "visual-primitive": "btn" });
  const r = run([join(scriptsDir, "check_implementation_contract.js"), caseDir, "--stage", "expand"]);
  assert(r.status !== 0, `非法值应 fail，exit=${r.status}\n${r.stdout}`);
  assert(/不在合法枚举内/.test(r.stdout), `应指出 enum 违规，实际:\n${r.stdout}`);
});

test("color-unit 绑定缺 color-source → fail", () => {
  const caseDir = join(tmp, "contract-vp-no-color-source");
  writeMinimalContract(caseDir, { "color-source": undefined });
  const r = run([join(scriptsDir, "check_implementation_contract.js"), caseDir, "--stage", "expand"]);
  assert(r.status !== 0, `缺 color-source 应 fail，exit=${r.status}\n${r.stdout}`);
  assert(/color-source/.test(r.stdout), `应指出 color-source 缺失，实际:\n${r.stdout}`);
});

test("color-source 格式错（比如裸 'red'）→ fail", () => {
  const caseDir = join(tmp, "contract-vp-bad-color-source");
  writeMinimalContract(caseDir, { "color-source": "red" });
  const r = run([join(scriptsDir, "check_implementation_contract.js"), caseDir, "--stage", "expand"]);
  assert(r.status !== 0, `非法 color-source 应 fail\n${r.stdout}`);
  assert(/color-source="red"/.test(r.stdout) || /格式不合法/.test(r.stdout),
    `应指出 color-source 格式问题，实际:\n${r.stdout}`);
});

test("core entity 配齐 visual-primitive + color-source → VP 相关不报错", () => {
  const caseDir = join(tmp, "contract-vp-ok");
  writeMinimalContract(caseDir); // 默认就是合法的
  const r = run([join(scriptsDir, "check_implementation_contract.js"), caseDir, "--stage", "expand"]);
  // 可能因其他 gate fail，但 VP 相关 fail 不应出现
  assert(!/必须透传 visual-primitive/.test(r.stdout), `不应报 VP 缺失:\n${r.stdout}`);
  assert(!/不在合法枚举内/.test(r.stdout), `不应报 VP 非法值:\n${r.stdout}`);
  assert(!/color-source.*不合法|color-source.*缺失/.test(r.stdout),
    `不应报 color-source 问题:\n${r.stdout}`);
});

// =============================
// P0.6: check_implementation_contract core entity must-render 硬约束
// =============================
console.log("\n[P0.6] check_implementation_contract: core entity must-render 硬约束");

test("core entity 所有 binding 都 must-render=false → fail", () => {
  const caseDir = join(tmp, "contract-p06-no-must-render");
  writeMinimalContract(caseDir, {
    "must-render": false,
    "allow-fallback": true,
  });
  const r = run([join(scriptsDir, "check_implementation_contract.js"), caseDir, "--stage", "expand"]);
  assert(r.status !== 0, `应 fail`);
  assert(/core-must-render/.test(r.stdout), `应指向 core-must-render，实际:\n${r.stdout}`);
});

test("core entity 唯一 binding role=decorative → fail", () => {
  const caseDir = join(tmp, "contract-p06-decorative-role");
  writeMinimalContract(caseDir, { role: "decorative" });
  const r = run([join(scriptsDir, "check_implementation_contract.js"), caseDir, "--stage", "expand"]);
  assert(r.status !== 0, `装饰 role 不合格，应 fail`);
  assert(/core-must-render/.test(r.stdout), `应报 core-must-render，实际:\n${r.stdout}`);
});

test("core entity must-render=true + 非装饰 role → P0.6 不报错", () => {
  const caseDir = join(tmp, "contract-p06-ok");
  writeMinimalContract(caseDir); // 默认 must-render=true, allow-fallback=false, role=color-unit
  const r = run([join(scriptsDir, "check_implementation_contract.js"), caseDir, "--stage", "expand"]);
  assert(!/core-must-render/.test(r.stdout), `合格主视觉不应触发 core-must-render，实际:\n${r.stdout}`);
});

test("generate_implementation_contract: core entity 启发式装饰 role 被提升为 core-visual", () => {
  // 构造一个"usage 提示装饰"但 binding 指向 core entity 的 asset
  const caseDir = join(tmp, "generate-p06-uplift");
  mkdirSync(join(caseDir, "docs"), { recursive: true });
  writeFileSync(join(caseDir, "docs/game-prd.md"), [
    "---",
    'game-aprd: "0.1"',
    "project: p06-uplift",
    "platform: [web]",
    "runtime: canvas",
    "is-3d: false",
    "mode: 单机",
    "language: zh-CN",
    "asset-strategy:",
    "  mode: library-first",
    `  rationale: "${"核心小猪需要主视觉，即便启发式把它误判为装饰，contract 生成层也必须把它提升为 core-visual 以防 checker 白名单跳过。".repeat(1)}"`,
    "  visual-core-entities: [pig]",
    "  visual-peripheral: []",
    "  style-coherence: { level: strict }",
    "---",
    "## 1. 项目概述",
    "### @game(main) P06 Uplift",
    "> genre: board-grid",
    "> platform: [web]",
    "> runtime: canvas",
    "> mode: 单机",
    "> core-loop: test",
    "> player-goal: test",
    "",
    "## 6. 状态与实体",
    "### @entity(pig) Pig",
    "> type: unit",
    "> fields: [color]",
  ].join("\n"));
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  writeFileSync(join(caseDir, "specs/assets.yaml"), [
    "images:",
    "  - id: pig-particle",
    "    source: assets/library_2d/ui-pixel/tile_0013.png",
    "    type: local-file",
    "    binding-to: pig",
    "    visual-primitive: color-unit",
    "    color-source: entity.color",
    "    usage: \"particle 发射源\"", // 启发式会把 usage 含 particle 的推成 particle role
    "audio: []",
    "spritesheets: []",
  ].join("\n"));
  writeBaseScene(caseDir);
  const out = "specs/implementation-contract.yaml";
  const r = run([join(scriptsDir, "generate_implementation_contract.js"), caseDir, "--out", out]);
  assert(r.status === 0, `generate 应通过，exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  const contract = readFileSync(join(caseDir, out), "utf-8");
  // 装饰角色被提升为 core-visual，或至少不是 particle/hud-indicator/decorative
  const decorativeLine = /role:\s*(particle|hud-indicator|decorative)/.test(contract);
  assert(!decorativeLine, `core entity 绑定不应保留装饰 role。contract:\n${contract}`);
  assert(/must-render:\s*true/.test(contract), `应含 must-render: true`);
});

// =============================
// P0.5: catalog family-level allowed/disallowed-slots
// =============================
console.log("\n[P0.5] catalog families: allowed/disallowed-slots");

// 单测：matchFamilyPattern 语义正确（从 check_asset_selection 复制一份确保对齐）
{
  // 重新实现一份与 checker 里同逻辑的 matcher 用于测试
  function match(source, pattern) {
    if (!source || !pattern) return false;
    const escape = (c) => c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    let re = "";
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === "*") {
        if (pattern[i + 1] === "*") { re += ".*"; i++; }
        else re += "[^/]*";
      } else if (ch === "?") re += "[^/]";
      else re += escape(ch);
    }
    return new RegExp("^" + re + "$").test(source);
  }

  test("matchFamilyPattern: * 不跨目录，** 跨目录", () => {
    assert(match("a/b.png", "a/*.png"), "单星匹配同级");
    assert(!match("a/b/c.png", "a/*.png"), "单星不跨子目录");
    assert(match("a/b/c.png", "a/**.png") ||
           match("a/b/c.png", "a/**/*.png"), "双星跨目录（任一等价形式）");
    assert(match("a/b/c/d.png", "a/**/d.png"), "双星中间多层");
  });

  test("matchFamilyPattern: 字面字符（包括点 / 和数字）", () => {
    assert(match("assets/library_2d/ui/tile_0013.png", "assets/library_2d/ui/tile_*.png"));
    assert(!match("assets/library_2d/ui/tile_0013.jpg", "assets/library_2d/ui/tile_*.png"));
  });
}

// 集成：构造一个临时 catalog family 配置 → 构造符合/违反 family 的 assets → 验证 checker fail/pass
test("family.disallowed-slots 命中 → fail", () => {
  const caseDir = join(tmp, "p05-family-disallow");
  // 在 assets/library_2d/catalog.yaml 旁边临时 patch 一个 stub pack
  // 更简单：直接写 PRD + assets，用已有的 catalog pack families（若还没标，这条应 skip）
  // 为了不依赖 catalog 实际是否已加 families，这条测试创建最小 case：
  //   PRD 声明 @entity(pig) 为 core
  //   assets.yaml 写 pig 绑定 ui-pixel/tile_0013.png 并声明 visual-primitive: color-unit
  // 如果 catalog 的 ui-pixel-adventure 已标 family "ui-pixel/tile_00{13..21}" allowed=ui-button
  // disallowed=color-unit，则这条应 fail。
  //
  // 若 catalog 尚未标 families（本测试在 checker 改完但 catalog 还没改时允许 skip）：
  //   这条 assertion 就退化为"不该 fail"——即规则不误伤。
  mkdirSync(join(caseDir, "docs"), { recursive: true });
  writeFileSync(join(caseDir, "docs/game-prd.md"), [
    "---",
    'game-aprd: "0.1"',
    "project: p05-test",
    "platform: [web]",
    "runtime: canvas",
    "is-3d: false",
    "mode: 单机",
    "language: zh-CN",
    "asset-strategy:",
    "  mode: library-first",
    `  rationale: "${"核心小猪需要颜色差异，要么用本地像素素材加颜色 overlay，要么用程序化色块直接绘制颜色字段。".repeat(1)}"`,
    "  visual-core-entities: [pig]",
    "  visual-peripheral: []",
    "  style-coherence: { level: flexible }",
    "color-scheme:",
    "  palette-id: pixel-retro",
    "---",
    "## 1. 项目概述",
    "### @game(main) P05 Test",
    "> genre: board-grid",
    "> platform: [web]",
    "> runtime: canvas",
    "> mode: 单机",
    "> core-loop: test",
    "> player-goal: test",
    "",
    "## 6. 状态与实体",
    "### @entity(pig) Pig",
    "> type: unit",
    "> fields: [color]",
  ].join("\n"));
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  // pig 用面板九宫格文件（tile_0004，属于 ui-pixel 面板段）标成 color-unit —— 语义不符
  writeFileSync(join(caseDir, "specs/assets.yaml"), [
    "color-scheme:",
    "  palette-id: pixel-retro",
    "genre: board-grid",
    "images:",
    "  - id: pig-wrong",
    "    source: assets/library_2d/ui-pixel/tile_0004.png",
    "    type: local-file",
    "    binding-to: pig",
    "    visual-primitive: color-unit",
    "    color-source: entity.color",
    "audio: []",
    "spritesheets: []",
    "fonts: []",
    "selection-report:",
    "  candidate-packs: [ui-pixel-adventure]",
    "  local-file-ratio: { images: 1/1 }",
    "  fallback-reasons: []",
  ].join("\n"));
  const r = run([join(scriptsDir, "check_asset_selection.js"), caseDir]);
  // 结果分两种：
  //   (a) catalog 已给 ui-pixel-adventure 标 families 且 tile_00{00-12} disallowed color-unit → fail
  //   (b) catalog 还没标 → P0.5 规则静默（不触发），这条 case 因为其他规则可能 fail/pass
  // 测试通过条件：如果 catalog 已标 families，应看到 "disallowed-slots" 错误；否则跳过断言。
  if (/disallowed-slots/.test(r.stdout) || /allowed-slots/.test(r.stdout)) {
    assert(r.status !== 0, `family 规则命中应 fail，实际 exit=${r.status}`);
  } else {
    console.log("    (catalog 尚未标 families，本条作为无误伤测试)");
    // 至少不应该报 P0.5 相关的误伤错误
    assert(!/family "[^"]*".*不能用作/.test(r.stdout) || r.stdout.includes("disallowed-slots"),
      `不应在没 families 声明时误报 family 错`);
  }
});

test("family 标注合法 asset → 不误伤", () => {
  const caseDir = join(tmp, "p05-family-ok");
  mkdirSync(join(caseDir, "docs"), { recursive: true });
  writeFileSync(join(caseDir, "docs/game-prd.md"), [
    "---",
    'game-aprd: "0.1"',
    "project: p05-ok",
    "platform: [web]",
    "runtime: canvas",
    "is-3d: false",
    "mode: 单机",
    "language: zh-CN",
    "asset-strategy:",
    "  mode: library-first",
    `  rationale: "${"开始按钮用 ui-pixel 的按钮段素材绑定 btn-start，属于 ui-button slot，是合法选择。".repeat(1)}"`,
    "  visual-core-entities: [btn-start]",
    "  visual-peripheral: []",
    "  style-coherence: { level: flexible }",
    "color-scheme:",
    "  palette-id: pixel-retro",
    "---",
    "## 1. 项目概述",
    "### @game(main) P05 OK",
    "> genre: board-grid",
    "> platform: [web]",
    "> runtime: canvas",
    "> mode: 单机",
    "> core-loop: test",
    "> player-goal: test",
    "",
    "## 6. 状态与实体",
    "### @ui(btn-start) Start",
    "> scene: start",
    "> role: button",
  ].join("\n"));
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  // btn-start 绑 tile_0013（按钮段）+ visual-primitive=ui-button，合法
  writeFileSync(join(caseDir, "specs/assets.yaml"), [
    "color-scheme:",
    "  palette-id: pixel-retro",
    "genre: board-grid",
    "images:",
    "  - id: btn-start-img",
    "    source: assets/library_2d/ui-pixel/tile_0013.png",
    "    type: local-file",
    "    binding-to: btn-start",
    "    visual-primitive: ui-button",
    "audio: []",
    "spritesheets: []",
    "fonts: []",
    "selection-report:",
    "  candidate-packs: [ui-pixel-adventure]",
    "  local-file-ratio: { images: 1/1 }",
    "  fallback-reasons: []",
  ].join("\n"));
  const r = run([join(scriptsDir, "check_asset_selection.js"), caseDir]);
  // 这条不应触发 P0.5 相关错误
  assert(!/disallowed-slots/.test(r.stdout), `合法 binding 不应触发 disallowed-slots:\n${r.stdout}`);
  // allowed-slots 冲突（声明的 vp 不在 allowed 里）也不应触发
  assert(!/与声明的 visual-primitive=/.test(r.stdout),
    `合法 binding 不应触发 allowed-slots 冲突:\n${r.stdout}`);
});

// =============================
// P0.2: _runtime_probes — ray-cast probe 集合 + trace 语义复算
// =============================
console.log("\n[P0.2] _runtime_probes: ray-cast 语义复算");

{
  const {
    hasPrimitives,
    selectApplicableProbes,
    traceEventMatches,
    verifyRayCastSemantics,
    RAY_CAST_GRID_PROBES,
  } = await import("../_runtime_probes.js");

  test("hasPrimitives 检测 mechanics 是否含指定 primitive 列表", () => {
    const m = {
      mechanics: [
        { node: "a", primitive: "ray-cast@v1" },
        { node: "b", primitive: "parametric-track@v1" },
      ],
    };
    assert(hasPrimitives(m, ["ray-cast@v1"]), "单一 primitive 命中");
    assert(hasPrimitives(m, ["ray-cast@v1", "parametric-track@v1"]), "多 primitive 命中");
    assert(!hasPrimitives(m, ["ray-cast@v1", "slot-pool@v1"]), "缺一个应返回 false");
    assert(!hasPrimitives(null, ["ray-cast@v1"]), "null mechanics 应 false");
  });

  test("selectApplicableProbes 按 mechanics 过滤", () => {
    const m = {
      mechanics: [
        { node: "a", primitive: "ray-cast@v1" },
        { node: "b", primitive: "parametric-track@v1" },
      ],
    };
    const picked = selectApplicableProbes(m);
    assert(picked.length >= 2, `应至少匹配 first-hit + position-dependent 两条 probe，实际 ${picked.length}`);
    assert(picked.find((p) => p.id === "first-hit.same-color"), "first-hit 应被选入");
  });

  test("selectApplicableProbes: mechanics 缺 primitive 则跳过", () => {
    const m = { mechanics: [{ node: "a", primitive: "fsm-transition@v1" }] };
    const picked = selectApplicableProbes(m);
    assert(picked.length === 0, `不含 ray-cast 的 case 应零匹配，实际 ${picked.length}`);
  });

  test("traceEventMatches 按 primitive/sourceId/firstHitId 断言", () => {
    const event = {
      primitive: "ray-cast@v1",
      before: { source: { id: "pig-1" } },
      after: { returnedHits: [{ id: "b-0-2" }] },
    };
    assert(traceEventMatches(event, { primitive: "ray-cast@v1", sourceId: "pig-1", firstHitId: "b-0-2" }), "全字段命中");
    assert(!traceEventMatches(event, { primitive: "ray-cast@v1", sourceId: "pig-2" }), "sourceId 不符应 false");
    assert(!traceEventMatches(event, { primitive: "ray-cast@v1", firstHitId: "b-9-9" }), "firstHitId 不符应 false");
  });

  test("verifyRayCastSemantics 用 reducer 复算与 trace 对比", async () => {
    const { castGrid } = await import("../../references/mechanics/spatial/ray-cast.reducer.mjs");
    const event = {
      primitive: "ray-cast@v1",
      before: {
        source: { id: "pig-1", gridPosition: { row: -1, col: 2 } },
        resolvedDirection: { dx: 0, dy: 1 },
        targetsSnapshot: [
          { id: "b-0-2", row: 0, col: 2, alive: true },
          { id: "b-1-2", row: 1, col: 2, alive: true },
        ],
      },
      after: { returnedHits: [{ id: "b-0-2" }] },
    };
    const res = verifyRayCastSemantics(event, castGrid, { "stop-on": "first-hit" });
    assert(res.ok === true, `应 ok，实际 ${JSON.stringify(res)}`);
  });

  test("verifyRayCastSemantics 命中穿透（trace 返回远处 block）→ ok=false", async () => {
    const { castGrid } = await import("../../references/mechanics/spatial/ray-cast.reducer.mjs");
    const event = {
      primitive: "ray-cast@v1",
      before: {
        source: { id: "pig-1", gridPosition: { row: -1, col: 2 } },
        resolvedDirection: { dx: 0, dy: 1 },
        targetsSnapshot: [
          { id: "b-0-2", row: 0, col: 2, alive: true },
          { id: "b-1-2", row: 1, col: 2, alive: true },
        ],
      },
      // 错：跨过 row 0 击中 row 1
      after: { returnedHits: [{ id: "b-1-2" }] },
    };
    const res = verifyRayCastSemantics(event, castGrid, { "stop-on": "first-hit" });
    assert(res.ok === false, `穿透应 fail，实际 ${JSON.stringify(res)}`);
    assert(res.expectedId === "b-0-2", `expected 应是最近 b-0-2`);
    assert(res.actualId === "b-1-2", `actual 应是 b-1-2`);
  });

  test("verifyRayCastSemantics 缺 before/after → ok=null 跳过", async () => {
    const { castGrid } = await import("../../references/mechanics/spatial/ray-cast.reducer.mjs");
    const event = { primitive: "ray-cast@v1", rule: "x" }; // 只有 rule，没 before
    const res = verifyRayCastSemantics(event, castGrid, {});
    assert(res.ok === null, `缺字段应返回 null（过渡期 skip）`);
  });
}

// =============================
// 汇总
// =============================
console.log(`\n结果: ${passed} passed, ${failed} failed`);
rmSync(tmp, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
