#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const casesRoot = join(repoRoot, "cases");
const usage = [
  "Usage: node scripts/resolve_vision_policy.js <case-dir> [--host-model <model>] [--provider <provider>]",
  "                                            [--requested enabled|disabled|unknown] [--decision-source <source>]",
  "                                            [--check] [--json]",
  "",
  "Writes <case-dir>/.game/vision-policy.json and records a minimal state.visionPolicy summary.",
  "The host model must be an actual model id. If --host-model is omitted, MINI_GAME_HOST_MODEL, ANTHROPIC_MODEL, CLAUDE_CODE_MODEL, then CODEX_MODEL are tried.",
  "Use --check to validate an existing policy without rewriting it.",
  "This is a static capability resolver; it never probes by reading or sending an image.",
].join("\n");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = args.check ? checkVisionPolicy(args.caseDir) : writeVisionPolicy(args.caseDir, args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else if (result.status === "pass") console.log(`PASS resolve_vision_policy: ${relative(repoRoot, result.path).replaceAll("\\", "/")} mode=${result.visionMode ?? result.policy?.visionMode}`);
    else console.error(`FAIL resolve_vision_policy: ${(result.errors ?? []).join("; ")}`);
    process.exit(result.status === "pass" ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage);
    process.exit(2);
  }
}

export function writeVisionPolicy(caseDir, options = {}) {
  const root = resolve(caseDir);
  assertMiniGameCaseDir(root);
  const hostModel = firstNonEmpty(
    options.hostModel,
    process.env.MINI_GAME_HOST_MODEL,
    process.env.ANTHROPIC_MODEL,
    process.env.CLAUDE_CODE_MODEL,
    process.env.CODEX_MODEL,
  );
  assertActualHostModel(hostModel);
  const policy = resolveVisionPolicy({
    requested: options.requested ?? "unknown",
    hostModel,
    provider: firstNonEmpty(options.provider, process.env.MINI_GAME_HOST_PROVIDER),
    decisionSource: options.decisionSource ?? null,
  });
  const gameDir = join(root, ".game");
  mkdirSync(gameDir, { recursive: true });
  const policyPath = join(gameDir, "vision-policy.json");
  writeJsonAtomic(policyPath, policy);

  const statePath = join(gameDir, "state.json");
  const state = readJsonOptional(statePath) ?? {};
  writeJsonAtomic(statePath, {
    ...state,
    visionPolicy: {
      visionMode: policy.visionMode,
      reason: policy.reason,
    },
  });

  return {
    status: "pass",
    path: policyPath,
    statePath,
    visionMode: policy.visionMode,
    policy,
  };
}

export function checkVisionPolicy(caseDir) {
  const root = resolve(caseDir);
  assertMiniGameCaseDir(root);
  const errors = [];
  const warnings = [];
  const policyPath = join(root, ".game", "vision-policy.json");
  const statePath = join(root, ".game", "state.json");
  const policy = readJson(policyPath, errors, ".game/vision-policy.json");
  const state = readJsonOptional(statePath);

  const mode = String(policy?.visionMode ?? policy?.["vision-mode"] ?? "").trim();
  if (!["enabled", "disabled"].includes(mode)) errors.push(".game/vision-policy.json visionMode must be enabled or disabled");
  const hostModel = String(policy?.hostModel ?? policy?.model ?? "").trim();
  if (isUnknownHostModel(hostModel)) errors.push(".game/vision-policy.json hostModel must be an actual model id, not empty or unknown");
  if (/glm/i.test(hostModel) && mode !== "disabled") errors.push("GLM host models must use visionMode disabled");
  if (mode === "disabled") {
    if (policy?.mainAgentMayReadImages !== false) errors.push("disabled vision policy must set mainAgentMayReadImages=false");
    const allowed = String(policy?.allowedImageInputs ?? policy?.["allowed-image-inputs"] ?? "").trim();
    if (allowed !== "none") errors.push("disabled vision policy must set allowedImageInputs/allowed-image-inputs to none");
  }
  if (mode === "enabled") {
    if (policy?.mainAgentMayReadImages !== true) errors.push("enabled vision policy must set mainAgentMayReadImages=true");
    if (String(policy?.compilerImagePolicy ?? "") !== "disabled") errors.push("compilerImagePolicy must remain disabled even when host vision is enabled");
  }
  if (!String(policy?.imageReadPolicy ?? policy?.["image-read-policy"] ?? "").trim()) {
    errors.push(".game/vision-policy.json missing image read policy text");
  }
  if (!state) {
    warnings.push(".game/state.json missing; resolve_vision_policy.js records a minimal mirror once state exists");
  } else {
    const stateMode = String(state?.visionPolicy?.visionMode ?? state?.visionPolicy?.["vision-mode"] ?? "").trim();
    if (stateMode && mode && stateMode !== mode) errors.push(`state visionPolicy ${stateMode} does not match .game/vision-policy.json ${mode}`);
    if (!stateMode) errors.push(".game/state.json missing minimal visionPolicy mirror");
  }

  return {
    status: errors.length === 0 ? "pass" : "fail",
    path: policyPath,
    visionMode: mode || null,
    hostModel: hostModel || null,
    policy: relative(repoRoot, policyPath).replaceAll("\\", "/"),
    errors,
    warnings,
  };
}

