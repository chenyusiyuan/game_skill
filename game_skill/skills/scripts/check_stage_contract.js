#!/usr/bin/env node
/**
 * check_stage_contract.js — validate specs/stage-contract-{N}.yaml.
 *
 * Exit codes:
 *   0 = OK
 *   1 = contract invalid or acceptance failed
 *   2 = contract missing or stage cannot be resolved
 */

import { existsSync, readFileSync } from "fs";
import { spawnSync } from "child_process";
import { basename, dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function usage() {
  return [
    "Usage: node check_stage_contract.js <case-dir> [--stage 1-5] [--log cases/<slug>/.game/log.jsonl]",
    "",
    "Validates specs/stage-contract-{N}.yaml, scope preserve/forbid, acceptance checks, and complexity budget.",
  ].join("\n");
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const caseArg = firstPositional(args) ?? ".";
const caseDir = resolve(caseArg);
const stage = resolveStage(args, caseDir);
const logPath = parseLogArg(process.argv);
const log = createLogger(logPath);
const errors = [];
const warnings = [];

function fail(msg) { console.log(`  ✗ ${msg}`); errors.push(msg); }
function warn(msg) { console.log(`  ⚠ ${msg}`); warnings.push(msg); }
function ok(msg) { console.log(`  ✓ ${msg}`); }

console.log(`Stage contract check: ${caseDir}${stage ? ` [stage=${stage}]` : ""}`);

function firstPositional(argv) {
  const valueFlags = new Set(["--stage", "--log"]);
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

if (!stage) {
  fail("无法解析 stage；请传 --stage 1-5，或在 state.json.phasePlan.allowedStages/currentStage 中声明");
  finish(2);
}

const contractPath = join(caseDir, `specs/stage-contract-${stage}.yaml`);
if (!existsSync(contractPath)) {
  fail(`stage contract 不存在: ${relative(process.cwd(), contractPath)}`);
  finish(2);
}

const contract = readYaml(contractPath, "stage-contract");
if (!contract) finish(1);

checkContractShape(contract, stage);
const ids = collectSpecIds(caseDir);
checkScope(contract, ids);
checkComplexityBudget(contract, stage, caseDir);
runAcceptance(contract, caseDir);

finish(errors.length ? 1 : 0);

function resolveStage(argv, root) {
  const idx = argv.indexOf("--stage");
  if (idx >= 0) {
    const value = Number(argv[idx + 1]);
    return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
  }
  const statePath = join(root, ".game/state.json");
  if (!existsSync(statePath)) return null;
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const candidates = [
      state.currentStage,
      state["current-stage"],
      state.phasePlan?.currentStage,
      state.phasePlan?.["current-stage"],
      Array.isArray(state.phasePlan?.allowedStages) ? state.phasePlan.allowedStages[0] : null,
      String(state.currentPhase ?? "").match(/^stage-(\d)$/)?.[1],
    ];
    for (const candidate of candidates) {
      const n = Number(candidate);
      if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
    }
  } catch {
    return null;
  }
  return null;
}

function readYaml(path, label) {
  try {
    return yaml.load(readFileSync(path, "utf8")) ?? {};
  } catch (err) {
    fail(`${label} YAML 解析失败: ${err.message}`);
    return null;
  }
}

function checkContractShape(contractDoc, expectedStage) {
  if (contractDoc["stage-n"] !== expectedStage) fail(`stage-n 必须等于 ${expectedStage}`);
  else ok(`stage-n = ${expectedStage}`);

  const stageTypes = new Set(["vertical-slice", "content", "variety", "progression", "polish"]);
  if (!stageTypes.has(contractDoc["stage-type"])) fail(`stage-type 非法: ${contractDoc["stage-type"]}`);
  else ok(`stage-type = ${contractDoc["stage-type"]}`);

  if (typeof contractDoc.goal !== "string" || !contractDoc.goal.trim()) fail("goal 必须是非空 string");
  const scope = contractDoc.scope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    fail("scope 必须是 object");
  } else {
    for (const key of ["add", "preserve", "forbid"]) {
      if (!Array.isArray(scope[key])) fail(`scope.${key} 必须是 array`);
    }
  }
  if (!Array.isArray(contractDoc.acceptance)) fail("acceptance 必须是 array");
  else ok(`acceptance = ${contractDoc.acceptance.length}`);
  const budget = contractDoc["complexity-budget"];
  if (!budget || typeof budget !== "object" || Array.isArray(budget)) {
    fail("complexity-budget 必须是 object");
  } else {
    for (const key of ["max-new-systems", "max-new-entities", "max-new-rules"]) {
      if (!Number.isInteger(budget[key])) fail(`complexity-budget.${key} 必须是 integer`);
    }
  }
}

function collectSpecIds(root) {
  const mechanics = readOptionalYaml(join(root, "specs/mechanics.yaml"));
  const scene = readOptionalYaml(join(root, "specs/scene.yaml"));
  const rule = readOptionalYaml(join(root, "specs/rule.yaml"));
  const out = {
    entities: new Set(),
    rules: new Set(),
    scenes: new Set(),
    all: new Set(),
  };

  for (const entity of mechanics?.entities ?? []) add(out.entities, entity?.id);
  for (const node of mechanics?.mechanics ?? []) {
    add(out.rules, node?.node);
    add(out.rules, node?.id);
  }
  for (const ruleItem of collectArrayishRules(rule)) {
    add(out.rules, ruleItem?.id);
    add(out.rules, ruleItem?.name);
  }
  for (const sceneItem of scene?.scenes ?? []) add(out.scenes, sceneItem?.id);

  for (const set of [out.entities, out.rules, out.scenes]) {
    for (const id of set) out.all.add(id);
  }
  return out;
}

function readOptionalYaml(path) {
  if (!existsSync(path)) return {};
  try {
    return yaml.load(readFileSync(path, "utf8")) ?? {};
  } catch (err) {
    warn(`${relative(process.cwd(), path)} 解析失败，scope 校验将缺少该文件信息: ${err.message}`);
    return {};
  }
}

function collectArrayishRules(ruleDoc) {
  if (Array.isArray(ruleDoc?.rules)) return ruleDoc.rules;
  if (Array.isArray(ruleDoc?.mechanics)) return ruleDoc.mechanics;
  return [];
}

function add(set, value) {
  if (value !== undefined && value !== null && String(value).trim()) set.add(String(value).trim());
}

function checkScope(contractDoc, ids) {
  for (const item of contractDoc.scope?.preserve ?? []) {
    const parsed = parseScopedId(item);
    if (!existsByScope(parsed, ids)) {
      fail(`scope.preserve 引用不存在: ${item}`);
    } else {
      ok(`scope.preserve 存在: ${item}`);
    }
  }
  for (const item of contractDoc.scope?.forbid ?? []) {
    const parsed = parseScopedId(item);
    if (existsByScope(parsed, ids)) {
      fail(`scope.forbid 仍然存在: ${item}`);
    }
  }
}

function parseScopedId(value) {
  const raw = String(value ?? "").trim();
  const m = raw.match(/^(entity|rule|scene):(.+)$/);
  if (m) return { kind: m[1], id: m[2].trim(), raw };
  return { kind: "any", id: raw, raw };
}

function existsByScope(ref, ids) {
  if (!ref.id) return false;
  if (ref.kind === "entity") return ids.entities.has(ref.id);
  if (ref.kind === "rule") return ids.rules.has(ref.id);
  if (ref.kind === "scene") return ids.scenes.has(ref.id);
  return ids.all.has(ref.id);
}

function checkComplexityBudget(contractDoc, stageNum, root) {
  if (stageNum === 1) {
    ok("Stage 1 无上一 stage，跳过增量复杂度预算");
    return;
  }
  const budget = contractDoc["complexity-budget"] ?? {};
  const prevMechanicsPath = findPreviousMechanics(root, stageNum - 1);
  if (!prevMechanicsPath) {
    fail(`缺少上一 stage mechanics 归档: .game/stages/${stageNum - 1}/.../mechanics.yaml`);
    return;
  }
  const current = countComplexity(readOptionalYaml(join(root, "specs/mechanics.yaml")));
  const prev = countComplexity(readOptionalYaml(prevMechanicsPath));
  const deltas = {
    "max-new-systems": current.systems - prev.systems,
    "max-new-entities": current.entities - prev.entities,
    "max-new-rules": current.rules - prev.rules,
  };
  for (const [key, delta] of Object.entries(deltas)) {
    const limit = budget[key];
    if (Number.isInteger(limit) && delta > limit) {
      fail(`complexity-budget.${key} 超限: delta=${delta}, limit=${limit}`);
    } else if (Number.isInteger(limit)) {
      ok(`complexity-budget.${key}: delta=${delta}, limit=${limit}`);
    }
  }
}

function findPreviousMechanics(root, prevStage) {
  const candidates = [
    join(root, `.game/stages/${prevStage}/specs/mechanics.yaml`),
    join(root, `.game/stages/${prevStage}/mechanics.yaml`),
    join(root, `.game/stages/stage-${prevStage}/specs/mechanics.yaml`),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function countComplexity(mechanicsDoc) {
  return {
    systems: Array.isArray(mechanicsDoc?.systems) ? mechanicsDoc.systems.length : 0,
    entities: Array.isArray(mechanicsDoc?.entities) ? mechanicsDoc.entities.length : 0,
    rules: Array.isArray(mechanicsDoc?.mechanics) ? mechanicsDoc.mechanics.length : 0,
  };
}

function runAcceptance(contractDoc, root) {
  for (const [idx, item] of (contractDoc.acceptance ?? []).entries()) {
    if (!item?.check || typeof item.check !== "string") {
      fail(`acceptance[${idx}].check 缺失`);
      continue;
    }
    if (!item.threshold || typeof item.threshold !== "object" || Array.isArray(item.threshold)) {
      fail(`acceptance[${idx}].threshold 必须是 object`);
      continue;
    }
    const scriptName = basename(item.check.endsWith(".js") ? item.check : `${item.check}.js`);
    if (scriptName === "check_stage_contract.js") {
      fail(`acceptance[${idx}] 不允许递归调用 check_stage_contract.js`);
      continue;
    }
    const scriptPath = join(__dirname, scriptName);
    if (!existsSync(scriptPath)) {
      fail(`acceptance[${idx}] check 脚本不存在: ${scriptName}`);
      continue;
    }
    const result = spawnSync(process.execPath, [scriptPath, ...checkArgs(scriptName, root, item.threshold)], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 8,
    });
    if (result.stdout?.trim()) console.log(indent(result.stdout.trim()));
    if (result.stderr?.trim()) console.error(indent(result.stderr.trim()));
    if (result.status !== 0) {
      fail(`acceptance[${idx}] ${scriptName} 退出码 ${result.status}`);
    } else {
      ok(`acceptance[${idx}] ${scriptName} passed`);
    }
  }
}

function checkArgs(scriptName, root, threshold = {}) {
  const gameDirScripts = new Set([
    "check_game_boots.js",
    "check_project.js",
    "check_profile_runner_smoke.js",
    "check_playthrough.js",
  ]);
  const target = gameDirScripts.has(scriptName) ? join(root, "game") : root;
  const out = [target];
  if (scriptName === "check_playthrough.js") {
    out.push("--profile", String(threshold.profile ?? basename(root)));
  }
  if (scriptName === "check_difficulty_curve.js" && threshold.stage) {
    out.push("--stage", String(threshold.stage));
  }
  if (logPath) out.push("--log", logPath);
  return out;
}

function indent(text) {
  return text.split("\n").map((line) => `    ${line}`).join("\n");
}

function finish(code) {
  log.entry({
    type: "check-run",
    phase: "stage",
    step: "stage-contract",
    script: "check_stage_contract.js",
    stage,
    exit_code: code,
    errors,
    warnings,
  });
  process.exit(code);
}
