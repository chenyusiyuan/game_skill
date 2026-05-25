import { existsSync, statSync, writeFileSync } from "node:fs";
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
} from "./_stage_common.js";
import { evaluateMustNot } from "./_mustnot_evaluator.js";

export async function runStage5({ casePath, subtask, evolutionContext }) {
  const caseDir = resolveCasePath(casePath);
  const subtaskId = subtask?.id ?? "unknown";
  const text = `${evolutionContext?.rawQuery ?? ""} ${subtask?.subIntent ?? ""}`;

  if (!subtask || subtask.stage !== 5) {
    return failResult(caseDir, subtaskId, ["worker received mismatched subtask stage"]);
  }
  if (wantsGameplayChange(text)) {
    await logRollback({ caseDir, subtaskId, stage: 5, reason: "wrong-worker" });
    return kickBackResult(caseDir, subtaskId, 2, "请求需要改变 gameplay 行为或证据触发");
  }
  if (isObstructiveLayoutRequest(text)) {
    await logRollback({ caseDir, subtaskId, stage: 5, reason: "visual-gate-weak" });
    return failResult(caseDir, subtaskId, ["visual gate advisory: obstructive HUD layout is not safe to merge"], {
      kind: "visual-gate-weak",
      followUp: "需要更强的视觉遮挡检测后再允许此类布局修改",
    });
  }
  if (!wantsHudPolish(text)) {
    await logRollback({ caseDir, subtaskId, stage: 5, reason: "unsupported-deterministic-polish" });
    return failResult(caseDir, subtaskId, ["unsupported deterministic polish POC"]);
  }

  const planPath = join(caseDir, "specs/plan.json");
  const scenePath = resolveMainScenePath(caseDir);
  if (!scenePath) {
    return failResult(caseDir, subtaskId, ["main scene file not found under game/src/scenes/"]);
  }
  const sceneRel = scenePath.slice(caseDir.length + 1);
  const snapshot = new FileSnapshot().capture([planPath, scenePath]);
  const beforePlan = readJson(planPath);
  const beforeFiles = { [sceneRel]: readTextOptional(scenePath) ?? "" };

  try {
    patchHudStyle(scenePath);
    const afterPlan = readJson(planPath);
    const afterFiles = { [sceneRel]: readTextOptional(scenePath) ?? "" };
    const changedFiles = changedFilesFromSnapshot(caseDir, snapshot);
    const forbidden = checkForbiddenMutations({
      stage: 5,
      beforePlan,
      afterPlan,
      changedFilePaths: changedFiles,
      beforeFiles,
      afterFiles,
    });
    if (!forbidden.ok) {
      snapshot.restore();
      await logRollback({ caseDir, subtaskId, stage: 5, reason: forbidden.kind });
      return kickBackResult(caseDir, subtaskId, forbidden.kind === "gameplay-logic-mutated" ? 2 : 3, forbidden.detail);
    }

    const deliveryResult = await runDeliveryCheck(caseDir);
    if (!deliveryResult.ok) {
      snapshot.restore();
      await logRollback({ caseDir, subtaskId, stage: 5, reason: "delivery-regression" });
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
      await logRollback({ caseDir, subtaskId, stage: 5, reason: "mustNot-violation" });
      return failResult(
        caseDir,
        subtaskId,
        mustNotResult.violations.map((violation) => `mustNot ${violation.id}: ${violation.text}`),
      );
    }

    const screenshotCheck = checkScreenshots(caseDir, deliveryResult.runnerResult);
    if (!screenshotCheck.ok) {
      snapshot.restore();
      await logRollback({ caseDir, subtaskId, stage: 5, reason: screenshotCheck.reason });
      return failResult(caseDir, subtaskId, [screenshotCheck.reason]);
    }

    const checkpoint = buildCheckpoint({
      casePath: caseDir,
      deliveryResult,
      changedFiles,
      note: "polished HUD font metadata",
    });
    checkpoint.screenshotMetadata = screenshotCheck.files;
    await logCheckpoint({ caseDir, subtaskId, stage: 5, checkpoint });
    const result = {
      verdict: "pass",
      checkpoint,
      advisory: {
        kind: "visual-gate-weak",
        followUp: "当前只校验截图文件元数据，严格视觉门留后续演进",
      },
    };
    await logSubtaskResult({ caseDir, subtaskId, stage: 5, result });
    return result;
  } catch (error) {
    snapshot.restore();
    const message = error instanceof Error ? error.message : String(error);
    await logRollback({ caseDir, subtaskId, stage: 5, reason: message });
    return failResult(caseDir, subtaskId, [message]);
  }
}

function patchHudStyle(scenePath) {
  let content = readTextOptional(scenePath);
  if (content === null) throw new Error(`scene file missing: ${scenePath}`);
  const fontMatch = content.match(/fontSize: "(\d+)px"/u);
  if (!fontMatch) throw new Error("HUD font size not found");
  const current = Number(fontMatch[1]);
  const next = Math.min(18, current + 2);
  if (next === current) throw new Error("HUD font size already at deterministic POC ceiling");
  content = content.replace(/fontSize: "\d+px"/u, `fontSize: "${next}px"`);
  content = content.replace('color: "#ffffff"', 'color: "#f8fbff"');
  writeFileSync(scenePath, content, "utf8");
}

function checkScreenshots(caseDir, runnerResult) {
  const screenshots = runnerResult?.screenshots ?? {
    mount: "eval/screenshots/mount.png",
    afterSteps: "eval/screenshots/after-steps.png",
    final: "eval/screenshots/final.png",
  };
  const files = {};
  for (const [name, relPath] of Object.entries(screenshots)) {
    const filePath = join(caseDir, relPath);
    if (!existsSync(filePath)) return { ok: false, reason: `screenshot missing: ${relPath}` };
    const info = statSync(filePath);
    if (info.size <= 0) return { ok: false, reason: `screenshot empty: ${relPath}` };
    files[name] = { path: relPath, sizeBytes: info.size };
  }
  return { ok: true, files };
}

async function failResult(caseDir, subtaskId, errors, advisory = undefined) {
  const result = { verdict: "fail", errors, advisory };
  await logSubtaskResult({ caseDir, subtaskId, stage: 5, result });
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
  await logSubtaskResult({ caseDir, subtaskId, stage: 5, result });
  return result;
}

function wantsHudPolish(text) {
  return /HUD|hud|字体|颜色|布局|排布|UI|ui|画面|视觉|更清楚|太小/u.test(text);
}

function wantsGameplayChange(text) {
  return /emitMilestone|milestone|输入|按键|判定|逻辑|胜负|得分|生命|球速|速度|碰撞/u.test(text);
}

function isObstructiveLayoutRequest(text) {
  return /挡板正上方|挡住玩法|遮挡|盖住挡板|盖住球/u.test(text);
}
