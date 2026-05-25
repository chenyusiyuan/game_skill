#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const AVAILABLE_ARCHETYPES = ["vampire-survivors", "shooter", "breakout", "topdown", "tower-defense"];

function parseArgs(argv) {
  const caseArg = argv.find((arg) => !arg.startsWith("--"));
  const archetypeIndex = argv.indexOf("--archetype");
  const archetype = archetypeIndex >= 0 ? argv[archetypeIndex + 1] : undefined;
  return { caseArg, archetype };
}

function main() {
  const { caseArg, archetype } = parseArgs(process.argv.slice(2));
  if (!caseArg || process.argv.includes("--help") || process.argv.includes("-h")) {
    console.error("Usage: node scripts/load_primer.js cases/<slug> --archetype <name>");
    process.exit(caseArg ? 0 : 1);
  }

  const caseDir = resolve(REPO, caseArg);
  if (!existsSync(caseDir)) {
    console.error(`[load_primer] missing case: ${caseArg}`);
    process.exit(1);
  }

  if (!AVAILABLE_ARCHETYPES.includes(archetype)) {
    console.warn(
      `[load_primer] unknown archetype '${archetype}', no primer loaded. available: ${AVAILABLE_ARCHETYPES.join(", ")}`,
    );
    process.exit(0);
  }

  const source = join(REPO, "templates/archetype-primers", `${archetype}.md`);
  const target = join(caseDir, ".game/archetype-primer.md");
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  console.log(`[load_primer] copied ${source} -> ${target}`);
}

main();
