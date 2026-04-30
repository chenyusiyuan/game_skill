#!/usr/bin/env node
/**
 * check_preserve_regression.js — verify Stage 1 preserve scenarios still hold.
 *
 * Exit codes:
 *   0 = preserve regression passed
 *   1 = preserve regression failed
 *   2 = preserve.lock missing
 */

import { existsSync, readFileSync } from "fs";
import { join, relative, resolve } from "path";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";

function usage() {
  return [
    "Usage: node check_preserve_regression.js <case-dir> [--log cases/<slug>/.game/log.jsonl]",
    "",
    "Reads .game/preserve.lock.yaml and current specs/mechanics.yaml.",
    "Fails if preserved scenarios disappeared or changed expected outcome.",
  ].join("\n");
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const caseArg = firstPositional(args) ?? ".";
const caseDir = resolve(caseArg);
const lockPath = join(caseDir, ".game/preserve.lock.yaml");
const mechanicsPath = join(caseDir, "specs/mechanics.yaml");
const log = createLogger(parseLogArg(process.argv));
const errors = [];
const warnings = [];

function fail(msg) { console.log(`  ✗ ${msg}`); errors.push(msg); }
function warn(msg) { console.log(`  ⚠ ${msg}`); warnings.push(msg); }
function ok(msg) { console.log(`  ✓ ${msg}`); }

console.log(`Preserve regression check: ${caseDir}`);

function firstPositional(argv) {
  const valueFlags = new Set(["--log"]);
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

if (!existsSync(lockPath)) {
  fail(`preserve.lock 缺失: ${relative(process.cwd(), lockPath)}`);
  finish(2);
}
if (!existsSync(mechanicsPath)) {
  fail(`mechanics.yaml 缺失，无法验证 preserve scenarios: ${relative(process.cwd(), mechanicsPath)}`);
  finish(1);
}

const lock = readYaml(lockPath, "preserve.lock");
const mechanics = readYaml(mechanicsPath, "mechanics");
if (!lock || !mechanics) finish(1);

checkLockShape(lock);
checkScenarioRegression(lock, mechanics);

finish(errors.length ? 1 : 0);

function readYaml(path, label) {
  try {
    return yaml.load(readFileSync(path, "utf8")) ?? {};
  } catch (err) {
    fail(`${label} YAML 解析失败: ${err.message}`);
    return null;
  }
}

function checkLockShape(lockDoc) {
  if (!Array.isArray(lockDoc.scenarios) || lockDoc.scenarios.length === 0) {
    fail("preserve.lock scenarios 为空");
  } else {
    ok(`preserve scenarios = ${lockDoc.scenarios.length}`);
  }
  if (!Array.isArray(lockDoc["core-entities"])) fail("preserve.lock core-entities 必须是 array");
  if (!Array.isArray(lockDoc["win-lose-conditions"])) fail("preserve.lock win-lose-conditions 必须是 array");
  if (!Array.isArray(lockDoc["core-ui-zones"])) fail("preserve.lock core-ui-zones 必须是 array");
}

function checkScenarioRegression(lockDoc, mechanicsDoc) {
  const current = new Map(getScenarios(mechanicsDoc).map((scenario) => [String(scenario?.name ?? ""), scenario]));
  for (const preserved of lockDoc.scenarios ?? []) {
    const name = String(preserved?.name ?? "");
    const expected = preserved?.["expected-outcome"];
    if (!name) {
      fail("preserve scenario 缺 name");
      continue;
    }
    const now = current.get(name);
    if (!now) {
      fail(`preserved scenario 已消失: ${name}`);
      continue;
    }
    const actual = now["actual-outcome"] ?? now.result ?? now["expected-outcome"];
    if (actual !== expected) {
      fail(`scenario ${name} outcome drift: preserve=${expected}, current=${actual ?? "<missing>"}`);
      continue;
    }
    const currentMax = Number(now["max-ticks"]);
    const lockedMax = Number(preserved["max-ticks"]);
    if (Number.isFinite(currentMax) && Number.isFinite(lockedMax) && currentMax > lockedMax * 2 && lockedMax > 0) {
      warn(`scenario ${name} max-ticks 明显变大: preserve=${lockedMax}, current=${currentMax}`);
    }
    ok(`scenario ${name} preserves ${expected}`);
  }
}

function getScenarios(mechanicsDoc) {
  if (Array.isArray(mechanicsDoc.scenarios)) return mechanicsDoc.scenarios;
  if (Array.isArray(mechanicsDoc["simulation-scenarios"])) return mechanicsDoc["simulation-scenarios"];
  return [];
}

function finish(code) {
  log.entry({
    type: "check-run",
    phase: "stage",
    step: "preserve-regression",
    script: "check_preserve_regression.js",
    exit_code: code,
    errors,
    warnings,
  });
  process.exit(code);
}
