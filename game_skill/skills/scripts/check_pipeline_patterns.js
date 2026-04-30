#!/usr/bin/env node
/**
 * check_pipeline_patterns.js — 同类失败 pattern 达到 3 次时必须抽象升级。
 */

import { existsSync } from "fs";
import { resolve } from "path";
import { createLogger, parseLogArg } from "./_logger.js";
import { patternsPathFor, readPatternDoc, thresholdViolations } from "./_pipeline_patterns.js";

const caseDir = resolve(process.argv[2] ?? ".");
const log = createLogger(parseLogArg(process.argv));
const filePath = patternsPathFor(caseDir);
const errors = [];
const warnings = [];

function fail(msg) { console.log(`  ✗ ${msg}`); errors.push(msg); }
function warn(msg) { console.log(`  ⚠ ${msg}`); warnings.push(msg); }
function ok(msg) { console.log(`  ✓ ${msg}`); }

console.log(`pipeline pattern 校验: ${caseDir}`);

if (!existsSync(filePath)) {
  warn(".pipeline_patterns.md 不存在，跳过 pattern 阈值校验");
  finish();
}

const doc = readPatternDoc(filePath);
const patterns = doc.data.patterns ?? [];
const violations = thresholdViolations(patterns);
if (violations.length > 0) {
  for (const p of violations) {
    fail(`[pattern.${p["pattern-id"]}] count=${p.count} 已达到 3，但 status=${p.status ?? "open"}；必须抽象升级或标记为 abstracted/fixed/closed`);
  }
} else {
  ok(`pipeline patterns 无未处理阈值违规 (${patterns.length} patterns)`);
}

finish();

function finish() {
  console.log(`\n${errors.length === 0 ? "✓ 通过" : `✗ ${errors.length} 个错误`}` +
    (warnings.length ? `（${warnings.length} warnings）` : ""));
  log.entry({
    type: "check-run",
    phase: "verify",
    step: "pipeline-patterns",
    script: "check_pipeline_patterns.js",
    exit_code: errors.length > 0 ? 1 : 0,
    errors,
    warnings,
  });
  process.exit(errors.length > 0 ? 1 : 0);
}
