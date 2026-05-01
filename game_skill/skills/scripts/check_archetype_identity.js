#!/usr/bin/env node
/**
 * check_archetype_identity.js — Stage 1 archetype identity gate.
 *
 * CLI:
 *   node check_archetype_identity.js <case-dir> [--log <path>]
 *
 * Exit codes:
 *   0 = OK, including ok-skip when no identity-anchors are declared
 *   1 = missing identity anchor implementation evidence
 *   3 = environment or unreadable-file failure
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, extname, join, resolve } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const ANCHOR_ID_RE = /^[a-z][a-z0-9-]*$/;
const REGEX_HINT_RE = /[\\()[\].*+?{}|]/;
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".html", ".css", ".json"]);

function usage() {
  return [
    "Usage: node check_archetype_identity.js <case-dir> [--log <path>]",
    "",
    "Reads cases/<slug>/docs/design-strategy.yaml identity-anchors array;",
    "verifies each anchor has grep-able evidence in cases/<slug>/game/src/.",
    "Missing design-strategy.yaml or empty identity-anchors returns ok-skip.",
  ].join("\n");
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const caseDir = resolve(firstPositional(args) ?? ".");
const log = createLogger(parseLogArg(process.argv));
const errors = [];
const warnings = [];
const info = [];

console.log(`Archetype identity check: ${caseDir}`);

if (!existsSync(caseDir) || !statSync(caseDir).isDirectory()) {
  envError(`case-dir 不存在或不是目录: ${caseDir}`);
}

const strategyPath = join(caseDir, "docs/design-strategy.yaml");
if (!existsSync(strategyPath)) {
  okSkip("docs/design-strategy.yaml 不存在，本 case 无 identity gate 约束");
}

const strategy = readYaml(strategyPath);
if (!strategy || typeof strategy !== "object" || Array.isArray(strategy)) {
  envError("docs/design-strategy.yaml 必须是对象");
}

if (!Object.prototype.hasOwnProperty.call(strategy, "identity-anchors")) {
  okSkip("design-strategy.identity-anchors 缺失或为空，本 case 无 identity gate 约束");
}

const anchors = strategy["identity-anchors"];
if (!Array.isArray(anchors)) {
  envError("design-strategy.identity-anchors 必须是数组");
}
if (anchors.length === 0) {
  okSkip("design-strategy.identity-anchors 缺失或为空，本 case 无 identity gate 约束");
}

const srcDir = join(caseDir, "game/src");
if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) {
  envError(`game/src 不存在，无法检查 identity anchor evidence: ${srcDir}`);
}

const sourceFiles = listFiles(srcDir);
const missing = [];
let okCount = 0;

for (const anchor of anchors) {
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
    envError("identity anchor 必须是对象");
  }
  const id = anchor.id;
  if (typeof id !== "string" || !ANCHOR_ID_RE.test(id)) {
    envError(`identity anchor.id 必须匹配 ^[a-z][a-z0-9-]*$: ${String(id)}`);
  }
  const evidence = resolveEvidence(anchor);
  const matched = hasEvidence(sourceFiles, evidence);
  if (matched) {
    console.log(`  ✓ ${id}`);
    okCount += 1;
  } else {
    console.log(`  ✗ ${id}: no evidence for pattern "${evidence.value}"`);
    missing.push(id);
  }
}

console.log(`  ${okCount}/${anchors.length} anchors found`);

if (missing.length > 0) {
  finish(1, { result: "failed", missing, anchors_checked: anchors.length, anchors_found: okCount });
}

finish(0, { result: "ok", missing: [], anchors_checked: anchors.length, anchors_found: okCount });

function firstPositional(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--log") {
      i += 1;
      continue;
    }
    if (!arg.startsWith("--")) return arg;
  }
  return null;
}

function readYaml(path) {
  try {
    return yaml.load(readFileSync(path, "utf-8")) ?? {};
  } catch (err) {
    envError(`读取 YAML 失败: ${path}: ${err.message}`);
  }
}

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build", ".git"].includes(entry.name)) continue;
      files.push(...listFiles(path));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }
  return files;
}

function resolveEvidence(anchor) {
  const raw = anchor["grep-evidence"];
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    envError(`identity anchor ${anchor.id} 的 grep-evidence 必须是字符串`);
  }
  const value = typeof raw === "string" && raw.trim() ? raw.trim() : anchor.id;
  return {
    value,
    mode: raw && REGEX_HINT_RE.test(value) ? "regex" : "literal",
  };
}

function hasEvidence(files, evidence) {
  let regex = null;
  if (evidence.mode === "regex") {
    try {
      regex = new RegExp(evidence.value, "i");
    } catch (err) {
      envError(`grep-evidence 不是合法 regex: ${evidence.value}: ${err.message}`);
    }
  }
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const matched = regex ? regex.test(text) : text.toLowerCase().includes(evidence.value.toLowerCase());
    if (matched) return true;
  }
  return false;
}

function okSkip(reason) {
  console.log(`  ✓ ok-skip: ${reason}`);
  finish(0, { result: "ok-skip", reason });
}

function envError(message) {
  console.log(`  ✗ ${message}`);
  errors.push(message);
  finish(3, { result: "environment_error", reason: message });
}

function finish(code, extra = {}) {
  log.entry({
    type: "check-run",
    phase: "verify",
    step: "archetype-identity",
    script: "check_archetype_identity.js",
    exit_code: code,
    errors,
    warnings,
    info,
    ...extra,
  });
  process.exit(code);
}
