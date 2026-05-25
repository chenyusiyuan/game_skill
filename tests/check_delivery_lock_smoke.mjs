import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const caseDir = join(repoRoot, `cases/.delivery-lock-${randomUUID()}`);
const lockPath = join(caseDir, ".game/check_delivery.lock");

try {
  mkdirSync(join(caseDir, ".game"), { recursive: true });
  writeFileSync(lockPath, `${JSON.stringify({ pid: 1, startedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");

  const result = spawnSync(process.execPath, [join(repoRoot, "scripts/check_delivery.js"), caseDir], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 20_000,
  });

  assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
  const deliveryPath = join(caseDir, "eval/delivery.json");
  assert.equal(existsSync(deliveryPath), true, "delivery.json is written on lock block");
  const delivery = JSON.parse(readFileSync(deliveryPath, "utf8"));
  assert.equal(delivery.status, "chain-blocked");
  assert.equal(delivery.blockReason, "case-delivery-already-running");
  assert.equal(existsSync(lockPath), true, "active foreign lock is preserved");
} finally {
  rmSync(caseDir, { recursive: true, force: true });
}

console.log("OK check_delivery_lock_smoke");
