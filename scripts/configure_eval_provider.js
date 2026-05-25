#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPT_DIR, "..");
const CASES_ROOT = path.join(REPO, "cases");
const PROVIDERS = new Set(["codex-cli", "claude-code-cli", "claude-code-api", "openrouter-api"]);
const DEFAULTS = {
  "codex-cli": { model: "gpt-5.5", reasoning: "xhigh" },
  "claude-code-cli": { model: "claude-opus-4-7", reasoning: "high" },
  "claude-code-api": { model: "claude-opus-4-7", reasoning: "high" },
  "openrouter-api": { model: "kimi-k2.6", reasoning: null },
};

const usage = [
  "Usage: node scripts/configure_eval_provider.js <case-dir> [--provider <provider>] [--model <model>] [--reasoning <level>]",
  "                                                [--default-from-policy|--confirmed-by-user --user-message-id <hash>|--user-message-text <text>] [--json]",
  "",
  "Default evaluator policy: openrouter-api / kimi-k2.6.",
  "Non-interactive calls with a non-default provider must pass --confirmed-by-user and user-message evidence.",
  "This writes <case-dir>/.game/eval-provider.json and mirrors Step 0 confirmation into <case-dir>/.game/state.json.",
].join("\n");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(usage);
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2));
if (!args.caseDir) fail(usage, 2);

const caseDir = path.resolve(REPO, args.caseDir);
assertMiniGameCaseDir(caseDir);
fs.mkdirSync(path.join(caseDir, ".game"), { recursive: true });

let provider = args.provider;
if (args.defaultFromPolicy && provider && provider !== "openrouter-api") {
  fail("FAIL configure_eval_provider: --default-from-policy is only valid with --provider openrouter-api", 2);
}
if (args.defaultFromPolicy && !provider) provider = "openrouter-api";
if (!provider) provider = await askProvider();
provider = normalizeProvider(provider);
if (!PROVIDERS.has(provider)) {
  fail(`FAIL configure_eval_provider: unsupported provider ${provider}`, 2);
}

if (provider === "openrouter-api") {
  const requested = String(args.model ?? "").trim();
  if (requested && !isKimiModel(requested)) {
    console.error(`WARN configure_eval_provider: openrouter-api is fixed to kimi-k2.6; ignoring requested model ${requested}`);
  }
}

const nonInteractive = Boolean(args.provider || args.defaultFromPolicy);
if (nonInteractive && !args.defaultFromPolicy && !args.confirmedByUser) {
  fail("FAIL configure_eval_provider: --provider requires --confirmed-by-user unless using --default-from-policy.", 2);
}
if (args.confirmedByUser && !args.userMessageId && !args.userMessageText && !args.defaultFromPolicy) {
  fail("FAIL configure_eval_provider: --confirmed-by-user requires --user-message-id or --user-message-text.", 2);
}

const defaults = DEFAULTS[provider];
const evalModel = provider === "openrouter-api" ? defaults.model : (args.model || defaults.model);
const persisted = {
  schemaVersion: 1,
  evalProvider: provider,
  evalModel,
  evalReasoning: args.reasoning ?? defaults.reasoning,
  multimodal: true,
  supportsMultimodal: true,
  multimodalSupport: {
    supported: true,
    status: "multimodal",
    evidence: "static current-pipeline evaluator policy",
  },
  confirmedByUser: true,
  ...confirmationEvidence(args),
  updatedAt: new Date().toISOString(),
  secretPolicy: "tokens are read from environment variables only; this file must not contain secrets",
};

const outPath = path.join(caseDir, ".game", "eval-provider.json");
writeJsonAtomic(outPath, persisted);
const step0 = updateStep0Confirmed(caseDir, persisted);

if (args.json) {
  console.log(JSON.stringify({ status: "ok", path: outPath, config: persisted, step0 }, null, 2));
} else {
  console.log(`PASS configure_eval_provider: ${outPath}`);
  console.log(`provider=${persisted.evalProvider} model=${persisted.evalModel} reasoning=${persisted.evalReasoning ?? "<none>"}`);
  if (step0.updated) console.log(`step0=updated ${step0.updatedStatePaths.join(", ")}`);
}

