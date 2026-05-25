#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeVisualWarn } from "./_visual_warn.js";
import { evaluateMustNot } from "./_mustnot_evaluator.js";
import { prepareCaseGame } from "./prepare_case_game.js";
import { scanCaseJunk } from "./scan_case_junk.js";
import { scanForbiddenImports } from "./scan_forbidden_imports.js";
import { validatePlan } from "./validate_plan.js";

/*
Delivery decision table:

delivery-pass
  - tsc --noEmit passes
  - vite build passes
  - Playwright page mounts without pageerror
  - plan.smoke.steps causes raw canvas RGBA changed pixels >= minChangedPixels
  - every plan.smoke.expect milestone is captured with required occurrences before timeout
  - every plan.smoke.expect state assertion passes

delivery-with-warnings
  - all delivery-pass conditions hold
  - plus plan.nonblockingTodos is non-empty or structured runner warnings were captured

generation-blocked
  - tsc or vite build fails
  - page mount or input path triggers pageerror
  - canvas changed pixels is below threshold
  - any milestone is missing or under minOccurrences
  - any state assertion fails
  - plan schema validation fails
  - a worker-invented missing local helper appears during typecheck/build
  - plan.smoke.steps dispatch throws, such as an out-of-range click

chain-blocked
  - another check_delivery run already owns the same case lock
  - case code imports templates, scripts, schemas, archive, legacy, or sibling cases
  - prepare_case_game.js itself fails
  - Playwright/browser/dev-server launch fails
  - delivery runner itself throws outside case gameplay
  - plan parser itself throws
*/

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BUILD_TIMEOUT_MS = Number(process.env.BUILD_TIMEOUT_MS) || 120_000;
const PROBE_TIMEOUT_MS = Number(process.env.DELIVERY_TIMEOUT_MS) || 180_000;
const REQUIRED_RUNTIME = ["phaser", "vite", "typescript", "playwright"];
const DELIVERY_LOCK_STALE_MS = 30 * 60 * 1000;

function blocked(kind, blockReason, detail, warningItems = []) {
  return { status: kind, blockReason, warnings: warningItems, detail };
}

function warnings(detail, items) {
  return { status: "delivery-with-warnings", warnings: items, detail };
}

function pass(detail) {
  return { status: "delivery-pass", warnings: [], detail };
}

function runtimeInvariant() {
  const missing = REQUIRED_RUNTIME.filter((pkg) => !existsSync(join(REPO, "node_modules", pkg)));
  if (missing.length === 0) return { ok: true };
  return { ok: false, missing };
}

function junkWarnings(junk) {
  if (!junk?.removed?.length) return [];
  return [{ kind: "auto-cleaned-junk", severity: "warn", removed: junk.removed }];
}

function decisionDetail(runnerResult) {
  const detail = { runner: runnerResult.summary };
  if (runnerResult.diagnostic) detail.diagnostic = runnerResult.diagnostic;
  return detail;
}

function compactMustNotWarnings(mustNotWarnings = []) {
  return mustNotWarnings.map((warning) => ({
    kind: warning.kind,
    severity: warning.severity,
    id: warning.id,
    text: warning.text,
    followUp: warning.followUp,
    evidence: warning.evidence,
  }));
}

async function decideAndWrite(caseDir, decision, diagnostics = {}) {
  const evalDir = join(caseDir, "eval");
  const deliveryRecord = {
    ...decision,
    qualityHints: await buildQualityHints(caseDir),
    timestamp: new Date().toISOString(),
  };
  if (diagnostics.mustNotWarnings?.length) {
    deliveryRecord.diagnostics = {
      ...(deliveryRecord.diagnostics ?? {}),
      mustNotWarnings: compactMustNotWarnings(diagnostics.mustNotWarnings),
    };
  }
  mkdirSync(evalDir, { recursive: true });
  writeFileSync(
    join(evalDir, "delivery.json"),
    `${JSON.stringify(deliveryRecord, null, 2)}\n`,
    "utf8",
  );
  return deliveryRecord;
}

