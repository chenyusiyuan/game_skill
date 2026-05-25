#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEvolutionContext } from "../scripts/_evolution_context.js";
import { buildTriagePrompt } from "../scripts/_triage_prompt.js";
import { routeQuery } from "../scripts/triage_router.js";

const tempRoot = mkdtempSync(join(tmpdir(), "evolution-router-"));

try {
  const caseDir = join(tempRoot, "case");
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  mkdirSync(join(caseDir, "docs"), { recursive: true });
  mkdirSync(join(caseDir, ".game"), { recursive: true });
  mkdirSync(join(caseDir, "eval"), { recursive: true });

  writeFileSync(join(caseDir, "specs/plan.json"), JSON.stringify({ rawQuery: "打砖块" }), "utf8");
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
  writeFileSync(join(caseDir, "eval/baseline.json"), JSON.stringify({ baselineId: "base-1" }), "utf8");
  writeFileSync(
    join(caseDir, "eval/delivery.json"),
    JSON.stringify({
      status: "delivery-with-warnings",
      warnings: [],
      qualityHints: {
        visual: { available: true, colorCount: 3, shapeRegions: 5, hudOccupancy: 0.01, centerActivity: 0.05, warnings: ["hud-empty"] },
        rubric: { "content-density": 3, "feel-juice": 3, "visual-feedback": 2, "hud-information": 2 },
      },
    }),
    "utf8",
  );
  writeFileSync(join(caseDir, "eval/runner-result.json"), JSON.stringify({ summary: { milestoneCount: 1 } }), "utf8");

  const context = readEvolutionContext(caseDir);
  const prompt = buildTriagePrompt({
    rawQuery: "继续打磨收尾",
    caseId: "case",
    plan: context.plan,
    deliverySummary: context.deliverySummary,
    runnerSummary: context.runnerSummary,
    qualityHintsSummary: context.qualityHintsSummary,
    designSummary: context.designSummary,
    decisionSummary: context.decisionSummary,
    baselineSummary: context.baselineSummary,
    recentEvolutionLog: [],
    screenshotArtifacts: {},
    providerConfig: context.providerConfig,
  });
  assert.match(prompt.user, /qualityHintsSummary/u);
  assert.match(prompt.user, /hud-empty/u);
  assert.match(prompt.user, /designSummary/u);

  const decision = await routeQuery({ casePath: caseDir, rawQuery: "继续打磨收尾", forceLocal: true, logDecision: false });
  assert.equal(decision.decision, "execute");
  assert.deepEqual(decision.subtasks.map((subtask) => subtask.stage), [4, 5]);
  assert.equal(decision.subtasks[1].subIntent, "HUD 信息强化");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("OK evolution_router_context_smoke");
