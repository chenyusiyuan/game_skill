import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareCaseGame } from "../scripts/prepare_case_game.js";

if (process.env.SKIP_BROWSER_SMOKE) {
  console.log("SKIP delivery_runner_smoke: SKIP_BROWSER_SMOKE is set");
  process.exit(0);
}

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const fixtureDir = join(repoRoot, "tests/fixtures/delivery/minimal-case");
const caseDir = join(repoRoot, `cases/.runner-smoke-${randomUUID()}`);

try {
  cpSync(fixtureDir, caseDir, { recursive: true });
  prepareCaseGame(caseDir);

  const result = spawnSync(process.execPath, [join(repoRoot, "scripts/_delivery_runner.mjs"), "--case-dir", caseDir], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const resultPath = join(caseDir, "eval/runner-result.json");
  assert.equal(existsSync(resultPath), true, "runner writes runner-result.json");
  const runnerResult = JSON.parse(readFileSync(resultPath, "utf8"));
  assert.equal(runnerResult.ok, true, JSON.stringify(runnerResult, null, 2));
  assert.equal(runnerResult.summary.stepsCount, 1);
  assert.equal(runnerResult.summary.milestoneCount >= 1, true);
  assert.equal(runnerResult.summary.changedPixels >= 200, true);
  assert.equal(Number.isFinite(runnerResult.summary.idleNoise), true, "summary includes idleNoise");
  assert.equal(Number.isFinite(runnerResult.summary.noiseRatio), true, "summary includes noiseRatio");
  assert.equal(runnerResult.screenshots.mount, "eval/screenshots/mount.png");
  assert.equal(runnerResult.screenshots.afterSteps, "eval/screenshots/after-steps.png");
  assert.equal(runnerResult.screenshots.final, "eval/screenshots/final.png");
  assert.equal(existsSync(join(caseDir, runnerResult.screenshots.mount)), true, "mount screenshot exists");
  assert.equal(existsSync(join(caseDir, runnerResult.screenshots.afterSteps)), true, "after-steps screenshot exists");
  assert.equal(existsSync(join(caseDir, runnerResult.screenshots.final)), true, "final screenshot exists");
  assert.equal(Array.isArray(runnerResult.warnings), true, "runner writes structured warnings");
  assert(
    runnerResult.warnings.some((warning) => warning.kind === "idle-frozen"),
    "static fixture gets an idle-frozen liveness warning",
  );
  assert(
    runnerResult.warnings.some((warning) => warning.kind === "static-between-inputs"),
    "static fixture gets a static-between-inputs liveness warning",
  );
  assert.equal(
    runnerResult.warnings.some((warning) => warning.kind === "unexpected-milestone"),
    false,
    "clean fixture has no unexpected milestone warning",
  );
} finally {
  rmSync(caseDir, { recursive: true, force: true });
}

const warningCaseDir = join(repoRoot, `cases/.runner-warning-${randomUUID()}`);
try {
  cpSync(fixtureDir, warningCaseDir, { recursive: true });
  prepareCaseGame(warningCaseDir);
  const mainPath = join(warningCaseDir, "game/src/main.ts");
  const mainSource = readFileSync(mainPath, "utf8");
  writeFileSync(
    mainPath,
    mainSource.replace(
      'emitMilestone("primary-progress", { kind: "move-right", value: score });',
      'emitMilestone("primary-progress", { kind: "move-right", value: score });\n  emitMilestone("unexpected-progress", { value: score });',
    ),
    "utf8",
  );

  const warningResult = spawnSync(process.execPath, [join(repoRoot, "scripts/_delivery_runner.mjs"), "--case-dir", warningCaseDir], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
  });

  assert.equal(warningResult.status, 0, `${warningResult.stdout}\n${warningResult.stderr}`);
  const runnerResult = JSON.parse(readFileSync(join(warningCaseDir, "eval/runner-result.json"), "utf8"));
  assert.equal(runnerResult.ok, true, JSON.stringify(runnerResult, null, 2));
  assert(
    runnerResult.warnings.some(
      (warning) => warning.kind === "unexpected-milestone" && warning.id === "unexpected-progress" && warning.count === 1,
    ),
    "unexpected milestone warning is structured",
  );
} finally {
  rmSync(warningCaseDir, { recursive: true, force: true });
}

console.log("OK delivery_runner_smoke");