function parseArgs(argv) {
  const out = {
    caseDir: null,
    provider: null,
    model: null,
    reasoning: null,
    defaultFromPolicy: false,
    confirmedByUser: false,
    userMessageId: null,
    userMessageText: null,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--provider") out.provider = argv[++index] ?? "";
    else if (arg === "--model") out.model = argv[++index] ?? "";
    else if (arg === "--reasoning") out.reasoning = argv[++index] ?? "";
    else if (arg === "--user-message-id") out.userMessageId = argv[++index] ?? "";
    else if (arg === "--user-message-text") out.userMessageText = argv[++index] ?? "";
    else if (arg === "--default-from-policy") out.defaultFromPolicy = true;
    else if (arg === "--confirmed-by-user") out.confirmedByUser = true;
    else if (arg === "--json") out.json = true;
    else if (arg.startsWith("--")) fail(`unknown argument: ${arg}`, 2);
    else if (!out.caseDir) out.caseDir = arg;
    else fail(`unexpected argument: ${arg}`, 2);
  }
  return out;
}

async function askProvider() {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question("Evaluator provider [openrouter-api]: ")).trim();
    return answer || "openrouter-api";
  } finally {
    rl.close();
  }
}

function normalizeProvider(value) {
  const raw = String(value ?? "").trim().toLowerCase().replaceAll("_", "-");
  const aliases = {
    codex: "codex-cli",
    claude: "claude-code-cli",
    "claude-cli": "claude-code-cli",
    api: "claude-code-api",
    anthropic: "claude-code-api",
    openrouter: "openrouter-api",
  };
  return aliases[raw] || raw;
}

function confirmationEvidence({ defaultFromPolicy, confirmedByUser, userMessageId, userMessageText }) {
  const text = String(userMessageText ?? "").trim();
  if (defaultFromPolicy) {
    return {
      confirmationMode: "policy-default",
      userMessageId: "policy:default-openrouter-kimi-k2.6",
      policy: "default evaluator openrouter-api/kimi-k2.6 unless current query explicitly specifies another evaluator",
    };
  }
  if (!confirmedByUser) return { confirmationMode: "interactive" };
  if (userMessageId) {
    return {
      confirmationMode: "user-message-id",
      userMessageId,
      ...(text ? { userMessageHash: confirmationHash(text) } : {}),
    };
  }
  const hash = confirmationHash(text);
  return {
    confirmationMode: "user-message-text",
    userMessageId: `hash:${hash.slice(0, 16)}`,
    userMessageHash: hash,
  };
}

function updateStep0Confirmed(caseDir, evalDoc) {
  const gameDir = path.join(caseDir, ".game");
  const statePaths = [
    path.join(gameDir, "state.json"),
    fs.existsSync(path.join(caseDir, "state.json")) ? path.join(caseDir, "state.json") : null,
  ].filter(Boolean);
  const updatedStatePaths = [];
  for (const statePath of statePaths) {
    const previous = readJsonOptional(statePath) ?? {};
    const next = {
      ...previous,
      "step-0-confirmed": {
        ...(isObject(previous["step-0-confirmed"]) ? previous["step-0-confirmed"] : {}),
        at: new Date().toISOString(),
        evaluator: {
          choice: evalDoc.evalProvider,
          model: evalDoc.evalModel,
          reasoning: evalDoc.evalReasoning,
          confirmationMode: evalDoc.confirmationMode,
          "confirmed-by": "user-message",
          "user-message-id": evalDoc.userMessageId || confirmationHash(evalDoc).slice(0, 16),
          ...(evalDoc.userMessageHash ? { "user-message-hash": evalDoc.userMessageHash } : {}),
        },
      },
    };
    writeJsonAtomic(statePath, next);
    updatedStatePaths.push(statePath);
  }
  return { updated: true, updatedStatePaths };
}

function assertMiniGameCaseDir(dir) {
  const rel = path.relative(CASES_ROOT, dir);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    fail(`FAIL configure_eval_provider: cases must live under ${CASES_ROOT}/<slug>; got ${dir}`, 2);
  }
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function readJsonOptional(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function confirmationHash(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function isKimiModel(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "kimi-k2.6" || raw === "kimi_k2_6" || raw === "kimi" || raw === "moonshotai/kimi-k2.6";
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}
