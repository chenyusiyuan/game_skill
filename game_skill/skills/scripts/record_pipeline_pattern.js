#!/usr/bin/env node
/**
 * record_pipeline_pattern.js
 *
 * 把 case-driven 复盘里的重复问题写入 case 根目录的 .pipeline_patterns.md。
 */

import { basename, resolve } from "path";
import {
  ORIGIN_LAYERS,
  patternsPathFor,
  readPatternDoc,
  recordPattern,
  thresholdViolations,
  writePatternDoc,
} from "./_pipeline_patterns.js";

const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const patternId = arg("--pattern");
const originLayer = arg("--origin");
const example = arg("--example") ?? basename(caseDir);
const nextAbstraction = arg("--next") ?? "";
const status = arg("--status") ?? "open";
const note = arg("--note") ?? null;
const filePath = arg("--file") ? resolve(arg("--file")) : patternsPathFor(caseDir);

if (!patternId || !originLayer) {
  console.error("Usage: node record_pipeline_pattern.js <case-dir> --pattern <id> --origin <layer> [--example <case>] [--next <text>] [--status open]");
  console.error(`origin layers: ${ORIGIN_LAYERS.join(" | ")}`);
  process.exit(2);
}

try {
  const doc = readPatternDoc(filePath);
  const entry = recordPattern(doc, { patternId, originLayer, example, nextAbstraction, status, note });
  writePatternDoc(filePath, doc);
  console.log(`✓ pattern recorded: ${entry["pattern-id"]} count=${entry.count}`);
  console.log(`  file: ${filePath}`);
  const violations = thresholdViolations(doc.data.patterns);
  if (violations.length > 0) {
    console.log("  ⚠ abstraction-required:");
    for (const p of violations) {
      console.log(`    - ${p["pattern-id"]}: count=${p.count}, status=${p.status}`);
    }
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}

function arg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : null;
}
