#!/usr/bin/env node
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareCaseGame } from "../scripts/prepare_case_game.js";

const repoRoot = process.cwd();
const tempBase = join(repoRoot, "node_modules");
mkdirSync(tempBase, { recursive: true });
const tempRoot = mkdtempSync(join(tempBase, ".tmp-helper-usage-"));

const mainSource = `import Phaser from "phaser";
import "./milestone";
import { attachDynamicBody, wireOverlapCooldown, wireOverlapOnce } from "./lib/arcadePhysics";
import { playSfx, loopMusic, stopSoundOnShutdown, toggleMute } from "./lib/audioSafe";
import { createArcadePool, despawnToPool, spawnFromPool } from "./lib/objectPool";
import { procRect } from "./lib/procSprite";
import { makeIconButton, makeTextButton } from "./lib/uiButton";

class HelperUsageSmokeScene extends Phaser.Scene {
  create(): void {
    const player = procRect(this, 40, 40, 20, 20, { fill: 0xffffff });
    attachDynamicBody(player, { allowGravity: false });
    wireOverlapOnce(this, player, player, () => {}, { deactivateSecond: false });
    wireOverlapCooldown(this, player, player, () => {}, { cooldownMs: 120 });

    const pool = createArcadePool(this, { maxSize: 4, defaultKey: "__missing", allowGravity: false });
    const shot = spawnFromPool<Phaser.Types.Physics.Arcade.ImageWithDynamicBody>(pool, 60, 60, "__missing");
    if (shot) despawnToPool(pool, shot);

    playSfx(this, "missing-sfx", { volume: 0.35 });
    const music = loopMusic(this, "missing-music", { volume: 0.15 });
    if (music) stopSoundOnShutdown(this, music);
    toggleMute(this, false);

    makeTextButton(this, { x: 90, y: 30, width: 90, height: 30, text: "Restart", onClick: () => {} });
    makeIconButton(this, { x: 90, y: 70, width: 40, height: 40, iconTexture: "__missing", onClick: () => {} });
  }
}

new Phaser.Game({
  type: Phaser.CANVAS,
  width: 320,
  height: 240,
  scene: [HelperUsageSmokeScene],
  physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 } } },
});
`;

try {
  const caseDir = join(tempRoot, "case");
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  copyFileSync(join(repoRoot, "tests/fixtures/plan.valid.json"), join(caseDir, "specs/plan.json"));
  const gameDir = prepareCaseGame(caseDir);
  writeFileSync(join(gameDir, "src/main.ts"), mainSource, "utf8");

  const tscBin = join(repoRoot, "node_modules/typescript/bin/tsc");
  const result = spawnSync(process.execPath, [tscBin, "--noEmit"], {
    cwd: gameDir,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("OK helper_usage_typecheck_smoke");
