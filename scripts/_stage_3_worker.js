import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FileSnapshot,
  buildCheckpoint,
  changedFilesFromSnapshot,
  checkForbiddenMutations,
  logCheckpoint,
  logRollback,
  logSubtaskResult,
  readJson,
  readTextOptional,
  resolveCasePath,
  resolveMainScenePath,
  runDeliveryCheck,
  summarizeFailure,
  writeJson,
} from "./_stage_common.js";
import { appendPublicDecisionLog, deriveMechanicAnchor, readEvolutionContext } from "./_evolution_context.js";
import { evaluateMustNot } from "./_mustnot_evaluator.js";
import { formatDiagnostics, validatePlan } from "./validate_plan.js";

const PROGRESS_MECHANIC = {
  name: "destroyed-brick-progress",
  summary: "累计记录本局已击碎砖块，并在破坏进度更新时发出目标进度证据",
};
const PROGRESS_MUST_HAVE = {
  id: "destroy-10-bricks-progress",
  text: "击碎砖块时更新累计破坏 10 个砖块的进度 milestone",
  mechanicRefs: ["destroyed-brick-progress"],
  evidence: [{ type: "milestone", id: "brick-destroy-progress" }],
};
const PROGRESS_EXPECT = { type: "milestone", id: "brick-destroy-progress", timeoutMs: 10000 };
const COMBO_MECHANIC = {
  name: "combo-achievement-progress",
  summary: "连续击碎砖块时记录 5 连击成就进度，并发出可观察进度 milestone",
};
const COMBO_MUST_HAVE = {
  id: "combo-5-achievement-progress",
  text: "连续击碎砖块时更新 5 连击成就进度 milestone",
  mechanicRefs: ["combo-achievement-progress"],
  evidence: [{ type: "milestone", id: "combo-achievement-progress" }],
};
const COMBO_EXPECT = { type: "milestone", id: "combo-achievement-progress", timeoutMs: 10000 };

export async function runStage3({ casePath, subtask, evolutionContext }) {
  const caseDir = resolveCasePath(casePath);
  const subtaskId = subtask?.id ?? "unknown";
  const text = subtask?.subIntent ?? "";

  if (!subtask || subtask.stage !== 3) {
    return failResult(caseDir, subtaskId, ["worker received mismatched subtask stage"]);
  }
  if (isTuningRequest(text)) {
    await logRollback({ caseDir, subtaskId, stage: 3, reason: "wrong-worker" });
    return kickBackResult(caseDir, subtaskId, 4, "请求是在调整数值或节奏，不是新增体验契约");
  }
  if (isPersistentStorageRequest(text)) {
    await logRollback({ caseDir, subtaskId, stage: 3, reason: "missing-capability" });
    return failResult(caseDir, subtaskId, ["missing capability: persistent storage is not present in this case"]);
  }
  if (!isDestroyProgressRequest(text) && !isComboAchievementRequest(text)) {
    await logRollback({ caseDir, subtaskId, stage: 3, reason: "unsupported-deterministic-feature" });
    return failResult(caseDir, subtaskId, ["unsupported deterministic new-feature POC"]);
  }

  const planPath = join(caseDir, "specs/plan.json");
  const decisionsPath = join(caseDir, "docs/decisions.md");
  const context = readEvolutionContext(caseDir);
  const derivedFrom = deriveMechanicAnchor(context.designSummary, "mechanic");
  if (!derivedFrom) {
    return failResult(caseDir, subtaskId, ["DESIGN.md missing usable anchor for new requiredMechanics.derivedFrom"]);
  }
  const scenePath = resolveMainScenePath(caseDir);
  if (!scenePath) {
    return failResult(caseDir, subtaskId, ["main scene file not found under game/src/scenes/"]);
  }
  const snapshot = new FileSnapshot().capture([planPath, scenePath, decisionsPath]);
  const beforePlan = readJson(planPath);

  try {
    const plan = addFeaturePlanContracts(beforePlan, {
      destroyProgress: isDestroyProgressRequest(text),
      comboAchievement: isComboAchievementRequest(text),
      derivedFrom,
    });
    writeJson(planPath, plan);
    appendFeatureDecisionLog({
      decisionsPath,
      subtaskId,
      destroyProgress: isDestroyProgressRequest(text),
      comboAchievement: isComboAchievementRequest(text),
      derivedFrom,
    });
    const planCheck = validatePlan(caseDir);
    if (!planCheck.ok) {
      throw new Error(`plan invalid after new feature contract: ${formatDiagnostics(planCheck.errors)}`);
    }
    patchFeatureCode(scenePath, {
      destroyProgress: isDestroyProgressRequest(text),
      comboAchievement: isComboAchievementRequest(text),
    });

    const afterPlan = readJson(planPath);
    const changedFiles = changedFilesFromSnapshot(caseDir, snapshot);
    const forbidden = checkForbiddenMutations({
      stage: 3,
      beforePlan,
      afterPlan,
      changedFilePaths: changedFiles,
    });
    if (!forbidden.ok) {
      snapshot.restore();
      await logRollback({ caseDir, subtaskId, stage: 3, reason: forbidden.kind });
      return kickBackResult(caseDir, subtaskId, 3, forbidden.detail);
    }

    const deliveryResult = await runDeliveryCheck(caseDir);
    if (!deliveryResult.ok) {
      snapshot.restore();
      await logRollback({ caseDir, subtaskId, stage: 3, reason: "delivery-regression" });
      return failResult(caseDir, subtaskId, summarizeFailure(deliveryResult.delivery, deliveryResult.runnerResult));
    }
    const mustNotResult = await evaluateMustNot({
      casePath: caseDir,
      plan: readJson(planPath),
      runnerResult: deliveryResult.runnerResult,
      subtaskId,
    });
    if (!mustNotResult.passed) {
      snapshot.restore();
      await logRollback({ caseDir, subtaskId, stage: 3, reason: "mustNot-violation" });
      return failResult(
        caseDir,
        subtaskId,
        mustNotResult.violations.map((violation) => `mustNot ${violation.id}: ${violation.text}`),
      );
    }

    const checkpoint = buildCheckpoint({
      casePath: caseDir,
      deliveryResult,
      changedFiles,
      note: "added brick destruction progress evidence",
    });
    await logCheckpoint({ caseDir, subtaskId, stage: 3, checkpoint });
    const result = { verdict: "pass", checkpoint };
    await logSubtaskResult({ caseDir, subtaskId, stage: 3, result });
    return result;
  } catch (error) {
    snapshot.restore();
    const message = error instanceof Error ? error.message : String(error);
    await logRollback({ caseDir, subtaskId, stage: 3, reason: message });
    return failResult(caseDir, subtaskId, [message]);
  }
}

