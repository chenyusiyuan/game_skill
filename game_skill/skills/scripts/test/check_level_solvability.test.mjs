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

test("fixture A: board-grid 合法 solution-path exit 0", () => {
  const dir = writeCase("valid", {
    collections: {
      pigs: [{ id: "pig-1", color: "red", ammo: 2, alive: true, lifecycle: "active" }],
      blocks: [
        { id: "block-1", color: "red", hp: 1, alive: true },
        { id: "block-2", color: "red", hp: 1, alive: true },
      ],
    },
    playability: { genre: "board-grid", "trivial-click-all": false, "meaningful-decisions-min": 2 },
    solution: [
      { event: "match.hit", payload: { sourceId: "pig-1", targetId: "block-1" }, "expected-effect": { entity: "block-1", field: "alive", to: false } },
      { event: "match.hit", payload: { sourceId: "pig-1", targetId: "block-2" }, "expected-effect": { entity: "block-2", field: "alive", to: false } },
    ],
    anti: [{ event: "match.hit", payload: { sourceId: "pig-1", targetId: "block-1" } }],
    antiExpectedWin: false,
  });
  const res = run(dir);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /solution-path 可达 win/);
});

test("fixture B: board-grid solution-path 不触发 win exit 1", () => {
  const dir = writeCase("no-win", {
    collections: {
      pigs: [{ id: "pig-1", color: "red", ammo: 2, alive: true }],
      blocks: [
        { id: "block-1", color: "red", hp: 1, alive: true },
        { id: "block-2", color: "red", hp: 1, alive: true },
      ],
    },
    playability: { genre: "board-grid", "trivial-click-all": false, "meaningful-decisions-min": 1 },
    solution: [{ event: "match.hit", payload: { sourceId: "pig-1", targetId: "block-1" } }],
    anti: [{ event: "match.hit", payload: { sourceId: "pig-1", targetId: "block-1" } }],
    antiExpectedWin: false,
  });
  const res = run(dir);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /未触发 win-condition/);
});

test("fixture C: anti-trivial 居然通关 exit 1", () => {
  const dir = writeCase("anti-wins", {
    collections: {
      pigs: [{ id: "pig-1", color: "red", ammo: 1, alive: true }],
      blocks: [{ id: "block-1", color: "red", hp: 1, alive: true }],
    },
    playability: { genre: "board-grid", "trivial-click-all": false, "meaningful-decisions-min": 1 },
    solution: [{ event: "match.hit", payload: { sourceId: "pig-1", targetId: "block-1" } }],
    anti: [{ event: "match.hit", payload: { sourceId: "pig-1", targetId: "block-1" } }],
    antiExpectedWin: false,
  });
  const res = run(dir);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /anti-trivial expected-win=false，actual=true/);
});

test("fixture D: reflex 缺 playability 子字段 exit 1 且日志含 reflex-schema", () => {
  const dir = writeCase("reflex-skip", {
    collections: { pigs: [], blocks: [] },
    playability: { genre: "reflex" },
    solution: [],
    anti: [],
  });
  const logPath = join(dir, ".game/log.jsonl");
  const res = run(dir, logPath);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /missing:target-frequency\.min-per-sec/);
  assert.match(readFileSync(logPath, "utf-8"), /"step":"reflex-schema"/);
});

test("fixture E: 缺 playability 块 backward-compatible ok-skip exit 0", () => {
  const dir = writeCase("missing-playability", {
    collections: { pigs: [], blocks: [] },
    playability: null,
    solution: [],
    anti: [],
  });
  const res = run(dir);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /playability\.genre=<missing>/);
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

function dataYaml({ collections, playability, solution, anti, antiExpectedWin }) {
  const doc = {
    "initial-state": { collections },
    "solution-path": {
      levels: [{
        id: 1,
        "min-steps": 1,
        "max-steps": 4,
        actions: solution,
        "anti-trivial": {
          "expected-win": antiExpectedWin ?? false,
          actions: anti,
        },
      }],
    },
  };
  if (playability) doc.playability = playability;
  return yaml.dump(doc, { lineWidth: 120, noRefs: true });
}

function mechanicsYaml() {
  return [
    "version: 1",
    "primitive-catalog-version: 1",
    "external-events: [match.hit]",
    "entities:",
    "  - id: pig",
    "    uses: [resource-consume]",
    "    initial: { id: \"\", ammo: 1, alive: true }",
    "  - id: block",
    "    uses: [resource-consume]",
    "    initial: { id: \"\", hp: 1, alive: true }",
    "mechanics:",
    "  - node: attack-consume",
    "    primitive: resource-consume@v1",
    "    trigger-on: [match.hit]",
    "    params:",
    "      agent-field: pig.ammo",
    "      target-field: block.hp",
    "      amount: 1",
    "    produces-events: [resource.consumed, resource.agent-zero, resource.target-zero]",
    "  - node: end-check",
    "    primitive: win-lose-check@v1",
    "    params:",
    "      win:",
    "        - kind: all-cleared",
    "          collection: blocks",
    "      lose: []",
    "      evaluate-on: [resource.target-zero]",
    "    produces-events: [win, lose]",
    "",
  ].join("\n");
}
