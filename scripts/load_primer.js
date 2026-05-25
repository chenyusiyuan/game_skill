#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const AVAILABLE_ARCHETYPES = ["platformer", "top_down", "grid_logic", "tower_defense", "ui_heavy"];

function parseArgs(argv) {
  const caseArg = argv.find((arg) => !arg.startsWith("--"));
  const archetypeIndex = argv.indexOf("--archetype");
  const archetype = archetypeIndex >= 0 ? argv[archetypeIndex + 1] : undefined;
  const clear = argv.includes("--clear") || argv.includes("--none");
  return { caseArg, archetype, clear };
}

function main() {
  const { caseArg, archetype, clear } = parseArgs(process.argv.slice(2));
  if (!caseArg || process.argv.includes("--help") || process.argv.includes("-h")) {
    console.error("Usage: node scripts/load_primer.js cases/<slug> --archetype <name>");
    console.error("       node scripts/load_primer.js cases/<slug> --clear");
    process.exit(caseArg ? 0 : 1);
  }

  const caseDir = resolve(REPO, caseArg);
  if (!existsSync(caseDir)) {
    console.error(`[load_primer] missing case: ${caseArg}`);
    process.exit(1);
  }

  const target = join(caseDir, ".game/archetype-primer.md");
  if (clear) {
    rmSync(target, { force: true });
    console.log(`[load_primer] cleared ${target}`);
    process.exit(0);
  }

  if (!AVAILABLE_ARCHETYPES.includes(archetype)) {
    console.warn(
      `[load_primer] unknown archetype '${archetype}', no primer loaded. available: ${AVAILABLE_ARCHETYPES.join(", ")}`,
    );
    process.exit(0);
  }

  const source = join(REPO, "templates/archetype-primers", `${archetype}.md`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  console.log(`[load_primer] copied ${source} -> ${target}`);
}

main();
