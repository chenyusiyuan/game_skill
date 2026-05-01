#!/usr/bin/env node
/**
 * check_archetype_identity.js — Stage 1 archetype identity gate.
 *
 * CLI:
 *   node check_archetype_identity.js <case-dir> [--log <path>]
 *
 * Exit codes:
 *   0 = OK, including ok-skip when no archetype-ref or archetype file exists
 *   1 = missing core-identity implementation evidence
 *   3 = environment or unreadable-file failure
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join, resolve, sep } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function usage() {
  return [
    "Usage: node check_archetype_identity.js <case-dir> [--log <path>]",
    "",
    "If docs/design-strategy.yaml has archetype-ref, checks core-identity anti-pattern mitigation evidence in game/src/.",
    "Missing design-strategy.yaml, missing archetype-ref, or missing gameplay-archetypes/<id>.yaml returns ok-skip.",
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
  okSkip("docs/design-strategy.yaml 不存在，本 case 暂无 archetype-ref");
}

const strategy = readYaml(strategyPath);
const archetypeRef = normalizeRef(strategy?.["archetype-ref"]);
if (!archetypeRef) {
  okSkip("design-strategy.archetype-ref 缺失或为空，本 case 无对应 archetype");
}

const archetypeDir = resolve(__dirname, "../references/gameplay-archetypes");
if (!existsSync(archetypeDir)) {
  okSkip(`gameplay archetype 目录不存在，未来内容批次尚未接入: ${archetypeDir}`);
}

const archetypePath = resolve(archetypeDir, `${archetypeRef}.yaml`);
if (!archetypePath.startsWith(`${archetypeDir}${sep}`)) {
  envError(`archetype-ref 非法，不能越过 gameplay-archetypes 目录: ${archetypeRef}`);
}
if (!existsSync(archetypePath)) {
  okSkip(`archetype 文件不存在，跳过 identity gate: ${archetypePath}`);
}

const archetypeDoc = readYaml(archetypePath);
const antiPatterns = readAntiPatterns(archetypeDoc);
const corePatterns = antiPatterns.filter((item) => item?.severity === "core-identity");
const polishPatterns = antiPatterns.filter((item) => item?.severity === "polish");

if (polishPatterns.length > 0) {
  const polishIds = polishPatterns.map((item) => item.id).filter(Boolean);
  console.log(`  info polish anti-patterns ignored for exit code: ${polishIds.join(", ") || polishPatterns.length}`);
  info.push({ kind: "polish", ids: polishIds });
}

if (corePatterns.length === 0) {
  console.log("  ✓ ok: no core-identity anti-patterns declared");
  finish(0, { result: "ok", archetype: archetypeRef, missing: [] });
}

const srcDir = join(caseDir, "game/src");
if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) {
  envError(`game/src 不存在，无法检查 archetype identity evidence: ${srcDir}`);
}

const sourceFiles = listFiles(srcDir);
const missing = [];

for (const pattern of corePatterns) {
  if (!pattern || typeof pattern.id !== "string" || !pattern.id.trim()) {
    envError("core-identity anti-pattern 缺少 id");
  }
  const evidence = typeof pattern["grep-evidence"] === "string" && pattern["grep-evidence"].trim()
    ? { mode: "regex", value: pattern["grep-evidence"].trim(), label: "grep-evidence" }
    : { mode: "literal", value: kebabCase(pattern.id), label: "id-kebab" };
  const matched = hasEvidence(sourceFiles, evidence);
  if (matched) {
    console.log(`  ✓ ${pattern.id}: ${evidence.label} matched ${matched}`);
  } else {
    console.log(`  ✗ ${pattern.id}: missing ${evidence.label} evidence '${evidence.value}'`);
    missing.push(pattern.id);
  }
}

if (missing.length > 0) {
  const payload = { archetype: archetypeRef, missing };
  console.log(JSON.stringify(payload, null, 2));
  finish(1, { result: "failed", ...payload });
}

console.log(`  ✓ ok: all ${corePatterns.length} core-identity anti-pattern mitigations have evidence`);
finish(0, { result: "ok", archetype: archetypeRef, missing: [] });

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

function normalizeRef(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readYaml(path) {
  try {
    return yaml.load(readFileSync(path, "utf-8")) ?? {};
  } catch (err) {
    envError(`读取 YAML 失败: ${path}: ${err.message}`);
  }
}

function readAntiPatterns(doc) {
  const value = Array.isArray(doc?.["anti-patterns"])
    ? doc["anti-patterns"]
    : doc?.archetype?.["anti-patterns"];
  if (!Array.isArray(value)) {
    envError(`archetype 缺少 anti-patterns 数组: ${archetypePath}`);
  }
  return value;
}

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build", ".git"].includes(entry.name)) continue;
      files.push(...listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function hasEvidence(files, evidence) {
  let regex = null;
  if (evidence.mode === "regex") {
    try {
      regex = new RegExp(evidence.value, "m");
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
    const matched = regex ? regex.test(text) : text.includes(evidence.value);
    if (matched) return file;
  }
  return null;
}

function kebabCase(value) {
  return String(value)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
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
