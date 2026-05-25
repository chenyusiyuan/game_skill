import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvolutionLog } from "./_evolution_log.js";

export const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DELIVERY_TIMEOUT_MS = Number(process.env.EVOLUTION_DELIVERY_TIMEOUT_MS) || 240_000;

const UNIVERSAL_LOGIC_PATTERNS = [
  /emitMilestone\s*\(/u,
  /createCursorKeys\s*\(/u,
  /input\.keyboard\.addKey/u,
  /Phaser\.Input\.Keyboard\.JustDown/u,
  /window\.__state/u,
  /\.physics\.add\.collider/u,
  /\.physics\.add\.overlap/u,
  /this\.scene\.start/u,
  /this\.scene\.restart/u,
];

/**
 * Resolve the main scene file path for a case-local game.
 *
 * Strategy 1: parse `game/src/main.ts` for `from "./scenes/<Name>"` and check
 *             if `game/src/scenes/<Name>.ts` exists.
 * Strategy 2: pick the only `.ts` under `game/src/scenes/`; if multiple,
 *             prefer the alphabetically first non-`milestone.ts` file.
 *
 * Returns absolute path or `null` if no scene can be located.
 */
export function resolveMainScenePath(caseDir) {
  const mainPath = join(caseDir, "game/src/main.ts");
  if (existsSync(mainPath)) {
    const content = readFileSync(mainPath, "utf8");
    const match = content.match(/from\s+['"`]\.\/scenes\/([A-Za-z][A-Za-z0-9_]*)['"`]/u);
    if (match) {
      const candidate = join(caseDir, "game/src/scenes", `${match[1]}.ts`);
      if (existsSync(candidate)) return candidate;
    }
  }
  const scenesDir = join(caseDir, "game/src/scenes");
  if (!existsSync(scenesDir)) return null;
  const tsFiles = readdirSync(scenesDir)
    .filter((file) => file.endsWith(".ts") && file !== "milestone.ts")
    .sort();
  if (tsFiles.length === 0) return null;
  return join(scenesDir, tsFiles[0]);
}

/**
 * Probe a TypeScript source for a named numeric constant declared as
 * `const NAME = <int>;`. Returns the first match across `candidateNames`
 * or `null` if none found.
 */
export function findTunableNumberConstant(content, candidateNames) {
  for (const name of candidateNames) {
    const pattern = new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)\\s*;`, "u");
    const match = String(content ?? "").match(pattern);
    if (match) return { name, value: Number(match[1]) };
  }
  return null;
}

export class FileSnapshot {
  constructor() {
    this.files = new Map();
  }

  capture(absPaths) {
    for (const filePath of absPaths) {
      if (this.files.has(filePath)) continue;
      this.files.set(filePath, {
        existed: existsSync(filePath),
        content: existsSync(filePath) ? readFileSync(filePath, "utf8") : null,
      });
    }
    return this;
  }

  restore() {
    for (const [filePath, snapshot] of this.files.entries()) {
      if (!snapshot.existed) {
        rmSync(filePath, { force: true });
        continue;
      }
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, snapshot.content, "utf8");
    }
  }
}

export function checkForbiddenMutations({
  stage,
  beforePlan,
  afterPlan,
  changedFilePaths = [],
  beforeFiles = {},
  afterFiles = {},
}) {
  if (stage === 2) return { ok: true };
  if (stage === 3) return checkStage3Plan(beforePlan, afterPlan);
  if (stage === 4) return checkStage4Mutations(beforePlan, afterPlan, changedFilePaths);
  if (stage === 5) return checkStage5Mutations(beforePlan, afterPlan, changedFilePaths, beforeFiles, afterFiles);
  return { ok: false, kind: "unknown-stage", detail: `unsupported stage: ${stage}` };
}

export async function runDeliveryCheck(casePath) {
  const caseDir = resolve(REPO, casePath);
  const result = spawnSync("node", [join(REPO, "scripts/check_delivery.js"), caseDir], {
    cwd: REPO,
    encoding: "utf8",
    timeout: DELIVERY_TIMEOUT_MS,
  });
  const delivery = readJsonOptional(join(caseDir, "eval/delivery.json"));
  const runnerResult = readJsonOptional(join(caseDir, "eval/runner-result.json"));
  return {
    status: result.status,
    signal: result.signal,
    error: result.error ? result.error.message : null,
    stdout: result.stdout,
    stderr: result.stderr,
    delivery,
    runnerResult,
    ok: result.status === 0 && isPassingDelivery(delivery),
  };
}

export function buildCheckpoint({ casePath, deliveryResult, changedFiles = [], note = null }) {
  const caseDir = resolve(REPO, casePath);
  const baseline = readJsonOptional(join(caseDir, "eval/baseline.json"));
  const delivery = deliveryResult?.delivery ?? readJsonOptional(join(caseDir, "eval/delivery.json"));
  const runnerResult = deliveryResult?.runnerResult ?? readJsonOptional(join(caseDir, "eval/runner-result.json"));
  return {
    baselineId: baseline?.baselineId ?? null,
    deliveryStatus: delivery?.status ?? null,
    runnerSummary: runnerResult?.summary ?? delivery?.detail?.runner ?? null,
    warningKinds: (delivery?.warnings ?? []).map((warning) => warning?.kind).filter(Boolean),
    changedFiles,
    ...(note ? { note } : {}),
  };
}

export async function logSubtaskResult({ caseDir, subtaskId, stage, result }) {
  await appendEvolutionLog({
    casePath: caseDir,
    entry: {
      kind: "subtask-result",
      timestamp: new Date().toISOString(),
      subtaskId,
      stage,
      verdict: result.verdict,
      checkpoint: result.checkpoint,
      errors: result.errors,
      kickBack: result.kickBack,
      advisory: result.advisory,
    },
  });
}

export async function logCheckpoint({ caseDir, subtaskId, stage, checkpoint }) {
  await appendEvolutionLog({
    casePath: caseDir,
    entry: {
      kind: "subtask-checkpoint",
      timestamp: new Date().toISOString(),
      subtaskId,
      stage,
      checkpoint,
    },
  });
}

export async function logRollback({ caseDir, subtaskId, stage, reason }) {
  await appendEvolutionLog({
    casePath: caseDir,
    entry: {
      kind: "subtask-rollback",
      timestamp: new Date().toISOString(),
      subtaskId,
      stage,
      reason,
    },
  });
}

export function resolveCasePath(casePath) {
  return resolve(REPO, casePath);
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function readJsonOptional(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return readJson(filePath);
  } catch {
    return null;
  }
}

export function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readTextOptional(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function relativeCaseFile(caseDir, filePath) {
  return relative(caseDir, filePath);
}

export function listFiles(dir, predicate = () => true) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(fullPath, predicate));
    else if (entry.isFile() && predicate(fullPath)) out.push(fullPath);
  }
  return out;
}

export function isPassingDelivery(delivery) {
  return ["delivery-pass", "delivery-with-warnings"].includes(delivery?.status);
}

export function summarizeFailure(delivery, runnerResult) {
  const failedExpects = runnerResult?.failedExpects ?? runnerResult?.diagnostic?.failedExpects ?? [];
  if (failedExpects.length > 0) {
    return failedExpects.slice(0, 5).map((item) => `${item.type ?? "expect"}:${item.id ?? item.path ?? "unknown"}`);
  }
  if (delivery?.blockReason) return [delivery.blockReason];
  return ["check_delivery failed"];
}

export function changedFilesFromSnapshot(caseDir, snapshot) {
  const changed = [];
  for (const [filePath, before] of snapshot.files.entries()) {
    const afterContent = existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
    const afterExisted = existsSync(filePath);
    if (before.existed !== afterExisted || before.content !== afterContent) {
      changed.push(relativeCaseFile(caseDir, filePath));
    }
  }
  return changed;
}

function checkStage3Plan(beforePlan, afterPlan) {
  if (beforePlan?.meta?.caseId !== afterPlan?.meta?.caseId) {
    return { ok: false, kind: "meta-mutated", detail: "meta.caseId changed" };
  }
  if (beforePlan?.meta?.createdAt !== afterPlan?.meta?.createdAt) {
    return { ok: false, kind: "meta-mutated", detail: "meta.createdAt changed" };
  }

  const afterMustHave = new Map((afterPlan?.acceptance?.mustHave ?? []).map((item) => [item.id, item]));
  for (const item of beforePlan?.acceptance?.mustHave ?? []) {
    if (!afterMustHave.has(item.id)) {
      return { ok: false, kind: "mustHave-degraded", detail: `missing previous mustHave: ${item.id}` };
    }
    if (!jsonEqual(afterMustHave.get(item.id), item)) {
      return { ok: false, kind: "mustHave-degraded", detail: `previous mustHave changed: ${item.id}` };
    }
  }
  return { ok: true };
}

function checkStage4Mutations(beforePlan, afterPlan, changedFilePaths) {
  if (changedFilePaths.some((filePath) => filePath.startsWith("assets/"))) {
    return { ok: false, kind: "asset-mutated", detail: "asset changes belong to the polish worker" };
  }

  const beforeInputs = (beforePlan?.controls ?? []).map((control) => control.input);
  const afterInputs = (afterPlan?.controls ?? []).map((control) => control.input);
  if (!jsonEqual(beforeInputs, afterInputs)) {
    return { ok: false, kind: "control-input-mutated", detail: "controls[].input changed" };
  }

  const beforeShape = stage4Shape(beforePlan);
  const afterShape = stage4Shape(afterPlan);
  if (!jsonEqual(beforeShape, afterShape)) {
    return { ok: false, kind: "contract-shape-mutated", detail: "contract shape changed" };
  }

  const beforeAllowedBlank = stage4AllowedBlank(beforePlan);
  const afterAllowedBlank = stage4AllowedBlank(afterPlan);
  if (!jsonEqual(beforeAllowedBlank, afterAllowedBlank)) {
    return { ok: false, kind: "plan-field-forbidden", detail: "plan changed outside allowed description or threshold fields" };
  }
  return { ok: true };
}

function checkStage5Mutations(beforePlan, afterPlan, changedFilePaths, beforeFiles, afterFiles) {
  if (!jsonEqual(beforePlan, afterPlan)) {
    return { ok: false, kind: "plan-mutated", detail: "visual polish cannot edit plan.json" };
  }

  const disallowedPath = changedFilePaths.find((filePath) => {
    if (filePath.startsWith("game/src/")) return false;
    if (filePath.startsWith("assets/")) return false;
    return filePath !== "eval/delivery.json" && filePath !== "eval/runner-result.json";
  });
  if (disallowedPath) {
    return { ok: false, kind: "path-forbidden", detail: `cannot edit ${disallowedPath}` };
  }

  const planSignaturePatterns = derivePlanLogicPatterns(beforePlan);
  for (const relPath of changedFilePaths.filter((filePath) => filePath.startsWith("game/src/"))) {
    const before = beforeFiles[relPath] ?? "";
    const after = afterFiles[relPath] ?? "";
    const logicBefore = visualForbiddenSignature(before, planSignaturePatterns);
    const logicAfter = visualForbiddenSignature(after, planSignaturePatterns);
    if (!jsonEqual(logicBefore, logicAfter)) {
      return { ok: false, kind: "gameplay-logic-mutated", detail: `logic-sensitive lines changed in ${relPath}` };
    }
  }
  return { ok: true };
}

function stage4Shape(plan) {
  return {
    mechanicNames: (plan?.requiredMechanics ?? []).map((item) => item.name),
    controlInputs: (plan?.controls ?? []).map((item) => item.input),
    mustHaveIds: (plan?.acceptance?.mustHave ?? []).map((item) => item.id),
    winCondition: plan?.winCondition,
    loseCondition: plan?.loseCondition,
    primaryLoop: plan?.primaryLoop,
  };
}

function stage4AllowedBlank(plan) {
  const clone = cloneJson(plan);
  for (const mechanic of clone.requiredMechanics ?? []) {
    if (Object.hasOwn(mechanic, "summary")) mechanic.summary = "__allowed__";
  }
  for (const control of clone.controls ?? []) {
    if (Object.hasOwn(control, "effect")) control.effect = "__allowed__";
  }
  for (const mustHave of clone.acceptance?.mustHave ?? []) {
    for (const evidence of mustHave.evidence ?? []) {
      if (Object.hasOwn(evidence, "minChangedPixels")) evidence.minChangedPixels = "__allowed__";
      if (Object.hasOwn(evidence, "minOccurrences")) evidence.minOccurrences = "__allowed__";
      if (Object.hasOwn(evidence, "timeoutMs")) evidence.timeoutMs = "__allowed__";
    }
  }
  for (const expect of clone.smoke?.expect ?? []) {
    if (Object.hasOwn(expect, "minChangedPixels")) expect.minChangedPixels = "__allowed__";
    if (Object.hasOwn(expect, "minOccurrences")) expect.minOccurrences = "__allowed__";
    if (Object.hasOwn(expect, "timeoutMs")) expect.timeoutMs = "__allowed__";
  }
  return clone;
}

/**
 * Build a list of regex patterns that mark "logic-sensitive" lines in
 * scene source code, derived from the case's plan plus a small set of
 * universal Phaser/runtime patterns.
 *
 * The result is consumed by visualForbiddenSignature() so Stage 5 can
 * detect gameplay-logic mutations without hardcoding case-specific
 * identifiers.
 */
function derivePlanLogicPatterns(plan) {
  const patterns = [...UNIVERSAL_LOGIC_PATTERNS];

  const milestoneIds = new Set();
  for (const expect of plan?.smoke?.expect ?? []) {
    if (expect?.type === "milestone" && typeof expect.id === "string") milestoneIds.add(expect.id);
  }
  for (const mustHave of plan?.acceptance?.mustHave ?? []) {
    for (const evidence of mustHave?.evidence ?? []) {
      if (evidence?.type === "milestone" && typeof evidence.id === "string") milestoneIds.add(evidence.id);
    }
  }
  for (const id of milestoneIds) {
    patterns.push(new RegExp(`["'\`]${escapeRegExpValue(id)}["'\`]`, "u"));
  }

  const statePaths = new Set();
  for (const expect of plan?.smoke?.expect ?? []) {
    if (expect?.type === "state" && typeof expect.path === "string") statePaths.add(expect.path);
  }
  for (const mustHave of plan?.acceptance?.mustHave ?? []) {
    for (const evidence of mustHave?.evidence ?? []) {
      if (evidence?.type === "state" && typeof evidence.path === "string") statePaths.add(evidence.path);
    }
  }
  for (const path of statePaths) {
    const top = String(path).split(".")[0];
    if (!top) continue;
    patterns.push(new RegExp(`__state\\.${escapeRegExpValue(top)}\\b`, "u"));
    patterns.push(new RegExp(`\\bthis\\.${escapeRegExpValue(top)}\\b`, "u"));
  }

  const inputs = new Set();
  for (const control of plan?.controls ?? []) {
    if (typeof control?.input === "string") {
      for (const token of String(control.input).split(/[\s/]+/u)) {
        if (token.length > 0) inputs.add(token);
      }
    }
  }
  for (const token of inputs) {
    patterns.push(new RegExp(`["'\`]${escapeRegExpValue(token)}["'\`]`, "u"));
  }

  return patterns;
}

function visualForbiddenSignature(content, patterns) {
  return String(content)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => patterns.some((pattern) => pattern.test(line)));
}

function escapeRegExpValue(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function jsonEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
