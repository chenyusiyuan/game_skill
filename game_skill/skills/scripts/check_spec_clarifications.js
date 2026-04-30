#!/usr/bin/env node
/**
 * check_spec_clarifications.js — gate Phase 2.5 output before mechanics.
 *
 * Catches balance formulas that cannot prove level reachability. Mechanics
 * nodes are now dynamically extracted later, so this gate no longer validates
 * names against a fixed mechanics catalog.
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { createLogger, parseLogArg } from "./_logger.js";

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

if (!existsSync(docPath)) fail(`spec-clarifications.md 不存在: ${docPath}`);
if (!existsSync(prdPath)) fail(`game-prd.md 不存在: ${prdPath}`);
if (errors.length) finish(1);

const doc = readFileSync(docPath, "utf-8");
const prd = readFileSync(prdPath, "utf-8");

checkRayCastContract(doc, prd);
checkBalanceFormula(doc, prd);

if (errors.length === 0) ok("spec-clarifications.md 可进入 dynamic mechanics decomposition");
finish(errors.length ? 1 : 0);

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
