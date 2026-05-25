import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FileSnapshot,
  buildCheckpoint,
  findTunableNumberConstant,
  isPassingDelivery,
  logCheckpoint,
  logRollback,
  logSubtaskResult as appendSubtaskResult,
  resolveMainScenePath,
  runDeliveryCheck,
  summarizeFailure,
} from "./_stage_common.js";
import { mustAvoidBlocksPaddleSpeed, readEvolutionContext } from "./_evolution_context.js";
import { evaluateMustNot } from "./_mustnot_evaluator.js";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ADDITIVE_RE = /加|新增|加入|添加|成就|新机制|新系统|新玩法|通关时显示|mustHave/u;

export async function runStage2({ casePath, subtask, evolutionContext }) {
  const caseDir = resolve(REPO, casePath);
  const subtaskId = subtask?.id ?? "unknown";
  const text = `${evolutionContext?.rawQuery ?? ""} ${subtask?.subIntent ?? ""}`;

  if (!subtask || subtask.stage !== 2) {
    return failResult(caseDir, subtaskId, ["worker received mismatched subtask stage"]);
  }
  const context = readEvolutionContext(caseDir);

  if (requiresNewContract(subtask.subIntent ?? "")) {
    await logRollback({ caseDir, subtaskId, stage: 2, reason: "wrong-worker" });
    return kickBackResult(caseDir, subtaskId, {
      forbidden: "new-mustHave-or-new-mechanic",
      inferredIntent: "需要新增体验或正向验收契约",
    });
  }

  const planPath = join(caseDir, "specs/plan.json");
  const plan = readJson(planPath);
  if (isPaddleLagRepair(text)) {
    if (mustAvoidBlocksPaddleSpeed(context.designSummary.mustAvoid)) {
      return failResult(caseDir, subtaskId, ["DESIGN.md mustAvoid blocks paddle speed/input responsiveness repair"]);
    }
    return runPaddleLagRepair({ caseDir, subtaskId, planPath });
  }

  const before = await runDeliveryCheck(caseDir);
  if (before.status === 0 && isPassingDelivery(before.delivery)) {
    const mustNotResult = await evaluateMustNot({
      casePath: caseDir,
      plan,
      runnerResult: before.runnerResult,
      subtaskId,
    });
    if (!mustNotResult.passed) {
      await logRollback({ caseDir, subtaskId, stage: 2, reason: "mustNot-violation" });
      return failResult(
        caseDir,
        subtaskId,
        mustNotResult.violations.map((violation) => `mustNot ${violation.id}: ${violation.text}`),
      );
    }
    return failResult(caseDir, subtaskId, ["cannot reproduce"]);
  }

  const missingMilestones = missingMilestoneIds({
    plan,
    runnerResult: readJsonOptional(join(caseDir, "eval/runner-result.json")),
    subIntent: subtask.subIntent ?? "",
  });
  if (missingMilestones.length === 0) {
    return failResult(caseDir, subtaskId, ["cannot reproduce milestone failure"]);
  }

  const replacement = findMilestoneTypo(caseDir, plan, missingMilestones);
  if (!replacement) {
    return failResult(caseDir, subtaskId, [`unsupported deterministic repair POC: missing milestone ${missingMilestones.join(", ")}`]);
  }

  const snapshot = new FileSnapshot();
  try {
    snapshot.capture([replacement.filePath]);
    replaceMilestone(replacement);

    const after = await runDeliveryCheck(caseDir);
    const delivery = after.delivery;
    if (after.status === 0 && isPassingDelivery(delivery)) {
      const latestPlan = readJson(planPath);
      const mustNotResult = await evaluateMustNot({
        casePath: caseDir,
        plan: latestPlan,
        runnerResult: after.runnerResult,
        subtaskId,
      });
      if (!mustNotResult.passed) {
        snapshot.restore();
        await logRollback({ caseDir, subtaskId, stage: 2, reason: "mustNot-violation" });
        return failResult(
          caseDir,
          subtaskId,
          mustNotResult.violations.map((violation) => `mustNot ${violation.id}: ${violation.text}`),
        );
      }

      const checkpoint = buildCheckpoint({
        casePath: caseDir,
        deliveryResult: after,
        changedFiles: [relativeCaseFile(caseDir, replacement.filePath)],
        note: "fixed milestone typo",
      });
      checkpoint.fixed = {
        file: relativeCaseFile(caseDir, replacement.filePath),
        from: replacement.from,
        to: replacement.to,
      };
      await logCheckpoint({ caseDir, subtaskId, stage: 2, checkpoint });
      const result = { verdict: "pass", checkpoint };
      await logSubtaskResult(caseDir, subtaskId, result);
      return result;
    }

    snapshot.restore();
    await logRollback({ caseDir, subtaskId, stage: 2, reason: "delivery-regression" });
    const errors = summarizeFailure(delivery, after.runnerResult);
    const result = { verdict: "fail", errors };
    await logSubtaskResult(caseDir, subtaskId, result);
    return result;
  } catch (error) {
    snapshot.restore();
    const message = error instanceof Error ? error.message : String(error);
    await logRollback({ caseDir, subtaskId, stage: 2, reason: message });
    const result = { verdict: "fail", errors: [message] };
    await logSubtaskResult(caseDir, subtaskId, result);
    return result;
  }
}

