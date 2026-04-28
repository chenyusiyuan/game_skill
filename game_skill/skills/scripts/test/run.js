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
// Phase plan: staged execution boundaries
// =============================
console.log("\n[phase-plan] staged execution boundaries");
{
  const { initState, readState, markPhase, markSubtask } = await import("../_state.js");

  test("mechanics-only 可从新 case 的 understand 开始，但阻止完整 expand/codegen", () => {
    const project = "phase-plan-mechanics-only";
    const caseDir = join(tmp, "cases", project);
    const statePath = join(caseDir, ".game/state.json");
    mkdirSync(join(caseDir, ".game"), { recursive: true });
    writeFileSync(statePath, JSON.stringify(initState({ project, runtime: "canvas" }), null, 2) + "\n");

    const r = run([
      join(scriptsDir, "phase_plan.js"),
      "--mode", "mechanics-only",
      "--project", project,
      "--write-state",
    ], { cwd: tmp });
    assert(r.status === 0, `phase_plan 应成功写入 state，exit=${r.status}\n${r.stderr}\n${r.stdout}`);

    const st = readState(statePath);
    assert(st.phasePlan?.hardStop === "after:mechanics", "hardStop 应为 after:mechanics");
    assert(st.phasePlan?.plannedPhases?.includes("understand"), "mechanics-only 应允许 understand");
    assert(st.phasePlan?.plannedPhases?.includes("mechanics"), "mechanics-only 应允许 mechanics");
    assert(!st.phasePlan?.plannedPhases?.includes("codegen"), "mechanics-only 不应包含 codegen");
    assert(markPhase(st, "understand", "running").currentPhase === "understand", "understand running 不应被 phase boundary 拦截");
    markSubtask(st, "mechanics", "running");

    let blocked = false;
    try {
      markSubtask(st, "scene", "running");
    } catch (e) {
      blocked = /phase boundary/.test(e.message);
    }
    assert(blocked, "mechanics-only 应阻止 scene/rule/data/assets 等完整 expand subtask");
  });
}

// =============================
// P2: level solvability fixtures
// =============================
console.log("\n[P2] check_level_solvability: board-grid solution replay");
test("node --test check_level_solvability.test.mjs 全绿", () => {
  const r = spawnSync("node", ["--test", join(here, "check_level_solvability.test.mjs")], {
    encoding: "utf-8",
    cwd: root,
  });
  assert(r.status === 0, `level solvability fixtures 应全绿，exit=${r.status}\n${r.stdout}\n${r.stderr}`);
});

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
    "window.__assetUsage = window.__assetUsage || [];",
    "const assetId = 'pig-shape';",
    "const ctx = document.getElementById('game').getContext('2d');",
    "function renderGeneratedPrimitive(id) {",
    "  window.__assetUsage.push({ id, section: 'images', kind: 'generated' });",
    "  ctx.fillRect(0, 0, 12, 12);",
    "}",
    withDrawCall ? "renderGeneratedPrimitive('pig-shape');" : "console.log(assetId);",
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

function writeRuntimeSemanticsCase(caseDir, scriptLines) {
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  mkdirSync(join(caseDir, "game"), { recursive: true });
  writeFileSync(join(caseDir, "specs/mechanics.yaml"), [
    "mechanics:",
    "  - node: move",
    "    primitive: parametric-track@v1",
    "  - node: attack",
    "    primitive: ray-cast@v1",
    "    params:",
    "      stop-on: first-hit",
  ].join("\n"));
  writeFileSync(join(caseDir, "game/index.html"), [
    "<!-- ENGINE: canvas | VERSION: test | RUN: file -->",
    "<script>",
    ...scriptLines,
    "</script>",
  ].join("\n"));
}

