import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { scanCaseJunk } from "../scripts/scan_case_junk.js";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const caseDir = join(repoRoot, `cases/.junk-smoke-${randomUUID()}`);

try {
  mkdirSync(join(caseDir, "game/node_modules/foo"), { recursive: true });
  writeFileSync(join(caseDir, "game/node_modules/foo/x.js"), "export default 1;\n", "utf8");

  const result = scanCaseJunk(caseDir);

  assert.equal(result.ok, true);
  assert.deepEqual(result.removed, ["game/node_modules"]);
  assert.equal(existsSync(join(caseDir, "game/node_modules")), false);
} finally {
  rmSync(caseDir, { recursive: true, force: true });
}

console.log("OK scan_case_junk_smoke");
