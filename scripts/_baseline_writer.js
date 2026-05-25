import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const SCREENSHOT_POINTERS = {
  mount: "eval/screenshots/mount.png",
  afterSteps: "eval/screenshots/after-steps.png",
  final: "eval/screenshots/final.png",
};

function assertEvalDir(casePath) {
  const evalDir = join(casePath, "eval");
  if (!existsSync(evalDir)) {
    throw new Error(`eval directory does not exist: ${evalDir}`);
  }
  return evalDir;
}

function planHash(planPath) {
  return createHash("sha256").update(readFileSync(planPath)).digest("hex");
}

function caseHash(casePath) {
  return createHash("sha256").update(basename(casePath)).digest("hex").slice(0, 6);
}

function rotateBaselines(evalDir) {
  const current = join(evalDir, "baseline.json");
  const prev1 = join(evalDir, "baseline-prev1.json");
  const prev2 = join(evalDir, "baseline-prev2.json");

  rmSync(prev2, { force: true });
  if (existsSync(prev1)) renameSync(prev1, prev2);
  if (existsSync(current)) renameSync(current, prev1);
}

function warningKinds(deliveryRecord) {
  return (deliveryRecord?.warnings ?? [])
    .map((warning) => warning?.kind)
    .filter((kind) => typeof kind === "string" && kind.length > 0);
}

function deliverySummary(deliveryRecord, runnerResult) {
  const runnerSummary = runnerResult?.summary ?? deliveryRecord?.detail?.runner ?? {};
  return {
    status: deliveryRecord?.status,
    warningKinds: warningKinds(deliveryRecord),
    milestoneCount: runnerSummary.milestoneCount,
    changedPixels: runnerSummary.changedPixels,
  };
}

function artifactPointers(runnerResult) {
  return {
    plan: "specs/plan.json",
    delivery: "eval/delivery.json",
    runnerResult: "eval/runner-result.json",
    screenshots: {
      ...SCREENSHOT_POINTERS,
      ...(runnerResult?.screenshots ?? {}),
    },
  };
}

export async function writeBaseline({ casePath, deliveryRecord, runnerResult, planPath }) {
  const evalDir = assertEvalDir(casePath);
  const createdAt = new Date().toISOString();
  const baselineId = `${createdAt}-${caseHash(casePath)}`;
  const baselinePath = join(evalDir, "baseline.json");
  const baselineRecord = {
    baselineId,
    createdAt,
    planHash: planHash(planPath),
    deliverySummary: deliverySummary(deliveryRecord, runnerResult),
    artifactPointers: artifactPointers(runnerResult),
  };

  rotateBaselines(evalDir);
  writeFileSync(baselinePath, `${JSON.stringify(baselineRecord, null, 2)}\n`, "utf8");

  return {
    baselineId,
    written: [baselinePath],
  };
}
