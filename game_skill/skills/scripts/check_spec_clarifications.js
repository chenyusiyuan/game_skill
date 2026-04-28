#!/usr/bin/env node
/**
 * check_spec_clarifications.js — gate Phase 2.5 output before mechanics.
 *
 * Catches the common failure where spec-clarifications.md invents primitive
 * names or records a balance formula that cannot prove level reachability.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const log = createLogger(parseLogArg(process.argv));
const errors = [];
const warnings = [];

function fail(msg) { console.log(`  ✗ ${msg}`); errors.push(msg); }
function warn(msg) { console.log(`  ⚠ ${msg}`); warnings.push(msg); }
function ok(msg) { console.log(`  ✓ ${msg}`); }

console.log(`Spec clarification check: ${caseDir}`);

const docPath = join(caseDir, "docs/spec-clarifications.md");
const prdPath = join(caseDir, "docs/game-prd.md");
const catalogPath = resolve(__dirname, "../references/mechanics/_index.yaml");

if (!existsSync(docPath)) fail(`spec-clarifications.md 不存在: ${docPath}`);
if (!existsSync(prdPath)) fail(`game-prd.md 不存在: ${prdPath}`);
if (!existsSync(catalogPath)) fail(`mechanics primitive catalog 不存在: ${catalogPath}`);
if (errors.length) finish(1);

const doc = readFileSync(docPath, "utf-8");
const prd = readFileSync(prdPath, "utf-8");
const catalog = yaml.load(readFileSync(catalogPath, "utf-8")) ?? {};
const known = new Set((catalog.primitives || []).map((p) => `${p.id}@${p.version}`));
const ids = new Set((catalog.primitives || []).map((p) => p.id));

checkPrimitiveRefs(doc, known, ids);
checkRayCastContract(doc, prd);
checkBalanceFormula(doc, prd);

if (errors.length === 0) ok("spec-clarifications.md 可进入 mechanics decomposition");
finish(errors.length ? 1 : 0);

function checkPrimitiveRefs(text, knownRefs, knownIds) {
  const refs = [...text.matchAll(/\b[a-z][a-z0-9-]*@v\d+\b/g)].map((m) => m[0]);
  const unknown = [...new Set(refs.filter((ref) => !knownRefs.has(ref)))];
  if (unknown.length === 0) {
    ok(`primitive refs 合法: ${refs.length ? [...new Set(refs)].join(", ") : "<none>"}`);
    return;
  }
  for (const ref of unknown) {
    const id = ref.replace(/@v\d+$/, "");
    const suggestion = suggestPrimitive(id, knownIds);
    fail(`未知 primitive 引用: ${ref}${suggestion ? `；是否应为 ${suggestion}@v1` : ""}`);
  }
}

function suggestPrimitive(id, knownIds) {
  const aliases = {
    raycast: "ray-cast",
    "raycast-grid": "ray-cast",
    "grid-path-follow": "parametric-track",
    "path-follow": "parametric-track",
  };
  if (aliases[id] && knownIds.has(aliases[id])) return aliases[id];
  let best = null;
  let bestScore = Infinity;
  for (const known of knownIds) {
    const score = levenshtein(id, known);
    if (score < bestScore) {
      best = known;
      bestScore = score;
    }
  }
  return bestScore <= 3 ? best : null;
}

function checkRayCastContract(text, prdText) {
  if (!/ray-?cast/i.test(prdText)) return;
  const missing = [];
  if (!/gridPosition/.test(text)) missing.push("source gridPosition");
  if (!/(row\s*[,=]|row=|row\s*为|row\+|row-)/i.test(text)) missing.push("row coordinate semantics");
  if (!/(col\s*[,=]|col=|col\s*为|col\+|col-)/i.test(text)) missing.push("col coordinate semantics");
  if (!/(上|下|左|右|up|down|left|right)/i.test(text)) missing.push("directions");
  if (missing.length) {
    fail(`ray-cast 澄清缺少: ${missing.join(", ")}`);
  } else {
    ok("ray-cast source/coord/direction 已澄清");
  }
}

function checkBalanceFormula(text, prdText) {
  if (!/@rule\(balance-check\)|balance-check|资源余量|balance-margin/.test(prdText)) return;
  const suspicious = [
    /demand\s*=\s*[^\n;]*(?:blockCount|方块|blocks?)[^\n;]*\/\s*2/i,
    /(?:假设|平均).{0,20}(?:每只小猪|pig).{0,20}(?:消除|clear).{0,20}2/i,
    /demand\s*=.*平均/i,
  ];
  if (suspicious.some((re) => re.test(text))) {
    fail("balance-check 使用了平均消除/除以 2 之类的估算 demand；必须用需要清除的目标耐久/消耗总量计算 demand");
    return;
  }
  const hasSupply = /supply|供给|资源总量|总弹药|sum\(.*ammo|ammo\s*(?:总和|总量)/i.test(text);
  const hasDemand = /demand|需求|耐久总和|hp\s*(?:总和|总量)|durability\s*(?:总和|总量)|需清除/i.test(text);
  const hasMargin = /1\.2|20%|余量|margin/i.test(text);
  if (!hasSupply || !hasDemand || !hasMargin) {
    fail("balance-check 澄清必须同时写明 supply、demand、1.2/20% margin 的可验证口径");
  } else {
    ok("balance-check 口径包含 supply/demand/margin");
  }
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

function finish(code) {
  log.entry({
    type: "check-run",
    phase: "spec-clarify",
    script: "check_spec_clarifications.js",
    exit_code: code,
    errors,
    warnings,
  });
  process.exit(code);
}

