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
];

export function prepareCaseGame(caseDir, { overwrite = "kept-only" } = {}) {
  if (!existsSync(join(caseDir, "specs/plan.json"))) {
    throw new Error(`prepare_case_game requires specs/plan.json at ${caseDir}`);
  }

  for (const [source, destination] of SCAFFOLD_FILES) {
    const target = join(caseDir, destination);
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) {
      if (overwrite === false) continue;
      if (overwrite === "kept-only" && !KEEP_SCAFFOLD.has(source)) continue;
    }
    copyFileSync(join(SCAFFOLD_DIR, source), target);
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
    const gameDir = prepareCaseGame(resolve(REPO, caseArg));
    console.log(`OK prepare_case_game: ${gameDir}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
