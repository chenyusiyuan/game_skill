#!/usr/bin/env node
/**
 * generate_preserve_lock.js — create .game/preserve.lock.yaml after Stage 1.
 *
 * Usage:
 *   node generate_preserve_lock.js <case-dir> [--force]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, relative, resolve } from "path";
import yaml from "js-yaml";

function usage() {
  return [
    "Usage: node generate_preserve_lock.js <case-dir> [--force]",
    "",
    "Reads specs/mechanics.yaml, docs/design-strategy.yaml, and specs/scene.yaml.",
    "Writes cases/<slug>/.game/preserve.lock.yaml.",
  ].join("\n");
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const caseArg = args.find((arg) => !arg.startsWith("--"));
if (!caseArg) {
  console.error("[generate_preserve_lock] missing <case-dir>");
  console.error(usage());
  process.exit(2);
}

const caseDir = resolve(caseArg);
const force = args.includes("--force");
const mechanicsPath = join(caseDir, "specs/mechanics.yaml");
const strategyPath = join(caseDir, "docs/design-strategy.yaml");
const scenePath = join(caseDir, "specs/scene.yaml");
const outPath = join(caseDir, ".game/preserve.lock.yaml");

if (!existsSync(mechanicsPath)) {
  console.error(`[generate_preserve_lock] mechanics.yaml missing: ${relative(process.cwd(), mechanicsPath)}`);
  process.exit(2);
}
if (existsSync(outPath) && !force) {
  console.error(`[generate_preserve_lock] preserve.lock already exists: ${relative(process.cwd(), outPath)} (use --force for pivot)`);
  process.exit(1);
}

const mechanics = readYaml(mechanicsPath, true);
const strategy = existsSync(strategyPath) ? readYaml(strategyPath, false) : {};
const scene = existsSync(scenePath) ? readYaml(scenePath, false) : {};

const lock = {
  version: 1,
  "generated-at-stage": force ? inferPivotStage(caseDir) : "1",
  "generated-at": new Date().toISOString(),
  "core-entities": extractCoreEntities(mechanics),
  "win-lose-conditions": extractWinLoseConditions(mechanics),
  "input-model": inferInputModel(strategy, mechanics),
  "core-ui-zones": extractCoreUiZones(scene),
  scenarios: extractScenarios(mechanics),
};

mkdirSync(join(caseDir, ".game"), { recursive: true });
writeFileSync(outPath, yaml.dump(lock, { lineWidth: 120, noRefs: true, sortKeys: false }), "utf8");
console.log(`✓ preserve.lock written: ${relative(process.cwd(), outPath)}`);

function readYaml(path, required) {
  try {
    return yaml.load(readFileSync(path, "utf8")) ?? {};
  } catch (err) {
    console.error(`[generate_preserve_lock] failed to read ${relative(process.cwd(), path)}: ${err.message}`);
    process.exit(required ? 2 : 1);
  }
}

function extractCoreEntities(mechanicsDoc) {
  const entities = Array.isArray(mechanicsDoc.entities) ? mechanicsDoc.entities : [];
  const core = entities.filter((entity) => entity?.core === true);
  const selected = core.length ? core : entities;
  return selected
    .filter((entity) => entity?.id)
    .map((entity) => ({
      id: String(entity.id),
      fields: extractEntityFields(entity),
    }));
}

function extractEntityFields(entity) {
  if (Array.isArray(entity.fields)) {
    return entity.fields.map((field) => String(field?.id ?? field?.name ?? field)).filter(Boolean);
  }
  if (entity.initial && typeof entity.initial === "object" && !Array.isArray(entity.initial)) {
    return Object.keys(entity.initial).filter((key) => key !== "id");
  }
  if (Array.isArray(entity["state-fields"])) {
    return entity["state-fields"].map((field) => String(field)).filter(Boolean);
  }
  return [];
}

function extractWinLoseConditions(mechanicsDoc) {
  const out = [];
  for (const node of mechanicsDoc.mechanics ?? []) {
    const params = node?.params && typeof node.params === "object" ? node.params : {};
    for (const kind of ["win", "lose", "settle"]) {
      const rules = Array.isArray(params[kind]) ? params[kind] : [];
      for (const item of rules) {
        out.push({
          kind,
          params: {
            node: String(node.node ?? ""),
            ...(item && typeof item === "object" ? item : { value: item }),
          },
        });
      }
    }
  }
  for (const scenario of getScenarios(mechanicsDoc)) {
    const outcome = scenario?.["expected-outcome"];
    if (["win", "lose", "settle"].includes(outcome)) {
      out.push({
        kind: outcome,
        params: {
          scenario: String(scenario.name ?? outcome),
        },
      });
    }
  }
  return dedupeByJson(out);
}

function inferInputModel(strategyDoc, mechanicsDoc) {
  const text = [
    strategyDoc?.["core-loop"]?.act,
    ...(toStringArray(mechanicsDoc?.["external-events"])),
  ].join(" ").toLowerCase();
  const hits = [];
  if (/(click|tap|press|点|点击)/.test(text)) hits.push("click");
  if (/(drag|swipe|拖|滑)/.test(text)) hits.push("drag");
  if (/(key|keyboard|wasd|arrow|键盘)/.test(text)) hits.push("keyboard");
  if (/(touch|触摸)/.test(text)) hits.push("touch");
  if (/(pointer|mouse|鼠标)/.test(text)) hits.push("pointer");
  const uniq = [...new Set(hits)];
  if (uniq.length === 0) return "unknown";
  if (uniq.length === 1) return uniq[0] === "tap" ? "click" : uniq[0];
  return "mixed";
}

function extractCoreUiZones(sceneDoc) {
  const zones = [];
  for (const scene of sceneDoc.scenes ?? []) {
    for (const zone of scene.zones ?? []) {
      if (zone?.id) zones.push(String(zone.id));
      if (zones.length >= 3) return zones;
    }
  }
  return zones;
}

function extractScenarios(mechanicsDoc) {
  const scenarios = getScenarios(mechanicsDoc);
  const terminal = scenarios.filter((scenario) => ["win", "lose", "settle"].includes(scenario?.["expected-outcome"]));
  const selected = terminal.length ? terminal : scenarios;
  return selected.slice(0, 3).map((scenario, idx) => ({
    name: String(scenario?.name ?? `scenario-${idx + 1}`),
    "max-ticks": normalizeInt(scenario?.["max-ticks"], 0),
    "expected-outcome": normalizeOutcome(scenario?.["expected-outcome"]),
    setup: scenario?.setup ?? {},
  }));
}

function getScenarios(mechanicsDoc) {
  if (Array.isArray(mechanicsDoc.scenarios)) return mechanicsDoc.scenarios;
  if (Array.isArray(mechanicsDoc["simulation-scenarios"])) return mechanicsDoc["simulation-scenarios"];
  return [];
}

function normalizeInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function normalizeOutcome(value) {
  return ["win", "lose", "settle"].includes(value) ? value : "settle";
}

function toStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "")).filter(Boolean) : [];
}

function dedupeByJson(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function inferPivotStage() {
  return "pivot-1";
}
