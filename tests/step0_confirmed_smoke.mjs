#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const casesRoot = join(repoRoot, "cases");
const scriptPath = join(repoRoot, "scripts/check_step0_confirmed.js");
const created = [];
let unique = Date.now();

try {
  const validCase = makeCase(nextSlug("step0-smoke"));
  const pass = runCheck(validCase);
  assert.equal(pass.status, 0, `${pass.stdout}\n${pass.stderr}`);
  const passResult = JSON.parse(pass.stdout);
  assert.equal(passResult.status, "pass");
  assert.equal(passResult.warnings.some((warning) => /template selection|archetype/u.test(warning)), false);

  const invalidSlugCase = makeCase(`BadSlug-glm-${unique++}`);
  const invalidSlug = runCheck(invalidSlugCase);
  assert.equal(invalidSlug.status, 1, `${invalidSlug.stdout}\n${invalidSlug.stderr}`);
  assert(JSON.parse(invalidSlug.stdout).errors.some((error) => /invalid project slug/u.test(error)));

  const modelMismatchCase = makeCase(nextSlug("model-mismatch", "kimi"));
  const modelMismatch = runCheck(modelMismatchCase);
  assert.equal(modelMismatch.status, 1, `${modelMismatch.stdout}\n${modelMismatch.stderr}`);
  assert(JSON.parse(modelMismatch.stdout).errors.some((error) => /does not match host model/u.test(error)));

  const missingEvalCase = makeCase(nextSlug("missing-eval"), { skipEvalProvider: true });
  const missingEval = runCheck(missingEvalCase);
  assert.equal(missingEval.status, 1, `${missingEval.stdout}\n${missingEval.stderr}`);
  assert(JSON.parse(missingEval.stdout).errors.some((error) => /missing .*eval-provider\.json/u.test(error)));

  const mismatchCase = makeCase(nextSlug("vision-mismatch", "opus"), {
    visionPolicy: {
      visionMode: "enabled",
      hostModel: "claude-opus-4-7",
      mainAgentMayReadImages: true,
      compilerImagePolicy: "disabled",
      imageReadPolicy: "image reads allowed for this fixture",
    },
  });
  const mismatch = runCheck(mismatchCase);
  assert.equal(mismatch.status, 1, `${mismatch.stdout}\n${mismatch.stderr}`);
  assert(JSON.parse(mismatch.stdout).errors.some((error) => /state\.visionPolicy .* does not match/u.test(error)));
} finally {
  for (const caseDir of created) rmSync(caseDir, { recursive: true, force: true });
}

console.log("OK step0_confirmed_smoke");

function makeCase(slug, options = {}) {
  const caseDir = join(casesRoot, slug);
  created.push(caseDir);
  const gameDir = join(caseDir, ".game");
  mkdirSync(gameDir, { recursive: true });

  writeJson(join(gameDir, "state.json"), {
    "step-0-confirmed": {
      at: new Date().toISOString(),
      evaluator: {
        choice: "openrouter-api",
        "confirmed-by": "user-message",
        "user-message-id": "test-message-id",
      },
    },
    archetype: "top_down",
    selectedArchetype: "platformer",
    "selected-archetype": "grid_logic",
    visionPolicy: {
      visionMode: "disabled",
    },
  });

  if (!options.skipEvalProvider) {
    writeJson(join(gameDir, "eval-provider.json"), {
      evalProvider: "openrouter-api",
      confirmedByUser: true,
      confirmationMode: "user-message-id",
      userMessageId: "test-message-id",
    });
  }

  writeJson(join(gameDir, "vision-policy.json"), options.visionPolicy ?? {
    visionMode: "disabled",
    hostModel: "glm-5.1",
    mainAgentMayReadImages: false,
    compilerImagePolicy: "disabled",
    imageReadPolicy: "text-only fixture",
  });

  return caseDir;
}

function nextSlug(gameName, model = "glm") {
  return `${gameName}-${model}-${unique++}`;
}

function runCheck(caseDir) {
  return spawnSync(process.execPath, [scriptPath, caseDir, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 20_000,
  });
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
