import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");
const checker = resolve(__dirname, "../check_implementation_contract.js");

test("check_implementation_contract accepts dynamic per-case runtime wrapper imports", () => {
  const root = mkdtempSync(join(tmpdir(), "dynamic-runtime-ok-"));
  try {
    writeDynamicCase(root, { importRuntime: true });
    const result = spawnSync("node", [checker, root, "--stage", "codegen"], {
      cwd: repoRoot,
      encoding: "utf-8",
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /runtime-module import \+ node 调用证据/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check_implementation_contract fails when dynamic runtime wrapper is not imported", () => {
  const root = mkdtempSync(join(tmpdir(), "dynamic-runtime-missing-"));
  try {
    writeDynamicCase(root, { importRuntime: false });
    const result = spawnSync("node", [checker, root, "--stage", "codegen"], {
      cwd: repoRoot,
      encoding: "utf-8",
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, output);
    assert.match(output, /runtime-module 未被业务代码 import/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeDynamicCase(root, { importRuntime }) {
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "specs"), { recursive: true });
  mkdirSync(join(root, "game/src/mechanics"), { recursive: true });

  writeFileSync(join(root, "docs/game-prd.md"), [
    "---",
    "asset-strategy:",
    "  mode: none",
    "---",
    "",
  ].join("\n"));

  writeFileSync(join(root, "specs/scene.yaml"), [
    "scenes:",
    "  - id: start",
    "    layout:",
    "      viewport: full",
    "      board-bbox: full",
    "      hud-bbox: top",
    "      safe-area: full",
    "    zones:",
    "      - id: start-btn",
    "        role: button",
    "  - id: play",
    "    layout:",
    "      viewport: full",
    "      board-bbox: full",
    "      hud-bbox: top",
    "      safe-area: full",
    "",
  ].join("\n"));

  writeFileSync(join(root, "specs/implementation-contract.yaml"), [
    "contract-version: 1",
    "runtime:",
    "  engine: dom-ui",
    "  run-mode: local-http",
    "boot:",
    "  entry-scene: start",
    "  ready-condition: window.gameState.phase === 'ready'",
    "  start-action:",
    "    trigger: click",
    "    target: start-btn",
    "    result: phase -> playing",
    "  scene-transitions:",
    "    - from: start",
    "      to: play",
    "      trigger: click start-btn",
    "asset-bindings: []",
    "engine-lifecycle:",
    "  asset-loading: before-first-render",
    "verification:",
    "  required-runtime-evidence: [gameState-exposed]",
    "  required-test-hooks:",
    "    observers: [getSnapshot, getTrace]",
    "    drivers: [clickStartButton]",
    "    probes: []",
    "",
  ].join("\n"));

  writeFileSync(join(root, "specs/mechanics.yaml"), [
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
    "    runtime-module: src/mechanics/score-click.runtime.mjs",
    "scenarios:",
    "  - name: normal",
    "    expected-outcome: settle",
    "",
  ].join("\n"));

  writeFileSync(join(root, "specs/event-graph.yaml"), [
    "version: 1",
    "rule-traces:",
    "  - rule-id: score-click",
    "",
  ].join("\n"));

  writeFileSync(join(root, "game/src/mechanics/score-click.runtime.mjs"), [
    "export function scoreClick({ rule, node, state }) {",
    "  const before = { score: state.score };",
    "  const after = { score: state.score + 1 };",
    "  window.__trace = window.__trace || [];",
    "  window.__trace.push({ type: 'score.updated', rule, node, before, after });",
    "  return after;",
    "}",
    "",
  ].join("\n"));

  writeFileSync(join(root, "game/src/main.js"), [
    importRuntime ? "import { scoreClick } from './mechanics/score-click.runtime.mjs';" : "",
    "const state = { phase: 'ready', score: 0 };",
    "window.gameState = state;",
    "export function onScore() {",
    importRuntime
      ? "  const next = scoreClick({ rule: 'score-click', node: 'score-click', state });"
      : "  const next = { score: state.score + 1 }; // rule: 'score-click', node: 'score-click'",
    "  Object.assign(state, next);",
    "}",
    "",
  ].filter(Boolean).join("\n"));

  writeFileSync(join(root, "game/index.html"), [
    "<!doctype html>",
    "<!-- ENGINE: dom-ui | VERSION: tailwind-v4 | RUN: local-http -->",
    "<script type=\"module\" src=\"./src/main.js\"></script>",
    "",
  ].join("\n"));
}