async function runPaddleLagRepair({ caseDir, subtaskId, planPath }) {
  const scenePath = resolveMainScenePath(caseDir);
  if (!scenePath) {
    return failResult(caseDir, subtaskId, ["main scene file not found under game/src/scenes/"]);
  }
  const snapshot = new FileSnapshot().capture([scenePath]);

  try {
    patchPaddleSpeed(scenePath);
    const after = await runDeliveryCheck(caseDir);
    if (!(after.status === 0 && isPassingDelivery(after.delivery))) {
      snapshot.restore();
      await logRollback({ caseDir, subtaskId, stage: 2, reason: "delivery-regression" });
      return failResult(caseDir, subtaskId, summarizeFailure(after.delivery, after.runnerResult));
    }

    const mustNotResult = await evaluateMustNot({
      casePath: caseDir,
      plan: readJson(planPath),
      runnerResult: after.runnerResult,
      subtaskId,
    });
    if (!mustNotResult.passed) {
      snapshot.restore();
      await logRollback({ caseDir, subtaskId, stage: 2, reason: "mustNot-violation" });
      return failResult(
        caseDir,
        subtaskId,
        mustNotResult.violations.map((violation) => `mustNot ${violation.id}: ${violation.text}`),
      );
    }

    const checkpoint = buildCheckpoint({
      casePath: caseDir,
      deliveryResult: after,
      changedFiles: [relativeCaseFile(caseDir, scenePath)],
      note: "fixed paddle input responsiveness",
    });
    checkpoint.fixed = {
      file: relativeCaseFile(caseDir, scenePath),
      reason: "paddle input responsiveness",
    };
    await logCheckpoint({ caseDir, subtaskId, stage: 2, checkpoint });
    const result = { verdict: "pass", checkpoint };
    await logSubtaskResult(caseDir, subtaskId, result);
    return result;
  } catch (error) {
    snapshot.restore();
    const message = error instanceof Error ? error.message : String(error);
    await logRollback({ caseDir, subtaskId, stage: 2, reason: message });
    return failResult(caseDir, subtaskId, [message]);
  }
}

function missingMilestoneIds({ plan, runnerResult, subIntent }) {
  const expected = expectedMilestoneIds(plan);
  const failed = [
    ...(runnerResult?.failedExpects ?? []),
    ...(runnerResult?.diagnostic?.failedExpects ?? []),
  ]
    .filter((item) => item?.type === "milestone" && typeof item.id === "string")
    .map((item) => item.id);
  const mentioned = expected.filter((id) => subIntent.includes(id));
  return unique([...failed, ...mentioned]).filter((id) => expected.includes(id));
}

