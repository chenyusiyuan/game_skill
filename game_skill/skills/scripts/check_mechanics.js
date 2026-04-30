#!/usr/bin/env node
/**
 * check_mechanics.js — Phase 3.5 Dynamic Mechanics Structure Check
 *
 * 读取 cases/<slug>/specs/mechanics.yaml，验证 v2 动态 mechanics：
 *   1. mechanics DAG 从 external-events 可达
 *   2. scenarios 至少声明一条 expected-outcome: win|settle
 *   3. 每个 node 的 invariants 条目含 name + condition
 *   4. trace-events 在对应 runtime-module 内有 push 证据
 *   5. runtime-module 存在，且被业务代码 import
 *
 * 用法:
 *   node check_mechanics.js <case-dir> [--allow-missing-mechanics] [--log cases/<slug>/.game/log.jsonl]
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const allowMissingMechanics = args.includes("--allow-missing-mechanics");
const log = createLogger(parseLogArg(process.argv));
const errors = [];
const warnings = [];

function fail(msg) { console.log(`  ✗ ${msg}`); errors.push(msg); }
function warn(msg) { console.log(`  ⚠ ${msg}`); warnings.push(msg); }
function ok(msg) { console.log(`  ✓ ${msg}`); }

console.log(`Dynamic mechanics check: ${caseDir}`);

const mechPath = join(caseDir, "specs/mechanics.yaml");
if (!existsSync(mechPath)) {
  if (allowMissingMechanics) {
    warn(`mechanics.yaml 不存在（${mechPath}）；因 --allow-missing-mechanics 跳过`);
    finish(0);
  }
  fail(`mechanics.yaml 不存在: ${mechPath}`);
  finish(1);
}

const mech = readYaml(mechPath);
if (!mech) finish(1);

const gameDir = join(caseDir, "game");
const businessSources = existsSync(gameDir) ? collectSource(gameDir)
  .filter((item) => !/[/\\]mechanics[/\\]/.test(item.path))
  .filter((item) => !/[/\\]_common[/\\]/.test(item.path)) : [];
const businessBlob = businessSources.map((item) => item.text).join("\n");

checkShape(mech);
checkDagConnectivity(mech);
checkScenarios(mech);
checkRuntimeModules(mech, businessBlob);

finish(errors.length ? 1 : 0);

function readYaml(p) {
  try { return yaml.load(readFileSync(p, "utf8")) ?? {}; }
  catch (e) { fail(`读取 ${p} 失败: ${e.message}`); return null; }
}

function checkShape(m) {
  if (m.version !== 2) fail("mechanics.yaml version 必须为 2（dynamic mechanics schema）");
  else ok("version = 2");

  if (m.mode !== "dynamic-generated") fail("mechanics.yaml mode 必须为 dynamic-generated");
  else ok("mode = dynamic-generated");

  if (!Array.isArray(m.entities) || m.entities.length === 0) fail("entities 段为空");
  else ok(`entities = ${m.entities.length}`);

  if (!Array.isArray(m.mechanics) || m.mechanics.length === 0) {
    fail("mechanics 段为空");
    return;
  }
  ok(`mechanics = ${m.mechanics.length}`);

  const nodeIds = new Set();
  for (const [idx, node] of m.mechanics.entries()) {
    const id = node?.node;
    if (!id) {
      fail(`mechanics[${idx}] 缺 node id`);
      continue;
    }
    if (nodeIds.has(id)) fail(`duplicate node id: ${id}`);
    nodeIds.add(id);
    if (!node["runtime-module"]) {
      fail(`node ${id} 缺 runtime-module（应指向 src/mechanics/<node-id>.runtime.mjs）`);
    }
    if (!Array.isArray(node.invariants)) {
      fail(`node ${id} 缺 invariants 数组（可为空，但字段必须存在）`);
    } else {
      for (const [i, inv] of node.invariants.entries()) {
        if (!inv?.name) fail(`node ${id}.invariants[${i}] 缺 name`);
        if (!inv?.condition) fail(`node ${id}.invariants[${i}] 缺 condition`);
      }
    }
  }
}

function checkDagConnectivity(m) {
  const nodes = Array.isArray(m.mechanics) ? m.mechanics : [];
  if (nodes.length === 0) return;

  const produced = new Set();
  for (const node of nodes) {
    for (const ev of producedEvents(node)) produced.add(ev);
  }

  const declaredExternal = toStringArray(m["external-events"]);
  const inferredExternal = new Set();
  for (const node of nodes) {
    for (const ev of triggerEvents(node)) {
      if (!produced.has(ev)) inferredExternal.add(ev);
    }
  }
  const externalEvents = new Set(declaredExternal.length ? declaredExternal : [...inferredExternal]);
  if (externalEvents.size === 0) {
    fail("DAG 缺 external-events，且无法从 triggers 推断根事件");
    return;
  }

  const visited = new Set();
  const availableEvents = new Set(externalEvents);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (!node?.node || visited.has(node.node)) continue;
      const triggers = triggerEvents(node);
      if (triggers.length === 0 || triggers.some((ev) => availableEvents.has(ev))) {
        visited.add(node.node);
        for (const ev of producedEvents(node)) availableEvents.add(ev);
        changed = true;
      }
    }
  }

  const unreachable = nodes.map((n) => n.node).filter((id) => id && !visited.has(id));
  if (unreachable.length) {
    fail(`DAG unreachable node(s) from external-events: ${unreachable.join(", ")}`);
  } else {
    ok(`DAG 连通：${visited.size}/${nodes.length} node(s) reachable`);
  }
}

function checkScenarios(m) {
  const scenarios = Array.isArray(m.scenarios)
    ? m.scenarios
    : (Array.isArray(m["simulation-scenarios"]) ? m["simulation-scenarios"] : []);
  if (scenarios.length === 0) {
    fail("mechanics.yaml 未声明 scenarios（至少需要一条 expected-outcome: win 或 settle）");
    return;
  }
  const positive = scenarios.filter((sc) => ["win", "settle"].includes(sc?.["expected-outcome"]));
  if (positive.length === 0) {
    fail("scenarios 至少需要一条 expected-outcome: win|settle");
  } else {
    ok(`scenarios 正向终局声明完整：${positive.length}/${scenarios.length}`);
  }
}

function checkRuntimeModules(m, businessSrc) {
  for (const node of m.mechanics ?? []) {
    if (!node?.node) continue;
    const relModule = node["runtime-module"];
    if (!relModule) continue;
    const modulePath = resolveRuntimeModule(relModule);
    if (!existsSync(modulePath)) {
      fail(`node ${node.node} runtime-module 不存在: ${relative(caseDir, modulePath)}`);
      continue;
    }
    const runtimeSrc = readFileSync(modulePath, "utf8");
    ok(`node ${node.node} runtime-module 存在: ${relative(caseDir, modulePath)}`);

    const traceEvents = toStringArray(node["trace-events"]);
    if (traceEvents.length === 0) {
      fail(`node ${node.node} 缺 trace-events`);
    }
    const hasPushEvidence = /(?:window\.)?__trace\.push\s*\(|\bpushTrace\s*\(|\.push\s*\(/.test(runtimeSrc);
    for (const ev of traceEvents) {
      if (!runtimeSrc.includes(ev) || !hasPushEvidence) {
        fail(`node ${node.node} trace-event "${ev}" 未在 ${relative(caseDir, modulePath)} 中形成 push 证据`);
      }
    }

    if (!isRuntimeModuleImported(businessSrc, relModule)) {
      fail(`node ${node.node} runtime-module 未被业务代码 import: ${relModule}`);
    } else {
      ok(`node ${node.node} runtime-module 已被业务代码 import`);
    }
  }
}

function triggerEvents(node) {
  return [
    ...toStringArray(node.triggers),
    ...toStringArray(node["trigger-on"]),
  ];
}

function producedEvents(node) {
  const out = [
    ...toStringArray(node["trace-events"]),
    ...toStringArray(node["produces-events"]),
  ];
  for (const effect of Array.isArray(node.effects) ? node.effects : []) {
    if (typeof effect === "string") out.push(effect);
    else if (effect?.event) out.push(String(effect.event));
    else if (effect?.type) out.push(String(effect.type));
  }
  return [...new Set(out.filter(Boolean))];
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function resolveRuntimeModule(rel) {
  const raw = String(rel);
  if (raw.startsWith("/")) return raw;
  const clean = raw.replace(/^\.?\//, "");
  if (clean.startsWith("game/")) return join(caseDir, clean);
  return join(gameDir, clean);
}

function isRuntimeModuleImported(source, relModule) {
  const clean = String(relModule).replace(/^\.?\//, "");
  const base = basename(clean);
  const noSrc = clean.replace(/^src\//, "");
  const patterns = [
    clean,
    noSrc,
    `./${noSrc}`,
    `../${noSrc}`,
    base,
  ].map(escapeReg);
  return new RegExp(`import[\\s\\S]{0,240}["'][^"']*(?:${patterns.join("|")})["']`).test(source);
}

function collectSource(root) {
  const out = [];
  walk(root, (p) => {
    if (!/\.(js|mjs|cjs|html)$/i.test(p)) return;
    out.push({ path: p, text: readFileSync(p, "utf8") });
  });
  return out;
}

function walk(dir, fn) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, fn);
    else fn(p);
  }
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function finish(code) {
  log.entry({
    type: "check-run",
    phase: "expand",
    step: "mechanics",
    script: "check_mechanics.js",
    exit_code: code,
    errors,
    warnings,
  });
  process.exit(code);
}
