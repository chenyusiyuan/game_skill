#!/usr/bin/env node
/**
 * check_level_solvability.js — 通用可解性结构校验
 *
 * 不再依赖固定 reducer 或 genre 分支。读取 specs/data.yaml 与 specs/mechanics.yaml，
 * 校验：
 *   1. 至少声明一条 solution path
 *   2. meaningful decisions >= 3
 *   3. 不声明可进入 softlock 的路径
 *
 * 用法: node check_level_solvability.js <case-dir> [--log ...]
 *
 * 退出码:
 *   0 = passed
 *   1 = 解路径/决策深度/softlock 声明不合格
 *   3 = 环境问题（data.yaml 或 mechanics.yaml 缺失 / YAML 解析失败）
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";

const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const log = createLogger(parseLogArg(process.argv));

const errors = [];
const warnings = [];
const oks = [];

console.log(`Level solvability 校验: ${caseDir}`);

const dataPath = join(caseDir, "specs/data.yaml");
const mechPath = join(caseDir, "specs/mechanics.yaml");
if (!existsSync(dataPath)) {
  fail(`data.yaml 不存在: ${dataPath}`);
  finish(3, "missing-data");
}
if (!existsSync(mechPath)) {
  fail(`mechanics.yaml 不存在: ${mechPath}`);
  finish(3, "missing-mechanics");
}

const data = readYaml(dataPath, "data.yaml");
const mechanics = readYaml(mechPath, "mechanics.yaml");
if (!data || !mechanics) finish(3, "parse-error");

const paths = collectSolutionPaths(data);
if (paths.length === 0) {
  fail("缺少 solution path：需在 data.yaml 声明 solution-path.actions 或 solution-path.levels[].actions");
} else {
  ok(`solution paths = ${paths.length}`);
}

const maxMeaningful = Math.max(0, ...paths.map((p) => meaningfulDecisionCount(p.actions)));
const declaredMin = Number(
  data?.playability?.["meaningful-decisions-min"]
    ?? data?.playability?.["meaningful-decisions"]
    ?? data?.["meaningful-decisions-min"]
    ?? 0,
);
const effectiveMeaningful = Math.max(maxMeaningful, Number.isFinite(declaredMin) ? declaredMin : 0);
if (effectiveMeaningful < 3) {
  fail(`meaningful-decisions 必须 >= 3（declared=${declaredMin || 0}, inferred=${maxMeaningful}）`);
} else {
  ok(`meaningful-decisions >= 3（declared=${declaredMin || 0}, inferred=${maxMeaningful}）`);
}

checkSoftlockDeclarations(data, paths);
checkTerminalScenarioDeclaration(mechanics);

finish(errors.length === 0 ? 0 : 1, "done");

function readYaml(path, label) {
  try {
    return yaml.load(readFileSync(path, "utf-8")) ?? {};
  } catch (e) {
    fail(`读取 ${label} 失败: ${e.message}`);
    return null;
  }
}

function collectSolutionPaths(dataDoc) {
  const out = [];
  const root = dataDoc?.["solution-path"] ?? dataDoc?.solutionPath ?? dataDoc?.solution;
  addPath(out, "solution-path", root);

  if (Array.isArray(root?.levels)) {
    for (const level of root.levels) addPath(out, `solution-path.levels.${level?.id ?? out.length + 1}`, level);
  }
  if (Array.isArray(dataDoc?.levels)) {
    for (const level of dataDoc.levels) {
      addPath(out, `levels.${level?.id ?? out.length + 1}`, level?.["solution-path"] ?? level?.solutionPath ?? level);
    }
  }
  if (Array.isArray(dataDoc?.playability?.["solution-paths"])) {
    for (const [idx, path] of dataDoc.playability["solution-paths"].entries()) addPath(out, `playability.solution-paths.${idx}`, path);
  }
  return out.filter((p) => Array.isArray(p.actions) && p.actions.length > 0);
}

function addPath(out, id, value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value.actions)) out.push({ id, actions: value.actions, raw: value });
  if (Array.isArray(value.steps)) out.push({ id, actions: value.steps, raw: value });
}

function meaningfulDecisionCount(actions) {
  const keys = new Set();
  for (const action of actions ?? []) {
    if (!action || typeof action !== "object") continue;
    const label = action.decision
      ?? action.intent
      ?? action.event
      ?? action.type
      ?? action.action
      ?? JSON.stringify(action);
    keys.add(String(label));
  }
  return Math.max(keys.size, (actions ?? []).length);
}

function checkSoftlockDeclarations(dataDoc, paths) {
  const playability = dataDoc?.playability ?? {};
  if (playability["no-softlock-after-valid-prefix"] === false || playability["no-softlock"] === false) {
    fail("playability 声明允许 softlock（no-softlock=false），不满足通用可解性要求");
    return;
  }

  const softlockMarkers = [];
  for (const path of paths) {
    const text = JSON.stringify(path.raw ?? {});
    if (/"soft-?lock"\s*:\s*true/i.test(text) || /expected-outcome"\s*:\s*"softlock"/i.test(text)) {
      softlockMarkers.push(path.id);
    }
  }
  if (softlockMarkers.length > 0) {
    fail(`solution path 声明了 softlock 风险: ${softlockMarkers.join(", ")}`);
  } else {
    ok("未发现 softlock 声明");
  }
}

function checkTerminalScenarioDeclaration(mechanicsDoc) {
  const scenarios = Array.isArray(mechanicsDoc?.scenarios)
    ? mechanicsDoc.scenarios
    : (Array.isArray(mechanicsDoc?.["simulation-scenarios"]) ? mechanicsDoc["simulation-scenarios"] : []);
  if (scenarios.length === 0) {
    warn("mechanics.yaml 未声明 scenarios，无法交叉确认 solution terminal；后续 check_mechanics 会给出结构 gate");
    return;
  }
  const positive = scenarios.some((sc) => ["win", "settle"].includes(sc?.["expected-outcome"]));
  if (!positive) fail("mechanics scenarios 缺 expected-outcome: win|settle");
  else ok("mechanics scenarios 含 win|settle terminal");
}

function ok(msg) { oks.push(msg); console.log(`  ✓ ${msg}`); }
function warn(msg) { warnings.push(msg); console.log(`  ⚠ ${msg}`); }
function fail(msg) { errors.push(msg); console.log(`  ✗ ${msg}`); }

function finish(code, tag) {
  log.entry({
    type: "check-run",
    phase: "verify",
    step: "level-solvability",
    script: "check_level_solvability.js",
    exit_code: code,
    tag,
    oks,
    errors,
    warnings,
  });
  process.exit(code);
}
