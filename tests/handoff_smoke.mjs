#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FOLLOW_UP_PROMPT, writeHandoff } from "../scripts/write_handoff.js";

const tempRoot = mkdtempSync(join(tmpdir(), "handoff-smoke-"));

try {
  const caseDir = join(tempRoot, "case");
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  mkdirSync(join(caseDir, "eval"), { recursive: true });
  writeFileSync(
    join(caseDir, "specs/plan.json"),
    JSON.stringify({
      primaryLoop: "玩家移动挡板反弹球，击碎砖块并累积分数。",
      controls: [{ input: "ArrowLeft / ArrowRight", effect: "移动挡板" }],
    }),
    "utf8",
  );
  writeFileSync(
    join(caseDir, "eval/delivery.json"),
    JSON.stringify({
      status: "generation-blocked",
      blockReason: "expect-not-met",
      detail: { diagnostic: { failedExpects: [{ type: "milestone", id: "primary-progress", observed: 0 }] } },
      qualityHints: { visual: { warnings: ["hud-empty"] } },
    }),
    "utf8",
  );
  writeFileSync(
    join(caseDir, "eval/preview.json"),
    JSON.stringify({
      status: "preview-ready",
      reason: null,
      launchCommand: "node scripts/start_preview.js cases/demo",
      screenshots: { mount: "eval/preview-screenshots/mount.png" },
    }),
    "utf8",
  );

  const record = writeHandoff(caseDir);
  assert.equal(record.status, "ready");
  assert.equal(record.deliveryStatus, "generation-blocked");
  assert.equal(record.checks.deliveryEvidence, "blocked");
  assert.equal(record.checks.previewHealth, "ready");
  assert.equal(record.playSummary, "玩家移动挡板反弹球，击碎砖块并累积分数。");
  assert.deepEqual(record.controls, [{ input: "ArrowLeft / ArrowRight", effect: "移动挡板" }]);
  assert.equal(record.followUpPrompt, FOLLOW_UP_PROMPT);
  assert.match(record.followUpPrompt, /bug/u);
  assert.match(record.followUpPrompt, /素材\/颜色\/布局\/UI/u);

  const written = JSON.parse(readFileSync(join(caseDir, "eval/handoff.json"), "utf8"));
  assert.equal(written.status, "ready");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("OK handoff_smoke");
