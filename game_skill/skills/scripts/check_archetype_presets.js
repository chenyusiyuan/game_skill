#!/usr/bin/env node
/**
 * check_archetype_presets.js — 校验 references/archetypes preset 只提供 specs 骨架，
 * 不提供绕过 gate 的完整 game code template。
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const archetypeDir = join(repoRoot, "game_skill/skills/references/archetypes");
const indexPath = join(archetypeDir, "index.yaml");
const errors = [];

function fail(msg) { console.log(`  ✗ ${msg}`); errors.push(msg); }
function ok(msg) { console.log(`  ✓ ${msg}`); }

console.log(`archetype preset 校验: ${archetypeDir}`);

if (!existsSync(indexPath)) {
  fail(`缺少 index.yaml: ${indexPath}`);
  finish();
}

let index;
try {
  index = yaml.load(readFileSync(indexPath, "utf-8")) ?? {};
} catch (e) {
  fail(`index.yaml 解析失败: ${e.message}`);
  finish();
}

if (index["archetype-index-version"] !== 1) fail("archetype-index-version 必须为 1");
if (!Array.isArray(index.presets)) fail("index.presets 必须是数组");

const ids = new Set();
for (const presetRef of index.presets ?? []) {
  const id = String(presetRef?.id ?? "");
  const rel = String(presetRef?.path ?? "");
  if (!id || !rel) {
    fail("index.presets 中存在缺 id/path 的条目");
    continue;
  }
  if (ids.has(id)) fail(`重复 archetype id: ${id}`);
  ids.add(id);
  const path = join(archetypeDir, rel);
  if (!existsSync(path)) {
    fail(`[${id}] preset 文件不存在: ${rel}`);
    continue;
  }
  validatePreset(id, path);
}

if (errors.length === 0) ok(`archetype presets 完整 (${ids.size})`);
finish();

function validatePreset(expectedId, path) {
  let preset;
  try {
    preset = yaml.load(readFileSync(path, "utf-8")) ?? {};
  } catch (e) {
    fail(`[${expectedId}] YAML 解析失败: ${e.message}`);
    return;
  }
  if (preset["archetype-id"] !== expectedId) {
    fail(`[${expectedId}] archetype-id 与 index 不一致: ${preset["archetype-id"]}`);
  }
  const requiredObjects = [
    "archetype-plan",
    "mechanics-preset",
    "data-schema",
    "visual-slots-preset",
    "profile-skeleton",
    "gate-policy",
  ];
  for (const key of requiredObjects) {
    if (!preset[key] || typeof preset[key] !== "object") fail(`[${expectedId}] 缺少对象段: ${key}`);
  }
  const arrays = [
    ["mechanics-preset", "primitives"],
    ["mechanics-preset", "required-rules"],
    ["visual-slots-preset", "slots"],
    [null, "runtime-modules"],
    [null, "semantic-probes"],
    ["profile-skeleton", "drivers"],
    ["profile-skeleton", "observers"],
    ["profile-skeleton", "steps"],
    ["gate-policy", "must-pass"],
  ];
  for (const [parent, key] of arrays) {
    const value = parent ? preset[parent]?.[key] : preset[key];
    if (!Array.isArray(value) || value.length === 0) {
      fail(`[${expectedId}] ${parent ? `${parent}.` : ""}${key} 必须是非空数组`);
    }
  }
  if (preset["game-code-template"] || preset["template-code"]) {
    fail(`[${expectedId}] preset 禁止携带完整 game code template；只能提供 specs/profile 骨架`);
  }
}

function finish() {
  console.log(`\n${errors.length === 0 ? "✓ 通过" : `✗ ${errors.length} 个错误`}`);
  process.exit(errors.length > 0 ? 1 : 0);
}