function parseArgs(argv) {
  const args = {
    caseDir: null,
    hostModel: "",
    provider: "",
    requested: "unknown",
    decisionSource: null,
    check: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host-model") {
      args.hostModel = argv[++i] ?? "";
      continue;
    }
    if (arg === "--provider") {
      args.provider = argv[++i] ?? "";
      continue;
    }
    if (arg === "--requested") {
      args.requested = argv[++i] ?? "unknown";
      continue;
    }
    if (arg === "--decision-source") {
      args.decisionSource = argv[++i] ?? null;
      continue;
    }
    if (arg === "--check") {
      args.check = true;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    }
    if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    if (args.caseDir) throw new Error(`unexpected argument: ${arg}`);
    args.caseDir = resolve(repoRoot, arg);
  }
  if (!args.caseDir) throw new Error("missing <case-dir>");
  return args;
}

function assertMiniGameCaseDir(dir) {
  const rel = relative(casesRoot, dir);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`mini-game cases must live under ${casesRoot}/<slug>; got ${dir}`);
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function assertActualHostModel(hostModel) {
  if (isUnknownHostModel(hostModel)) {
    throw new Error("host model is required for vision policy; pass --host-model <actual-model-id> or set MINI_GAME_HOST_MODEL/ANTHROPIC_MODEL/CLAUDE_CODE_MODEL/CODEX_MODEL");
  }
}

function resolveVisionPolicy({ requested = "unknown", hostModel = "", provider = "", decisionSource = null } = {}) {
  const requestedMode = normalizeRequestedMode(requested);
  const modelText = `${provider} ${hostModel}`.toLowerCase();
  const reason = /(^|[^a-z0-9])glm([^a-z0-9]|$)|glm[-_]/i.test(modelText)
    ? "glm-text-only"
    : requestedMode === "disabled"
      ? "explicit-disabled"
      : "default-enabled";
  const visionMode = reason === "glm-text-only" || requestedMode === "disabled" ? "disabled" : "enabled";
  const enabled = visionMode === "enabled";
  return {
    schemaVersion: 1,
    "vision-mode": visionMode,
    visionMode,
    requested: requestedMode,
    hostModel: hostModel || null,
    provider: provider || null,
    decisionSource: decisionSource || (reason === "glm-text-only" ? "static-glm-deny" : "static-capability-table"),
    reason,
    mainAgentMayReadImages: enabled,
    subagentImagePolicy: enabled ? "enabled-for-codegen-repairer-l3-only" : "disabled-before-l3",
    compilerImagePolicy: "disabled",
    "allowed-image-inputs": enabled ? "explicit-main-agent-paths-only" : "none",
    allowedImageInputs: enabled ? "explicit-main-agent-paths-only" : "none",
    "image-read-policy": enabled
      ? "Main agent, codegen, repairer, and L3 may read only explicit image paths; compiler subagents remain text-only and visual observations are auxiliary."
      : "Main agent and all L3-before subagents must not read image files; use text/state/trace/DOM/console/pageerror and pixel metrics when needed.",
    imageReadPolicy: enabled
      ? "Main agent, codegen, repairer, and L3 may read only explicit image paths; compiler subagents remain text-only and visual observations are auxiliary."
      : "Main agent and all L3-before subagents must not read image files; use text/state/trace/DOM/console/pageerror and pixel metrics when needed.",
    forbiddenImageReadGlobs: enabled ? [] : ["**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.webp", "**/*.gif"],
    visualFallbackEvidence: [
      "screenshot path existence",
      "image dimensions",
      "non-empty pixel/basic contrast metrics",
      "DOM/HUD text",
      "state snapshot",
      "console/pageerror",
    ],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeRequestedMode(value) {
  const mode = String(value ?? "unknown").trim().toLowerCase();
  return ["enabled", "disabled", "unknown"].includes(mode) ? mode : "unknown";
}

function isUnknownHostModel(hostModel) {
  const text = String(hostModel ?? "").trim();
  if (!text) return true;
  if (/^<.*>$/.test(text)) return true;
  return /\bunknown\b/i.test(text.replaceAll(/[-_]/g, " "));
}

function readJsonOptional(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readJson(path, errors, label) {
  if (!existsSync(path)) {
    errors.push(`${label} missing; run resolve_vision_policy.js in Step 0`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${label} is not parseable JSON: ${error.message}`);
    return null;
  }
}

function writeJsonAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}
