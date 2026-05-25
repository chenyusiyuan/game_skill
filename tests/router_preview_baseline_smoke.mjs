#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEvolutionContext } from "../scripts/_evolution_context.js";
import { buildTriagePrompt } from "../scripts/_triage_prompt.js";
import { routeQuery } from "../scripts/triage_router.js";

const tempRoot = mkdtempSync(join(tmpdir(), "router-preview-"));

try {
  const caseDir = join(tempRoot, "case");
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  mkdirSync(join(caseDir, "docs"), { recursive: true });
  mkdirSync(join(caseDir, ".game"), { recursive: true });
  mkdirSync(join(caseDir, "eval"), { recursive: true });

  writeFileSync(join(caseDir, "specs/plan.json"), JSON.stringify({ rawQuery: "打砖块", controls: [] }), "utf8");
  writeFileSync(
    join(caseDir, "docs/DESIGN.md"),
    `# DESIGN.md

## coreLoop

\`\`\`yaml
coreLoop:
  primaryAction: 移动挡板反弹球
  successSignal: 砖块碎裂
\`\`\`

## uiSurfaces

\`\`\`yaml
uiSurfaces:
  primary: { description: HUD, elements: [score] }
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

### A.1 玩法 — 来源: from-query

**A**: 打砖块。
`,
    "utf8",
  );
  writeFileSync(join(caseDir, ".game/eval-provider.json"), JSON.stringify({ evalProvider: "local", evalModel: "none" }), "utf8");
  writeFileSync(
    join(caseDir, "eval/delivery.json"),
    JSON.stringify({
      status: "generation-blocked",
      blockReason: "expect-not-met",
      detail: { diagnostic: { failedExpects: [{ type: "milestone", id: "primary-progress", observed: 0, needed: 1 }] } },
    }),
    "utf8",
  );
  writeFileSync(
    join(caseDir, "eval/preview.json"),
    JSON.stringify({
      status: "preview-ready",
      reason: null,
      launchCommand: "node scripts/start_preview.js cases/demo",
      health: { canvas: { status: "ok", canvasSize: { width: 640, height: 480 } } },
    }),
    "utf8",
  );
  writeFileSync(
    join(caseDir, "eval/baseline.json"),
    JSON.stringify({
      baselineKind: "preview",
      baselineId: "preview-base-1",
      previewSummary: { status: "preview-ready" },
    }),
    "utf8",
  );

  const context = readEvolutionContext(caseDir);
  assert.equal(context.baselineSummary.baselineKind, "preview");
  assert.equal(context.previewSummary.status, "preview-ready");

  const prompt = buildTriagePrompt({
    rawQuery: "修复 primary-progress milestone 没触发",
    caseId: "case",
    plan: context.plan,
    deliverySummary: context.deliverySummary,
    previewSummary: context.previewSummary,
    runnerSummary: context.runnerSummary,
    qualityHintsSummary: context.qualityHintsSummary,
    designSummary: context.designSummary,
    decisionSummary: context.decisionSummary,
    baselineSummary: context.baselineSummary,
    recentEvolutionLog: [],
    screenshotArtifacts: {},
    providerConfig: context.providerConfig,
  });
  assert.match(prompt.user, /previewSummary/u);
  assert.match(prompt.user, /preview-ready/u);
  assert.match(prompt.user, /primary-progress/u);

  const decision = await routeQuery({
    casePath: caseDir,
    rawQuery: "修复 primary-progress milestone 没触发",
    forceLocal: true,
    logDecision: false,
  });
  assert.equal(decision.decision, "execute", JSON.stringify(decision, null, 2));
  assert.equal(decision.baselineRef, "preview-base-1");
  assert.equal(decision.subtasks[0].stage, 2);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("OK router_preview_baseline_smoke");
