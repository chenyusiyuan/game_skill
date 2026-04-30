#!/usr/bin/env node
/**
 * 单元测试：review 反馈修复后的静态行为断言
 *
 * 跑法: node game_skill/skills/scripts/test/run.js
 * 退出码 0 = 全部通过；非 0 = 失败
 */

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
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
// Phase gate wiring
// =============================
console.log("\n[phase-gate] expand gate wiring");
test("run_phase_gate expand includes clarification and solvability gates", () => {
  const src = readFileSync(join(scriptsDir, "run_phase_gate.js"), "utf-8");
  const verifyAll = readFileSync(join(scriptsDir, "verify_all.js"), "utf-8");
  const expandBlock = src.match(/expand:\s*\{[\s\S]*?\n\s*\},\n\s*codegen:/)?.[0] ?? "";
  const codegenBlock = src.match(/codegen:\s*\{[\s\S]*?\n\s*\},\n\s*verify:/)?.[0] ?? "";
  assert(/check_spec_clarifications\.js/.test(expandBlock), "expand gate 应跑 check_spec_clarifications.js");
  assert(/check_level_solvability\.js/.test(expandBlock), "expand gate 应提前跑 check_level_solvability.js");
  assert(/check_visual_slots\.js/.test(expandBlock), "expand gate 应跑 check_visual_slots.js");
  assert(/check_visual_slots\.js/.test(codegenBlock), "codegen gate 应跑 check_visual_slots.js");
  assert(!/--allow-missing/.test(expandBlock + codegenBlock), "phase gate 默认不应给 check_visual_slots 传 --allow-missing");
  assert(!/check_visual_slots\.js"[\s\S]{0,120}--allow-missing/.test(verifyAll), "verify_all 默认不应给 check_visual_slots 传 --allow-missing");
});

test("check_project accepts local module src with cache-busting query", () => {
  const gameDir = join(tmp, "project-query-script", "game");
  mkdirSync(join(gameDir, "src"), { recursive: true });
  writeFileSync(join(gameDir, "index.html"), [
    "<!-- ENGINE: canvas | VERSION: test | RUN: local-http -->",
    "<script src=\"./src/main.js?v=123\"></script>",
  ].join("\n"));
  writeFileSync(join(gameDir, "src/main.js"), [
    "window.gameState = { ready: true };",
    "window.gameTest = { observers: {}, drivers: {}, probes: {} };",
  ].join("\n"));
  const r = run([join(scriptsDir, "check_project.js"), gameDir]);
  assert(r.status === 0, `query string 本地脚本应通过，exit=${r.status}\n${r.stdout}\n${r.stderr}`);
});

// =============================
// Engine templates: _common import paths resolve after codegen copy
// =============================
console.log("\n[engine-template] _common import path resolver");
{
  const repoRoot = resolve(here, "../../../..");
  const enginesRoot = join(repoRoot, "game_skill/skills/references/engines");
  const commonRoot = join(enginesRoot, "_common");

  function walkFiles(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) out.push(...walkFiles(p));
      else if (/\.(js|mjs)$/.test(name)) out.push(p);
    }
    return out;
  }

  test("template local _common imports resolve to game/src/_common", () => {
    const engines = ["canvas", "dom", "phaser3", "pixijs", "three"];
    const bad = [];
    for (const engine of engines) {
      const templateRoot = join(enginesRoot, engine, "template");
      if (!existsSync(templateRoot)) continue;
      for (const file of walkFiles(templateRoot)) {
        const src = readFileSync(file, "utf-8");
        const relFile = file.slice(templateRoot.length + 1);
        const outputFile = join("game", relFile);
        for (const m of src.matchAll(/from\s+["']([^"']*_common[^"']*)["']/g)) {
          const spec = m[1];
          const resolvedInGame = join(dirname(outputFile), spec);
          const relCommon = resolvedInGame.split("game/src/_common/")[1];
          if (!relCommon) {
            bad.push(`${engine}:${relFile} -> ${spec} resolves ${resolvedInGame}`);
            continue;
          }
          if (!existsSync(join(commonRoot, relCommon))) {
            bad.push(`${engine}:${relFile} -> ${spec} missing _common/${relCommon}`);
          }
        }
      }
    }
    assert(bad.length === 0, `template _common imports should resolve:\n${bad.join("\n")}`);
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
// Mechanics gate: dynamic DAG + runtime-module coverage
// =============================
console.log("\n[mechanics] check_mechanics dynamic coverage");

function writeMinimalMechanicsCase(caseDir, { runtimeModule = true, importRuntime = true, outcome = "win" } = {}) {
  mkdirSync(join(caseDir, "docs"), { recursive: true });
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  mkdirSync(join(caseDir, "game/src/mechanics"), { recursive: true });
  writeFileSync(join(caseDir, "docs/game-prd.md"), [
    "---",
    'game-aprd: "0.1"',
    "project: mechanics-min",
    "platform: [web]",
    "runtime: canvas",
    "mode: 单机",
    "---",
    "# Mechanics Min Game PRD",
  ].join("\n"));
  writeFileSync(join(caseDir, "specs/mechanics.yaml"), [
    "version: 2",
    "mode: dynamic-generated",
    "external-events: [input.score]",
    "entities:",
    "  - id: game",
    "    fields: [score]",
    "mechanics:",
    "  - node: score-click",
    "    triggers: [input.score]",
    "    effects: [score.updated]",
    "    state-fields: [game.score]",
    "    invariants: []",
    "    trace-events: [score.updated]",
    runtimeModule ? "    runtime-module: src/mechanics/score-click.runtime.mjs" : "",
    "scenarios:",
    "  - name: terminal-path",
    `    expected-outcome: ${outcome}`,
  ].filter(Boolean).join("\n"));
  if (runtimeModule) {
    writeFileSync(join(caseDir, "game/src/mechanics/score-click.runtime.mjs"), [
      "export function scoreClick({ rule, node, state }) {",
      "  const before = { score: state.score };",
      "  const after = { score: state.score + 1 };",
      "  window.__trace = window.__trace || [];",
      "  window.__trace.push({ type: 'score.updated', rule, node, before, after });",
      "  return after;",
      "}",
      "",
    ].join("\n"));
  }
  writeFileSync(join(caseDir, "game/src/main.js"), [
    importRuntime ? "import { scoreClick } from './mechanics/score-click.runtime.mjs';" : "",
    "const state = { score: 0 };",
    "window.gameState = state;",
    "export function onScore() {",
    importRuntime
      ? "  Object.assign(state, scoreClick({ rule: 'score-click', node: 'score-click', state }));"
      : "  state.score += 1;",
    "}",
    "",
  ].filter(Boolean).join("\n"));
}

test("check_mechanics: dynamic mechanics v2 with runtime-module passes", () => {
  const caseDir = join(tmp, "mechanics-dynamic-pass");
  writeMinimalMechanicsCase(caseDir);
  const r = run([join(scriptsDir, "check_mechanics.js"), caseDir]);
  assert(r.status === 0, `mechanics check 应通过，exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  assert(/runtime-module 已被业务代码 import/.test(r.stdout), `应输出 runtime import 证据\n${r.stdout}`);
});

test("check_mechanics: missing runtime-module fails", () => {
  const caseDir = join(tmp, "mechanics-missing-runtime-module");
  writeMinimalMechanicsCase(caseDir, { runtimeModule: false });
  const r = run([join(scriptsDir, "check_mechanics.js"), caseDir]);
  assert(r.status !== 0, `缺 runtime-module 应失败\n${r.stdout}\n${r.stderr}`);
  assert(/缺 runtime-module/.test(r.stdout), `应点名 runtime-module\n${r.stdout}`);
});

test("check_mechanics: settle terminal counts as positive reachable terminal", () => {
  const caseDir = join(tmp, "mechanics-settle-terminal");
  writeMinimalMechanicsCase(caseDir, { outcome: "settle" });
  const r = run([join(scriptsDir, "check_mechanics.js"), caseDir]);
  assert(r.status === 0, `settle terminal 应通过，exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  assert(/正向终局声明完整/.test(r.stdout), `应接受 settle 作为正向终局\n${r.stdout}`);
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

console.log("\n[profile-runner] shared click step parser");
{
  const {
    readClickPosition,
    hasRealClickStep,
    hasRealUserInputStep,
    clickOptionsForStep,
  } = await import("../_profile_steps.js");
  const { buildSmokeClickStep } = await import("../_interaction_smoke.js");

  test("options.position click 算真实输入并传给 Playwright position", () => {
    const assertion = {
      setup: [{ action: "click", selector: "canvas", options: { position: { x: 123, y: 45 } } }],
    };
    assert(hasRealClickStep(assertion), "嵌套 options.position 应算真实 click");
    assert(hasRealUserInputStep(assertion), "嵌套 options.position 应算真实用户输入");
    const pos = readClickPosition(assertion.setup[0]);
    assert(pos?.source === "options.position" && pos.x === 123 && pos.y === 45, `实际 pos=${JSON.stringify(pos)}`);
    const opts = clickOptionsForStep(assertion.setup[0]);
    assert(opts.position?.x === 123 && opts.position?.y === 45, `实际 opts=${JSON.stringify(opts)}`);
  });

  test("boot/profile smoke canvas 目标生成 selector + options.position 形状", () => {
    const step = buildSmokeClickStep({ kind: "pixijs", canvasRelX: 320, canvasRelY: 240, pageX: 320, pageY: 240 });
    assert(step.selector === "canvas", "canvas 目标应使用 selector=canvas");
    assert(step.options?.position?.x === 320 && step.options?.position?.y === 240, `实际 step=${JSON.stringify(step)}`);
  });
}

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

test("check_asset_selection: core entity 非空 + decor ratio > 40% 应 fail", () => {
  const caseDir = join(tmp, "asset-decor-ratio-core");
  writeCasePrd(caseDir, [
    "  mode: library-first",
    `  rationale: "${"核心实体需要真实绑定，不能把多数本地素材都声明成 decor 来绕过实体语义。".repeat(2)}"`,
    "  visual-core-entities: [pig, block]",
    "  visual-peripheral: []",
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
    ...Array.from({ length: 3 }, (_, i) => [
      `  - id: decor-${i}`,
      "    source: assets/library_2d/ui-pixel/tile_0013.png",
      "    type: local-file",
      "    binding-to: decor",
    ].join("\n")),
  ].join("\n"));
  const r = run([join(scriptsDir, "check_asset_selection.js"), caseDir]);
  assert(r.status !== 0, `core 非空 decor ratio > 40% 应 fail\n${r.stdout}`);
  assert(/\[binding-decor\]/.test(r.stdout), `应报 binding-decor\n${r.stdout}`);
});

test("check_asset_selection: core slot asset binding-to decor 应 fail", () => {
  const caseDir = join(tmp, "asset-core-slot-decor");
  writeCasePrd(caseDir, [
    "  mode: library-first",
    `  rationale: "${"核心 pig 的 slot 是玩法识别关键，不允许 asset 用 decor 绑定伪装通过。".repeat(2)}"`,
    "  visual-core-entities: [pig]",
    "  visual-peripheral: []",
    "  style-coherence: { level: flexible }",
  ].join("\n"));
  writeAssets(caseDir, [
    "  - id: pig-core",
    "    source: assets/library_2d/sprites/puzzle/ballBlue.png",
    "    type: local-file",
    "    binding-to: decor",
    "    fulfills-slot: entity.pig.primary",
  ].join("\n"));
  writeFileSync(join(caseDir, "specs/visual-slots.yaml"), [
    "visual-slots-version: 1",
    "slots:",
    "  - id: entity.pig.primary",
    "    entity: pig",
    "    semantic-slot: color-unit",
    "    render-zone: board-grid-cell",
    "    required: true",
    "    state-driven-fields: [color]",
  ].join("\n"));
  const r = run([join(scriptsDir, "check_asset_selection.js"), caseDir]);
  assert(r.status !== 0, `core slot decor 应 fail\n${r.stdout}`);
  assert(/core visual slot|core entity/.test(r.stdout), `应报 core slot/core entity decor\n${r.stdout}`);
});

test("check_asset_selection: visual-core-entities 为空 + decor ratio > 40% 仍 warn/pass", () => {
  const caseDir = join(tmp, "asset-decor-ratio-no-core");
  writeCasePrd(caseDir, [
    "  mode: library-first",
    `  rationale: "${"这是装饰素材压力测试，没有声明核心视觉实体，因此 decor 高占比只作为提醒。".repeat(2)}"`,
    "  visual-core-entities: []",
    "  visual-peripheral: [scene-background]",
    "  style-coherence: { level: flexible }",
  ].join("\n"));
  writeAssets(caseDir, Array.from({ length: 5 }, (_, i) => [
    `  - id: decor-only-${i}`,
    "    source: assets/library_2d/ui-pixel/tile_0013.png",
    "    type: local-file",
    "    binding-to: decor",
  ].join("\n")).join("\n"));
  const r = run([join(scriptsDir, "check_asset_selection.js"), caseDir]);
  assert(r.status === 0, `core 为空 decor ratio > 40% 应 warn/pass\n${r.stdout}\n${r.stderr}`);
  assert(/\[binding-decor\].*warning|保留 warning/.test(r.stdout), `应保留 decor warning\n${r.stdout}`);
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
    "    binding-to: pig",
    "    must-render: true",
  ].join("\n"));
  mkdirSync(join(caseDir, "game/src/_common"), { recursive: true });
  writeFileSync(
    join(caseDir, "game/src/_common/asset-usage.js"),
    readFileSync(join(resolve(here, "../../../.."), "game_skill/skills/references/engines/_common/asset-usage.js"), "utf-8"),
  );
  writeFileSync(join(caseDir, "game/index.html"), [
    "<!-- ENGINE: canvas | VERSION: test | RUN: local-http -->",
    "<canvas id=\"game\"></canvas>",
    "<script type=\"module\">",
    "import { recordAssetUsage, renderSlot } from './src/_common/asset-usage.js';",
    "const assetId = 'pig-shape';",
    "const ctx = document.getElementById('game').getContext('2d');",
    "function renderGeneratedPrimitive(id) {",
    "  renderSlot({ assetId: id, section: 'images', kind: 'generated', width: 12, height: 12, draw: () => ctx.fillRect(0, 0, 12, 12) });",
    "}",
    "function requestOnly() {",
    "  recordAssetUsage({ id: 'pig-shape', section: 'images', kind: 'generated' });",
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

test("runtime asset usage: requested-only 不能替代 rendered/visible", () => {
  const caseDir = join(tmp, "asset-requested-only");
  writeGeneratedUsageCase(caseDir, true);
  const html = readFileSync(join(caseDir, "game/index.html"), "utf-8")
    .replace("renderGeneratedPrimitive('pig-shape');", "requestOnly();");
  writeFileSync(join(caseDir, "game/index.html"), html);
  const r = run([join(scriptsDir, "check_asset_usage.js"), caseDir]);
  assert(r.status !== 0, `requested-only 应失败，exit=${r.status}\n${r.stdout}`);
  assert(/pig-shape\(rendered\+visible\)/.test(r.stdout), `应缺 rendered+visible，实际:\n${r.stdout}`);
});

test("runtime asset usage: Phaser/Pixi/Three 视觉 must-render 也要求 rendered/visible", () => {
  for (const engine of ["phaser3", "pixijs", "three"]) {
    const caseDir = join(tmp, `asset-requested-only-${engine}`);
    writeGeneratedUsageCase(caseDir, true);
    let html = readFileSync(join(caseDir, "game/index.html"), "utf-8")
      .replace("ENGINE: canvas", `ENGINE: ${engine}`)
      .replace("renderGeneratedPrimitive('pig-shape');", "requestOnly();");
    writeFileSync(join(caseDir, "game/index.html"), html);
    const r = run([join(scriptsDir, "check_asset_usage.js"), caseDir]);
    assert(r.status !== 0, `${engine} requested-only 应失败，exit=${r.status}\n${r.stdout}`);
    assert(/pig-shape\(rendered\+visible\)/.test(r.stdout), `${engine} 应缺 rendered+visible，实际:\n${r.stdout}`);
  }
});

test("check_asset_usage: 只 getTexture 不走 drawAsset 的 must-render visual 应 fail", () => {
  const caseDir = join(tmp, "asset-gettexture-only");
  writeCasePrd(caseDir, [
    "  mode: generated-only",
    `  rationale: "${"核心视觉即使来自 inline svg，也必须真实渲染并产生 rendered/visible 证据，单纯请求 texture 不算。".repeat(2)}"`,
    "  visual-core-entities: [pig]",
    "  visual-peripheral: []",
    "  style-coherence: { level: \"n/a\" }",
  ].join("\n"));
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  writeFileSync(join(caseDir, "specs/assets.yaml"), [
    "images:",
    "  - id: pig-img",
    "    source: inline-svg",
    "    type: inline-svg",
    "    binding-to: pig",
    "audio: []",
    "spritesheets: []",
  ].join("\n"));
  writeFileSync(join(caseDir, "specs/implementation-contract.yaml"), [
    "asset-bindings:",
    "  - id: pig-img",
    "    section: images",
    "    type: inline-svg",
    "    binding-to: pig",
    "    must-render: true",
  ].join("\n"));
  mkdirSync(join(caseDir, "game/src/adapters"), { recursive: true });
  mkdirSync(join(caseDir, "game/src/_common"), { recursive: true });
  for (const f of ["registry.spec.js", "asset-usage.js"]) {
    writeFileSync(
      join(caseDir, "game/src/_common", f),
      readFileSync(join(resolve(here, "../../../.."), "game_skill/skills/references/engines/_common", f), "utf-8"),
    );
  }
  writeFileSync(
    join(caseDir, "game/src/adapters/canvas-registry.js"),
    readFileSync(join(resolve(here, "../../../.."), "game_skill/skills/references/engines/canvas/template/src/adapters/canvas-registry.js"), "utf-8"),
  );
  writeFileSync(join(caseDir, "game/index.html"), [
    "<!-- ENGINE: canvas | VERSION: test | RUN: local-http -->",
    "<canvas id=\"game\"></canvas>",
    "<script type=\"module\">",
    "import { createRegistry } from './src/adapters/canvas-registry.js';",
    "const registry = await createRegistry({",
    "  basePath: '',",
    "  images: [{ id: 'pig-img', type: 'inline-svg', svg: '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"12\" height=\"12\"><rect width=\"12\" height=\"12\" fill=\"red\"/></svg>' }],",
    "  spritesheets: [],",
    "  audio: [],",
    "});",
    "registry.getTexture('pig-img');",
    "</script>",
  ].join("\n"));
  const r = run([join(scriptsDir, "check_asset_usage.js"), caseDir]);
  assert(r.status !== 0, `getTexture-only 应失败\n${r.stdout}\n${r.stderr}`);
  assert(/pig-img\(rendered\+visible\)/.test(r.stdout), `应缺 rendered+visible\n${r.stdout}`);
});

// =============================
// P1 follow-up: visual-slots generator + checker
// =============================
console.log("\n[P1 follow-up] visual-slots: generator + strict checker");

function writeVisualSlotCase(caseDir) {
  writeCasePrd(caseDir, [
    "  mode: library-first",
    `  rationale: "${"核心实体 pig 的主视觉必须绑定到明确 visual slot，避免素材请求和实际语义槽错位。".repeat(2)}"`,
    "  visual-core-entities: [pig]",
    "  visual-peripheral: []",
    "  style-coherence: { level: flexible }",
  ].join("\n"));
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  writeFileSync(join(caseDir, "specs/assets.yaml"), [
    "images:",
    "  - id: pig-body",
    "    source: assets/library_2d/sprites/pig.png",
    "    type: local-file",
    "    binding-to: pig",
    "    visual-primitive: color-unit",
    "    color-source: entity.color",
    "    fulfills-slot: entity.pig.primary",
    "audio: []",
    "spritesheets: []",
  ].join("\n"));
  writeFileSync(join(caseDir, "specs/implementation-contract.yaml"), [
    "asset-bindings:",
    "  - id: pig-body",
    "    section: images",
    "    role: core-visual",
    "    asset-kind: sprite",
    "    type: local-file",
    "    source: assets/library_2d/sprites/pig.png",
    "    binding-to: pig",
    "    visual-primitive: color-unit",
    "    color-source: entity.color",
    "    visual-slot: entity.pig.primary",
    "    render-as: texture",
    "    text-bearing: false",
    "    must-render: true",
    "    allow-fallback: false",
  ].join("\n"));
}

test("generate_visual_slots + check_visual_slots: 核心 asset slot 对齐应通过", () => {
  const caseDir = join(tmp, "visual-slots-good");
  writeVisualSlotCase(caseDir);
  const gen = run([join(scriptsDir, "generate_visual_slots.js"), caseDir]);
  assert(gen.status === 0, `generate_visual_slots 应通过，exit=${gen.status}\n${gen.stdout}\n${gen.stderr}`);
  const body = readFileSync(join(caseDir, "specs/visual-slots.yaml"), "utf-8");
  assert(/entity\.pig\.primary/.test(body), `应生成 pig primary slot，实际:\n${body}`);
  const check = run([join(scriptsDir, "check_visual_slots.js"), caseDir]);
  assert(check.status === 0, `check_visual_slots 应通过，exit=${check.status}\n${check.stdout}\n${check.stderr}`);
});

test("check_visual_slots: slot.allowed-visual-primitives 不匹配应 fail", () => {
  const caseDir = join(tmp, "visual-slots-bad-vp");
  writeVisualSlotCase(caseDir);
  const gen = run([join(scriptsDir, "generate_visual_slots.js"), caseDir]);
  assert(gen.status === 0, `生成 visual-slots 失败:\n${gen.stdout}\n${gen.stderr}`);
  const path = join(caseDir, "specs/visual-slots.yaml");
  const body = readFileSync(path, "utf-8").replace("color-unit", "ui-button");
  writeFileSync(path, body);
  const check = run([join(scriptsDir, "check_visual_slots.js"), caseDir]);
  assert(check.status !== 0, `visual primitive mismatch 应失败，exit=${check.status}\n${check.stdout}`);
  assert(/不在 slot\.allowed-visual-primitives/.test(check.stdout), `应报 allowed mismatch，实际:\n${check.stdout}`);
});

test("check_visual_slots: core entity 非空且缺 visual-slots 应 fail", () => {
  const caseDir = join(tmp, "visual-slots-missing-core");
  writeVisualSlotCase(caseDir);
  const check = run([join(scriptsDir, "check_visual_slots.js"), caseDir]);
  assert(check.status !== 0, `缺 visual-slots 且 core entity 非空应 fail\n${check.stdout}`);
  assert(/visual-slots\.yaml 不存在/.test(check.stdout), `应报缺 visual-slots\n${check.stdout}`);
});

test("check_visual_slots: mode=none 缺 visual-slots 应 pass", () => {
  const caseDir = join(tmp, "visual-slots-mode-none");
  writeCasePrd(caseDir, [
    "  mode: none",
    `  rationale: "${"纯文字互动 case 不需要外部素材或核心视觉实体，因此 visual-slots 可以自然缺省。".repeat(2)}"`,
    "  visual-core-entities: []",
    "  visual-peripheral: []",
    "  style-coherence: { level: \"n/a\" }",
  ].join("\n"));
  const check = run([join(scriptsDir, "check_visual_slots.js"), caseDir]);
  assert(check.status === 0, `mode=none 缺 visual-slots 应 pass\n${check.stdout}\n${check.stderr}`);
});

test("check_visual_slots: core entity 非空但 --allow-missing 显式兼容应 pass/warn", () => {
  const caseDir = join(tmp, "visual-slots-allow-missing");
  writeVisualSlotCase(caseDir);
  const check = run([join(scriptsDir, "check_visual_slots.js"), caseDir, "--allow-missing"]);
  assert(check.status === 0, `--allow-missing 应兼容通过\n${check.stdout}\n${check.stderr}`);
  assert(/allow-missing/.test(check.stdout), `应输出 allow-missing warning\n${check.stdout}`);
});

// =============================
// P1 follow-up: pipeline pattern structured ledger
// =============================
console.log("\n[P1 follow-up] pipeline patterns: structured ledger + threshold gate");

test("record_pipeline_pattern: 第三次同类 pattern 触发抽象升级 gate", () => {
  const caseDir = join(tmp, "pipeline-patterns");
  mkdirSync(caseDir, { recursive: true });
  for (let i = 0; i < 3; i++) {
    const r = run([
      join(scriptsDir, "record_pipeline_pattern.js"),
      caseDir,
      "--pattern", "asset-requested-not-rendered",
      "--origin", "Codegen / engine template",
      "--example", `case-${i + 1}`,
      "--next", "add engine render wrapper evidence",
    ]);
    assert(r.status === 0, `record pattern 应成功，exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  }
  const body = readFileSync(join(caseDir, ".pipeline_patterns.md"), "utf-8");
  assert(/count:\s*3/.test(body), `count 应累计到 3，实际:\n${body}`);
  const check = run([join(scriptsDir, "check_pipeline_patterns.js"), caseDir]);
  assert(check.status !== 0, `count>=3 且 open 应 fail，exit=${check.status}\n${check.stdout}`);
  assert(/必须抽象升级/.test(check.stdout), `应提示抽象升级，实际:\n${check.stdout}`);

  const close = run([
    join(scriptsDir, "record_pipeline_pattern.js"),
    caseDir,
    "--pattern", "asset-requested-not-rendered",
    "--origin", "Codegen / engine template",
    "--example", "case-4",
    "--next", "add engine render wrapper evidence",
    "--status", "abstracted",
  ]);
  assert(close.status === 0, `标记 abstracted 应成功:\n${close.stdout}\n${close.stderr}`);
  const checkClosed = run([join(scriptsDir, "check_pipeline_patterns.js"), caseDir]);
  assert(checkClosed.status === 0, `abstracted 后应通过，exit=${checkClosed.status}\n${checkClosed.stdout}`);
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

test("exposeTestHooks 旧入参 simulators 仍挂 window 且 mirror 到 drivers", async () => {
  const { mod, win, restore } = await loadTestHookWithWindow();
  try {
    const simulateCorrectMatch = () => "match";
    mod.exposeTestHooks({
      state: { s: 1 },
      simulators: { simulateCorrectMatch },
    });
    assert(typeof win.simulateCorrectMatch === "function", "旧 window.simulateCorrectMatch 应可访问");
    assert(
      typeof win.gameTest.drivers.simulateCorrectMatch === "function",
      "simulators 应自动 mirror 到 drivers.simulateCorrectMatch",
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

  test("旧 API 过渡兼容路径 — 仍应兼容但记 deprecation warning", () => {
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

  test("新 API drivers.clickStartButton() → 应走新路径", () => {
    const a = {
      id: "drivers-ok",
      setup: [
        { action: "click", selector: "#start" },
        { action: "eval", js: "window.gameTest.drivers.clickStartButton()" },
      ],
    };
    const hits = detectAntiCheatHits(a);
    assert(hits.length === 0, `新 drivers 调用不应命中 anti-cheat，实际=${JSON.stringify(hits)}`);
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

test("check_playthrough: 3 条 inert interaction click 应 exit non-zero", () => {
  const caseDir = join(tmp, "playthrough-click-hits-nothing");
  const gameDir = join(caseDir, "game");
  mkdirSync(gameDir, { recursive: true });
  mkdirSync(join(caseDir, ".game"), { recursive: true });
  writeFileSync(join(gameDir, "index.html"), [
    "<!-- ENGINE: canvas | VERSION: test | RUN: file -->",
    "<button id=\"start\" style=\"width:200px;height:100px\">start</button>",
    "<script>",
    "window.gameState = { score: 0, phase: 'ready' };",
    "window.__trace = [];",
    "</script>",
  ].join("\n"));
  const profilePath = join(tmp, "playthrough-click-hits-nothing-profile.json");
  const profile = {
    assertions: [1, 2, 3].map((n) => ({
      id: `inert-${n}`,
      kind: "interaction",
      description: `inert click ${n}`,
      setup: [{ action: "click", x: 10 + n, y: 10 + n }],
    })),
  };
  const profileText = JSON.stringify(profile, null, 2) + "\n";
  writeFileSync(profilePath, profileText);
  writeFileSync(join(caseDir, ".game/state.json"), JSON.stringify({
    phases: {
      verify: {
        profileSha: createHash("sha256").update(profileText).digest("hex"),
        profilePath,
      },
    },
  }, null, 2) + "\n");
  const r = run([
    join(scriptsDir, "check_playthrough.js"),
    gameDir,
    "--profile",
    profilePath.replace(/\.json$/, ""),
    "--skip-coverage",
  ]);
  assert(r.status !== 0, `inert click 应失败，exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  assert(/click-hits-nothing/.test(r.stdout), `应输出 click-hits-nothing，实际:\n${r.stdout}`);
});

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

test("pack-level disallowed-slots 命中 → fail", () => {
  const caseDir = join(tmp, "p05-pack-disallow");
  mkdirSync(join(caseDir, "docs"), { recursive: true });
  writeFileSync(join(caseDir, "docs/game-prd.md"), [
    "---",
    'game-aprd: "0.1"',
    "project: p05-pack",
    "platform: [web]",
    "runtime: canvas",
    "is-3d: false",
    "mode: 单机",
    "language: zh-CN",
    "asset-strategy:",
    "  mode: library-first",
    `  rationale: "${"角色包只能绑定角色/颜色单位，不能伪装成地形格。".repeat(1)}"`,
    "  visual-core-entities: [hero]",
    "  visual-peripheral: []",
    "  style-coherence: { level: flexible }",
    "color-scheme:",
    "  palette-id: pixel-retro",
    "---",
    "## 1. 项目概述",
    "### @game(main) P05 Pack",
    "> genre: platform-physics",
    "> platform: [web]",
    "> runtime: canvas",
    "> mode: 单机",
    "> core-loop: test",
    "> player-goal: test",
    "",
    "## 6. 状态与实体",
    "### @entity(hero) Hero",
    "> type: unit",
  ].join("\n"));
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  writeFileSync(join(caseDir, "specs/assets.yaml"), [
    "color-scheme:",
    "  palette-id: pixel-retro",
    "genre: platform-physics",
    "images:",
    "  - id: hero-wrong-terrain",
    "    source: assets/library_2d/sprites/platformer-pixel/tile_0000.png",
    "    type: local-file",
    "    binding-to: hero",
    "    visual-primitive: terrain-cell",
    "audio: []",
    "spritesheets: []",
    "fonts: []",
    "selection-report:",
    "  candidate-packs: [sprites-platformer-pixel]",
    "  local-file-ratio: { images: 1/1 }",
    "  fallback-reasons: []",
  ].join("\n"));
  const r = run([join(scriptsDir, "check_asset_selection.js"), caseDir]);
  assert(r.status !== 0, `pack-level disallowed-slots 命中应 fail，实际 exit=${r.status}\n${r.stdout}`);
  assert(/pack "sprites-platformer-pixel".*disallowed-slots/.test(r.stdout),
    `错误信息应指向 pack-level disallowed-slots:\n${r.stdout}`);
});

// =============================
// P1.6: asset-usage runtime evidence + test-hook 自动挂 getAssetUsage
// =============================
console.log("\n[P1.6] asset-usage: recordAssetUsage + observers.getAssetUsage 默认安装");

{
  const repoRoot = resolve(here, "../../../..");
  const { recordAssetUsage, recordAssetRendered, recordAssetVisible, recordAssetRenderEvidence, renderSlot, getAssetUsageSnapshot, resetAssetUsage } = await import(
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
      assert(entry.assetId === "pig-red");
      assert(entry.phase === "requested");
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

  test("renderSlot: 记录 requested/rendered/visible 三层证据", () => {
    const saved = globalThis.window;
    try {
      globalThis.window = {};
      let drew = false;
      renderSlot({
        assetId: "pig-shape",
        slotId: "actor.pig.body",
        entityId: "pig-1",
        semanticSlot: "color-unit",
        width: 16,
        height: 12,
        draw: () => { drew = true; },
      });
      assert(drew, "renderSlot 应执行 draw 回调");
      const phases = globalThis.window.__assetUsage.map((e) => e.phase);
      assert(phases.includes("requested"), `应有 requested，实际 ${phases}`);
      assert(phases.includes("rendered"), `应有 rendered，实际 ${phases}`);
      assert(phases.includes("visible"), `应有 visible，实际 ${phases}`);
    } finally {
      if (saved === undefined) delete globalThis.window;
      else globalThis.window = saved;
    }
  });

  test("recordAssetRendered / recordAssetVisible: 可单独写入 phase", () => {
    const saved = globalThis.window;
    try {
      globalThis.window = {};
      recordAssetRendered({ assetId: "a", section: "images" });
      recordAssetVisible({ assetId: "a", section: "images" });
      const phases = globalThis.window.__assetUsage.map((e) => e.phase);
      assert(phases.join(",") === "rendered,visible", `phase 应精确记录，实际 ${phases}`);
    } finally {
      if (saved === undefined) delete globalThis.window;
      else globalThis.window = saved;
    }
  });

  test("recordAssetRenderEvidence: 有面积且 visible 时补 visible phase", () => {
    const saved = globalThis.window;
    try {
      globalThis.window = {};
      recordAssetRenderEvidence({ assetId: "a", section: "images", width: 8, height: 8 });
      const phases = globalThis.window.__assetUsage.map((e) => e.phase);
      assert(phases.join(",") === "rendered,visible", `应记录 rendered+visible，实际 ${phases}`);
    } finally {
      if (saved === undefined) delete globalThis.window;
      else globalThis.window = saved;
    }
  });

  test("canvas registry.drawAsset: 真实 drawImage 后记录 requested/rendered/visible", async () => {
    const savedWindow = globalThis.window;
    const savedImage = globalThis.Image;
    try {
      globalThis.window = {};
      globalThis.Image = class {
        set src(value) {
          this._src = value;
          setTimeout(() => this.onload?.(), 0);
        }
        get src() { return this._src; }
      };
      const { createRegistry } = await import(
        `file://${repoRoot}/game_skill/skills/references/engines/canvas/template/src/adapters/canvas-registry.js`
      );
      const registry = await createRegistry({
        basePath: "/assets",
        images: [{ id: "pig-img", type: "local-file", src: "pig.png", "binding-to": "pig" }],
        spritesheets: [],
        audio: [],
      });
      const drawCalls = [];
      const ctx = { drawImage: (...args) => drawCalls.push(args) };
      const rendered = registry.drawAsset(ctx, "pig-img", { x: 1, y: 2, width: 16, height: 12 }, { entityId: "pig-1", semanticSlot: "color-unit" });
      assert(rendered === true, "drawAsset 应返回 true");
      assert(drawCalls.length === 1, "drawAsset 必须真实调用 ctx.drawImage");
      const phases = globalThis.window.__assetUsage.map((e) => e.phase);
      assert(phases.includes("requested"), `应有 requested，实际 ${phases}`);
      assert(phases.includes("rendered"), `应有 rendered，实际 ${phases}`);
      assert(phases.includes("visible"), `应有 visible，实际 ${phases}`);
      const visible = globalThis.window.__assetUsage.find((e) => e.phase === "visible");
      assert(visible.source === "canvas-registry.drawAsset", `visible evidence 应来自 wrapper，实际 ${JSON.stringify(visible)}`);
    } finally {
      if (savedWindow === undefined) delete globalThis.window;
      else globalThis.window = savedWindow;
      if (savedImage === undefined) delete globalThis.Image;
      else globalThis.Image = savedImage;
    }
  });

  test("dom registry wrappers: createImageElement/setBackgroundAsset 记录 rendered/visible", async () => {
    const savedWindow = globalThis.window;
    const savedDocument = globalThis.document;
    const savedGetComputedStyle = globalThis.getComputedStyle;
    const savedRaf = globalThis.requestAnimationFrame;
    try {
      globalThis.window = {};
      class FakeElement {
        constructor(tag) {
          this.tagName = tag.toUpperCase();
          this.style = {};
          this.dataset = {};
          this.children = [];
        }
        addEventListener(_type, cb) { setTimeout(cb, 0); }
        getBoundingClientRect() { return { x: 0, y: 0, width: 20, height: 18 }; }
      }
      globalThis.document = { createElement: (tag) => new FakeElement(tag) };
      globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
      globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
      const { createRegistry } = await import(
        `file://${repoRoot}/game_skill/skills/references/engines/dom/template/src/adapters/dom-registry.js`
      );
      const registry = await createRegistry({
        basePath: "/assets",
        images: [{ id: "pig-img", type: "local-file", src: "pig.png", "binding-to": "pig" }],
        spritesheets: [],
        audio: [],
      });
      const img = registry.createImageElement("pig-img", { entityId: "pig-1", className: "pig" });
      assert(img && img.src === "/assets/pig.png", "createImageElement 应返回 img 元素");
      const panel = new FakeElement("div");
      const okBg = registry.setBackgroundAsset(panel, "pig-img", { renderZone: "hud" });
      assert(okBg === true && /pig\.png/.test(panel.style.backgroundImage), "setBackgroundAsset 应设置 backgroundImage");
      await new Promise((resolve) => setTimeout(resolve, 5));
      const phases = globalThis.window.__assetUsage.map((e) => e.phase);
      assert(phases.filter((p) => p === "rendered").length >= 2, `应记录 rendered，实际 ${phases}`);
      assert(phases.filter((p) => p === "visible").length >= 2, `应记录 visible，实际 ${phases}`);
    } finally {
      if (savedWindow === undefined) delete globalThis.window;
      else globalThis.window = savedWindow;
      if (savedDocument === undefined) delete globalThis.document;
      else globalThis.document = savedDocument;
      if (savedGetComputedStyle === undefined) delete globalThis.getComputedStyle;
      else globalThis.getComputedStyle = savedGetComputedStyle;
      if (savedRaf === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = savedRaf;
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
// 汇总
// =============================
console.log(`\n结果: ${passed} passed, ${failed} failed`);
rmSync(tmp, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
