#!/usr/bin/env node
/**
 * freeze_specs.js
 *
 * Phase 5 入口：对 PRD / specs/ / profile 计算 sha256 指纹并冻结到
 *   cases/<slug>/.game/freeze.json
 *
 * 后续任何 Phase 5 修复循环脚本在启动时可调 --verify，
 * 对比当前文件哈希与 freeze.json；有差异则立即拒绝执行，
 * 防止 LLM "为了通过测试回头改 PRD / specs / profile" 的退路。
 *
 * 用法:
 *   node freeze_specs.js <case-dir>                      # 写入 freeze.json
 *   node freeze_specs.js <case-dir> --verify             # 对照检查
 *   node freeze_specs.js <case-dir> --verify --allow code
 */

import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "fs";
import { join, relative, resolve } from "path";

const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const verify = args.includes("--verify");
const freezeFile = join(caseDir, ".game/freeze.json");

// 受冻结的路径（相对 caseDir）
const FROZEN_PATHS = [
  "docs/game-prd.md",
  "docs/design-strategy.yaml",
  ".game/preserve.lock.yaml",
  "specs",                 // 整个目录递归
  "profile.json",          // 若有 profiles/<slug>.json 也要纳入，下面处理
];

// 冻结白名单（这些可以改，不参与 freeze）
const WHITELIST_RELATIVE = [
  "game/",           // Phase 5 只允许改 code，所以 game/ 不在 freeze 内
  ".game/",          // 状态文件自身
  "eval/",           // 产物
  "docs/delivery.md",// 最终交付文档，Phase 5 写入
];

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function walk(root, out = {}) {
  if (!existsSync(root)) return out;
  const st = statSync(root);
  if (st.isFile()) {
    out[relative(caseDir, root)] = sha256File(root);
    return out;
  }
  for (const ent of readdirSync(root)) {
    const p = join(root, ent);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else out[relative(caseDir, p)] = sha256File(p);
  }
  return out;
}

function buildFingerprint() {
  const fp = {};
  for (const rel of frozenPathsForCurrentStage()) {
    walk(join(caseDir, rel), fp);
  }
  // 额外加 profiles/<slug>.json（如存在）—— 从仓库根推算
  // 这里不强制；主 agent 如需冻结可显式指定
  return fp;
}

function frozenPathsForCurrentStage() {
  const out = [...FROZEN_PATHS];
  const stage = readCurrentStage();
  if (stage) out.push(`specs/stage-contract-${stage}.yaml`);
  return [...new Set(out)];
}

function readCurrentStage() {
  const statePath = join(caseDir, ".game/state.json");
  if (!existsSync(statePath)) return null;
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const candidates = [
      state.currentStage,
      state["current-stage"],
      state.phasePlan?.currentStage,
      state.phasePlan?.["current-stage"],
      Array.isArray(state.phasePlan?.allowedStages) ? state.phasePlan.allowedStages[0] : null,
      String(state.currentPhase ?? "").match(/^stage-(\d)$/)?.[1],
    ];
    for (const candidate of candidates) {
      const n = Number(candidate);
      if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
    }
  } catch {
    return null;
  }
  return null;
}

if (!verify) {
  const fp = buildFingerprint();
  mkdirSync(join(caseDir, ".game"), { recursive: true });
  writeFileSync(freezeFile, JSON.stringify({
    frozenAt: new Date().toISOString(),
    caseDir: relative(process.cwd(), caseDir),
    fingerprint: fp,
  }, null, 2));
  console.log(`✓ froze ${Object.keys(fp).length} files → ${relative(process.cwd(), freezeFile)}`);
  process.exit(0);
}

// --verify
if (!existsSync(freezeFile)) {
  console.error(`✗ freeze.json 不存在；必须先跑 'node freeze_specs.js <case-dir>' 锁定 Phase 4 末尾状态`);
  process.exit(2);
}
const { fingerprint: frozen } = JSON.parse(readFileSync(freezeFile, "utf8"));
const current = buildFingerprint();
const violations = [];
for (const [p, hash] of Object.entries(frozen)) {
  if (current[p] !== hash) violations.push(`MODIFIED: ${p}`);
}
for (const p of Object.keys(current)) {
  if (!(p in frozen)) violations.push(`ADDED:    ${p}`);
}
for (const p of Object.keys(frozen)) {
  if (!(p in current)) violations.push(`DELETED:  ${p}`);
}
if (violations.length === 0) {
  console.log(`✓ freeze verification passed (${Object.keys(frozen).length} files unchanged)`);
  process.exit(0);
}
console.error(`✗ freeze verification FAILED — PRD/specs/profile 在 Phase 5 被修改：`);
for (const v of violations) console.error(`    ${v}`);
console.error(`\n修复循环只允许改 game/ 下的代码。若真的要改 PRD/specs，请显式走 Phase 2→3 回溯流程。`);
process.exit(1);
