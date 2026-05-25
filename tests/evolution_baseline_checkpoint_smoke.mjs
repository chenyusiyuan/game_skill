#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeBaseline } from "../scripts/_baseline_writer.js";
import { buildCheckpoint } from "../scripts/_stage_common.js";

const tempRoot = mkdtempSync(join(tmpdir(), "evolution-baseline-"));

try {
  const caseDir = join(tempRoot, "case");
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  mkdirSync(join(caseDir, "docs"), { recursive: true });
  mkdirSync(join(caseDir, "eval"), { recursive: true });

  const planPath = join(caseDir, "specs/plan.json");
  writeFileSync(planPath, JSON.stringify({ meta: { caseId: "case", createdAt: "2026-05-25T00:00:00.000Z" } }), "utf8");
  writeFileSync(
    join(caseDir, "docs/DESIGN.md"),
    `# DESIGN.md

## uiSurfaces

\`\`\`yaml
uiSurfaces:
  primary: { description: 常驻 HUD, elements: [score] }
\`\`\`

## coreLoop

\`\`\`yaml
coreLoop:
  primaryAction: 接球反弹
  successSignal: 砖块碎裂
\`\`\`

## mustAvoid

- default-purple-blue-orbs
`,
    "utf8",
  );
  writeFileSync(
    join(caseDir, "docs/decisions.md"),
    `# decisions.md

## A. 设计期决策

### A.1 主闭环 — 来源: from-query

**A**: 接球反弹。
`,
    "utf8",
  );

  const deliveryRecord = {
    status: "delivery-with-warnings",
    warnings: [{ kind: "nonblocking-todos", severity: "info" }],
    qualityHints: {
      visual: { available: true, colorCount: 4, shapeRegions: 7, hudOccupancy: 0.04, centerActivity: 0.2, warnings: ["hud-empty"] },
      rubric: { "hud-information": 2 },
      scopeReport: { available: true, fromQueryCount: 1, demotedCount: 0 },
      loc: { scaffoldLoc: 50, businessLoc: 160, helperImportCount: 1, helperCallCount: 1 },
    },
  };
  const runnerResult = { summary: { milestoneCount: 2, changedPixels: 3000 }, screenshots: { final: "eval/screenshots/final.png" } };

  await writeBaseline({ casePath: caseDir, deliveryRecord, runnerResult, planPath });
  const baseline = JSON.parse(readFileSync(join(caseDir, "eval/baseline.json"), "utf8"));
  assert.equal(baseline.baselineKind, "delivery");
  assert.equal(baseline.deliverySummary.status, "delivery-with-warnings");
  assert.deepEqual(baseline.qualityHintsSummary.visual.warnings, ["hud-empty"]);
  assert.equal(baseline.designSummary.anchors.includes("coreLoop.primaryAction"), true);
  assert.equal(baseline.decisionSummary.sourceCounts["from-query"], 1);

  const checkpoint = buildCheckpoint({
    casePath: caseDir,
    deliveryResult: { delivery: deliveryRecord, runnerResult, ok: true },
    beforeDeliveryResult: {
      delivery: {
        status: "delivery-with-warnings",
        qualityHints: { visual: { available: true, hudOccupancy: 0.02, warnings: ["hud-empty"] } },
      },
    },
    changedFiles: ["game/src/scenes/PlayScene.ts"],
  });
  assert.equal(checkpoint.baselineId, baseline.baselineId);
  assert.equal(checkpoint.qualityHintsSummary.visual.hudOccupancy, 0.04);
  assert.equal(checkpoint.beforeDeliverySummary.status, "delivery-with-warnings");
  assert.equal(checkpoint.afterDeliverySummary.status, "delivery-with-warnings");

  await writeBaseline({
    casePath: caseDir,
    deliveryRecord: { status: "generation-blocked", blockReason: "expect-not-met" },
    runnerResult: { ok: false, reason: "expect-not-met" },
    planPath,
    baselineKind: "preview",
    previewRecord: { status: "preview-ready", reason: null, health: { canvas: { status: "ok" } } },
  });
  const previewBaseline = JSON.parse(readFileSync(join(caseDir, "eval/baseline.json"), "utf8"));
  assert.equal(previewBaseline.baselineKind, "preview");
  assert.equal(previewBaseline.previewSummary.status, "preview-ready");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("OK evolution_baseline_checkpoint_smoke");
