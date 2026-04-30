#!/usr/bin/env node
/**
 * check_design_strategy.js — gate Phase 2.5B output before dynamic mechanics.
 *
 * Exit codes:
 *   0 = OK
 *   1 = field missing, parse failure, or inconsistent reference
 *   2 = docs/design-strategy.yaml missing
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";

function usage() {
  return [
    "Usage: node check_design_strategy.js <case-dir> [--log cases/<slug>/.game/log.jsonl]",
    "",
    "Validates cases/<slug>/docs/design-strategy.yaml for Phase 2.5B.",
  ].join("\n");
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const caseArg = args.find((arg) => !arg.startsWith("--")) ?? ".";
const caseDir = resolve(caseArg);
const log = createLogger(parseLogArg(process.argv));
const errors = [];
const warnings = [];

function fail(msg) { console.log(`  ✗ ${msg}`); errors.push(msg); }
function warn(msg) { console.log(`  ⚠ ${msg}`); warnings.push(msg); }
function ok(msg) { console.log(`  ✓ ${msg}`); }

console.log(`Design strategy check: ${caseDir}`);

const strategyPath = join(caseDir, "docs/design-strategy.yaml");
if (!existsSync(strategyPath)) {
  fail(`design-strategy.yaml 不存在: ${strategyPath}`);
  finish(2);
}

const strategy = readYaml(strategyPath);
if (!strategy) finish(1);

checkRequiredShape(strategy);
checkDecisionPoints(strategy);
checkResourceLoop(strategy);

if (errors.length === 0) ok("design-strategy.yaml 可进入 dynamic mechanics decomposition");
finish(errors.length ? 1 : 0);

function readYaml(path) {
  try {
    return yaml.load(readFileSync(path, "utf-8")) ?? {};
  } catch (e) {
    fail(`读取 ${path} 失败: ${e.message}`);
    return null;
  }
}

function checkRequiredShape(doc) {
  requireType(doc.version, "integer", "version");
  requireObject(doc["target-experience"], "target-experience");
  requireArray(doc["gameplay-pillars"], "gameplay-pillars");
  requireObject(doc["core-loop"], "core-loop");
  requireArray(doc["decision-points"], "decision-points");
  requireObject(doc["resource-loop"], "resource-loop");
  requireObject(doc["juice-plan"], "juice-plan");
  requireObject(doc["complexity-budget"], "complexity-budget");

  const target = doc["target-experience"] ?? {};
  requireType(target.fantasy, "string", "target-experience.fantasy");
  requireType(target["session-length"], "string", "target-experience.session-length");
  requireType(target.difficulty, "string", "target-experience.difficulty");
  requireArray(target["emotional-beats"], "target-experience.emotional-beats");

  for (const [i, pillar] of asArray(doc["gameplay-pillars"]).entries()) {
    requireType(pillar?.id, "string", `gameplay-pillars[${i}].id`);
    requireType(pillar?.description, "string", `gameplay-pillars[${i}].description`);
  }

  const loop = doc["core-loop"] ?? {};
  for (const key of ["observe", "decide", "act", "feedback", "progress"]) {
    requireType(loop[key], "string", `core-loop.${key}`);
  }

  for (const [i, point] of asArray(doc["decision-points"]).entries()) {
    requireType(point?.id, "string", `decision-points[${i}].id`);
    requireType(point?.type, "string", `decision-points[${i}].type`);
    requireType(point?.options, "integer", `decision-points[${i}].options`);
    requireType(point?.["observable-via"], "string", `decision-points[${i}].observable-via`);
    requireType(point?.frequency, "string", `decision-points[${i}].frequency`);
  }

  const resources = doc["resource-loop"] ?? {};
  requireArray(resources.resources, "resource-loop.resources");
  requireArray(resources.sources, "resource-loop.sources");
  requireArray(resources.sinks, "resource-loop.sinks");
  requireType(resources["balance-target"], "number", "resource-loop.balance-target");

  const juice = doc["juice-plan"] ?? {};
  for (const key of ["input-feedback", "success-feedback", "failure-feedback", "progression-feedback"]) {
    requireArray(juice[key], `juice-plan.${key}`);
  }

  const budget = doc["complexity-budget"] ?? {};
  for (const key of ["max-new-systems-per-stage", "max-new-entities-per-stage", "max-new-rules-per-stage"]) {
    requireType(budget[key], "integer", `complexity-budget.${key}`);
  }
}

function checkDecisionPoints(doc) {
  const points = asArray(doc["decision-points"]);
  if (points.length === 0) return;
  let valid = 0;
  for (const [i, point] of points.entries()) {
    const value = point?.["observable-via"];
    if (typeof value !== "string") continue;
    if (!/^window\.gameTest\./.test(value)) {
      fail(`decision-points[${i}].observable-via 必须以 window.gameTest. 开头: ${value}`);
    } else {
      valid += 1;
    }
  }
  if (valid === points.length) ok(`decision-points observable-via 合法：${valid}/${points.length}`);
}

function checkResourceLoop(doc) {
  const loop = doc["resource-loop"] ?? {};
  const resources = new Set(asArray(loop.resources).map(resourceId).filter(Boolean));
  if (resources.size === 0) {
    fail("resource-loop.resources 至少需要一个可引用资源 id");
    return;
  }

  let refs = 0;
  for (const [i, source] of asArray(loop.sources).entries()) {
    const from = source?.from;
    if (typeof from !== "string") {
      fail(`resource-loop.sources[${i}].from 缺失或不是 string`);
      continue;
    }
    refs += 1;
    if (!resources.has(from)) fail(`resource-loop.sources[${i}].from 未在 resources[] 声明: ${from}`);
  }
  for (const [i, sink] of asArray(loop.sinks).entries()) {
    const to = sink?.to;
    if (typeof to !== "string") {
      fail(`resource-loop.sinks[${i}].to 缺失或不是 string`);
      continue;
    }
    refs += 1;
    if (!resources.has(to)) fail(`resource-loop.sinks[${i}].to 未在 resources[] 声明: ${to}`);
  }
  if (refs > 0 && errors.length === 0) ok(`resource-loop references 合法：${refs} 个引用`);
}

function resourceId(item) {
  if (typeof item === "string") return item;
  if (item && typeof item.id === "string") return item.id;
  return null;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} 必须是 object`);
}

function requireArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} 必须是 array`);
}

function requireType(value, type, label) {
  if (type === "integer") {
    if (!Number.isInteger(value)) fail(`${label} 必须是 integer`);
    return;
  }
  if (type === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) fail(`${label} 必须是 number`);
    return;
  }
  if (typeof value !== type) fail(`${label} 必须是 ${type}`);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finish(code) {
  log.entry({
    type: "check-run",
    phase: "design-strategy",
    script: "check_design_strategy.js",
    exit_code: code,
    errors,
    warnings,
  });
  process.exit(code);
}
