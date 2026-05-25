#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SCAFFOLD_DIR = join(REPO, "templates/scaffold");
const KEEP_SCAFFOLD = new Set(["index.html", "package.json", "tsconfig.json", "vite.config.js", "milestone.ts"]);

const SCAFFOLD_FILES = [
  ["index.html", "game/index.html"],
  ["package.json", "game/package.json"],
  ["tsconfig.json", "game/tsconfig.json"],
  ["vite.config.js", "game/vite.config.js"],
  ["main.ts", "game/src/main.ts"],
  ["milestone.ts", "game/src/milestone.ts"],
  ["src/lib/visualTheme.ts", "game/src/lib/visualTheme.ts"],
  ["src/lib/inputController.ts", "game/src/lib/inputController.ts"],
  ["src/lib/hudBuilder.ts", "game/src/lib/hudBuilder.ts"],
  ["src/lib/progressionMath.ts", "game/src/lib/progressionMath.ts"],
  ["src/lib/HELPERS.md", "game/src/lib/HELPERS.md"],
  ["src/lib/arcadePhysics.ts", "game/src/lib/arcadePhysics.ts"],
  ["src/lib/safeTimers.ts", "game/src/lib/safeTimers.ts"],
  ["src/lib/procSprite.ts", "game/src/lib/procSprite.ts"],
  ["src/lib/cameraRig.ts", "game/src/lib/cameraRig.ts"],
  ["src/lib/inputExtras.ts", "game/src/lib/inputExtras.ts"],
];

const TEMPLATE_FILES = [
  ["templates/design-template.md", "docs/DESIGN.md"],
  ["templates/decisions-template.md", "docs/decisions.md"],
];

function isKeptScaffold(source) {
  return KEEP_SCAFFOLD.has(source) || (source.startsWith("src/lib/") && (source.endsWith(".ts") || source.endsWith(".md")));
}

export function prepareCaseGame(caseDir, { overwrite = "kept-only", reset = false } = {}) {
  if (!existsSync(join(caseDir, "specs/plan.json"))) {
    throw new Error(`prepare_case_game requires specs/plan.json at ${caseDir}`);
  }

  for (const [source, destination] of SCAFFOLD_FILES) {
    const target = join(caseDir, destination);
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) {
      if (overwrite === false) continue;
      if (overwrite === "kept-only" && !isKeptScaffold(source)) continue;
    }
    copyFileSync(join(SCAFFOLD_DIR, source), target);
  }

  for (const [source, destination] of TEMPLATE_FILES) {
    const target = join(caseDir, destination);
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target) && !reset && overwrite !== true) continue;
    copyFileSync(join(REPO, source), target);
  }

  return join(caseDir, "game");
}

function main() {
  const caseArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!caseArg || process.argv.includes("--help") || process.argv.includes("-h")) {
    console.error("Usage: node scripts/prepare_case_game.js cases/<slug>");
    process.exit(caseArg ? 0 : 2);
  }

  try {
    const gameDir = prepareCaseGame(resolve(REPO, caseArg), { reset: process.argv.includes("--reset") });
    console.log(`OK prepare_case_game: ${gameDir}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
