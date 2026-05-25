#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveMechanicAnchor,
  mustAvoidBlocksPaddleSpeed,
  summarizeDesign,
} from "../scripts/_evolution_context.js";
import { addFeaturePlanContracts } from "../scripts/_stage_3_worker.js";
import { validatePlan } from "../scripts/validate_plan.js";

const repoRoot = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "evolution-worker-contract-"));

try {
  const caseDir = join(tempRoot, "case");
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  mkdirSync(join(caseDir, "docs"), { recursive: true });

  const design = `# DESIGN.md

## visualIdentity

\`\`\`yaml
visualIdentity:
  palette: { background: '#101820', primary: '#f6d365', secondary: '#35a7ff', accent: '#ff6b6b', danger: '#ff2e63' }
\`\`\`

## uiSurfaces

\`\`\`yaml
uiSurfaces:
  primary: { description: 常驻 HUD, elements: [score] }
\`\`\`

## coreLoop

\`\`\`yaml
coreLoop:
  primaryAction: 移动挡板反弹球并击碎砖块
  successSignal: 砖块碎裂 + 分数跳动
\`\`\`

## mustAvoid

- default-purple-blue-orbs
- 不要让挡板速度继续变快
`;
  writeFileSync(join(caseDir, "docs/DESIGN.md"), design, "utf8");

  const plan = JSON.parse(readFileSync(join(repoRoot, "tests/fixtures/plan.valid.json"), "utf8"));
  for (const mechanic of plan.requiredMechanics) {
    mechanic.derivedFrom = "coreLoop.primaryAction";
  }
  const next = addFeaturePlanContracts(plan, { destroyProgress: true, comboAchievement: false, derivedFrom: "coreLoop.primaryAction" });
  writeFileSync(join(caseDir, "specs/plan.json"), `${JSON.stringify(next, null, 2)}\n`, "utf8");

  const progress = next.requiredMechanics.find((mechanic) => mechanic.name === "destroyed-brick-progress");
  assert.equal(progress.derivedFrom, "coreLoop.primaryAction");
  const result = validatePlan(caseDir);
  assert.equal(result.ok, true, result.errors.join("\n"));

  assert.equal(deriveMechanicAnchor(summarizeDesign(design), "mechanic"), "coreLoop.primaryAction");
  assert.equal(deriveMechanicAnchor(summarizeDesign("# DESIGN.md"), "mechanic"), null);
  assert.equal(mustAvoidBlocksPaddleSpeed(["不要让挡板速度继续变快"]), true);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("OK evolution_worker_contract_smoke");
