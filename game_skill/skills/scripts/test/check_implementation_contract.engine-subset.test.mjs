import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  applicablePrimitivesFor,
  isEngineEnforced,
} from "../_primitive_runtime_map.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");
const checker = resolve(__dirname, "../check_implementation_contract.js");

test("dom-ui applicable primitive subset excludes spatial/motion primitives", () => {
  const dom = applicablePrimitivesFor("dom-ui");
  assert.equal(isEngineEnforced("dom-ui"), true);
  assert.equal(dom.has("predicate-match@v1"), true);
  assert.equal(dom.has("score-accum@v1"), true);
  assert.equal(dom.has("parametric-track@v1"), false);
  assert.equal(dom.has("ray-cast@v1"), false);
  assert.equal(dom.has("grid-board@v1"), false);
});

test("check_implementation_contract does not fail dom-ui when only spatial imports are missing", () => {
  const root = mkdtempSync(join(tmpdir(), "dom-ui-subset-"));
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    mkdirSync(join(root, "specs"), { recursive: true });
    mkdirSync(join(root, "game"), { recursive: true });

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
      "version: 1",
      "mechanics:",
      "  - node: track",
      "    primitive: parametric-track@v1",
      "  - node: score",
      "    primitive: score-accum@v1",
      "",
    ].join("\n"));

    writeFileSync(join(root, "specs/event-graph.yaml"), [
      "version: 1",
      "rule-traces:",
      "  - rule-id: score-click",
      "",
    ].join("\n"));

    writeFileSync(join(root, "game/index.html"), [
      "<!doctype html>",
      "<!-- ENGINE: dom-ui | VERSION: tailwind-v4 | RUN: local-http -->",
      "<script type=\"module\">",
      "import { accumulateScore } from './src/_common/primitives/index.mjs';",
      "window.__trace = window.__trace || [];",
      "const state = { phase: 'ready', score: 0 };",
      "window.gameState = state;",
      "// @primitive(parametric-track@v1): node-id=track",
      "function moveAlongDomTrack() { return 'handwritten-dom-layout'; }",
      "// @primitive(score-accum@v1): node-id=score",
      "function scoreClick() {",
      "  state.score = accumulateScore({ rule: 'score-click', node: 'score', currentScore: state.score, eventPayload: 'score-click', params: { rules: [{ on: 'score-click', delta: 1 }] } });",
      "}",
      "void moveAlongDomTrack; void scoreClick;",
      "</script>",
      "",
    ].join("\n"));

    const result = spawnSync("node", [checker, root, "--stage", "codegen"], {
      cwd: repoRoot,
      encoding: "utf-8",
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /runtime primitive import 完整/);
    assert.doesNotMatch(output, /parametric-track@v1 .*未 import/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
