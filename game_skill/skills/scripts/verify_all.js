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

import { existsSync, mkdirSync, writeFileSync } from "fs";
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

const gameDir = join(caseDir, "game");
const reportPath = join(caseDir, "eval/report.json");
const checks = [];

console.log(`verify_all: ${caseDir}`);

runCheck("mechanics", ["check_mechanics.js", caseDir]);
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