function findMilestoneTypo(caseDir, plan, targetIds) {
  const srcDir = join(caseDir, "game/src");
  const files = listTsFiles(srcDir).filter((filePath) => !filePath.endsWith("/milestone.ts"));
  const expected = expectedMilestoneIds(plan);
  const emitted = [];

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf8");
    for (const match of content.matchAll(/emitMilestone\s*\(\s*(["'`])([^"'`]+)\1/gu)) {
      emitted.push({ filePath, id: match[2] });
    }
  }

  for (const target of targetIds) {
    if (emitted.some((item) => item.id === target)) continue;
    let best = null;
    for (const item of emitted.filter((candidate) => !expected.includes(candidate.id))) {
      const distance = levenshtein(item.id, target);
      const limit = Math.max(2, Math.ceil(target.length * 0.25));
      if (distance <= limit && (!best || distance < best.distance)) {
        best = { ...item, distance };
      }
    }
    if (best) return { filePath: best.filePath, from: best.id, to: target };
  }
  return null;
}

function replaceMilestone({ filePath, from, to }) {
  const content = readFileSync(filePath, "utf8");
  const pattern = new RegExp(`(emitMilestone\\s*\\(\\s*["'\`])${escapeRegExp(from)}(["'\`])`, "u");
  if (!pattern.test(content)) throw new Error(`milestone call not found: ${from}`);
  writeFileSync(filePath, content.replace(pattern, `$1${to}$2`), "utf8");
}

async function failResult(caseDir, subtaskId, errors) {
  const result = { verdict: "fail", errors };
  await logSubtaskResult(caseDir, subtaskId, result);
  return result;
}

async function kickBackResult(caseDir, subtaskId, kickBack) {
  const result = {
    verdict: "kicked-back",
    kickBack: {
      rolledBack: true,
      ...kickBack,
    },
  };
  await logSubtaskResult(caseDir, subtaskId, result);
  return result;
}

async function logSubtaskResult(caseDir, subtaskId, result) {
  await appendSubtaskResult({ caseDir, subtaskId, stage: 2, result });
}

function expectedMilestoneIds(plan) {
  return unique([
    ...(plan?.smoke?.expect ?? [])
      .filter((item) => item?.type === "milestone" && typeof item.id === "string")
      .map((item) => item.id),
    ...(plan?.acceptance?.mustHave ?? []).flatMap((item) =>
      (item?.evidence ?? [])
        .filter((evidence) => evidence?.type === "milestone" && typeof evidence.id === "string")
        .map((evidence) => evidence.id),
    ),
  ]);
}

function listTsFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(fullPath));
    else if (entry.isFile() && fullPath.endsWith(".ts")) out.push(fullPath);
  }
  return out;
}

function requiresNewContract(text) {
  return ADDITIVE_RE.test(text);
}

function isPaddleLagRepair(text) {
  return /挡板|paddle|输入|移动/u.test(text) && /滞后|迟钝|延迟|不跟手|响应慢/u.test(text);
}

function patchPaddleSpeed(scenePath) {
  const content = readFileSync(scenePath, "utf8");
  const tunable = findTunableNumberConstant(content, ["PADDLE_SPEED", "PADDLE_VELOCITY", "PADDLE_X_SPEED"]);
  if (!tunable) throw new Error("paddle speed constant not found (tried PADDLE_SPEED / PADDLE_VELOCITY / PADDLE_X_SPEED)");
  const next = Math.min(420, Math.max(tunable.value + 40, Math.round(tunable.value * 1.15)));
  if (next === tunable.value) throw new Error("paddle responsiveness headroom exhausted");
  const pattern = new RegExp(`const\\s+${tunable.name}\\s*=\\s*\\d+\\s*;`, "u");
  writeFileSync(scenePath, content.replace(pattern, `const ${tunable.name} = ${next};`), "utf8");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readJsonOptional(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return readJson(filePath);
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(values)];
}

function relativeCaseFile(caseDir, filePath) {
  return filePath.slice(caseDir.length + 1);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}