function writeLock(lockPath) {
  const fd = openSync(lockPath, "wx");
  try {
    writeFileSync(
      fd,
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  } finally {
    closeSync(fd);
  }
}

function readLock(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function isLockStale(lockPath, lock) {
  const startedAt = Date.parse(lock?.startedAt ?? "");
  if (Number.isFinite(startedAt)) return Date.now() - startedAt > DELIVERY_LOCK_STALE_MS;
  try {
    return Date.now() - statSync(lockPath).mtimeMs > DELIVERY_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function acquireDeliveryLock(caseDir) {
  const lockDir = join(caseDir, ".game");
  const lockPath = join(lockDir, "check_delivery.lock");
  mkdirSync(lockDir, { recursive: true });

  try {
    writeLock(lockPath);
    return { ok: true, path: lockPath };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  const lock = readLock(lockPath);
  if (isLockStale(lockPath, lock)) {
    rmSync(lockPath, { force: true });
    writeLock(lockPath);
    return { ok: true, path: lockPath, replacedStale: true };
  }

  return { ok: false, path: lockPath, lock };
}

function releaseDeliveryLock(lock) {
  if (!lock?.ok) return;
  rmSync(lock.path, { force: true });
}

function runBuildCommand(command, args, cwd, reason) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: BUILD_TIMEOUT_MS,
  });

  if (result.error) {
    return {
      ok: false,
      reason,
      error: result.error.message,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      reason,
      status: result.status,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return {
    ok: true,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function mustNotWarningsFromResult(mustNotResult) {
  return (mustNotResult?.violations ?? []).map((violation) => ({
    kind: "mustnot-warning",
    severity: "warn",
    id: violation.id,
    text: `acceptance.mustNot '${violation.id}' may be violated: ${violation.text}. Treat as follow-up / Stage 2 backlog, not a Stage 1 blocker.`,
    followUp: "follow-up / Stage 2 backlog",
    evidence: violation.evidence ?? null,
  }));
}

export function decideStatus({
  importScan = { ok: true },
  planValid,
  build,
  runnerResult,
  junk = { ok: true },
  extraWarnings = [],
}) {
  const warningItems = [...junkWarnings(junk), ...extraWarnings];

  if (importScan && !importScan.ok) return blocked("chain-blocked", importScan.reason, importScan, warningItems);
  if (!planValid.ok) return blocked("generation-blocked", "plan-invalid", planValid, warningItems);
  if (!build.ok) {
    if (build.reason === "prepare-failed") return blocked("chain-blocked", "prepare-failed", build, warningItems);
    return blocked("generation-blocked", build.reason, build, warningItems);
  }
  if (!runnerResult.ok) {
    if (runnerResult.chainBlocked) return blocked("chain-blocked", runnerResult.reason, runnerResult, warningItems);
    return blocked("generation-blocked", runnerResult.reason, runnerResult, warningItems);
  }

  warningItems.push(...(runnerResult.warnings ?? runnerResult.nonFatalWarnings ?? []));
  if ((runnerResult.nonblockingTodosCount ?? 0) > 0) {
    warningItems.push({ kind: "nonblocking-todos", count: runnerResult.nonblockingTodosCount, severity: "info" });
  }
  if (warningItems.length > 0) {
    return warnings(decisionDetail(runnerResult), warningItems);
  }
  return pass(decisionDetail(runnerResult));
}

const RUBRIC_FIELDS = [
  "content-density",
  "mechanical-differentiation",
  "visual-feedback",
  "hud-information",
  "feel-juice",
  "genre-fitness",
];

function readRubric(caseDir) {
  const rubricPath = join(caseDir, ".game/rubric.json");
  if (!existsSync(rubricPath)) {
    return { available: false, reason: "missing-rubric", missing: RUBRIC_FIELDS };
  }
  try {
    const parsed = JSON.parse(readFileSync(rubricPath, "utf8"));
    const missing = RUBRIC_FIELDS.filter((field) => !Object.hasOwn(parsed, field));
    if (missing.length > 0) return { available: false, reason: "rubric-missing-fields", missing };
    return {
      available: true,
      ...Object.fromEntries(RUBRIC_FIELDS.map((field) => [field, parsed[field]])),
    };
  } catch (error) {
    return {
      available: false,
      reason: "rubric-unparseable",
      error: error instanceof Error ? error.message : String(error),
      missing: RUBRIC_FIELDS,
    };
  }
}

function extractSourceTag(chunk) {
  const sourceLine = chunk.split(/\r?\n/u).find((line) => /来源[:：]/u.test(line));
  if (!sourceLine || sourceLine.includes("|")) return null;
  const match = sourceLine.match(/来源[:：]\s*<?\s*(from-query|from-genre-knowledge|from-reasoning)\s*>?/u);
  return match?.[1] ?? null;
}

function parseDecisionAChunks(markdown) {
  const section = markdown.match(/(?:^|\n)##\s+A\.[\s\S]*?(?=\n##\s+B\.|\n##\s+C\.|$)/u)?.[0] ?? "";
  const chunks = [];
  for (const chunk of section.split(/(?=^###\s+A\.)/mu)) {
    const heading = chunk.match(/^###\s+A\.[^\n]+/mu)?.[0];
    if (!heading) continue;
    const title = heading
      .replace(/^###\s+A\.\S+\s*/u, "")
      .replace(/\s*[—-]\s*来源[:：].*$/u, "")
      .trim();
    chunks.push({ title, source: extractSourceTag(chunk), text: chunk });
  }
  return chunks;
}

function readPlanScopeLeaks(caseDir) {
  const planCheckPath = join(caseDir, "eval/plan-check.json");
  if (!existsSync(planCheckPath)) return [];
  try {
    const planCheck = JSON.parse(readFileSync(planCheckPath, "utf8"));
    return (planCheck.warnings ?? []).filter((warning) => {
      const text = typeof warning === "string" ? warning : JSON.stringify(warning);
      return text.includes("scope-leak");
    });
  } catch {
    return [];
  }
}

function readScopeReport(caseDir) {
  const decisionsPath = join(caseDir, "docs/decisions.md");
  const counts = {
    "from-query": 0,
    "from-genre-knowledge": 0,
    "from-reasoning": 0,
  };
  const demotedChunks = [];

  if (existsSync(decisionsPath)) {
    const chunks = parseDecisionAChunks(readFileSync(decisionsPath, "utf8"));
    for (const chunk of chunks) {
      if (chunk.source && Object.hasOwn(counts, chunk.source)) counts[chunk.source] += 1;
      if (chunk.text.includes("降级理由")) {
        demotedChunks.push({ title: chunk.title || "<untitled>", source: chunk.source ?? "unknown" });
      }
    }
  }

  return {
    available: existsSync(decisionsPath),
    fromQueryCount: counts["from-query"],
    fromGenreKnowledgeCount: counts["from-genre-knowledge"],
    fromReasoningCount: counts["from-reasoning"],
    scopeLeaks: readPlanScopeLeaks(caseDir),
    demoted: demotedChunks,
    counts,
    demotedCount: demotedChunks.length,
    demotedChunks,
  };
}

function listTsFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listTsFiles(path));
    else if (entry.isFile() && path.endsWith(".ts")) files.push(path);
  }
  return files;
}

function lineCount(text) {
  if (text.length === 0) return 0;
  const newlineCount = text.match(/\n/gu)?.length ?? 0;
  return text.endsWith("\n") ? newlineCount : newlineCount + 1;
}

function isScaffoldFile(srcRoot, filePath) {
  const rel = relative(srcRoot, filePath).replaceAll("\\", "/");
  return rel === "main.ts" || rel === "milestone.ts" || rel.startsWith("lib/");
}

function parseImportedHelperNames(source) {
  const imports = new Map();
  const importPattern = /^\s*import\s+([^;]*?)\s+from\s+["'](\.{1,2}\/lib(?:\/[^"']*)?)["'];?/gmu;
  let match;
  while ((match = importPattern.exec(source)) !== null) {
    const clause = match[1].trim();
    const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/u);
    if (namespace) imports.set(namespace[1], "namespace");

    const named = clause.match(/\{([\s\S]*?)\}/u);
    if (named) {
      for (const part of named[1].split(",")) {
        const clean = part.trim();
        if (!clean) continue;
        const pieces = clean.split(/\s+as\s+/u).map((piece) => piece.trim());
        imports.set(pieces.at(-1), "named");
      }
    }

    const withoutNamed = clause.replace(/\{[\s\S]*?\}/u, "").replace(/\*\s+as\s+[A-Za-z_$][\w$]*/u, "");
    const defaultName = withoutNamed.split(",")[0]?.trim();
    if (defaultName && /^[A-Za-z_$][\w$]*$/u.test(defaultName)) imports.set(defaultName, "default");
  }
  return imports;
}

function stripImportStatements(source) {
  return source.replace(/^\s*import\s+[^;]*?\s+from\s+["'][^"']+["'];?\s*/gmu, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function countMatches(source, pattern) {
  return Array.from(source.matchAll(pattern)).length;
}

function computeLoc(caseDir) {
  const srcRoot = join(caseDir, "game/src");
  const files = listTsFiles(srcRoot);
  let scaffoldLoc = 0;
  let businessLoc = 0;
  const importedHelpers = new Map();
  const businessSources = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (isScaffoldFile(srcRoot, file)) {
      scaffoldLoc += lineCount(source);
      continue;
    }
    businessLoc += lineCount(source);
    businessSources.push(source);
    for (const [name, kind] of parseImportedHelperNames(source)) {
      importedHelpers.set(name, kind === "namespace" ? "namespace" : (importedHelpers.get(name) ?? kind));
    }
  }

  let helperCallCount = 0;
  for (const source of businessSources) {
    const body = stripImportStatements(source);
    for (const [name, kind] of importedHelpers) {
      const escaped = escapeRegExp(name);
      if (kind === "namespace") {
        helperCallCount += countMatches(
          body,
          new RegExp(`(^|[^A-Za-z0-9_$])${escaped}\\s*\\.\\s*[A-Za-z_$][\\w$]*\\s*\\(`, "gu"),
        );
      } else {
        helperCallCount += countMatches(body, new RegExp(`(^|[^A-Za-z0-9_$])${escaped}\\s*\\(`, "gu"));
      }
    }
  }

  return {
    scaffoldLoc,
    businessLoc,
    helperImportCount: importedHelpers.size,
    helperCallCount,
  };
}

async function buildQualityHints(caseDir) {
  const visual = await computeVisualWarn(caseDir);
  const rubric = readRubric(caseDir);
  const scopeReport = readScopeReport(caseDir);
  const loc = computeLoc(caseDir);
  const warnings = [];
  if (loc.helperCallCount < 2) {
    warnings.push({ kind: "low-helper-usage", severity: "warn", helperCallCount: loc.helperCallCount });
  }
  return { visual, rubric, scopeReport, loc, warnings };
}

export async function main(argv = process.argv.slice(2)) {
  const caseArg = argv.find((arg) => !arg.startsWith("--"));
  if (!caseArg || argv.includes("--help") || argv.includes("-h")) {
    console.error("Usage: node scripts/check_delivery.js cases/<slug>");
    return caseArg ? 0 : 2;
  }

  const caseDir = resolve(REPO, caseArg);
  let deliveryLock = null;

  const runtime = runtimeInvariant();
  if (!runtime.ok) {
    const decision = await decideAndWrite(caseDir, blocked("chain-blocked", "missing-runtime", { missing: runtime.missing }));
    console.error(`[delivery] ${decision.status}: ${decision.blockReason}`);
    return 3;
  }

  try {
    deliveryLock = acquireDeliveryLock(caseDir);
  } catch (error) {
    const decision = await decideAndWrite(
      caseDir,
      blocked("chain-blocked", "case-delivery-lock-failed", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    console.error(`[delivery] ${decision.status}: ${decision.blockReason}`);
    return 3;
  }

  if (!deliveryLock.ok) {
    const decision = await decideAndWrite(caseDir, blocked("chain-blocked", "case-delivery-already-running", deliveryLock));
    console.error(`[delivery] ${decision.status}: ${decision.blockReason}`);
    return 3;
  }

  try {
    const junk = scanCaseJunk(caseDir);

    const importScan = scanForbiddenImports(caseDir);
    const planValid = validatePlan(caseDir);
    const plan = planValid.ok ? JSON.parse(readFileSync(join(caseDir, "specs/plan.json"), "utf8")) : null;

    let build = { ok: true };
    if (importScan.ok && planValid.ok) {
      try {
        prepareCaseGame(caseDir);
      } catch (error) {
        build = {
          ok: false,
          reason: "prepare-failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }

      const gameDir = join(caseDir, "game");
      if (build.ok) {
        build = runBuildCommand("npx", ["tsc", "--noEmit"], gameDir, "typecheck-failed");
      }
      if (build.ok) {
        build = runBuildCommand("npx", ["vite", "build"], gameDir, "vite-build-failed");
      }
    }

    let runnerResult = { ok: false, reason: "skipped-due-to-prior-failure" };
    if (importScan.ok && planValid.ok && build.ok) {
      const runner = spawnSync("node", [join(REPO, "scripts/_delivery_runner.mjs"), "--case-dir", caseDir], {
        encoding: "utf8",
        timeout: PROBE_TIMEOUT_MS,
      });
      const outputPath = join(caseDir, "eval/runner-result.json");
      try {
        runnerResult = JSON.parse(readFileSync(outputPath, "utf8"));
      } catch {
        runnerResult = {
          ok: false,
          chainBlocked: true,
          reason: runner.error ? "runner-spawn-failed" : "runner-output-missing",
          status: runner.status,
          signal: runner.signal,
          error: runner.error ? runner.error.message : undefined,
          stdout: runner.stdout,
          stderr: runner.stderr,
        };
      }
    }

    let mustNotResult = { passed: true, violations: [], skipped: [] };
    if (plan && runnerResult && runnerResult.reason !== "skipped-due-to-prior-failure" && !runnerResult.chainBlocked) {
      mustNotResult = await evaluateMustNot({
        casePath: caseDir,
        plan,
        runnerResult,
        subtaskId: "stage1-delivery",
        writeLog: false,
      });
    }
    const mustNotWarnings = mustNotWarningsFromResult(mustNotResult);
    const decision = await decideAndWrite(
      caseDir,
      decideStatus({ importScan, planValid, build, runnerResult, junk, extraWarnings: mustNotWarnings }),
      { mustNotWarnings },
    );

    // === N19 Phase 1 hook: append-only baseline + evolution-log ===
    if (decision.status === "delivery-pass" || decision.status === "delivery-with-warnings") {
      try {
        const { writeBaseline } = await import("./_baseline_writer.js");
        const { appendEvolutionLog } = await import("./_evolution_log.js");
        const baselineResult = await writeBaseline({
          casePath: caseDir,
          deliveryRecord: decision,
          runnerResult,
          planPath: join(caseDir, "specs/plan.json"),
        });
        await appendEvolutionLog({
          casePath: caseDir,
          entry: {
            kind: "delivery-baseline-written",
            timestamp: new Date().toISOString(),
            baselineId: baselineResult.baselineId,
            deliveryStatus: decision.status,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[n19-phase1] baseline/log hook failed: ${message}`);
      }
    }
    // === end N19 Phase 1 hook ===

    if (decision.status === "delivery-pass" || decision.status === "delivery-with-warnings") {
      console.log(`[delivery] ${decision.status}`);
      return 0;
    }

    console.error(`[delivery] ${decision.status}: ${decision.blockReason}`);
    return decision.status === "chain-blocked" ? 3 : 1;
  } finally {
    releaseDeliveryLock(deliveryLock);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
