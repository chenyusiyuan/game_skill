#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));

function readJsonOptional(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readTextOptional(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, "utf8").trim();
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = { casePath: null, query: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--query") {
      args.query = argv[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown argument: ${arg}`);
    } else if (!args.casePath) {
      args.casePath = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return args;
}

function inferRawQuery(caseDir, explicitQuery) {
  if (explicitQuery?.trim()) return explicitQuery.trim();
  const plan = readJsonOptional(join(caseDir, "specs/plan.json"));
  if (typeof plan?.rawQuery === "string" && plan.rawQuery.trim()) return plan.rawQuery.trim();
  const rawQueryText = readTextOptional(join(caseDir, ".game/raw-query.txt"));
  if (rawQueryText) return rawQueryText;
  return "<paste raw user query here>";
}

export function buildPhaseAChecklist({ caseDir, rawQuery }) {
  const designTemplateExists = existsSync(join(REPO, "templates/design-template.md"));
  const decisionsTemplateExists = existsSync(join(REPO, "templates/decisions-template.md"));
  const skillExists = existsSync(join(REPO, "SKILL.md"));
  const generatedAt = new Date().toISOString();

  return `# Phase A Self-Check

Generated: ${generatedAt}
Case: ${caseDir}

## Raw Query

${rawQuery}

## Before Writing plan.json

- [ ] DESIGN.md exists before plan.json and contains visualIdentity / uiSurfaces / coreLoop / mustAvoid.
- [ ] visualIdentity.palette names background, player/main actor, primary interaction object, target/enemy/obstacle, reward/item, and HUD colors with clear contrast.
- [ ] uiSurfaces.secondary includes a pause overlay unless the query explicitly forbids pausing.
- [ ] coreLoop states primaryAction, successSignal, failureSignal, and iterationFeel.
- [ ] mustAvoid has at least 3 concrete items and includes default-purple-blue-orbs.
- [ ] If levels, waves, stages, next-level, or boss cycles appear in the query, temporalShape includes visible progression beyond speed/HP only.
- [ ] decisions.md A records OpenGame prototype choice or why none applies, plus source tags from-query / from-genre-knowledge / from-reasoning.
- [ ] requiredMechanics[].derivedFrom references actual DESIGN anchors such as coreLoop.primaryAction, uiSurfaces.primary, visualIdentity.palette, or mustAvoid.<item>.
- [ ] acceptance.mustHave covers every requiredMechanics[].name through mechanicRefs.
- [ ] Each mustHave evidence is covered by smoke.expect and includes milestone or state evidence, not canvas-change only.
- [ ] State evidence proves change or capability; avoid score >= 0, combo >= 0, level >= 1, lives >= initial, or gameState == "playing" as sole proof.
- [ ] High-frequency milestone ids such as hit/damage/destroy/score/combo include explicit minIntervalMs or maxOccurrencesInWindow/windowMs when burst loops would be harmful.
- [ ] smoke.steps is a short deterministic path and does not rely on random drops, whole-level clear, or long navigation luck.
- [ ] No checker is expected to rewrite plan.json; fix all listed issues in one Phase A batch.

## Source Templates

- DESIGN template available: ${designTemplateExists ? "yes" : "no"}
- decisions template available: ${decisionsTemplateExists ? "yes" : "no"}
- SKILL hard-contract source available: ${skillExists ? "yes" : "no"}
`;
}

export function writePhaseAChecklist(casePath, { query = null } = {}) {
  const caseDir = resolve(REPO, casePath);
  const rawQuery = inferRawQuery(caseDir, query);
  const target = join(caseDir, ".game/phase-a-checklist.md");
  mkdirSync(dirname(target), { recursive: true });
  const content = buildPhaseAChecklist({ caseDir, rawQuery });
  writeFileSync(target, content, "utf8");
  return { path: target, content };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.casePath) {
    console.error("Usage: node scripts/write_phase_a_checklist.js cases/<slug> --query \"<raw query>\"");
    return args.help ? 0 : 2;
  }
  const result = writePhaseAChecklist(args.casePath, { query: args.query });
  console.log(`[phase-a-checklist] wrote ${result.path}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
