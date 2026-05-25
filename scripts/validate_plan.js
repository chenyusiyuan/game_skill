#!/usr/bin/env node
import { basename, join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SCHEMA_PATH = join(REPO, "schemas/plan.schema.json");

const SKILL_REFS = {
  schema: "SKILL.md#Phase A plan.json contract",
  acceptance: "SKILL.md#acceptance anti-dilution rules",
  designAnchor: "SKILL.md#A.3 plan.json derivedFrom required",
  smokeSafety: "SKILL.md#smoke design rules",
  scope: "SKILL.md#decisions source coverage",
  frequency: "SKILL.md#milestone frequency guards",
};

function diagnostic({ code, message, severity, path = "specs/plan.json", skillRef }) {
  return {
    code,
    message,
    severity,
    path,
    skillRef,
  };
}

function diagnosticMessage(item) {
  return typeof item === "string" ? item : item?.message ?? JSON.stringify(item);
}

export function formatDiagnostics(items) {
  return (items ?? []).map(diagnosticMessage).join("; ");
}

function schemaErrorPath(error) {
  const base = error.instancePath || "/";
  if (error.params?.missingProperty) {
    return `${base === "/" ? "" : base}/${error.params.missingProperty}`;
  }
  if (error.params?.additionalProperty) {
    return `${base === "/" ? "" : base}/${error.params.additionalProperty}`;
  }
  return base;
}

function formatAjvErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return [
      diagnostic({
        code: "schema-validation",
        message: "schema validation failed without error details",
        severity: "error",
        skillRef: SKILL_REFS.schema,
      }),
    ];
  }
  return errors.map((error) =>
    diagnostic({
      code: "schema-validation",
      message: `${error.instancePath || "/"} ${error.message}`,
      severity: "error",
      path: `specs/plan.json${schemaErrorPath(error)}`,
      skillRef: SKILL_REFS.schema,
    }),
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function messagesToDiagnostics(messages, { code, severity, path, skillRef }) {
  return (messages ?? []).map((message) =>
    diagnostic({
      code,
      message,
      severity,
      path,
      skillRef,
    }),
  );
}

function jsonEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function evidenceMatchesExpect(evidence, expect) {
  if (!isPlainObject(evidence) || !isPlainObject(expect)) return false;
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
  if (!isPlainObject(mustHave)) return null;
  const evidenceItems = asArray(mustHave.evidence);
  const mechanicRefs = asArray(mustHave.mechanicRefs);
  const runtimeEvidence = evidenceItems.filter((evidence) => evidence?.type === "milestone" || evidence?.type === "state");
  if (mechanicRefs.length !== 1 || runtimeEvidence.length === 0) return null;

  const expectedTokens = identityTokens(`${mechanicRefs[0]} ${mustHave.id}`);
  const observedTokens = runtimeEvidence.reduce((tokens, evidence) => {
    for (const token of evidenceIdentityTokens(evidence)) tokens.add(token);
    return tokens;
  }, new Set());

  if (expectedTokens.size === 0 || observedTokens.size === 0 || hasTokenOverlap(expectedTokens, observedTokens)) {
    return null;
  }

  return `acceptance.mustHave '${mustHave.id}' for mechanic '${mechanicRefs[0]}' needs mechanic-specific evidence; runtime evidence ids/paths [${runtimeEvidence.map(describeEvidence).join(", ")}] do not share a specific token with the mechanic or mustHave id`;
}

function validateAcceptanceContract(plan) {
  const errors = [];
  const requiredMechanics = asArray(plan.requiredMechanics).filter(isPlainObject);
  const mechanicNames = new Set(requiredMechanics.map((mechanic) => mechanic.name));
  const coveredMechanics = new Set();
  const smokeExpect = asArray(plan.smoke?.expect).filter(isPlainObject);

  for (const mustHave of asArray(plan.acceptance?.mustHave).filter(isPlainObject)) {
    const mechanicRefs = asArray(mustHave.mechanicRefs);
    const evidenceItems = asArray(mustHave.evidence);
    for (const ref of mechanicRefs) {
      if (!mechanicNames.has(ref)) {
        errors.push(`acceptance.mustHave '${mustHave.id}' references unknown requiredMechanics '${ref}'`);
      } else {
        coveredMechanics.add(ref);
      }
    }

    const hasRuntimeEvidence = evidenceItems.some((evidence) => evidence?.type === "milestone" || evidence?.type === "state");
    if (!hasRuntimeEvidence) {
      errors.push(`acceptance.mustHave '${mustHave.id}' must include at least one milestone or state evidence`);
    }

    for (const evidence of evidenceItems) {
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

  for (const exp of asArray(plan.smoke?.expect).filter(isPlainObject)) {
    if (exp.type !== "state") continue;
    if (typeof exp.value === "string" && enumStatePath.test(exp.path)) {
      warnings.push(
        `smoke.expect state '${exp.path}' uses string literal '${exp.value}'; prefer numeric/count fields such as score, lives, level, or progress over enum-state assertions`,
      );
    }
    if (isTautologicalStateExpect(exp)) {
      warnings.push(
        `smoke.expect state '${exp.path}' ${exp.operator ?? "=="} ${JSON.stringify(exp.value)} is likely initial/tautological evidence; use a changed numeric value or a mechanic-specific milestone instead`,
      );
    }
  }

  return warnings;
}

const HIGH_FREQUENCY_MILESTONE_RE = /hit|damage|destroy|score|combo|collision|collide|hurt|brick|kill|shot|bullet|fire|attack|命中|伤害|销毁|击碎|击中|得分|连击|碰撞|受击/u;

function validateMilestoneFrequencyHints(plan) {
  const warnings = [];
  for (const exp of asArray(plan.smoke?.expect).filter(isPlainObject)) {
    if (exp.type !== "milestone") continue;
    if (!HIGH_FREQUENCY_MILESTONE_RE.test(String(exp.id ?? ""))) continue;
    if (Number.isFinite(exp.minIntervalMs) || Number.isFinite(exp.maxOccurrencesInWindow)) continue;
    warnings.push(
      `smoke.expect milestone '${exp.id}' looks high-frequency; consider minIntervalMs or maxOccurrencesInWindow/windowMs so burst loops are observable without validator rewriting plan.json`,
    );
  }
  return warnings;
}

function isTautologicalStateExpect(exp) {
  const path = String(exp.path ?? "");
  const operator = exp.operator ?? "==";
  const value = exp.value;
  if (operator === ">=" && typeof value === "number" && value <= 0) {
    return /score|combo|count|progress|balls?|ballCount|level|lives|life|health|hp/u.test(path);
  }
  if (operator === ">=" && value === 1 && /(^|\.)(level|stage|wave|lives|life|health|hp)$/iu.test(path)) {
    return true;
  }
  return false;
}

function schemaWithRuntimeCompatibility(schema) {
  const copy = JSON.parse(JSON.stringify(schema));
  const mechanicProperties = copy?.properties?.requiredMechanics?.items?.properties;
  if (mechanicProperties) {
    mechanicProperties.derivedFrom = {
      oneOf: [
        { type: "string", minLength: 1 },
        { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
      ],
    };
  }
  return copy;
}

function sectionText(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = markdown.match(new RegExp(`(?:^|\\n)##\\s+${escaped}\\b[\\s\\S]*?(?=\\n##\\s+|\\n---\\s*$|$)`, "u"));
  return match?.[0] ?? "";
}

function designContractText(markdown) {
  const sampleIndex = markdown.search(/\n---\s*\n\s*##\s*跨品类样例/u);
  return sampleIndex >= 0 ? markdown.slice(0, sampleIndex) : markdown;
}

function normalizeMustAvoidItem(item) {
  return item
    .replace(/\s+#.*$/u, "")
    .replace(/[`"'“”‘’]/gu, "")
    .replace(/[。.,，;；]+$/u, "")
    .trim();
}

function mustAvoidAnchorVariants(item) {
  const normalized = normalizeMustAvoidItem(item);
  if (!normalized || /^<.*>$/u.test(normalized)) return [];
  const slug = normalized
    .toLowerCase()
    .replace(/\s+/gu, "-")
    .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return Array.from(new Set([normalized, slug].filter(Boolean))).map((value) => `mustAvoid.${value}`);
}

function extractDesignAnchors(markdown) {
  const contract = designContractText(markdown);
  const anchors = new Set();
  const visualIdentity = sectionText(contract, "visualIdentity");
  const uiSurfaces = sectionText(contract, "uiSurfaces");
  const coreLoop = sectionText(contract, "coreLoop");
  const mustAvoid = sectionText(contract, "mustAvoid");

  if (/visualIdentity\s*:/u.test(visualIdentity) && /palette\s*:/u.test(visualIdentity)) {
    anchors.add("visualIdentity.palette");
  }
  if (/uiSurfaces\s*:/u.test(uiSurfaces) && /primary\s*:/u.test(uiSurfaces)) {
    anchors.add("uiSurfaces.primary");
  }
  if (/coreLoop\s*:/u.test(coreLoop) && /primaryAction\s*:/u.test(coreLoop)) {
    anchors.add("coreLoop.primaryAction");
  }
  for (const line of mustAvoid.split(/\r?\n/u)) {
    const match = line.match(/^\s*-\s+(.+)$/u);
    if (!match) continue;
    for (const anchor of mustAvoidAnchorVariants(match[1])) anchors.add(anchor);
  }

  return Array.from(anchors).sort();
}

function derivedFromList(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  return [];
}

function validateDesignAnchors(caseDir, plan) {
  const designPath = join(caseDir, "docs/DESIGN.md");
  if (!existsSync(designPath)) return [];

  const availableAnchors = extractDesignAnchors(readFileSync(designPath, "utf8"));
  const available = new Set(availableAnchors);
  const bad = [];
  let hasStableAnchor = false;

  for (const mechanic of asArray(plan.requiredMechanics).filter(isPlainObject)) {
    const refs = derivedFromList(mechanic.derivedFrom);
    if (refs.length === 0) {
      bad.push(`${mechanic.name}: <missing>`);
      continue;
    }
    for (const ref of refs) {
      if (available.has(ref)) {
        hasStableAnchor = true;
      } else {
        bad.push(`${mechanic.name}: ${ref}`);
      }
    }
  }

  if (!hasStableAnchor && bad.length === 0) {
    bad.push("<all>: <no stable design anchor referenced>");
  }

  if (bad.length === 0) return [];
  return [
    `generation-blocked: design-anchor-missing; bad derivedFrom: ${bad.join(", ")}; available anchors: ${availableAnchors.join(", ") || "<none>"}`,
  ];
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

const SCOPE_TOKEN_STOPWORDS = new Set([
  "archetype",
  "case",
  "from",
  "query",
  "source",
  "risk",
  "user",
  "what",
  "which",
  "decision",
  "primary",
  "visual",
  "must",
  "avoid",
]);

const SCOPE_CJK_STOPWORDS = new Set([
  "用户",
  "原文",
  "要求",
  "是否",
  "什么",
  "这个",
  "必须",
  "进入",
  "主计划",
  "依据",
  "风险",
  "明确",
  "写了",
]);

function scopeChunkText(chunk) {
  const answer = chunk.text.match(/\*\*A\*\*:\s*([^\n]+)/u)?.[1] ?? "";
  return `${chunk.title}\n${answer}`;
}

function scopeTokens(text) {
  const value = String(text ?? "").toLowerCase();
  const latinTokens = value
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 3 && !/^\d+$/u.test(token) && !SCOPE_TOKEN_STOPWORDS.has(token));
  const cjkTokens = (value.match(/[\p{Script=Han}][\p{Script=Han}a-z0-9-]{1,24}/gu) ?? []).filter(
    (token) => !SCOPE_CJK_STOPWORDS.has(token),
  );
  return Array.from(new Set([...latinTokens, ...cjkTokens]));
}

function scopeLeakWarnings(caseDir, plan) {
  const decisionsPath = join(caseDir, "docs/decisions.md");
  if (!existsSync(decisionsPath)) return [];

  const chunks = parseDecisionAChunks(readFileSync(decisionsPath, "utf8"));
  const planText = [
    ...asArray(plan.requiredMechanics).filter(isPlainObject).map((mechanic) => mechanic.name),
    ...asArray(plan.acceptance?.mustHave).filter(isPlainObject).map((mustHave) => mustHave.text),
  ]
    .join("\n")
    .toLowerCase();
  const warnings = [];

  for (const chunk of chunks) {
    if (chunk.source !== "from-query" || chunk.text.includes("降级理由")) continue;
    const tokens = scopeTokens(scopeChunkText(chunk));
    if (tokens.length === 0) continue;
    if (!tokens.some((token) => planText.includes(token))) {
      warnings.push(
        `scope-leak: from-query decision '${chunk.title || "<untitled>"}' not reflected in plan.requiredMechanics[].name or acceptance.mustHave[].text`,
      );
    }
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
      result.errors.push(
        diagnostic({
          code: "plan-missing",
          message: `missing ${result.path}`,
          severity: "error",
          skillRef: SKILL_REFS.schema,
        }),
      );
      return result;
    }

    const schema = schemaWithRuntimeCompatibility(JSON.parse(readFileSync(SCHEMA_PATH, "utf8")));
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const schemaOk = validate(plan);
    const schemaErrors = schemaOk ? [] : formatAjvErrors(validate.errors);
    const canRunStaticChecks = isPlainObject(plan);
    const contractErrors = canRunStaticChecks
      ? messagesToDiagnostics(validateAcceptanceContract(plan), {
          code: "acceptance-contract",
          severity: "error",
          path: "specs/plan.json/acceptance",
          skillRef: SKILL_REFS.acceptance,
        })
      : [];
    const designAnchorErrors = canRunStaticChecks
      ? messagesToDiagnostics(validateDesignAnchors(caseDir, plan), {
          code: "design-anchor-missing",
          severity: "error",
          path: "specs/plan.json/requiredMechanics",
          skillRef: SKILL_REFS.designAnchor,
        })
      : [];
    const smokeWarnings = canRunStaticChecks
      ? messagesToDiagnostics(validateSmokeSafety(plan), {
          code: "smoke-safety-warning",
          severity: "warn",
          path: "specs/plan.json/smoke/expect",
          skillRef: SKILL_REFS.smokeSafety,
        })
      : [];
    const frequencyWarnings = canRunStaticChecks
      ? messagesToDiagnostics(validateMilestoneFrequencyHints(plan), {
          code: "milestone-frequency-suggestion",
          severity: "warn",
          path: "specs/plan.json/smoke/expect",
          skillRef: SKILL_REFS.frequency,
        })
      : [];
    const scopeWarnings = canRunStaticChecks
      ? messagesToDiagnostics(scopeLeakWarnings(caseDir, plan), {
          code: "scope-leak",
          severity: "warn",
          path: "docs/decisions.md",
          skillRef: SKILL_REFS.scope,
        })
      : [];
    result.ok = schemaOk && contractErrors.length === 0 && designAnchorErrors.length === 0;
    result.status = result.ok ? "pass" : "fail";
    result.errors = [...schemaErrors, ...contractErrors, ...designAnchorErrors];
    result.warnings = [...smokeWarnings, ...frequencyWarnings, ...scopeWarnings];
    return result;
  } catch (error) {
    result.errors.push(
      diagnostic({
        code: "plan-validation-exception",
        message: error instanceof Error ? error.message : String(error),
        severity: "error",
        skillRef: SKILL_REFS.schema,
      }),
    );
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
  const compact = process.argv.includes("--compact");
  const issues = [...result.errors, ...result.warnings];
  const summary = formatDiagnostics(compact ? issues.slice(0, 3) : issues) || result.path;
  console.log(`${result.status === "pass" ? "PASS" : "FAIL"} validate_plan: ${summary}`);
  process.exit(result.status === "pass" ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
