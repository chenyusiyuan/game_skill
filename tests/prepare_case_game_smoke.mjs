#!/usr/bin/env node
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareCaseGame } from "../scripts/prepare_case_game.js";

const repoRoot = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "prepare-"));
const scaffoldMain = readFileSync(join(repoRoot, "templates/scaffold/main.ts"), "utf8");
const scaffoldTsconfig = JSON.parse(readFileSync(join(repoRoot, "templates/scaffold/tsconfig.json"), "utf8"));
const scaffoldVite = readFileSync(join(repoRoot, "templates/scaffold/vite.config.js"), "utf8");

assert.match(scaffoldMain, /import Phaser from "phaser";/u, "scaffold main imports Phaser explicitly");
assert.match(scaffoldMain, /Recommended liveness pattern/u, "scaffold main shows the liveness pattern");
assert.match(scaffoldMain, /update\(_time: number, delta: number\)/u, "scaffold main shows a delta-based update example");
assert(scaffoldTsconfig.compilerOptions.types.includes("phaser"), "scaffold tsconfig exposes Phaser types");
assert.match(scaffoldVite, /cacheDir: path\.join\(repoRoot, 'node_modules\/\.vite-mini-game'/u, "scaffold vite cache stays outside case-local game/node_modules");

const files = [
  ["index.html", "game/index.html"],
  ["package.json", "game/package.json"],
  ["tsconfig.json", "game/tsconfig.json"],
  ["vite.config.js", "game/vite.config.js"],
  ["main.ts", "game/src/main.ts"],
  ["milestone.ts", "game/src/milestone.ts"],
  ["src/lib/HELPERS.md", "game/src/lib/HELPERS.md"],
  ["src/lib/visualTheme.ts", "game/src/lib/visualTheme.ts"],
  ["src/lib/inputController.ts", "game/src/lib/inputController.ts"],
  ["src/lib/hudBuilder.ts", "game/src/lib/hudBuilder.ts"],
  ["src/lib/progressionMath.ts", "game/src/lib/progressionMath.ts"],
  ["src/lib/arcadePhysics.ts", "game/src/lib/arcadePhysics.ts"],
  ["src/lib/safeTimers.ts", "game/src/lib/safeTimers.ts"],
  ["src/lib/procSprite.ts", "game/src/lib/procSprite.ts"],
  ["src/lib/cameraRig.ts", "game/src/lib/cameraRig.ts"],
  ["src/lib/inputExtras.ts", "game/src/lib/inputExtras.ts"],
];

try {
  const caseDir = join(tempRoot, "case");
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  copyFileSync(join(repoRoot, "tests/fixtures/plan.valid.json"), join(caseDir, "specs/plan.json"));

  prepareCaseGame(caseDir);

  for (const [, destination] of files) {
    assert.equal(existsSync(join(caseDir, destination)), true, `${destination} generated`);
  }

  const workerMain = "console.log('worker-owned main');\n";
  writeFileSync(join(caseDir, "game/src/main.ts"), workerMain, "utf8");
  writeFileSync(join(caseDir, "game/index.html"), "<html>drift</html>\n", "utf8");
  writeFileSync(join(caseDir, "game/src/milestone.ts"), "export {};\n", "utf8");

  prepareCaseGame(caseDir);

  assert.equal(readFileSync(join(caseDir, "game/src/main.ts"), "utf8"), workerMain, "main.ts is not overwritten after worker writes it");

  for (const [source, destination] of files.filter(([source]) => source !== "main.ts")) {
    const expected = readFileSync(join(repoRoot, "templates/scaffold", source), "utf8");
    const actual = readFileSync(join(caseDir, destination), "utf8");
    assert.equal(actual, expected, `${destination} is kept in sync with scaffold template`);
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("OK prepare_case_game_smoke");
