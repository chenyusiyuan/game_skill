#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve, isAbsolute } from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(SCRIPT_DIR, "..");
const CASES_ROOT = join(SKILL_DIR, "cases");

const ASSET_MODES = new Set(["local-assets", "no-assets", "llm-generated-mock"]);
const VALID_EVAL_PROVIDERS = new Set(["codex-cli", "claude-code-cli", "claude-code-api", "openrouter-api"]);
const VALID_CONFIRMATION_MODES = new Set(["user-message-id", "user-message-text", "interactive", "policy-default"]);
const SLUG_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const usage = [
  "Usage: node check_step0_confirmed.js <case-dir> [--bypass-step0 --reason <text>] [--json]",
  "",
  "Checks <case-dir>/.game/state.json for state['step-0-confirmed'].",
  "Default evaluator policy uses openrouter-api/kimi-k2.6 via confirmationMode=policy-default.",
  "Also requires <case-dir>/.game/vision-policy.json from resolve_vision_policy.js --check.",
  "Use --bypass-step0 --reason <text> only for smoke-test scenarios.",
].join("\n");

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage);
  process.exit(0);
}

const jsonOut = args.includes("--json");
const caseArg = firstPositional(args);
if (!caseArg) {
  console.error(usage);
  process.exit(2);
}

const caseDir = resolve(caseArg);
assertMiniGameCaseDir(caseDir);
const gameDir = join(caseDir, ".game");
const statePath = join(gameDir, "state.json");
const bypass = args.includes("--bypass-step0");
const reason = valueAfter(args, "--reason");
if (bypass) {
  const trimmed = String(reason ?? "").trim();
  if (!trimmed) {
    fail(["--bypass-step0 requires a non-empty --reason <text>"], 2);
  }
  const state = readStateOrEmpty(statePath);
  state["step-0-bypassed"] = {
    at: new Date().toISOString(),
    reason: trimmed,
  };
  writeJsonAtomic(statePath, state);
  ok({ bypassed: true, statePath });
}

if (!existsSync(statePath)) {
  fail([`missing ${statePath}`], 1);
}

const state = readJsonStrict(statePath);
const errors = validateConfirmed(state["step-0-confirmed"]);
const bypassed = validateExistingBypass(state["step-0-bypassed"]);
const { warnings: stateWarnings, errors: stateErrors } = validateStateChoices(state);

// C-FP09: also validate eval-provider.json confirmationMode
const evalProviderPath = join(gameDir, "eval-provider.json");
const { warnings: evalWarnings, errors: evalErrors } = validateEvalProviderConfirmation(evalProviderPath);
const visionPolicyPath = join(gameDir, "vision-policy.json");
const { warnings: visionWarnings, errors: visionErrors } = validateVisionPolicy(visionPolicyPath, state);

const allErrors = [...errors, ...stateErrors, ...evalErrors, ...visionErrors];
if (allErrors.length && !bypassed.ok) {
  fail(allErrors, 1);
}

ok({
  bypassed: bypassed.ok,
  statePath,
  warnings: [
    ...(allErrors.length && bypassed.ok ? allErrors.map((error) => `ignored by step-0-bypassed: ${error}`) : []),
    ...stateWarnings,
    ...evalWarnings,
    ...visionWarnings,
  ],
});

function validateConfirmed(confirmed) {
  const errors = [];
  if (!isObject(confirmed)) {
    return ["missing state['step-0-confirmed']; configure the default OpenRouter evaluator or an explicitly requested evaluator before Phase A"];
  }
  if (!isIsoTimestamp(confirmed.at)) errors.push("state['step-0-confirmed'].at must be an ISO timestamp");
  const evaluator = confirmed.evaluator;
  if (!isObject(evaluator)) {
    errors.push("state['step-0-confirmed'].evaluator is missing");
  } else {
    if (!nonEmpty(evaluator.choice)) errors.push("state['step-0-confirmed'].evaluator.choice is missing");
    if (evaluator["confirmed-by"] !== "user-message") errors.push("state['step-0-confirmed'].evaluator['confirmed-by'] must be user-message");
    if (!nonEmpty(evaluator["user-message-id"])) errors.push("state['step-0-confirmed'].evaluator['user-message-id'] is missing");
  }

  // asset-mode is optional; current Step 0 only blocks on evaluator confirmation.
  // If the field is present, validate its shape.
  const assetMode = confirmed["asset-mode"];
  if (isObject(assetMode) && !ASSET_MODES.has(assetMode.choice)) {
    errors.push(`state['step-0-confirmed']['asset-mode'].choice must be one of ${[...ASSET_MODES].join(", ")}`);
  }
  return errors;
}

