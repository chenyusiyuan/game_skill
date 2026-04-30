import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const script = join(root, "game_skill/skills/scripts/check_level_solvability.js");
const tmp = join(here, ".tmp-level-solvability");

rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

test("fixture A: 通用 solution path + 3 个 meaningful decisions exit 0", () => {
  const dir = writeCase("valid", {
    playability: { "meaningful-decisions-min": 3, "no-softlock-after-valid-prefix": true },
    solution: [
      { event: "observe-board" },
      { event: "choose-target" },
      { event: "commit-action" },
    ],
  });
  const res = run(dir);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /meaningful-decisions >= 3/);
});

test("fixture B: 缺 solution path exit 1", () => {
  const dir = writeCase("missing-solution", {
    playability: { "meaningful-decisions-min": 3 },
    solution: [],
  });
  const res = run(dir);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /缺少 solution path/);
});

test("fixture C: 决策深度不足 exit 1", () => {
  const dir = writeCase("too-shallow", {
    playability: { "meaningful-decisions-min": 1 },
    solution: [{ event: "click" }],
  });
  const res = run(dir);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /meaningful-decisions 必须 >= 3/);
});

test("fixture D: 明确允许 softlock exit 1 且日志记录", () => {
  const dir = writeCase("softlock", {
    playability: { "meaningful-decisions-min": 3, "no-softlock-after-valid-prefix": false },
    solution: [
      { event: "observe-board" },
      { event: "choose-target" },
      { event: "commit-action" },
    ],
  });
  const logPath = join(dir, ".game/log.jsonl");
  const res = run(dir, logPath);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /softlock/);
  assert.match(readFileSync(logPath, "utf-8"), /"level-solvability"/);
});

function run(caseDir, logPath = null) {
  const args = [script, caseDir];
  if (logPath) args.push("--log", logPath);
  return spawnSync("node", args, { cwd: root, encoding: "utf-8" });
}

function writeCase(name, opts) {
  const dir = join(tmp, name);
  mkdirSync(join(dir, "specs"), { recursive: true });
  mkdirSync(join(dir, ".game"), { recursive: true });
  writeFileSync(join(dir, "specs/mechanics.yaml"), mechanicsYaml());
  writeFileSync(join(dir, "specs/data.yaml"), dataYaml(opts));
  return dir;
}

function dataYaml({ playability, solution }) {
  const doc = {
    playability,
    "solution-path": {
      levels: [{
        id: 1,
        actions: solution,
      }],
    },
  };
  return yaml.dump(doc, { lineWidth: 120, noRefs: true });
}

function mechanicsYaml() {
  return [
    "version: 2",
    "mode: dynamic-generated",
    "external-events: [input.action]",
    "entities:",
    "  - id: game",
    "    fields: [score]",
    "mechanics:",
    "  - node: action-loop",
    "    triggers: [input.action]",
    "    effects: [action.resolved]",
    "    state-fields: [game.score]",
    "    invariants: []",
    "    trace-events: [action.resolved]",
    "    runtime-module: src/mechanics/action-loop.runtime.mjs",
    "scenarios:",
    "  - name: normal",
    "    expected-outcome: settle",
    "",
  ].join("\n");
}