export function addFeaturePlanContracts(beforePlan, { destroyProgress, comboAchievement, derivedFrom }) {
  const plan = JSON.parse(JSON.stringify(beforePlan));
  plan.requiredMechanics ??= [];
  plan.acceptance ??= {};
  plan.acceptance.mustHave ??= [];
  plan.smoke ??= {};
  plan.smoke.expect ??= [];

  if (destroyProgress && !plan.requiredMechanics.some((item) => item?.name === PROGRESS_MECHANIC.name)) {
    plan.requiredMechanics.push({ ...PROGRESS_MECHANIC, derivedFrom });
  }
  if (destroyProgress && !plan.acceptance.mustHave.some((item) => item?.id === PROGRESS_MUST_HAVE.id)) {
    plan.acceptance.mustHave.push(PROGRESS_MUST_HAVE);
  }
  if (destroyProgress && !plan.smoke.expect.some((item) => item?.type === "milestone" && item?.id === PROGRESS_EXPECT.id)) {
    plan.smoke.expect.push(PROGRESS_EXPECT);
  }
  if (comboAchievement && !plan.requiredMechanics.some((item) => item?.name === COMBO_MECHANIC.name)) {
    plan.requiredMechanics.push({ ...COMBO_MECHANIC, derivedFrom });
  }
  if (comboAchievement && !plan.acceptance.mustHave.some((item) => item?.id === COMBO_MUST_HAVE.id)) {
    plan.acceptance.mustHave.push(COMBO_MUST_HAVE);
  }
  if (comboAchievement && !plan.smoke.expect.some((item) => item?.type === "milestone" && item?.id === COMBO_EXPECT.id)) {
    plan.smoke.expect.push(COMBO_EXPECT);
  }
  return plan;
}

function appendFeatureDecisionLog({ decisionsPath, subtaskId, destroyProgress, comboAchievement, derivedFrom }) {
  const featureNames = [
    destroyProgress ? "破坏进度 milestone" : null,
    comboAchievement ? "连击成就进度 milestone" : null,
  ].filter(Boolean);
  appendPublicDecisionLog({
    decisionsPath,
    subtaskId,
    title: "演进新增机制契约",
    decision: `新增 ${featureNames.join("、")}，并把 requiredMechanics.derivedFrom 绑定到 ${derivedFrom}。`,
    basis: "该机制是用户演进 query 要求的新体验，属于唯一允许扩展 plan shape 的新增机制路径。",
    risk: "新增证据必须和旧 smoke 一起回归；若后续 delivery 退化，本 subtask 回滚。",
  });
}