function validateExistingBypass(value) {
  if (!isObject(value)) return { ok: false };
  return { ok: isIsoTimestamp(value.at) && nonEmpty(value.reason) };
}

function validateEvalProviderConfirmation(evalPath) {
  const warnings = [];
  const errors = [];
  if (!existsSync(evalPath)) {
    errors.push(`missing ${evalPath}; run configure_eval_provider.js with --default-from-policy or after explicit user choice`);
    return { warnings, errors };
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(evalPath, "utf-8"));
  } catch (err) {
    errors.push(`failed to parse ${evalPath}: ${err.message}`);
    return { warnings, errors };
  }
  if (!isObject(doc)) {
    errors.push(`${evalPath} is not a valid JSON object`);
    return { warnings, errors };
  }
  if (!VALID_EVAL_PROVIDERS.has(doc.evalProvider)) {
    errors.push(`${evalPath} invalid evalProvider "${doc.evalProvider ?? "<missing>"}"; must be one of: ${[...VALID_EVAL_PROVIDERS].join(", ")}`);
  }
  if (doc.confirmedByUser !== true) {
    errors.push(`${evalPath} must have confirmedByUser=true`);
  }
  const mode = doc.confirmationMode;
  if (!mode) {
    errors.push(`${evalPath} missing confirmationMode field`);
  } else if (mode === "noninteractive-explicit") {
    errors.push(`${evalPath} confirmationMode "noninteractive-explicit" is no longer accepted; use user-message-id, user-message-text, or interactive`);
  } else if (!VALID_CONFIRMATION_MODES.has(mode)) {
    errors.push(`${evalPath} invalid confirmationMode "${mode}"; must be one of: ${[...VALID_CONFIRMATION_MODES].join(", ")}`);
  }
  if (mode === "user-message-id" && !nonEmpty(doc.userMessageId)) {
    errors.push(`${evalPath} confirmationMode user-message-id requires userMessageId`);
  }
  if (mode === "user-message-text" && !nonEmpty(doc.userMessageText) && !nonEmpty(doc.userMessageHash)) {
    errors.push(`${evalPath} confirmationMode user-message-text requires userMessageText or userMessageHash`);
  }
  if (mode !== "interactive" && !nonEmpty(doc.userMessageId)) {
    errors.push(`${evalPath} missing userMessageId audit field; re-run configure_eval_provider.js with --default-from-policy, --user-message-id, or --user-message-text`);
  }
  return { warnings, errors };
}

