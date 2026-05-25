#!/usr/bin/env node
import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareCaseGame } from "../scripts/prepare_case_game.js";

if (process.env.SKIP_BROWSER_SMOKE) {
  console.log("SKIP preview_runner_smoke: SKIP_BROWSER_SMOKE is set");
  process.exit(0);
}

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const fixtureDir = join(repoRoot, "tests/fixtures/delivery/minimal-case");
const caseDir = join(repoRoot, `cases/.preview-smoke-${randomUUID()}`);

try {
  cpSync(fixtureDir, caseDir, { recursive: true });
  prepareCaseGame(caseDir);

  const result = spawnSync(process.execPath, [join(repoRoot, "scripts/check_preview.js"), caseDir], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 90_000,
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const previewPath = join(caseDir, "eval/preview.json");
  assert.equal(existsSync(previewPath), true, "check_preview writes preview.json");
  const preview = JSON.parse(readFileSync(previewPath, "utf8"));
  assert.equal(preview.status, "preview-ready", JSON.stringify(preview, null, 2));
  assert.equal(preview.health.typecheck.status, "ok");
  assert.equal(preview.health.build.status, "ok");
  assert.equal(preview.health.canvas.status, "ok");
  assert.equal(preview.screenshots.mount, "eval/preview-screenshots/mount.png");
  assert.equal(existsSync(join(caseDir, preview.screenshots.mount)), true, "preview mount screenshot exists");

  const baseline = JSON.parse(readFileSync(join(caseDir, "eval/baseline.json"), "utf8"));
  assert.equal(baseline.baselineKind, "preview");
  assert.equal(baseline.previewSummary.status, "preview-ready");
} finally {
  rmSync(caseDir, { recursive: true, force: true });
}

console.log("OK preview_runner_smoke");