function patchFeatureCode(scenePath, { destroyProgress, comboAchievement }) {
  let content = readTextOptional(scenePath);
  if (content === null) throw new Error(`scene file missing: ${scenePath}`);

  if (destroyProgress && !content.includes("BRICK_PROGRESS_TARGET")) {
    content = content.replace(
      "const MAX_LIVES = 3;\n",
      "const MAX_LIVES = 3;\nconst BRICK_PROGRESS_TARGET = 10;\n",
    );
  }
  if (comboAchievement && !content.includes("COMBO_ACHIEVEMENT_TARGET")) {
    content = content.replace(
      "const MAX_LIVES = 3;\n",
      "const MAX_LIVES = 3;\nconst COMBO_ACHIEVEMENT_TARGET = 5;\n",
    );
  }
  if (destroyProgress && !content.includes("private destroyedBricks = 0;")) {
    content = content.replace("  private comboTimer = 0;\n", "  private comboTimer = 0;\n  private destroyedBricks = 0;\n");
  }
  if (destroyProgress && !content.includes("this.destroyedBricks = 0;")) {
    content = content.replace("    this.comboTimer = 0;\n", "    this.comboTimer = 0;\n    this.destroyedBricks = 0;\n");
  }
  if (destroyProgress && !content.includes("destroyedBricks: this.destroyedBricks")) {
    content = content.replace(
      "      combo: this.combo,\n",
      "      combo: this.combo,\n      destroyedBricks: this.destroyedBricks,\n      destroyTarget: BRICK_PROGRESS_TARGET,\n",
    );
  }
  if (comboAchievement && !content.includes("comboAchievementTarget")) {
    content = content.replace(
      "      combo: this.combo,\n",
      "      combo: this.combo,\n      comboAchievementTarget: COMBO_ACHIEVEMENT_TARGET,\n",
    );
  }
  if (destroyProgress && !content.includes("private recordBrickProgress()")) {
    content = content.replace(
      "  private maybeDropPowerUp(x: number, y: number, brickType: number): void {\n",
      "  private recordBrickProgress(): void {\n    this.destroyedBricks++;\n    emitMilestone(\"brick-destroy-progress\", {\n      destroyed: this.destroyedBricks,\n      target: BRICK_PROGRESS_TARGET,\n    });\n  }\n\n  private maybeDropPowerUp(x: number, y: number, brickType: number): void {\n",
    );
  }
  if (comboAchievement && !content.includes("private recordComboAchievementProgress()")) {
    content = content.replace(
      "  private maybeDropPowerUp(x: number, y: number, brickType: number): void {\n",
      "  private recordComboAchievementProgress(): void {\n    emitMilestone(\"combo-achievement-progress\", {\n      combo: this.combo,\n      target: COMBO_ACHIEVEMENT_TARGET,\n      achieved: this.combo >= COMBO_ACHIEVEMENT_TARGET,\n    });\n  }\n\n  private maybeDropPowerUp(x: number, y: number, brickType: number): void {\n",
    );
  }
  if (destroyProgress && !content.includes("this.recordBrickProgress();")) {
    content = content.replace("          this.addScore(bd.type);\n", "          this.addScore(bd.type);\n          this.recordBrickProgress();\n");
  }
  if (comboAchievement && !content.includes("this.recordComboAchievementProgress();")) {
    content = content.replace("          this.addScore(bd.type);\n", "          this.addScore(bd.type);\n          this.recordComboAchievementProgress();\n");
  }

  writeFileSync(scenePath, content, "utf8");
}

async function failResult(caseDir, subtaskId, errors) {
  const result = { verdict: "fail", errors };
  await logSubtaskResult({ caseDir, subtaskId, stage: 3, result });
  return result;
}

async function kickBackResult(caseDir, subtaskId, suggestedStage, reason) {
  const result = {
    verdict: "kicked-back",
    kickBack: {
      rolledBack: true,
      suggestedStage,
      reason,
    },
  };
  await logSubtaskResult({ caseDir, subtaskId, stage: 3, result });
  return result;
}

function isDestroyProgressRequest(text) {
  return /累计|破坏\s*10|10\s*个砖|破坏进度|进度\s*milestone|progress/u.test(text);
}

function isComboAchievementRequest(text) {
  return /连击|combo|成就/u.test(text);
}

function isTuningRequest(text) {
  return /球速|速度|太快|太慢|慢点|快点|手感|节奏|调慢|调快/u.test(text);
}

function isPersistentStorageRequest(text) {
  return /跨局|存档|持久|保存|localStorage|storage/u.test(text);
}
