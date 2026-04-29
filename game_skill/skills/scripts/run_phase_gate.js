#!/usr/bin/env node
/**
 * run_phase_gate.js — 阻断式阶段门禁 runner
 *
 * 对每个 phase 执行固定的 gate 检查集合。任何 gate 失败 → exit(1) 阻断。
 * 即使 agent 漏跑、漏读文档，这个脚本也会阻断进入下一阶段。
 *
 * Usage:
 *   node run_phase_gate.js <case-dir> --phase prd
 *   node run_phase_gate.js <case-dir> --phase expand
 *   node run_phase_gate.js <case-dir> --phase codegen
 *   node run_phase_gate.js <case-dir> --phase verify [--profile <id>]
 *
 * Exit codes:
 *   0 = all gates passed
 *   1 = one or more gates failed
 *   2 = usage error / missing arguments
 */

import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const phaseIdx = args.indexOf("--phase");
const phase = phaseIdx >= 0 ? args[phaseIdx + 1] : null;
const profileIdx = args.indexOf("--profile");
const profileId = profileIdx >= 0 ? args[profileIdx + 1] : null;

if (!phase) {
  console.error("Usage: node run_phase_gate.js <case-dir> --phase <prd|expand|codegen|verify> [--profile <id>]");
  process.exit(2);
}

if (!existsSync(caseDir)) {
  console.error(`✗ case-dir 不存在: ${caseDir}`);
  process.exit(2);
}

const gameDir = join(caseDir, "game");

/**
 * 每个 phase 的 gate 定义：
 *   - files: 必须存在的文件列表
 *   - checks: 需要运行的 checker 脚本 + 参数
 */
const GATES = {
  prd: {
    files: [
      "docs/game-prd.md",
    ],
    checks: [
      ["check_game_prd.js", join(caseDir, "docs/game-prd.md")],
    ],
  },

  expand: {
    files: [
      "docs/spec-clarifications.md",
      "specs/mechanics.yaml",
      "specs/scene.yaml",
      "specs/rule.yaml",
      "specs/data.yaml",
      "specs/assets.yaml",
      "specs/event-graph.yaml",
      "specs/implementation-contract.yaml",
    ],
    checks: [
      ["check_mechanics.js", caseDir],
      ["check_asset_selection.js", caseDir],
      ["check_implementation_contract.js", caseDir, "--stage", "expand"],
    ],
  },

  codegen: {
    files: [
      "game/index.html",
    ],
    checks: [
      ["check_mechanics.js", caseDir],
      ["check_project.js", gameDir],
      ["check_game_boots.js", gameDir],
      ["check_implementation_contract.js", caseDir, "--stage", "codegen"],
      ["check_runtime_semantics.js", caseDir],
    ],
  },

  verify: {
    files: [],
    checks: profileId
      ? [["check_level_solvability.js", caseDir], ["verify_all.js", caseDir, "--profile", profileId]]
      : [["check_level_solvability.js", caseDir], ["verify_all.js", caseDir]],
  },
};

const gate = GATES[phase];
if (!gate) {
  console.error(`✗ 未知 phase: "${phase}"。支持: ${Object.keys(GATES).join(", ")}`);
  process.exit(2);
}

console.log(`\n╔══ Phase Gate: ${phase} ══╗`);
console.log(`   case: ${caseDir}\n`);

let failed = 0;
let passed = 0;

// 1) 文件存在性检查
for (const rel of gate.files) {
  const full = join(caseDir, rel);
  if (existsSync(full)) {
    passed++;
    console.log(`  ✓ file: ${rel}`);
  } else {
    failed++;
    console.log(`  ✗ file: ${rel} — 不存在`);
  }
}

// 2) 脚本 gate 检查
for (const [script, ...rest] of gate.checks) {
  const scriptPath = join(__dirname, script);
  if (!existsSync(scriptPath)) {
    console.log(`  ⚠ skip: ${script} — 脚本不存在`);
    continue;
  }
  console.log(`  ▶ ${script}`);
  const res = spawnSync("node", [scriptPath, ...rest], {
    cwd: resolve(__dirname, "../../.."),
    encoding: "utf-8",
    maxBuffer: 12 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exitCode = typeof res.status === "number" ? res.status : 1;
  if (exitCode === 0) {
    passed++;
    console.log(`    ✓ passed`);
  } else {
    failed++;
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
    const lastLines = output.split("\n").slice(-5).join("\n    ");
    console.log(`    ✗ failed (exit ${exitCode})`);
    if (lastLines) console.log(`    ${lastLines}`);
  }
}

// 3) 汇总
console.log(`\n╚══ ${phase}: ${failed === 0 ? "PASSED" : "BLOCKED"} (${passed} passed, ${failed} failed) ══╝\n`);

process.exit(failed === 0 ? 0 : 1);
