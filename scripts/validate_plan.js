#!/usr/bin/env node
import { basename, join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SCHEMA_PATH = join(REPO, "schemas/plan.schema.json");

function formatAjvErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return ["schema validation failed without error details"];
  }
  return errors.map((error) => `${error.instancePath || "/"} ${error.message}`);
}

function jsonEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function evidenceMatchesExpect(evidence, expect) {
  if (evidence.type !== expect.type) return false;

  if (evidence.type === "canvas-change") {
    return expect.minChangedPixels >= (evidence.minChangedPixels ?? 1);
  }

  if (evidence.type === "milestone") {
    return expect.id === evidence.id && (expect.minOccurrences ?? 1) >= (evidence.minOccurrences ?? 1);
  }

  if (evidence.type === "state") {
    return (
      expect.path === evidence.path &&
      (expect.operator ?? "==") === evidence.operator &&
      jsonEqual(expect.value, evidence.value)
    );
  }

  return false;
}

function describeEvidence(evidence) {
  if (evidence.type === "canvas-change") {
    return `canvas-change minChangedPixels>=${evidence.minChangedPixels ?? 1}`;
  }
  if (evidence.type === "milestone") {
    return `milestone ${evidence.id} minOccurrences>=${evidence.minOccurrences ?? 1}`;
  }
  if (evidence.type === "state") {
    return `state ${evidence.path} ${evidence.operator} ${JSON.stringify(evidence.value)}`;
  }
  return JSON.stringify(evidence);
}

const GENERIC_EVIDENCE_TOKENS = new Set([
  "action",
  "active",
  "canvas",
  "changed",
  "count",
  "data",
  "done",
  "entity",
  "event",
  "game",
  "main",
  "mechanic",
  "mechanics",
  "mode",
  "object",
  "phase",
  "player",
  "primary",
  "ready",
  "state",
  "status",
  "system",
  "updated",
  "value",
]);

function tokenVariants(token) {
  const variants = new Set([token]);
  if (token.length > 5 && token.endsWith("ing")) {
    const base = token.slice(0, -3);
    variants.add(base);
    variants.add(`${base}e`);
  }
  if (token.length > 4 && token.endsWith("ed")) {
    variants.add(token.slice(0, -2));
  }
  if (token.length > 4 && token.endsWith("s")) {
    variants.add(token.slice(0, -1));
  }
  return variants;
}

function identityTokens(value) {
  const words = String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length >= 3 && !/^\d+$/u.test(word) && !GENERIC_EVIDENCE_TOKENS.has(word));
  return new Set(words.flatMap((word) => Array.from(tokenVariants(word))));
}

function evidenceIdentityTokens(evidence) {
  if (evidence.type === "milestone") return identityTokens(evidence.id);
  if (evidence.type === "state") return identityTokens(evidence.path);
  return new Set();
}

function hasTokenOverlap(left, right) {
  for (const token of left) {
    if (right.has(token)) return true;
  }
  return false;
}

function validateMechanicSpecificEvidence(mustHave) {
  const runtimeEvidence = (mustHave.evidence ?? []).filter((evidence) => evidence.type === "milestone" || evidence.type === "state");
  if ((mustHave.mechanicRefs ?? []).length !== 1 || runtimeEvidence.length === 0) return null;

  const expectedTokens = identityTokens(`${mustHave.mechanicRefs[0]} ${mustHave.id}`);
  const observedTokens = runtimeEvidence.reduce((tokens, evidence) => {
    for (const token of evidenceIdentityTokens(evidence)) tokens.add(token);
    return tokens;
  }, new Set());

  if (expectedTokens.size === 0 || observedTokens.size === 0 || hasTokenOverlap(expectedTokens, observedTokens)) {
    return null;
  }

  return `acceptance.mustHave '${mustHave.id}' for mechanic '${mustHave.mechanicRefs[0]}' needs mechanic-specific evidence; runtime evidence ids/paths [${runtimeEvidence.map(describeEvidence).join(", ")}] do not share a specific token with the mechanic or mustHave id`;
}