function validateVisionPolicy(policyPath, state) {
  const warnings = [];
  const errors = [];
  if (!existsSync(policyPath)) {
    errors.push(`missing ${policyPath}; run resolve_vision_policy.js before Phase A`);
    return { warnings, errors };
  }
  let policy;
  try {
    policy = JSON.parse(readFileSync(policyPath, "utf-8"));
  } catch (err) {
    errors.push(`failed to parse ${policyPath}: ${err.message}`);
    return { warnings, errors };
  }
  if (!isObject(policy)) {
    errors.push(`${policyPath} is not a valid JSON object`);
    return { warnings, errors };
  }
  const mode = String(policy.visionMode ?? policy["vision-mode"] ?? "").trim();
  if (!["enabled", "disabled"].includes(mode)) errors.push(`${policyPath} visionMode must be enabled or disabled`);
  const hostModel = String(policy.hostModel ?? policy.model ?? "").trim();
  if (isUnknownHostModel(hostModel)) errors.push(`${policyPath} hostModel must be an actual model id, not empty or unknown`);
  if (/glm/i.test(hostModel) && mode !== "disabled") errors.push(`${policyPath} GLM-like host model must force visionMode disabled`);
  if (mode === "disabled" && policy.mainAgentMayReadImages !== false) {
    errors.push(`${policyPath} disabled mode must set mainAgentMayReadImages=false`);
  }
  if (mode === "enabled" && policy.mainAgentMayReadImages !== true) {
    errors.push(`${policyPath} enabled mode must set mainAgentMayReadImages=true`);
  }
  const compilerPolicy = String(policy.compilerImagePolicy ?? "").trim();
  if (compilerPolicy && compilerPolicy !== "disabled") errors.push(`${policyPath} compilerImagePolicy must remain disabled`);
  if (!nonEmpty(policy.imageReadPolicy) && !nonEmpty(policy["image-read-policy"])) {
    errors.push(`${policyPath} missing imageReadPolicy text`);
  }
  const stateMode = String(state?.visionPolicy?.visionMode ?? state?.visionPolicy?.["vision-mode"] ?? "").trim();
  if (!stateMode) errors.push("state.visionPolicy missing; run resolve_vision_policy.js so Step 0 records the minimal host image-read policy");
  else if (mode && stateMode !== mode) errors.push(`state.visionPolicy ${stateMode} does not match vision-policy.json ${mode}`);
  return { warnings, errors };
}

function validateStateChoices(state) {
  const warnings = [];
  const errors = [];
  const caseName = caseDir.split("/").filter(Boolean).pop();
  if (!SLUG_RE.test(caseName)) {
    errors.push(`invalid project slug "${caseName}": must match ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`);
  }
  const confirmedChoice = state["step-0-confirmed"]?.evaluator?.choice;
  if (confirmedChoice && !VALID_EVAL_PROVIDERS.has(confirmedChoice)) {
    errors.push(`state['step-0-confirmed'].evaluator.choice invalid: ${confirmedChoice}`);
  }
  return { warnings, errors };
}

function firstPositional(argv) {
  const valueFlags = new Set(["--reason"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (valueFlags.has(arg)) {
      i += 1;
      continue;
    }
    if (!arg.startsWith("--")) return arg;
  }
  return null;
}

function valueAfter(argv, flag) {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : null;
}

function assertMiniGameCaseDir(dir) {
  const rel = relative(CASES_ROOT, dir);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    fail([`mini-game cases must live under ${CASES_ROOT}/<slug>; got ${dir}`], 2);
  }
}

function readStateOrEmpty(path) {
  if (!existsSync(path)) return {};
  return readJsonStrict(path);
}

function readJsonStrict(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    fail([`failed to read JSON ${path}: ${error.message}`], 1);
  }
}

function writeJsonAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  renameSync(tmp, path);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isUnknownHostModel(hostModel) {
  const text = String(hostModel ?? "").trim();
  if (!text) return true;
  if (/^<.*>$/.test(text)) return true;
  return /\bunknown\b/i.test(text.replaceAll(/[-_]/g, " "));
}

function isIsoTimestamp(value) {
  return nonEmpty(value) && !Number.isNaN(Date.parse(value));
}

function ok(extra = {}) {
  const result = { status: "pass", summary: "step-0 ok", errors: [], warnings: [], ...extra };
  if (jsonOut) console.log(JSON.stringify(result, null, 2));
  else console.log("step-0 ok");
  process.exit(0);
}

function fail(errors, exitCode) {
  const result = {
    status: "fail",
    summary: "Step 0 evaluator configuration is incomplete",
    errors,
    warnings: [],
  };
  if (jsonOut) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error("FAIL check_step0_confirmed: Step 0 evaluator configuration is incomplete");
    for (const error of errors) console.error(`  FAIL ${error}`);
  }
  process.exit(exitCode);
}
