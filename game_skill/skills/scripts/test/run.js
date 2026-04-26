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
    "    source: assets/library_2d/ui-pixel/tile_0013.png",
    "    type: local-file",
    "    binding-to: pig",
    "  - id: block-sprite",
    "    source: assets/library_2d/ui-pixel/tile_0014.png",
    "    type: local-file",
    "    binding-to: block",
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
// 汇总
// =============================
console.log(`\n结果: ${passed} passed, ${failed} failed`);
rmSync(tmp, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