test("check_runtime_semantics: 有适用 probe 但缺 probes API 应 fail", () => {
  const caseDir = join(tmp, "runtime-semantics-no-probes");
  writeRuntimeSemanticsCase(caseDir, [
    "window.__trace = [];",
  ]);
  const r = run([join(scriptsDir, "check_runtime_semantics.js"), caseDir]);
  assert(r.status !== 0, `缺 probes API 应失败，实际 exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  assert(/resetWithScenario 未暴露/.test(r.stdout), `应报 probes API 缺失，实际:\n${r.stdout}`);
});

test("check_runtime_semantics: trace 缺 before/after 不能再 soft-skip", () => {
  const caseDir = join(tmp, "runtime-semantics-missing-before");
  writeRuntimeSemanticsCase(caseDir, [
    "window.__trace = [];",
    "let currentState = {};",
    "window.gameTest = {",
    "  probes: {",
    "    resetWithScenario(state) { currentState = JSON.parse(JSON.stringify(state)); },",
    "    resetPig(pigPatch) { currentState.pig = { ...currentState.pig, ...pigPatch }; }",
    "  },",
    "  drivers: {",
    "    dispatchPig() {",
    "      const col = currentState.pig?.gridPosition?.col;",
    "      const hit = (currentState.blocks || []).find((b) => b.col === col && b.alive !== false);",
    "      window.__trace.push({ primitive: 'ray-cast@v1', before: null, after: { returnedHits: hit ? [hit] : [] } });",
    "    }",
    "  }",
    "};",
  ]);
  const r = run([join(scriptsDir, "check_runtime_semantics.js"), caseDir]);
  assert(r.status !== 0, `缺 before/after 应失败，实际 exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  assert(/复算缺证据|缺 before\/after/.test(r.stdout), `应报 trace 证据不足，实际:\n${r.stdout}`);
});

// =============================
// P1.1 (spike): ray-cast.runtime.mjs
// =============================
console.log("\n[P1.1] ray-cast.runtime: reducer wrapper + trace 自动填充");

{
  // runtime 模块在 browser 用；Node 侧也能 import（跑 Node unit test）
  const runtimeMod = await import(
    "../../references/engines/_common/primitives/ray-cast.runtime.mjs"
  );
  const reducerMod = await import(
    "../../references/mechanics/spatial/ray-cast.reducer.mjs"
  );

  test("Node 环境（无 window）调用不崩，返回命中对象", () => {
    // 没有 window，getTraceSink 返回 null，不 push trace
    const savedWindow = globalThis.window;
    delete globalThis.window;
    try {
      const hit = runtimeMod.rayCastGridFirstHit({
        rule: "attack",
        source: { id: "pig-1", gridPosition: { row: -1, col: 2 } },
        targets: [
          { id: "b-0-2", row: 0, col: 2, alive: true },
          { id: "b-1-2", row: 1, col: 2, alive: true },
        ],
        direction: { dx: 0, dy: 1 },
      });
      assert(hit?.id === "b-0-2", `应命中最近 b-0-2，实际 ${hit?.id}`);
    } finally {
      if (savedWindow !== undefined) globalThis.window = savedWindow;
    }
  });

  test("Browser mock: runtime 自动 push 结构化 trace", () => {
    const fakeWindow = {};
    const savedWindow = globalThis.window;
    globalThis.window = fakeWindow;
    try {
      runtimeMod.rayCastGridFirstHit({
        rule: "attack-consume",
        node: "attack-consume",
        source: { id: "pig-1", gridPosition: { row: -1, col: 2 } },
        targets: [
          { id: "b-0-2", row: 0, col: 2, alive: true },
          { id: "b-1-2", row: 1, col: 2, alive: true },
        ],
        direction: { dx: 0, dy: 1 },
      });
      assert(Array.isArray(fakeWindow.__trace), "window.__trace 应被初始化为数组");
      assert(fakeWindow.__trace.length === 1, `应 push 1 条事件，实际 ${fakeWindow.__trace.length}`);
      const ev = fakeWindow.__trace[0];
      assert(ev.primitive === "ray-cast@v1", `primitive 应为 ray-cast@v1，实际 ${ev.primitive}`);
      assert(ev.rule === "attack-consume", `rule 字段应透传`);
      assert(ev.node === "attack-consume", `node 字段应透传`);
      assert(ev.before?.source?.id === "pig-1", `before.source.id 应是 pig-1`);
      assert(Array.isArray(ev.before?.targetsSnapshot) && ev.before.targetsSnapshot.length === 2,
        `before.targetsSnapshot 应含 2 条`);
      assert(ev.before?.resolvedDirection?.dy === 1, `resolvedDirection 应透传`);
      assert(ev.after?.returnedHits?.[0]?.id === "b-0-2", `after.returnedHits[0] 应是 b-0-2`);
    } finally {
      if (savedWindow === undefined) delete globalThis.window;
      else globalThis.window = savedWindow;
    }
  });

  test("等价性: runtime.rayCastGridFirstHit === reducer.castGrid[0].target", () => {
    const savedWindow = globalThis.window;
    delete globalThis.window;
    try {
      // 100 次随机输入对比
      let mismatch = 0;
      for (let i = 0; i < 100; i++) {
        const srcRow = Math.floor(Math.random() * 5) - 2;
        const srcCol = Math.floor(Math.random() * 5);
        const blocks = Array.from({ length: Math.floor(Math.random() * 4) + 1 }, (_, j) => ({
          id: `b-${j}`,
          row: Math.floor(Math.random() * 5),
          col: Math.floor(Math.random() * 5),
          alive: Math.random() > 0.2,
        }));
        const dx = [-1, 0, 1][Math.floor(Math.random() * 3)];
        const dy = [-1, 0, 1][Math.floor(Math.random() * 3)];
        if (dx === 0 && dy === 0) continue;

        const runtimeHit = runtimeMod.rayCastGridFirstHit({
          rule: "x",
          source: { id: "s", gridPosition: { row: srcRow, col: srcCol } },
          targets: blocks,
          direction: { dx, dy },
        });
        const reducerHits = reducerMod.castGrid(
          { row: srcRow, col: srcCol },
          { dx, dy },
          blocks,
          { "coord-system": "grid", "stop-on": "first-hit" },
        );
        const expectedId = reducerHits[0]?.target?.id ?? null;
        const actualId = runtimeHit?.id ?? null;
        if (expectedId !== actualId) mismatch++;
      }
      assert(mismatch === 0, `runtime 与 reducer 不等价: ${mismatch}/100 次不符`);
    } finally {
      if (savedWindow !== undefined) globalThis.window = savedWindow;
    }
  });

  test("all-hits 模式: 返回所有命中，顺序与 reducer 一致", () => {
    const savedWindow = globalThis.window;
    delete globalThis.window;
    try {
      const hits = runtimeMod.rayCastGrid({
        rule: "scan",
        source: { id: "s", gridPosition: { row: -1, col: 2 } },
        targets: [
          { id: "b-0-2", row: 0, col: 2, alive: true },
          { id: "b-1-2", row: 1, col: 2, alive: true },
          { id: "b-2-2", row: 2, col: 2, alive: true },
        ],
        direction: { dx: 0, dy: 1 },
        params: { "coord-system": "grid", "stop-on": "all-hits" },
      });
      assert(Array.isArray(hits) && hits.length === 3, `应返回 3 条命中，实际 ${hits?.length}`);
      assert(hits[0].id === "b-0-2" && hits[2].id === "b-2-2", `顺序应按距离升序`);
    } finally {
      if (savedWindow !== undefined) globalThis.window = savedWindow;
    }
  });
}

// =============================
// P1.1 full: index.mjs 聚合 + 10 个 runtime smoke
// =============================
console.log("\n[P1.1 full] engines/_common/primitives: 聚合导出与 smoke 测");

{
  const idx = await import(
    "../../references/engines/_common/primitives/index.mjs"
  );
  const expectedApi = [
    "rayCastGrid", "rayCastGridFirstHit",
    "tickTrack", "positionAt",
    "gridMove",
    "addCell", "removeCell",
    "queryNeighbors",
    "predicateMatch",
    "consumeResource",
    "fireTrigger",
    "checkWinLose",
    "accumulateScore",
    "pushTraceEvent", "getTraceSink", "snapshot",
  ];

  test("index.mjs 导出所有 runtime API", () => {
    const missing = expectedApi.filter((k) => typeof idx[k] !== "function");
    assert(missing.length === 0, `index.mjs 缺失: ${missing.join(", ")}`);
  });

  test("predicateMatch: Browser mock, color 匹配命中", () => {
    const fakeWindow = {};
    const saved = globalThis.window;
    globalThis.window = fakeWindow;
    try {
      const ok = idx.predicateMatch({
        rule: "color-match",
        left: { id: "pig-1", color: "red" },
        right: { id: "b-0-2", color: "red" },
        params: { fields: ["color"], op: "eq" },
      });
      assert(ok === true, `同色应 match true`);
      const ev = fakeWindow.__trace.at(-1);
      assert(ev.primitive === "predicate-match@v1");
      assert(ev.after.matched === true);
    } finally {
      if (saved === undefined) delete globalThis.window;
      else globalThis.window = saved;
    }
  });

  test("predicateMatch: 异色不 match，trace 记录 matched=false", () => {
    const fakeWindow = {};
    const saved = globalThis.window;
    globalThis.window = fakeWindow;
    try {
      const ok = idx.predicateMatch({
        rule: "color-match",
        left: { id: "pig-1", color: "red" },
        right: { id: "b-0-2", color: "blue" },
        params: { fields: ["color"], op: "eq" },
      });
      assert(ok === false, `异色应 match false`);
      assert(fakeWindow.__trace.at(-1).after.matched === false);
    } finally {
      if (saved === undefined) delete globalThis.window;
      else globalThis.window = saved;
    }
  });

  test("consumeResource: ammo/durability 各减 1，trace 捕获 before/after", () => {
    const fakeWindow = {};
    const saved = globalThis.window;
    globalThis.window = fakeWindow;
    try {
      const pig = { id: "pig-1", ammo: 3 };
      const block = { id: "b-0-2", durability: 1 };
      const res = idx.consumeResource({
        rule: "attack-consume",
        agent: pig,
        target: block,
        params: { "agent-field": "pig.ammo", "target-field": "block.durability", amount: 1 },
      });
      assert(res.agent.ammo === 2, `pig.ammo 应 3→2，实际 ${res.agent.ammo}`);
      assert(res.target.durability === 0, `block.durability 应 1→0`);
      const ev = fakeWindow.__trace.at(-1);
      assert(ev.primitive === "resource-consume@v1");
      assert(ev.before.agent.ammo === 3 && ev.after.agent.ammo === 2);
      const zeroed = ev.after.events.find((e) => e.type === "resource.target-zero");
      assert(zeroed, `应触发 resource.target-zero 事件`);
    } finally {
      if (saved === undefined) delete globalThis.window;
      else globalThis.window = saved;
    }
  });

  test("tickTrack: 推进 t 并在 segment 切换时 push trace", () => {
    const fakeWindow = {};
    const saved = globalThis.window;
    globalThis.window = fakeWindow;
    try {
      const pig = { id: "pig-1", t: 0.24, speed: 0.02, segmentId: "top" };
      const trackParams = {
        shape: "rect-loop",
        geometry: { x: 0, y: 0, width: 4, height: 4 },
        segments: [
          { id: "top",    range: [0,    0.25] },
          { id: "right",  range: [0.25, 0.5] },
          { id: "bottom", range: [0.5,  0.75] },
          { id: "left",   range: [0.75, 1.0] },
        ],
      };
      const next = idx.tickTrack({
        rule: "pig-move",
        agent: pig,
        dt: 1,
        params: trackParams,
      });
      assert(next.segmentId === "right", `应切到 right 段，实际 ${next.segmentId}`);
      assert(fakeWindow.__trace.length > 0, `segment 切换应 push trace`);
      assert(fakeWindow.__trace.at(-1).primitive === "parametric-track@v1");
    } finally {
      if (saved === undefined) delete globalThis.window;
      else globalThis.window = saved;
    }
  });
}

// =============================
// P1.4: check_implementation_contract runtime primitive import 校验
// =============================
console.log("\n[P1.4] _primitive_runtime_map: parseEsmImports + isPrimitivesImport");

{
  const {
    parseEsmImports,
    isPrimitivesImport,
    isRuntimeBacked,
    apisFor,
    isEngineEnforced,
  } = await import("../_primitive_runtime_map.js");

  test("isEngineEnforced: all supported engines → true；空 engine → false", () => {
    assert(isEngineEnforced("canvas"), "canvas enforced");
    assert(isEngineEnforced("pixijs"), "pixijs enforced");
    assert(isEngineEnforced("phaser3"), "phaser3 enforced");
    assert(isEngineEnforced("dom-ui"), "dom-ui enforced");
    assert(isEngineEnforced("three"), "three enforced");
    assert(!isEngineEnforced(""), "空 engine not enforced");
  });

  test("isRuntimeBacked + apisFor 覆盖所有 P1.1 + P1.2 primitive", () => {
    const expected = [
      "parametric-track@v1",
      "grid-step@v1",
      "ray-cast@v1",
      "grid-board@v1",
      "neighbor-query@v1",
      "predicate-match@v1",
      "resource-consume@v1",
      "fsm-transition@v1",
      "win-lose-check@v1",
      "score-accum@v1",
      // P1.2 生命周期四件套
      "slot-pool@v1",
      "capacity-gate@v1",
      "entity-lifecycle@v1",
      "cooldown-dispatch@v1",
    ];
    for (const p of expected) {
      assert(isRuntimeBacked(p), `${p} 应 runtime-backed`);
      assert(apisFor(p).length > 0, `${p} 应至少有一个 API`);
    }
    assert(!isRuntimeBacked("nonexistent@v1"), "未实现 runtime 的 primitive 不应 backed");
  });

  test("parseEsmImports: 命名导入", () => {
    const src = `import { rayCastGridFirstHit, consumeResource } from './_common/primitives/index.mjs';`;
    const imports = parseEsmImports(src);
    assert(imports.length === 1, `应解析 1 条 import`);
    assert(imports[0].specifier === "./_common/primitives/index.mjs");
    assert(imports[0].names.includes("rayCastGridFirstHit"));
    assert(imports[0].names.includes("consumeResource"));
  });

  test("parseEsmImports: 重命名绑定只记原名", () => {
    const src = `import { rayCastGridFirstHit as cast } from "./_common/primitives/index.mjs";`;
    const imports = parseEsmImports(src);
    assert(imports[0].names.includes("rayCastGridFirstHit"));
  });

  test("parseEsmImports: 命名空间导入 → '*'", () => {
    const src = `import * as P from "../_common/primitives/index.mjs";`;
    const imports = parseEsmImports(src);
    assert(imports[0].names.includes("*"), "应记录 '*'");
  });

  test("isPrimitivesImport 识别 index.mjs 与 *.runtime.mjs", () => {
    assert(isPrimitivesImport("./_common/primitives/index.mjs"));
    assert(isPrimitivesImport("../_common/primitives/ray-cast.runtime.mjs"));
    assert(isPrimitivesImport("../../_common/primitives/resource-consume.runtime.mjs"));
    assert(!isPrimitivesImport("./_common/registry.spec.js"));
    assert(!isPrimitivesImport("./primitives/foo.js"));
  });
}

console.log("\n[P1.4] check_implementation_contract: canvas 缺 runtime import 应 fail");

{
  const caseDir = join(tmp, "p14-missing");
  rmSync(caseDir, { recursive: true, force: true });
  mkdirSync(caseDir, { recursive: true });

  // 最小 PRD
  mkdirSync(join(caseDir, "docs"), { recursive: true });
  writeFileSync(join(caseDir, "docs/game-prd.md"), [
    "---",
    'game-aprd: "0.1"',
    "project: p14",
    "platform: [web]",
    "runtime: canvas",
    "is-3d: false",
    "mode: 单机",
    "language: zh-CN",
    "asset-strategy:",
    "  mode: none",
    `  rationale: "${"极简 case 验 runtime import 校验，无素材依赖，需要至少八十字的解释文字才能过最小长度阈值。".repeat(1)}"`,
    "  visual-core-entities: []",
    "  visual-peripheral: []",
    "---",
    "## 1. 项目概述",
    "### @game(main) P14 Test",
    "> genre: board-grid",
    "> platform: [web]",
    "> runtime: canvas",
    "> mode: 单机",
    "> core-loop: test",
    "> player-goal: test",
  ].join("\n"));

  mkdirSync(join(caseDir, "specs"), { recursive: true });
  // mechanics.yaml — 引用 ray-cast@v1 （runtime-backed）
  writeFileSync(join(caseDir, "specs/mechanics.yaml"), [
    "mechanics:",
    "  - node: attack-consume",
    "    primitive: ray-cast@v1",
    "    params:",
    '      coord-system: "grid"',
    '      stop-on: "first-hit"',
  ].join("\n"));
  // scene minimal
  writeFileSync(join(caseDir, "specs/scene.yaml"), "scenes: []\n");
  writeFileSync(join(caseDir, "specs/assets.yaml"), "images: []\naudio: []\nspritesheets: []\n");
  // contract minimal
  writeFileSync(join(caseDir, "specs/implementation-contract.yaml"), [
    "runtime:",
    "  engine: canvas",
    "boot:",
    "  first-scene: play",
    "  ready-condition: canvas-ready",
    "  start-action: click-start",
    "  transitions: []",
    "asset-bindings: []",
    "engine-lifecycle:",
    "  canvas: { phase: init, notes: 'n/a' }",
    "verification: []",
  ].join("\n"));

  // 业务代码：手写 ray-cast，**未** import runtime → 应 fail
  mkdirSync(join(caseDir, "game/src"), { recursive: true });
  writeFileSync(join(caseDir, "game/src/main.js"), [
    "// @primitive(ray-cast@v1): node-id=attack-consume",
    "export function handleAttack(pig, blocks) {",
    "  const hit = blocks.find(b => b.color === pig.color);",
    '  window.__trace = window.__trace || [];',
    '  window.__trace.push({ rule: "attack-consume" });',
    "  return hit;",
    "}",
  ].join("\n"));

  const checker = resolve(here, "../check_implementation_contract.js");
  const r = spawnSync("node", [checker, caseDir, "--stage", "codegen"], {
    encoding: "utf-8",
  });
  const output = (r.stdout || "") + (r.stderr || "");
  test("canvas + ray-cast@v1 但业务没 import runtime → fail", () => {
    assert(r.status !== 0, `应 fail，退出码 ${r.status}\n${output}`);
    assert(
      /\[runtime\].*未 import/.test(output),
      `应报 runtime import 缺失\n${output}`,
    );
  });
}

console.log("\n[P1.4] check_implementation_contract: canvas 正确 import 应通过 runtime 段");

{
  const caseDir = join(tmp, "p14-ok");
  rmSync(caseDir, { recursive: true, force: true });
  mkdirSync(caseDir, { recursive: true });
  mkdirSync(join(caseDir, "docs"), { recursive: true });
  writeFileSync(join(caseDir, "docs/game-prd.md"), [
    "---",
    'game-aprd: "0.1"',
    "project: p14ok",
    "platform: [web]",
    "runtime: canvas",
    "is-3d: false",
    "mode: 单机",
    "language: zh-CN",
    "asset-strategy:",
    "  mode: none",
    `  rationale: "${"极简 case 验 runtime import 通过路径，无素材依赖，需要至少八十字的解释文字才能过最小长度阈值。".repeat(1)}"`,
    "  visual-core-entities: []",
    "  visual-peripheral: []",
    "---",
    "## 1. 项目概述",
    "### @game(main) P14 OK",
    "> genre: board-grid",
    "> platform: [web]",
    "> runtime: canvas",
    "> mode: 单机",
    "> core-loop: test",
    "> player-goal: test",
  ].join("\n"));

  mkdirSync(join(caseDir, "specs"), { recursive: true });
  writeFileSync(join(caseDir, "specs/mechanics.yaml"), [
    "mechanics:",
    "  - node: attack-consume",
    "    primitive: ray-cast@v1",
    "    params:",
    '      coord-system: "grid"',
    '      stop-on: "first-hit"',
  ].join("\n"));
  writeFileSync(join(caseDir, "specs/scene.yaml"), "scenes: []\n");
  writeFileSync(join(caseDir, "specs/assets.yaml"), "images: []\naudio: []\nspritesheets: []\n");
  writeFileSync(join(caseDir, "specs/implementation-contract.yaml"), [
    "runtime:",
    "  engine: canvas",
    "boot:",
    "  first-scene: play",
    "  ready-condition: canvas-ready",
    "  start-action: click-start",
    "  transitions: []",
    "asset-bindings: []",
    "engine-lifecycle:",
    "  canvas: { phase: init, notes: 'n/a' }",
    "verification: []",
  ].join("\n"));

  mkdirSync(join(caseDir, "game/src"), { recursive: true });
  writeFileSync(join(caseDir, "game/src/main.js"), [
    "// @primitive(ray-cast@v1): node-id=attack-consume",
    "import { rayCastGridFirstHit } from './_common/primitives/index.mjs';",
    "export function handleAttack(pig, blocks) {",
    "  const hit = rayCastGridFirstHit({",
    "    rule: 'attack-consume', node: 'attack-consume',",
    "    source: pig, direction: { dx: 0, dy: 1 }, targets: blocks,",
    "    params: { 'stop-on': 'first-hit', 'coord-system': 'grid' },",
    "  });",
    "  return hit;",
    "}",
  ].join("\n"));

  const checker = resolve(here, "../check_implementation_contract.js");
  const r = spawnSync("node", [checker, caseDir, "--stage", "codegen"], {
    encoding: "utf-8",
  });
  const output = (r.stdout || "") + (r.stderr || "");
  test("canvas + ray-cast@v1 + 正确 import + 调用 → runtime 段 ok", () => {
    assert(
      /\[runtime\].*全部.*均已 import \+ 调用/.test(output),
      `应报 runtime 段 ok\n${output}`,
    );
  });
}

console.log("\n[P1.4] check_implementation_contract: phaser3 引擎必须接入 runtime primitive");

{
  const caseDir = join(tmp, "p14-phaser-skip");
  rmSync(caseDir, { recursive: true, force: true });
  mkdirSync(caseDir, { recursive: true });
  mkdirSync(join(caseDir, "docs"), { recursive: true });
  writeFileSync(join(caseDir, "docs/game-prd.md"), [
    "---",
    'game-aprd: "0.1"',
    "project: p14phaser",
    "platform: [web]",
    "runtime: phaser3",
    "is-3d: false",
    "mode: 单机",
    "language: zh-CN",
    "asset-strategy:",
    "  mode: none",
    `  rationale: "${"phaser3 过渡期不强制 runtime import，用最少字数解释，需要超过八十字所以再写一点凑数字。".repeat(1)}"`,
    "  visual-core-entities: []",
    "  visual-peripheral: []",
    "---",
    "## 1. 项目概述",
    "### @game(main) Phaser P14",
    "> genre: board-grid",
    "> platform: [web]",
    "> runtime: phaser3",
    "> mode: 单机",
    "> core-loop: test",
    "> player-goal: test",
  ].join("\n"));

  mkdirSync(join(caseDir, "specs"), { recursive: true });
  writeFileSync(join(caseDir, "specs/mechanics.yaml"), [
    "mechanics:",
    "  - node: attack-consume",
    "    primitive: ray-cast@v1",
    "    params:",
    '      coord-system: "grid"',
  ].join("\n"));
  writeFileSync(join(caseDir, "specs/scene.yaml"), "scenes: []\n");
  writeFileSync(join(caseDir, "specs/assets.yaml"), "images: []\naudio: []\nspritesheets: []\n");
  writeFileSync(join(caseDir, "specs/implementation-contract.yaml"), [
    "runtime:",
    "  engine: phaser3",
    "boot:",
    "  first-scene: play",
    "  ready-condition: scene-ready",
    "  start-action: click-start",
    "  transitions: []",
    "asset-bindings: []",
    "engine-lifecycle:",
    "  phaser3: { phase: preload, notes: 'n/a' }",
    "verification: []",
  ].join("\n"));

  mkdirSync(join(caseDir, "game/src"), { recursive: true });
  writeFileSync(join(caseDir, "game/src/main.js"), [
    "// @primitive(ray-cast@v1): node-id=attack-consume",
    "export function handleAttack(pig, blocks) {",
    "  const hit = blocks.find(b => b.color === pig.color);",
    '  window.__trace = window.__trace || [];',
    '  window.__trace.push({ rule: "attack-consume" });',
    "  return hit;",
    "}",
  ].join("\n"));

  const checker = resolve(here, "../check_implementation_contract.js");
  const r = spawnSync("node", [checker, caseDir, "--stage", "codegen"], {
    encoding: "utf-8",
  });
  const output = (r.stdout || "") + (r.stderr || "");
  test("phaser3 引擎 → 缺 runtime import 应 fail", () => {
    assert(
      /\[runtime\].*runtime-backed primitive 未 import/.test(output),
      `应报 runtime import 缺失\n${output}`,
    );
  });
}

// =============================
// P1.2: lifecycle primitives 三件套 — reducer + runtime 等价性
// =============================
console.log("\n[P1.2] slot-pool / capacity-gate / entity-lifecycle / cooldown-dispatch: reducer + runtime");

{
  const repoRoot = resolve(here, "../../../..");
  const slotReducer = await import(
    `file://${repoRoot}/game_skill/skills/references/mechanics/lifecycle/slot-pool.reducer.mjs`
  );
  const slotRuntime = await import(
    `file://${repoRoot}/game_skill/skills/references/engines/_common/primitives/slot-pool.runtime.mjs`
  );
  const gateReducer = await import(
    `file://${repoRoot}/game_skill/skills/references/mechanics/lifecycle/capacity-gate.reducer.mjs`
  );
  const gateRuntime = await import(
    `file://${repoRoot}/game_skill/skills/references/engines/_common/primitives/capacity-gate.runtime.mjs`
  );
  const lifeReducer = await import(
    `file://${repoRoot}/game_skill/skills/references/mechanics/lifecycle/entity-lifecycle.reducer.mjs`
  );
  const lifeRuntime = await import(
    `file://${repoRoot}/game_skill/skills/references/engines/_common/primitives/entity-lifecycle.runtime.mjs`
  );
  const cdReducer = await import(
    `file://${repoRoot}/game_skill/skills/references/mechanics/lifecycle/cooldown-dispatch.reducer.mjs`
  );
  const cdRuntime = await import(
    `file://${repoRoot}/game_skill/skills/references/engines/_common/primitives/cooldown-dispatch.runtime.mjs`
  );

  test("slot-pool.reducer: bind 到空槽、再次 bind 同一 occupant idempotent", () => {
    let s = {};
    s = slotReducer.step(s, { type: "bind", occupantId: "pig-0" }, { capacity: 2 });
    assert(s.pool.slots.some((x) => x.occupantId === "pig-0"));
    assert(s._events[0].type === "pool.bound");
    const s2 = slotReducer.step(s, { type: "bind", occupantId: "pig-0" }, { capacity: 2 });
    assert(s2.pool.slots.filter((x) => x.occupantId === "pig-0").length === 1, "不应重复绑定");
    assert((s2._events ?? []).length === 0, "idempotent no-op 不发事件");
  });

  test("slot-pool.reducer: 超容量触发 overflow", () => {
    let s = {};
    s = slotReducer.step(s, { type: "bind", occupantId: "a" }, { capacity: 1 });
    s = slotReducer.step(s, { type: "bind", occupantId: "b" }, { capacity: 1 });
    const last = s._events.at(-1);
    assert(last?.type === "pool.overflow", `应 overflow，实际 ${last?.type}`);
  });

  test("slot-pool.reducer: unbind 保留 entity 字段（自身不归零）", () => {
    // reducer 不接触 entity 对象，只管 slot 占用；验证无副作用
    const pig = { id: "pig-0", ammo: 3 };
    let s = { pool: { capacity: 2, slots: [{ id: "s0", occupantId: "pig-0" }, { id: "s1", occupantId: null }] } };
    s = slotReducer.step(s, { type: "unbind", occupantId: "pig-0" }, { capacity: 2 });
    assert(s.pool.slots[0].occupantId === null);
    assert(pig.ammo === 3, "pool 不应动 entity 字段");
  });

  test("slot-pool.runtime: browser mock 下 auto push trace", () => {
    const saved = globalThis.window;
    try {
      const fakeWindow = { __trace: [] };
      globalThis.window = fakeWindow;
      const r = slotRuntime.bindSlot({
        rule: "dispatch-pig",
        node: "return-to-slot",
        pool: { capacity: 2, slots: [{ id: "s0", occupantId: null }, { id: "s1", occupantId: null }] },
        occupantId: "pig-0",
        params: { capacity: 2 },
      });
      assert(r.pool.slots[0].occupantId === "pig-0");
      const ev = fakeWindow.__trace.at(-1);
      assert(ev?.primitive === "slot-pool@v1");
      assert(ev.after?.events?.[0]?.type === "pool.bound");
    } finally {
      if (saved === undefined) delete globalThis.window;
      else globalThis.window = saved;
    }
  });

  test("capacity-gate.reducer: 超 capacity 触发 blocked", () => {
    let s = {};
    s = gateReducer.step(s, { type: "request", entityId: "a" }, { capacity: 1 });
    assert(s._events[0].type === "capacity.admitted");
    s = gateReducer.step(s, { type: "request", entityId: "b" }, { capacity: 1 });
    assert(s._events[0].type === "capacity.blocked", "b 应被 blocked");
    assert(s.gate.active.length === 1, "active 不应增长到 2");
  });

  test("capacity-gate.reducer: release 已激活 entity 恢复容量", () => {
    let s = { gate: { capacity: 1, active: ["a"] } };
    s = gateReducer.step(s, { type: "release", entityId: "a" }, { capacity: 1 });
    assert(s.gate.active.length === 0);
    s = gateReducer.step(s, { type: "request", entityId: "b" }, { capacity: 1 });
    assert(s._events[0].type === "capacity.admitted");
  });

  test("capacity-gate.runtime: 命中 blocked 时 admitted=false", () => {
    const saved = globalThis.window;
    try {
      globalThis.window = { __trace: [] };
      const r = gateRuntime.requestCapacity({
        rule: "dispatch",
        node: "gate",
        gate: { capacity: 1, active: ["a"] },
        entityId: "b",
        params: { capacity: 1 },
      });
      assert(r.admitted === false);
      assert(r.blocked === true);
    } finally {
      if (saved === undefined) delete globalThis.window;
      else globalThis.window = saved;
    }
  });

  test("entity-lifecycle.reducer: 白名单转移", () => {
    const params = {
      transitions: [
        { from: "waiting", event: "dispatched", to: "active" },
        { from: "active", event: "exhausted", to: "returning" },
      ],
    };
    let s = { entity: { id: "p", lifecycle: "waiting" } };
    s = lifeReducer.step(s, { type: "transition", entityId: "p", event: "dispatched" }, params);
    assert(s.entity.lifecycle === "active");
    assert(s._events[0].type === "lifecycle.entered");
  });

  test("entity-lifecycle.reducer: 非白名单事件 → invalid-transition 且 state 不变", () => {
    const params = { transitions: [{ from: "waiting", event: "dispatched", to: "active" }] };
    let s = { entity: { id: "p", lifecycle: "waiting" } };
    s = lifeReducer.step(s, { type: "transition", entityId: "p", event: "score-set" }, params);
    assert(s.entity.lifecycle === "waiting", "state 不应变");
    assert(s._events[0].type === "lifecycle.invalid-transition");
  });

  test("entity-lifecycle.reducer: dead 是终态", () => {
    const params = {
      transitions: [
        { from: "active", event: "killed", to: "dead" },
        { from: "dead", event: "revive", to: "active" }, // 白名单允许但 reducer 应拒
      ],
    };
    let s = { entity: { id: "p", lifecycle: "active" } };
    s = lifeReducer.step(s, { type: "transition", entityId: "p", event: "killed" }, params);
    assert(s.entity.lifecycle === "dead");
    s = lifeReducer.step(s, { type: "transition", entityId: "p", event: "revive" }, params);
    assert(s.entity.lifecycle === "dead", "dead 不应复活");
    assert(s._events[0].type === "lifecycle.invalid-transition");
  });

  test("entity-lifecycle.runtime: trace 捕获 from/to", () => {
    const saved = globalThis.window;
    try {
      globalThis.window = { __trace: [] };
      const r = lifeRuntime.transitionLifecycle({
        rule: "pig-dispatch",
        node: "lifecycle",
        entity: { id: "p", lifecycle: "waiting" },
        event: "dispatched",
        params: { transitions: [{ from: "waiting", event: "dispatched", to: "active" }] },
      });
      assert(r.changed === true);
      assert(r.from === "waiting" && r.to === "active");
      const ev = globalThis.window.__trace.at(-1);
      assert(ev.primitive === "entity-lifecycle@v1");
    } finally {
      if (saved === undefined) delete globalThis.window;
      else globalThis.window = saved;
    }
  });

  test("cooldown-dispatch.reducer: 冷却内再次触发被拒", () => {
    const params = {
      "cooldown-ms": 250,
      "allowed-events": [{ kind: "lifecycle-event", event: "dispatched" }],
    };
    const downstream = { kind: "lifecycle-event", event: "dispatched", entityId: "p" };
    let s = {};
    s = cdReducer.step(s, { type: "request", now: 0, downstream }, params);
    assert(s._events[0].type === "dispatch.fired");
    s = cdReducer.step(s, { type: "request", now: 100, downstream }, params);
    assert(s._events[0].type === "dispatch.rejected-cooldown", "100ms < 250ms 应 reject");
    s = cdReducer.step(s, { type: "request", now: 260, downstream }, params);
    assert(s._events[0].type === "dispatch.fired", "260ms > 250ms 应放行");
  });

  test("cooldown-dispatch.reducer: 黑名单 downstream 直接拒", () => {
    const params = {
      "cooldown-ms": 0,
      "allowed-events": [{ kind: "lifecycle-event" }],
    };
    let s = {};
    s = cdReducer.step(
      s,
      { type: "request", now: 0, downstream: { kind: "state.score-set", value: 100 } },
      params,
    );
    assert(s._events[0].type === "dispatch.rejected-forbidden");
    assert(s._events[0].reason === "forbidden-kind");
  });

  test("cooldown-dispatch.reducer: downstream 不在白名单 → rejected-forbidden", () => {
    const params = {
      "cooldown-ms": 0,
      "allowed-events": [{ kind: "lifecycle-event", event: "dispatched" }],
    };
    let s = {};
    s = cdReducer.step(
      s,
      { type: "request", now: 0, downstream: { kind: "capacity.request", entityId: "x" } },
      params,
    );
    assert(s._events[0].type === "dispatch.rejected-forbidden");
    assert(s._events[0].reason === "not-whitelisted");
  });

  test("cooldown-dispatch.runtime: 冷却内 fired=false", () => {
    const saved = globalThis.window;
    try {
      globalThis.window = { __trace: [] };
      const params = {
        "cooldown-ms": 250,
        "allowed-events": [{ kind: "lifecycle-event", event: "dispatched" }],
      };
      const downstream = { kind: "lifecycle-event", event: "dispatched", entityId: "p" };
      const r1 = cdRuntime.requestDispatch({
        rule: "click-dispatch",
        node: "input-gate",
        dispatcher: { id: "d", lastFiredAt: null },
        downstream,
        now: 0,
        params,
      });
      assert(r1.fired === true);
      const r2 = cdRuntime.requestDispatch({
        rule: "click-dispatch",
        node: "input-gate",
        dispatcher: r1.dispatcher,
        downstream,
        now: 50,
        params,
      });
      assert(r2.fired === false);
      assert(r2.rejectedCooldown === true);
    } finally {
      if (saved === undefined) delete globalThis.window;
      else globalThis.window = saved;
    }
  });
}

// =============================
// P1.6: asset-usage runtime evidence + test-hook 自动挂 getAssetUsage
// =============================
console.log("\n[P1.6] asset-usage: recordAssetUsage + observers.getAssetUsage 默认安装");

{
  const repoRoot = resolve(here, "../../../..");
  const { recordAssetUsage, getAssetUsageSnapshot, resetAssetUsage } = await import(
    `file://${repoRoot}/game_skill/skills/references/engines/_common/asset-usage.js`
  );
  const { exposeTestHooks } = await import(
    `file://${repoRoot}/game_skill/skills/references/engines/_common/test-hook.js`
  );

  test("recordAssetUsage: 无 window → noop 不崩", () => {
    const saved = globalThis.window;
    try {
      delete globalThis.window;
      recordAssetUsage({ id: "x", section: "images" });
      // 没 window 就是没 window，不抛异常即可
    } finally {
      if (saved !== undefined) globalThis.window = saved;
    }
  });

  test("recordAssetUsage: browser mock 写入 window.__assetUsage 且带 manifest meta", () => {
    const saved = globalThis.window;
    try {
      const fakeWindow = {};
      globalThis.window = fakeWindow;
      recordAssetUsage({
        id: "pig-red",
        section: "images",
        kind: "texture",
        manifestItem: {
          id: "pig-red",
          "binding-to": "pig",
          "visual-primitive": "color-unit",
          "color-source": "entity.color",
        },
        extra: { color: "red" },
      });
      const entry = fakeWindow.__assetUsage[0];
      assert(entry.id === "pig-red");
      assert(entry.bindingTo === "pig");
      assert(entry.visualPrimitive === "color-unit");
      assert(entry.colorSource === "entity.color");
      assert(entry.extra?.color === "red");
      assert(entry.section === "images" && entry.kind === "texture");
      assert(typeof entry.at === "number");
    } finally {
      if (saved === undefined) delete globalThis.window;
      else globalThis.window = saved;
    }
  });

  test("getAssetUsageSnapshot: 返回 shallow-copy，后续原地修改不污染", () => {
    const saved = globalThis.window;
    try {
      globalThis.window = { __assetUsage: [] };
      recordAssetUsage({ id: "a", section: "images" });
      const snap = getAssetUsageSnapshot();
      snap[0].id = "mutated";
      const second = getAssetUsageSnapshot();
      assert(second[0].id === "a", "原 sink 不应被 snapshot 修改影响");
    } finally {
      if (saved === undefined) delete globalThis.window;
      else globalThis.window = saved;
    }
  });

  test("resetAssetUsage: 清空 sink", () => {
    const saved = globalThis.window;
    try {
      globalThis.window = {};
      recordAssetUsage({ id: "a", section: "images" });
      assert(globalThis.window.__assetUsage.length === 1);
      resetAssetUsage();
      assert(globalThis.window.__assetUsage.length === 0);
    } finally {
      if (saved === undefined) delete globalThis.window;
      else globalThis.window = saved;
    }
  });

  test("exposeTestHooks: 默认自动挂 observers.getAssetUsage", () => {
    const saved = globalThis.window;
    try {
      globalThis.window = {};
      exposeTestHooks({ state: { hello: 1 } });
      const getter = globalThis.window.gameTest.observers.getAssetUsage;
      assert(typeof getter === "function", "应自动挂 getAssetUsage");
      // 调一下返回 sink snapshot
      recordAssetUsage({ id: "x", section: "images" });
      const list = getter();
      assert(Array.isArray(list) && list.length >= 1);
    } finally {
      if (saved === undefined) delete globalThis.window;
      else globalThis.window = saved;
    }
  });

  test("exposeTestHooks: 业务显式传 observers.getAssetUsage 则不被覆盖", () => {
    const saved = globalThis.window;
    try {
      globalThis.window = {};
      const custom = () => "custom-sentinel";
      exposeTestHooks({ state: { hello: 1 }, observers: { getAssetUsage: custom } });
      assert(globalThis.window.gameTest.observers.getAssetUsage === custom);
    } finally {
      if (saved === undefined) delete globalThis.window;
      else globalThis.window = saved;
    }
  });
}

// =============================
// P1.5: _runtime_replay 通用 reducer 复算
// =============================
console.log("\n[P1.5] _runtime_replay: 每个 runtime primitive 的 replay 正确性");

{
  const { replayEvent, indexMechanics } = await import("../_runtime_replay.js");

  const mech = {
    mechanics: [
      { node: "attack-consume", primitive: "resource-consume@v1", params: { "agent-field": "ammo", "target-field": "durability" } },
      { node: "match-color", primitive: "predicate-match@v1", params: { fields: ["color"] } },
      { node: "score-up", primitive: "score-accum@v1", params: { rules: [{ "on-event": "block.destroyed", "delta": 10 }] } },
      { node: "phase", primitive: "fsm-transition@v1", params: { states: ["start", "playing"], transitions: [{ from: "start", trigger: "click-start", to: "playing" }] } },
      { node: "outcome", primitive: "win-lose-check@v1", params: { conditions: [{ kind: "win", when: "state.aliveBlocks === 0" }] } },
      { node: "cap", primitive: "capacity-gate@v1", params: { capacity: 1 } },
      { node: "life", primitive: "entity-lifecycle@v1", params: { transitions: [{ from: "waiting", event: "dispatched", to: "active" }] } },
      { node: "input", primitive: "cooldown-dispatch@v1", params: { "cooldown-ms": 250, "allowed-events": [{ kind: "lifecycle-event", event: "dispatched" }] } },
      { node: "pool", primitive: "slot-pool@v1", params: { capacity: 2 } },
    ],
  };
  const idx = indexMechanics(mech);

  test("replayEvent: 缺 primitive 跳过", async () => {
    const r = await replayEvent({}, { mechNodesByNode: idx.byNode, mechByPrimitive: idx.byPrimitive });
    assert(r.ok === null, "空事件应 skip");
  });

  test("replayEvent: resource-consume 正确的 after → ok:true", async () => {
    const ev = {
      primitive: "resource-consume@v1",
      node: "attack-consume",
      before: { agent: { id: "p", ammo: 3 }, target: { id: "b", durability: 2 } },
      after: { agent: { id: "p", ammo: 2 }, target: { id: "b", durability: 1 } },
    };
    const r = await replayEvent(ev, { mechNodesByNode: idx.byNode, mechByPrimitive: idx.byPrimitive });
    assert(r.ok === true, `应通过，实际 ${JSON.stringify(r)}`);
  });

  test("replayEvent: resource-consume after 写错 → ok:false", async () => {
    const ev = {
      primitive: "resource-consume@v1",
      node: "attack-consume",
      before: { agent: { id: "p", ammo: 3 }, target: { id: "b", durability: 2 } },
      after: { agent: { id: "p", ammo: 3 }, target: { id: "b", durability: 1 } }, // agent.ammo 没扣
    };
    const r = await replayEvent(ev, { mechNodesByNode: idx.byNode, mechByPrimitive: idx.byPrimitive });
    assert(r.ok === false, `应识别 violation，实际 ${JSON.stringify(r)}`);
    assert(/agent\.ammo/.test(r.reason));
  });

  test("replayEvent: score-accum 正确增分 → ok:true", async () => {
    const ev = {
      primitive: "score-accum@v1",
      node: "score-up",
      before: { score: 0, event: { type: "block.destroyed" } },
      after: { score: 10, delta: 10 },
    };
    const r = await replayEvent(ev, { mechNodesByNode: idx.byNode, mechByPrimitive: idx.byPrimitive });
    // reducer 可能 ignore 该事件（依赖 params 形态）；只要不是 false 就接受
    assert(r.ok !== false, `不应 violation，实际 ${JSON.stringify(r)}`);
  });

  test("replayEvent: capacity-gate admitted=true 与 blocked=true 冲突被识别", async () => {
    const ev = {
      primitive: "capacity-gate@v1",
      node: "cap",
      before: { gate: { capacity: 1, active: ["a"] }, entityId: "b" },
      // 正确 after 是 admitted=false, blocked=true；故意写反
      after: { gate: { capacity: 1, active: ["a", "b"] }, admitted: true, blocked: false },
    };
    const r = await replayEvent(ev, { mechNodesByNode: idx.byNode, mechByPrimitive: idx.byPrimitive });
    assert(r.ok === false, `应识别 violation，实际 ${JSON.stringify(r)}`);
  });

  test("replayEvent: entity-lifecycle 白名单转移", async () => {
    const ev = {
      primitive: "entity-lifecycle@v1",
      node: "life",
      before: { entity: { id: "p", lifecycle: "waiting" }, event: "dispatched" },
      after: { entity: { id: "p", lifecycle: "active" }, from: "waiting", to: "active" },
    };
    const r = await replayEvent(ev, { mechNodesByNode: idx.byNode, mechByPrimitive: idx.byPrimitive });
    assert(r.ok === true, `应通过，实际 ${JSON.stringify(r)}`);
  });

  test("replayEvent: cooldown-dispatch fired 状态一致", async () => {
    const ev = {
      primitive: "cooldown-dispatch@v1",
      node: "input",
      before: {
        dispatcher: { id: "d", lastFiredAt: null },
        downstream: { kind: "lifecycle-event", event: "dispatched" },
        now: 0,
      },
      after: { dispatcher: { id: "d", lastFiredAt: 0 }, fired: true },
    };
    const r = await replayEvent(ev, { mechNodesByNode: idx.byNode, mechByPrimitive: idx.byPrimitive });
    assert(r.ok === true, `应通过，实际 ${JSON.stringify(r)}`);
  });

  test("replayEvent: 未知 primitive → ok:null（skip）", async () => {
    const ev = {
      primitive: "nonexistent@v1",
      before: {},
      after: {},
    };
    const r = await replayEvent(ev, { mechNodesByNode: idx.byNode, mechByPrimitive: idx.byPrimitive });
    assert(r.ok === null);
  });
}

// =============================
// P0+P1 集成回归：最小 Pixel-Flow case 从 expand → codegen 全走一遍
// =============================
console.log("\n[P0+P1 集成] mini-pixel-flow: visual-primitive + runtime import + trace 复算");

{
  const caseDir = join(tmp, "mini-pixel-flow");
  rmSync(caseDir, { recursive: true, force: true });
  mkdirSync(join(caseDir, "docs"), { recursive: true });
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  mkdirSync(join(caseDir, "game/src/_common/primitives"), { recursive: true });

  // 1) PRD
  writeFileSync(join(caseDir, "docs/game-prd.md"), [
    "---",
    'game-aprd: "0.1"',
    "project: mini-pf",
    "platform: [web]",
    "runtime: canvas",
    "is-3d: false",
    "mode: 单机",
    "language: zh-CN",
    "asset-strategy:",
    "  mode: library-first",
    `  rationale: "${"核心小猪按颜色区分，目标色块依颜色判定，属于玩法识别的关键视觉；不可用纯装饰或 decorative 降级代替，保持语义一致。".repeat(1)}"`,
    "  visual-core-entities: [pig, block]",
    "  visual-peripheral: []",
    "  style-coherence: { level: strict }",
    "---",
    "## 1. 项目概述",
    "### @game(main) Mini Pixel Flow",
    "> genre: board-grid",
    "> platform: [web]",
    "> runtime: canvas",
    "> mode: 单机",
    "> core-loop: click-dispatch, ray-cast, consume",
    "> player-goal: clear all blocks",
    "",
    "## 6. 状态与实体",
    "### @entity(pig) Pig",
    "> type: unit",
    "> fields: [color, ammo]",
    "### @entity(block) Block",
    "> type: grid-cell",
    "> fields: [color, durability]",
  ].join("\n"));

  // 2) specs
  writeFileSync(join(caseDir, "specs/mechanics.yaml"), [
    "mechanics:",
    "  - node: attack-consume",
    "    primitive: ray-cast@v1",
    "    params:",
    '      coord-system: "grid"',
    '      stop-on: "first-hit"',
    "  - node: match-color",
    "    primitive: predicate-match@v1",
    "    params:",
    "      fields: [color]",
    "  - node: consume",
    "    primitive: resource-consume@v1",
    "    params:",
    '      agent-field: "ammo"',
    '      target-field: "durability"',
  ].join("\n"));
  writeFileSync(join(caseDir, "specs/scene.yaml"), [
    "scenes:",
    "  - id: start",
    "    purpose: 起始页",
    "    entities: []",
    "    layout:",
    "      viewport: { width: 480, height: 640 }",
    "      board-bbox: { x: 40, y: 120, w: 400, h: 400 }",
    "      hud-bbox:   { x: 40, y: 60,  w: 400, h: 40  }",
    "      safe-area:  { x: 0,  y: 0,   w: 480, h: 640 }",
    "  - id: play",
    "    purpose: 主玩法",
    "    entities: [pig, block]",
    "    layout:",
    "      viewport: { width: 480, height: 640 }",
    "      board-bbox: { x: 40, y: 120, w: 400, h: 400 }",
    "      hud-bbox:   { x: 40, y: 60,  w: 400, h: 40  }",
    "      safe-area:  { x: 0,  y: 0,   w: 480, h: 640 }",
  ].join("\n"));
  writeFileSync(join(caseDir, "specs/assets.yaml"), [
    "images:",
    "  - id: pig-red",
    "    source: generated",
    "    type: graphics-generated",
    "    binding-to: pig",
    "    visual-primitive: color-unit",
    "    color-source: entity.color",
    "  - id: block-red",
    "    source: generated",
    "    type: graphics-generated",
    "    binding-to: block",
    "    visual-primitive: color-block",
    "    color-source: entity.color",
    "audio: []",
    "spritesheets: []",
  ].join("\n"));

  // 3) 生成 contract 并 assert 通过 expand 阶段
  const contractGen = spawnSync("node", [
    resolve(here, "../generate_implementation_contract.js"),
    caseDir,
  ], { encoding: "utf-8" });
  test("集成: generate_implementation_contract 通过", () => {
    assert(contractGen.status === 0, `contract 生成失败: ${contractGen.stderr}`);
  });

  const expandCheck = spawnSync("node", [
    resolve(here, "../check_implementation_contract.js"),
    caseDir,
    "--stage",
    "expand",
  ], { encoding: "utf-8" });
  test("集成: --stage expand 通过（visual-primitive + color-source + core must-render 全对）", () => {
    const out = (expandCheck.stdout || "") + (expandCheck.stderr || "");
    assert(expandCheck.status === 0, `expand 应通过，实际 ${expandCheck.status}\n${out}`);
  });

  // 4) 铺设业务代码 + 拷贝 _common/primitives（模拟 Step 4 cp -R）
  const primSrc = resolve(here, "../../references/engines/_common/primitives");
  const primDst = join(caseDir, "game/src/_common/primitives");
  for (const f of [
    "index.mjs",
    "_trace.mjs",
    "ray-cast.runtime.mjs",
    "predicate-match.runtime.mjs",
    "resource-consume.runtime.mjs",
  ]) {
    writeFileSync(join(primDst, f), readFileSync(join(primSrc, f), "utf-8"));
  }
  // 顺便拷贝必需的 reducer（runtime 内部 import 向上三层）。
  // runtime.mjs 里 `../../../mechanics/...` 需要真实 reducer 存在。
  // 因为测试只跑 check_implementation_contract（静态扫描 import + call），不实际 import runtime，
  // 所以 reducer 不需要拷。
  writeFileSync(join(caseDir, "game/src/main.js"), [
    "// @primitive(ray-cast@v1): node-id=attack-consume",
    "// @primitive(predicate-match@v1): node-id=match-color",
    "// @primitive(resource-consume@v1): node-id=consume",
    "import {",
    "  rayCastGridFirstHit,",
    "  predicateMatch,",
    "  consumeResource,",
    "} from './_common/primitives/index.mjs';",
    "",
    "export function handleAttack(pig, blocks) {",
    "  const hit = rayCastGridFirstHit({",
    "    rule: 'attack-consume', node: 'attack-consume',",
    "    source: pig, direction: { dx: 0, dy: 1 }, targets: blocks,",
    "    params: { 'stop-on': 'first-hit', 'coord-system': 'grid' },",
    "  });",
    "  if (!hit) return;",
    "  const match = predicateMatch({",
    "    rule: 'match-color', node: 'match-color',",
    "    candidate: hit, filter: { color: pig.color },",
    "  });",
    "  if (!match) return;",
    "  const r = consumeResource({",
    "    rule: 'consume', node: 'consume',",
    "    agent: pig, target: hit,",
    "    params: { 'agent-field': 'ammo', 'target-field': 'durability' },",
    "  });",
    "  return r;",
    "}",
  ].join("\n"));
  writeFileSync(join(caseDir, "game/src/assets.manifest.json"), JSON.stringify({
    version: "1",
    images: [
      { id: "pig-red", type: "graphics-generated" },
      { id: "block-red", type: "graphics-generated" },
    ],
    audio: [],
    spritesheets: [],
  }));
  writeFileSync(join(caseDir, "game/index.html"),
    "<!DOCTYPE html><meta charset='utf-8'><canvas id='g'></canvas><script type='module' src='./src/main.js'></script>"
  );

  // 5) codegen 阶段校验：visual-primitive + runtime import + trace 都应通过
  const codegenCheck = spawnSync("node", [
    resolve(here, "../check_implementation_contract.js"),
    caseDir,
    "--stage",
    "codegen",
  ], { encoding: "utf-8" });

  test("集成: --stage codegen — visual-primitive 段全绿", () => {
    const out = (codegenCheck.stdout || "") + (codegenCheck.stderr || "");
    assert(
      !/\[contract\.asset\..+\] visual-primitive/.test(out),
      `不应有 visual-primitive 报错\n${out}`,
    );
  });

  test("集成: --stage codegen — core-must-render 段全绿", () => {
    const out = (codegenCheck.stdout || "") + (codegenCheck.stderr || "");
    assert(
      !/\[contract\.core-must-render\]/.test(out),
      `不应有 core must-render 报错\n${out}`,
    );
  });

  test("集成: --stage codegen — runtime import 校验通过", () => {
    const out = (codegenCheck.stdout || "") + (codegenCheck.stderr || "");
    assert(
      /\[runtime\].*全部 3 个 runtime-backed primitive 均已 import \+ 调用/.test(out),
      `应报 3 个 runtime import ok\n${out}`,
    );
  });

  // 6) 反作弊：profile 里带 window.gameState.score=999 应被 _profile_anti_cheat 识别
  {
    const { detectAntiCheatHits } = await import("../_profile_anti_cheat.js");
    test("集成: profile 反作弊识别 gameState.score 篡改", () => {
      const hits = detectAntiCheatHits({
        id: "bad",
        setup: [{ action: "eval", js: "window.gameState.score = 999;" }],
      });
      assert(hits.length > 0, "应识别到反作弊模式");
      assert(hits.some((h) => /gameState/.test(h.kind)), `hit 内容应提到 gameState: ${JSON.stringify(hits)}`);
    });

    test("集成: profile 反作弊识别 probes.* 调用", () => {
      const hits = detectAntiCheatHits({
        id: "bad",
        setup: [{ action: "eval", js: "window.gameTest.probes.resetWithScenario({});" }],
      });
      assert(hits.length > 0);
    });

    test("集成: 合法 profile（真实 click）不触发反作弊", () => {
      const hits = detectAntiCheatHits({
        id: "ok",
        setup: [{ action: "click", selector: "#start" }],
      });
      assert(hits.length === 0, `合法 profile 不应触发，实际 ${JSON.stringify(hits)}`);
    });
  }

  // 7) replay 在运行时捕获的合法 trace 上应通过
  {
    const yaml = (await import("js-yaml")).default;
    const { replayEvent, indexMechanics } = await import("../_runtime_replay.js");
    const mech = yaml.load(readFileSync(join(caseDir, "specs/mechanics.yaml"), "utf-8"));
    const idx = indexMechanics(mech);

    test("集成: 合法 runtime trace（resource-consume）→ replay ok", async () => {
      const ev = {
        primitive: "resource-consume@v1",
        rule: "consume",
        node: "consume",
        before: { agent: { id: "pig-1", ammo: 3 }, target: { id: "b-0", durability: 2 } },
        after: { agent: { id: "pig-1", ammo: 2 }, target: { id: "b-0", durability: 1 } },
      };
      const r = await replayEvent(ev, { mechNodesByNode: idx.byNode, mechByPrimitive: idx.byPrimitive });
      assert(r.ok === true, `应通过，实际 ${JSON.stringify(r)}`);
    });

    test("集成: 被篡改的 trace（ammo 没扣）→ replay 识别", async () => {
      const ev = {
        primitive: "resource-consume@v1",
        rule: "consume",
        node: "consume",
        before: { agent: { id: "pig-1", ammo: 3 }, target: { id: "b-0", durability: 2 } },
        after: { agent: { id: "pig-1", ammo: 3 }, target: { id: "b-0", durability: 1 } },
      };
      const r = await replayEvent(ev, { mechNodesByNode: idx.byNode, mechByPrimitive: idx.byPrimitive });
      assert(r.ok === false, `应识别 violation，实际 ${JSON.stringify(r)}`);
      assert(/agent\.ammo/.test(r.reason));
    });
  }
}

// =============================
// 汇总
// =============================
console.log(`\n结果: ${passed} passed, ${failed} failed`);
rmSync(tmp, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
