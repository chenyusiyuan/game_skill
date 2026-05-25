import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FileSnapshot,
  buildCheckpoint,
  changedFilesFromSnapshot,
  checkForbiddenMutations,
  findTunableNumberConstant,
  logCheckpoint,
  logRollback,
  logSubtaskResult,
  readJson,
  readTextOptional,
  resolveCasePath,
  resolveMainScenePath,
  runDeliveryCheck,
  summarizeFailure,
} from "./_stage_common.js";
import { evaluateMustNot } from "./_mustnot_evaluator.js";

export async function runStage4({ casePath, subtask, evolutionContext }) {
  const caseDir = resolveCasePath(casePath);
  const subtaskId = subtask?.id ?? "unknown";
  const text = `${evolutionContext?.rawQuery ?? ""} ${subtask?.subIntent ?? ""}`;

  if (!subtask || subtask.stage !== 4) {
    return failResult(caseDir, subtaskId, ["worker received mismatched subtask stage"]);
  }
  if (wantsContractShape(text)) {
    await logRollback({ caseDir, subtaskId, stage: 4, reason: "wrong-worker" });
    return kickBackResult(caseDir, subtaskId, 3, "请求需要改变验收契约形状");
  }
  if (wantsInputRemap(text)) {
    await logRollback({ caseDir, subtaskId, stage: 4, reason: "wrong-worker" });
    return kickBackResult(caseDir, subtaskId, 3, "请求需要改变 controls[].input");
  }
  if (!wantsBallSpeedTune(text)) {
    await logRollback({ caseDir, subtaskId, stage: 4, reason: "unsupported-deterministic-tuning" });
    return failResult(caseDir, subtaskId, ["unsupported deterministic tuning POC"]);
  }

  const planPath = join(caseDir, "specs/plan.json");
  const scenePath = resolveMainScenePath(caseDir);
  if (!scenePath) {
    return failResult(caseDir, subtaskId, ["main scene file not found under game/src/scenes/"]);
  }
  const snapshot = new FileSnapshot().capture([planPath, scenePath]);
  const beforePlan = readJson(planPath);

  try {
    const beforeDelivery = await runDeliveryCheck(caseDir);
    patchBallSpeed(scenePath, speedDirection(text));

    const afterPlan = readJson(planPath);
    const changedFiles = changedFilesFromSnapshot(caseDir, snapshot);
    const forbidden = checkForbiddenMutations({
      stage: 4,
      beforePlan,
      afterPlan,
      changedFilePaths: changedFiles,
    });
    if (!forbidden.ok) {
      snapshot.restore();
      await logRollback({ caseDir, subtaskId, stage: 4, reason: forbidden.kind });
      return kickBackResult(caseDir, subtaskId, 3, forbidden.detail);
    }

    const afterDelivery = await runDeliveryCheck(caseDir);
    if (!afterDelivery.ok) {
      snapshot.restore();
      await logRollback({ caseDir, subtaskId, stage: 4, reason: "delivery-regression" });
      return failResult(caseDir, subtaskId, summarizeFailure(afterDelivery.delivery, afterDelivery.runnerResult));
    }
    const mustNotResult = await evaluateMustNot({
      casePath: caseDir,
      plan: readJson(planPath),
      runnerResult: afterDelivery.runnerResult,
      subtaskId,
    });
    if (!mustNotResult.passed) {
      snapshot.restore();
      await logRollback({ caseDir, subtaskId, stage: 4, reason: "mustNot-violation" });
      return failResult(
        caseDir,
        subtaskId,
        mustNotResult.violations.map((violation) => `mustNot ${violation.id}: ${violation.text}`),
      );
    }

    const checkpoint = buildCheckpoint({
      casePath: caseDir,
      deliveryResult: afterDelivery,
      changedFiles,
      note: "tuned ball speed constant",
    });
    checkpoint.beforeRunnerSummary = beforeDelivery.runnerResult?.summary ?? beforeDelivery.delivery?.detail?.runner ?? null;
    await logCheckpoint({ caseDir, subtaskId, stage: 4, checkpoint });
    const result = { verdict: "pass", checkpoint };
    await logSubtaskResult({ caseDir, subtaskId, stage: 4, result });
    return result;
  } catch (error) {
    snapshot.restore();
    const message = error instanceof Error ? error.message : String(error);
    await logRollback({ caseDir, subtaskId, stage: 4, reason: message });
    return failResult(caseDir, subtaskId, [message]);
  }
}

function patchBallSpeed(scenePath, direction) {
  const content = readTextOptional(scenePath);
  if (content === null) throw new Error(`scene file missing: ${scenePath}`);
  const tunable = findTunableNumberConstant(content, [
    "BASE_BALL_SPEED",
    "BALL_SPEED",
    "INITIAL_BALL_SPEED",
    "DEFAULT_BALL_SPEED",
  ]);
  if (!tunable) throw new Error("ball speed constant not found (tried BASE_BALL_SPEED / BALL_SPEED / INITIAL_BALL_SPEED / DEFAULT_BALL_SPEED)");
  const next = direction === "down"
    ? Math.max(120, Math.round(tunable.value * 0.9))
    : Math.min(360, Math.round(tunable.value * 1.1));
  if (next === tunable.value) throw new Error("tuning headroom exhausted");
  const pattern = new RegExp(`const\\s+${tunable.name}\\s*=\\s*\\d+\\s*;`, "u");
  writeFileSync(scenePath, content.replace(pattern, `const ${tunable.name} = ${next};`), "utf8");
}

async function failResult(caseDir, subtaskId, errors) {
  const result = { verdict: "fail", errors };
  await logSubtaskResult({ caseDir, subtaskId, stage: 4, result });
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
  await logSubtaskResult({ caseDir, subtaskId, stage: 4, result });
  return result;
}

function wantsBallSpeedTune(text) {
  return /球速|速度|太快|太慢|慢点|快点|调慢|调快|提一点|降低|提高/u.test(text);
}

function speedDirection(text) {
  if (/太快|慢点|调慢|降低/u.test(text)) return "down";
  return "up";
}

function wantsContractShape(text) {
  return /mustHave|新增验收|加验收|新增机制|新机制|加一个机制|新增\s*required/u.test(text);
}

function wantsInputRemap(text) {
  return /空格.*回车|回车.*空格|Space.*Enter|Enter.*Space|改成回车|换成回车/u.test(text);
}
