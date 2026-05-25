#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEvolutionContext } from "../scripts/_evolution_context.js";

const tempRoot = mkdtempSync(join(tmpdir(), "evolution-context-"));

try {
  const caseDir = join(tempRoot, "case");
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  mkdirSync(join(caseDir, "docs"), { recursive: true });
  mkdirSync(join(caseDir, ".game"), { recursive: true });
  mkdirSync(join(caseDir, "eval"), { recursive: true });

  writeFileSync(join(caseDir, "specs/plan.json"), "{}\n", "utf8");
  writeFileSync(
    join(caseDir, "docs/DESIGN.md"),
    `# DESIGN.md

## visualIdentity

\`\`\`yaml
visualIdentity:
  palette: { background: '#101820', primary: '#f6d365', secondary: '#35a7ff', accent: '#ff6b6b', danger: '#ff2e63' }
\`\`\`

## uiSurfaces

\`\`\`yaml
uiSurfaces:
  primary: { description: 常驻 HUD, elements: [score, combo] }
\`\`\`

## coreLoop

\`\`\`yaml
coreLoop:
  primaryAction: 移动挡板接球并击碎砖块
  successSignal: 砖块碎裂 + 分数跳动
\`\`\`

## mustAvoid

- default-purple-blue-orbs
- 不要让挡板速度继续变快
`,
    "utf8",
  );
  writeFileSync(
    join(caseDir, "docs/decisions.md"),
    `# decisions.md

## A. 设计期决策

### A.1 archetype 识别 — 来源: from-query

**A**: 砖块破坏主循环。

## B. 实现期决策

### B.1 文件与职责 — 来源: from-design

**决策**: 单 scene 实现主闭环。
`,
    "utf8",
  );
  writeFileSync(
    join(caseDir, ".game/rubric.json"),
    `${JSON.stringify({
      "content-density": 3,
      "mechanical-differentiation": 4,
      "visual-feedback": 2,
      "hud-information": 2,
      "feel-juice": 3,
      "genre-fitness": 4,
    }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(caseDir, "eval/delivery.json"),
    `${JSON.stringify({
      status: "delivery-with-warnings",
      warnings: [{ kind: "nonblocking-todos", severity: "info" }],
      qualityHints: {
        visual: {
          available: true,
          colorCount: 3,
          shapeRegions: 4,
          hudOccupancy: 0.01,
          centerActivity: 0.03,
          warnings: ["colorCount-low", "hud-empty", "center-static"],
        },
        rubric: {
          "content-density": 3,
          "mechanical-differentiation": 4,
          "visual-feedback": 2,
          "hud-information": 2,
          "feel-juice": 3,
          "genre-fitness": 4,
        },
        scopeReport: {
          available: true,
          fromQueryCount: 2,
          fromGenreKnowledgeCount: 1,
          fromReasoningCount: 1,
          demotedCount: 1,
          demoted: [{ title: "额外皮肤", source: "from-query" }],
          scopeLeaks: ["scope-leak: extra-skin"],
        },
        loc: { scaffoldLoc: 40, businessLoc: 220, helperImportCount: 2, helperCallCount: 3 },
      },
    }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(join(caseDir, "eval/runner-result.json"), JSON.stringify({ summary: { milestoneCount: 1 } }), "utf8");
  writeFileSync(join(caseDir, "eval/baseline.json"), JSON.stringify({ baselineId: "b-1" }), "utf8");

  const context = readEvolutionContext(caseDir);
  assert.equal(context.designSummary.available, true);
  assert(context.designSummary.anchors.includes("coreLoop.primaryAction"));
  assert(context.designSummary.mustAvoid.includes("不要让挡板速度继续变快"));
  assert.equal(context.decisionSummary.sourceCounts["from-query"], 1);
  assert.deepEqual(context.qualityHintsSummary.visual.warnings, ["colorCount-low", "hud-empty", "center-static"]);
  assert.equal(context.qualityHintsSummary.scopeReport.demoted[0].title, "额外皮肤");
  assert.equal(JSON.stringify(context).includes("data:image"), false, "context must not embed screenshot data");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("OK evolution_context_smoke");