function validateAcceptanceContract(plan) {
  const errors = [];
  const requiredMechanics = plan.requiredMechanics ?? [];
  const mechanicNames = new Set(requiredMechanics.map((mechanic) => mechanic.name));
  const coveredMechanics = new Set();
  const smokeExpect = plan.smoke?.expect ?? [];

  for (const mustHave of plan.acceptance?.mustHave ?? []) {
    for (const ref of mustHave.mechanicRefs ?? []) {
      if (!mechanicNames.has(ref)) {
        errors.push(`acceptance.mustHave '${mustHave.id}' references unknown requiredMechanics '${ref}'`);
      } else {
        coveredMechanics.add(ref);
      }
    }

    const hasRuntimeEvidence = (mustHave.evidence ?? []).some((evidence) => evidence.type === "milestone" || evidence.type === "state");
    if (!hasRuntimeEvidence) {
      errors.push(`acceptance.mustHave '${mustHave.id}' must include at least one milestone or state evidence`);
    }

    for (const evidence of mustHave.evidence ?? []) {
      if (!smokeExpect.some((expect) => evidenceMatchesExpect(evidence, expect))) {
        errors.push(`acceptance.mustHave '${mustHave.id}' evidence not covered by smoke.expect: ${describeEvidence(evidence)}`);
      }
    }

    const mechanicSpecificError = validateMechanicSpecificEvidence(mustHave);
    if (mechanicSpecificError) errors.push(mechanicSpecificError);
  }

  for (const mechanic of requiredMechanics) {
    if (!coveredMechanics.has(mechanic.name)) {
      errors.push(`requiredMechanics '${mechanic.name}' is not covered by acceptance.mustHave[].mechanicRefs`);
    }
  }

  return errors;
}

function validateSmokeSafety(plan) {
  const warnings = [];
  const enumStatePath = /(^|\.)(gameState|state|status|phase|mode)$/iu;

  for (const exp of plan.smoke?.expect ?? []) {
    if (exp.type !== "state") continue;
    if (typeof exp.value !== "string") continue;
    if (!enumStatePath.test(exp.path)) continue;
    warnings.push(
      `smoke.expect state '${exp.path}' uses string literal '${exp.value}'; prefer numeric/count fields such as score, lives, level, or progress over enum-state assertions`,
    );
  }

  return warnings;
}

function writeResult(caseDir, result) {
  const evalDir = join(caseDir, "eval");
  mkdirSync(evalDir, { recursive: true });
  writeFileSync(join(evalDir, "plan-check.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

export function validatePlan(caseDir) {
  const planPath = join(caseDir, "specs/plan.json");
  const result = {
    ok: false,
    status: "fail",
    case: basename(caseDir),
    path: "specs/plan.json",
    errors: [],
    warnings: [],
  };

  try {
    if (!existsSync(planPath)) {
      result.errors.push(`missing ${result.path}`);
      return result;
    }

    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const schemaOk = validate(plan);
    const schemaErrors = schemaOk ? [] : formatAjvErrors(validate.errors);
    const contractErrors = schemaOk ? validateAcceptanceContract(plan) : [];
    const smokeWarnings = schemaOk ? validateSmokeSafety(plan) : [];
    result.ok = schemaOk && contractErrors.length === 0;
    result.status = result.ok ? "pass" : "fail";
    result.errors = [...schemaErrors, ...contractErrors];
    result.warnings = smokeWarnings;
    return result;
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    return result;
  } finally {
    writeResult(caseDir, result);
  }
}

function main() {
  const caseArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!caseArg || process.argv.includes("--help") || process.argv.includes("-h")) {
    console.error("Usage: node scripts/validate_plan.js cases/<slug>");
    process.exit(caseArg ? 0 : 2);
  }

  const caseDir = resolve(REPO, caseArg);
  const result = validatePlan(caseDir);
  const summary = result.errors.join("; ") || result.path;
  console.log(`${result.status === "pass" ? "PASS" : "FAIL"} validate_plan: ${summary}`);
  process.exit(result.status === "pass" ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
