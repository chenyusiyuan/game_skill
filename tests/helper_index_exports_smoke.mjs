#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const helperDir = join(repoRoot, "templates/scaffold/src/lib");
const helperIndex = readFileSync(join(helperDir, "HELPERS.md"), "utf8");

const rowPattern = /^\|\s*`([^`]+)`\s*\|[^|]*\|\s*([^|]+)\|/gmu;
const rows = Array.from(helperIndex.matchAll(rowPattern));
assert.ok(rows.length > 0, "HELPERS.md must contain helper table rows");

for (const [, fileName, exportsCell] of rows) {
  const filePath = join(helperDir, fileName);
  assert.equal(existsSync(filePath), true, `${fileName} must exist`);
  const source = readFileSync(filePath, "utf8");
  const exportNames = Array.from(exportsCell.matchAll(/`([^`]+)`/gu), (match) => match[1]);
  assert.ok(exportNames.length > 0, `${fileName} must list Main Exports`);
  for (const exportName of exportNames) {
    const exportPattern = new RegExp(
      `export\\s+(?:async\\s+)?(?:function|class|const|let|var|type|interface)\\s+${escapeRegExp(exportName)}\\b`,
      "u",
    );
    assert.match(source, exportPattern, `${fileName} must export ${exportName}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

console.log("OK helper_index_exports_smoke");
