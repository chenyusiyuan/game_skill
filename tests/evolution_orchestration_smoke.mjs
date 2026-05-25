#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvolution } from "../scripts/run_evolution.js";

const tempRoot = mkdtempSync(join(tmpdir(), "evolution-orchestration-"));

try {
  const caseDir = join(tempRoot, "case");
  mkdirSync(caseDir, { recursive: true });
  const result = await runEvolution({
    casePath: caseDir,
    rawQuery: "修复后新增进度、调手感并美化",
    forceLocal: true,
    testHooks: {
      routeQuery: async () => ({
        decision: "execute",
        rawQuery: "修复后新增进度、调手感并美化",
        caseId: "case",
        baselineRef: "base-1",
        subtasks: [2, 3, 4, 5].map((stage, index) => ({
          id: `s${stage}-${String(index + 1).padStart(3, "0")}`,
          stage,
          subIntent: ["现有异常修复", "新增破坏进度", "玩法体验打磨", "表现层优化"][index],
          specImpact: stage === 3 ? "spec-shape-change" : "none",
          evidenceRequired: ["synthetic-smoke"],
          stopIfFails: true,
          dependsOn: [],
          expectedArtifacts: ["synthetic"],
        })),
        conflicts: [],
      }),
      dispatchWorker: async ({ subtask }) => ({
        verdict: "pass",
        checkpoint: {
          baselineId: "base-1",
          deliveryStatus: "delivery-with-warnings",
          stage: subtask.stage,
          qualityHintsSummary: { available: true },
        },
      }),
    },
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.results.map((item) => item.checkpoint.stage), [2, 3, 4, 5]);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("OK evolution_orchestration_smoke");
