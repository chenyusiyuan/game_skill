#!/usr/bin/env node
/**
 * verify_all.js — Phase 5 single source of truth
 *
 * Runs the full gate set and writes eval/report.json from real exit codes.
 * Agents must not hand-write a green report while any gate is red.
 *
 * Usage:
 *   node verify_all.js <case-dir> --profile <profile-id> [--log <log.jsonl>]
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { createLogger, parseLogArg } from "./_logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const profileIdx = args.indexOf("--profile");
const profileId = profileIdx >= 0 ? args[profileIdx + 1] : null;
const noWrite = args.includes("--no-write");
const logPath = parseLogArg(process.argv);
const log = createLogger(logPath);

if (!existsSync(caseDir)) {
  console.error(`✗ case-dir 不存在: ${caseDir}`);
  process.exit(2);
}

// 协议 Stage 2 硬门：任何 failures/<ts>-<check>-fail.md 未填完就不得再跑 verify_all。
// 检测：文件里仍含 "TODO"，或"起源层"下所有 checkbox 都是 `- [ ]`（没勾过）。
// 这条门由 e9a5602 落模板、本 commit 补齐填写强制。
{
  const failuresDir = join(caseDir, "failures");
  if (existsSync(failuresDir)) {
    const unfilled = [];
    for (const f of readdirSync(failuresDir)) {
      if (!/\.md$/.test(f)) continue;
      const body = readFileSync(join(failuresDir, f), "utf-8");
      const hasTodo = /\bTODO\b/.test(body);
      // 起源层 checklist：至少一项被勾选 `- [x]` 才算填过
      const originCheckboxes = body.match(/^-\s*\[([ xX])\]/gm) ?? [];
      const anyChecked = originCheckboxes.some((s) => /\[[xX]\]/.test(s));
      if (hasTodo || (originCheckboxes.length > 0 && !anyChecked)) {
        unfilled.push(f);
      }
    }
    if (unfilled.length > 0) {
      console.error(`✗ failures/ 里有 ${unfilled.length} 份未填完的 attribution 模板，按 Stage 2 纪律禁止继续 verify_all:`);
      for (const f of unfilled) console.error(`    · ${f}`);
      console.error(`  修复方式：打开每份文件，勾选"起源层"唯一项、填写"根因/修在哪/不动哪"、删除所有 TODO 字样。`);
      process.exit(2);
    }
  }
}

const gameDir = join(caseDir, "game");
const reportPath = join(caseDir, "eval/report.json");
const checks = [];

console.log(`verify_all: ${caseDir}`);

runCheck("mechanics", ["check_mechanics.js", caseDir]);
runCheck("asset_selection", ["check_asset_selection.js", caseDir, ...logArgs()]);
runCheck("implementation_contract", ["check_implementation_contract.js", caseDir, "--stage", "codegen", ...logArgs()]);
runCheck("boot", ["check_game_boots.js", gameDir, ...logArgs()]);
runCheck("project", ["check_project.js", gameDir, ...logArgs()]);

if (!profileId) {
  checks.push({
    name: "playthrough",
    script: "check_playthrough.js",
    exit_code: 3,
    status: "failed",
    error: "missing --profile <profile-id>",
  });
  console.log("  ✗ playthrough: missing --profile <profile-id>");
} else {
  runCheck("playthrough", ["check_playthrough.js", gameDir, "--profile", profileId, ...logArgs()]);
}

// P0.2: runtime_semantics 接在 playthrough 之后。不读产品 profile，使用 probe scenario
// 语义复算。当前 case 若不含 ray-cast@v1 或未暴露 probes API 会自动 ok-skip。
runCheck("runtime_semantics", ["check_runtime_semantics.js", caseDir, ...logArgs()]);
runCheck("level_solvability", ["check_level_solvability.js", caseDir, ...logArgs()]);

runCheck("compliance", ["check_skill_compliance.js", caseDir, ...logArgs()]);

const passed = checks.every(c => c.exit_code === 0);
const specialFailure = checks.find(c => [4, 5, 6].includes(c.exit_code));
const aggregateExitCode = passed ? 0 : (specialFailure?.exit_code ?? 1);
const report = {
  case: caseDir.split(/[\\/]/).filter(Boolean).at(-1),
  status: passed ? "passed" : "failed",
  failure_kind: specialFailure ? "profile_gate" : (passed ? null : "verification_gate"),
  generated_by: "verify_all.js",
  timestamp: new Date().toISOString(),
  checks,
};

if (!noWrite) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
}
// Stage 2 硬门：任何失败的 check 自动落 failure attribution 模板到 failures/。
// 独立于 report.json，`--no-write` 也会生成（这是诊断资产，不是产物）。
// 未填完禁止用户进入下一次 verify_all 调用的约束由协议层保证；此处只负责模板生成。
if (!passed) writeFailureTemplates(checks, caseDir);
console.log(`\n${passed ? "✓" : "✗"} verify_all ${passed ? "passed" : "failed"}`);
console.log(noWrite ? "report: <not written --no-write>" : `report: ${reportPath}`);

log.entry({
  type: "check-run",
  phase: "verify",
  step: "verify-all",
  script: "verify_all.js",
  exit_code: aggregateExitCode,
  checks: checks.map(c => ({ name: c.name, exit_code: c.exit_code })),
  report: noWrite ? null : reportPath,
});

process.exit(aggregateExitCode);

function runCheck(name, argv) {
  const [script, ...rest] = argv;
  const scriptPath = join(__dirname, script);
  const start = Date.now();
  console.log(`\n▶ ${name}: node ${script} ${rest.join(" ")}`);
  const res = spawnSync("node", [scriptPath, ...rest], {
    cwd: resolve(__dirname, "../../.."),
    encoding: "utf-8",
    maxBuffer: 12 * 1024 * 1024,
  });
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  if (output.trim()) process.stdout.write(output);
  const exitCode = typeof res.status === "number" ? res.status : 1;
  checks.push({
    name,
    script,
    exit_code: exitCode,
    status: exitCode === 0 ? "passed" : "failed",
    duration_ms: Date.now() - start,
    output_tail: tail(output, 5000),
  });
}

function logArgs() {
  return logPath ? ["--log", logPath] : [];
}

function tail(text, max) {
  const clean = String(text ?? "").trim();
  if (clean.length <= max) return clean;
  return clean.slice(clean.length - max);
}

function writeFailureTemplates(checksArr, caseRoot) {
  const failuresDir = join(caseRoot, "failures");
  mkdirSync(failuresDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
  for (const c of checksArr) {
    if (c.exit_code === 0) continue;
    const slug = c.name.replace(/[^a-zA-Z0-9-]+/g, "-");
    const fname = `${ts}-${slug}-fail.md`;
    const fpath = join(failuresDir, fname);
    if (existsSync(fpath)) continue;
    const body = [
      `# Failure Attribution — ${c.name} (exit ${c.exit_code})`,
      "",
      `**verify_all timestamp**: ${new Date().toISOString()}`,
      `**check**: \`${c.name}\` via \`${c.script ?? "unknown"}\``,
      `**exit_code**: ${c.exit_code}`,
      "",
      "## 起源层（唯一勾选）",
      "",
      "- [ ] PRD",
      "- [ ] Spec clarify",
      "- [ ] Mechanics DAG",
      "- [ ] Scene / rule / data / assets / event-graph / implementation-contract expand",
      "- [ ] Codegen / engine template",
      "- [ ] Profile",
      "- [ ] Checker bug / checker 规则误报",
      "- [ ] 其他（详述）：",
      "",
      "## 错误摘要（output_tail 自动带入）",
      "",
      "```",
      tail(c.output_tail ?? "", 2000),
      "```",
      "",
      "## 你认为的根因（一句话）",
      "",
      "> TODO",
      "",
      "## 修在哪里（只修起源层）",
      "",
      "- 文件: TODO",
      "- 改动: TODO",
      "",
      "## 不动哪里",
      "",
      "- TODO",
      "",
      "## 下一次 verify_all 前的自检",
      "",
      `- [ ] 根因写清楚，不是"改完再说"`,
      "- [ ] 只修起源层，未触及症状层（profile / checker 豁免 / 跳过 schema）",
      "- [ ] 是否属于 pattern 重复？累计次数 __",
      "",
      "---",
      "",
      `_本模板由 verify_all.js 在 exit ${c.exit_code} 时自动生成；填写完毕即可删除本尾注并 commit。_`,
    ].join("\n");
    writeFileSync(fpath, body, "utf-8");
    console.log(`  · failure template: ${fpath}`);
  }
}
