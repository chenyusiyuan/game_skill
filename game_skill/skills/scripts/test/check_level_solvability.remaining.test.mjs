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
const benchmarkDir = join(here, "benchmark");
const tmp = join(here, ".tmp-level-solvability-remaining");

rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

test("benchmark: board-grid legal path passes softlock + trivial probes", () => {
  const dir = materialize("board-grid.yaml");
  const logPath = join(dir, ".game/log.jsonl");
  const res = run(dir, logPath);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const log = readFileSync(logPath, "utf-8");
  assert.match(log, /"step":"softlock-probe"/);
  assert.match(log, /"step":"trivial-probe"/);
});

test("benchmark: board-grid valid prefix softlock fails", () => {
  const dir = materialize("board-grid-softlock.yaml");
  const res = run(dir);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /softlock-after-prefix/);
});

test("benchmark: board-grid trivial click all wins fails", () => {
  const dir = materialize("board-grid-trivial.yaml");
  const res = run(dir);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /trivial-click-all-wins/);
});

test("benchmark: reflex minimal schema passes without reducer replay", () => {
  const dir = materialize("reflex-minimal.yaml");
  const logPath = join(dir, ".game/log.jsonl");
  const res = run(dir, logPath);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(readFileSync(logPath, "utf-8"), /"step":"reflex-schema"/);
});

test("benchmark: reflex hit window below physical floor fails", () => {
  const dir = materialize("reflex-bad-window.yaml");
  const res = run(dir);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /hit-window-ms<100/);
});

test("benchmark: edu-practice minimal schema passes", () => {
  const dir = materialize("edu-minimal.yaml");
  const logPath = join(dir, ".game/log.jsonl");
  const res = run(dir, logPath);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(readFileSync(logPath, "utf-8"), /"step":"edu-schema"/);
});

test("benchmark: edu-practice coverage mismatch fails", () => {
  const dir = materialize("edu-bad-coverage.yaml");
  const res = run(dir);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /progressive-difficulty\.coverage>item-count/);
});

function run(caseDir, logPath = null) {
  const args = [script, caseDir];
  if (logPath) args.push("--log", logPath);
  return spawnSync("node", args, { cwd: root, encoding: "utf-8" });
}

function materialize(name) {
  const fixture = yaml.load(readFileSync(join(benchmarkDir, name), "utf-8"));
  const dir = join(tmp, name.replace(/\.yaml$/, ""));
  mkdirSync(join(dir, "specs"), { recursive: true });
  mkdirSync(join(dir, ".game"), { recursive: true });
  writeFileSync(join(dir, "specs/mechanics.yaml"), yaml.dump(fixture.mechanics, { lineWidth: 120, noRefs: true }));
  writeFileSync(join(dir, "specs/data.yaml"), yaml.dump(fixture.data, { lineWidth: 120, noRefs: true }));
  return dir;
}
