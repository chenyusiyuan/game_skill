#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePhaseAChecklist } from "../scripts/write_phase_a_checklist.js";

const tempRoot = mkdtempSync(join(tmpdir(), "phase-a-checklist-"));

try {
  const caseDir = join(tempRoot, "case");
  const { path, content } = writePhaseAChecklist(caseDir, {
    query: "做一个三关砖块反弹小游戏，要有暂停、分数、道具和明显反馈。",
  });

  assert.equal(existsSync(path), true, "phase-a checklist is written");
  assert.match(content, /Raw Query/u);
  assert.match(content, /visualIdentity \/ uiSurfaces \/ coreLoop \/ mustAvoid/u);
  assert.match(content, /requiredMechanics\[\]\.derivedFrom/u);
  assert.match(content, /palette/u);
  assert.match(content, /pause overlay/u);
  assert.match(content, /smoke\.expect/u);
  assert.match(content, /score >= 0/u);
  assert.match(content, /minIntervalMs/u);
  assert.match(content, /不参与 verdict|No checker/u);

  const written = readFileSync(path, "utf8");
  assert.equal(written, content);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("OK phase_a_checklist_smoke");
