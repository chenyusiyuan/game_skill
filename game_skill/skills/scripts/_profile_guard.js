#!/usr/bin/env node
/**
 * _profile_guard.js — profile SHA 写锁（T6）
 *
 * 目的：防止 Phase 5 期间 codegen / verify 为了过校验去改正式 profile。
 *
 * 用法（作为 helper 被其他 check 脚本调用）：
 *   import { guardProfileSha } from "./_profile_guard.js";
 *   guardProfileSha({ caseDir, profilePath });  // 缺基线 exit 6，不一致 exit 5
 *
 * 流程：
 *   1. Phase 5 补完正式 profiles/<project>.json 后：
 *      主 agent 跑 `node _profile_guard.js <caseDir> <profilePath> --freeze`
 *      把正式 profile SHA 写入 state.json.phases.verify.profileSha
 *   2. Phase 5 每个 check 脚本启动时：自动对比；缺基线 exit 6，不一致 exit 5
 *
 * 主命令用法（freeze 模式）：
 *   node _profile_guard.js <caseDir> <profilePath> --freeze
 *
 * 退出码：
 *   0 = 验证通过 / freeze 成功
 *   5 = profile 被篡改（SHA 不一致）
 *   6 = 缺 freeze 基线（.game/state.json 里无 phases.verify.profileSha）
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { resolve, join } from "path";

const FREEZE_EXIT = 0;
const MISMATCH_EXIT = 5;
const NO_BASELINE_EXIT = 6;

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function computeProfileSha(profilePath) {
  return sha256(readFileSync(profilePath, "utf-8"));
}

/**
 * 把当前正式 profile 的 SHA 写入 state.json（Phase 5 首次 check 前调用一次）
 */
export function freezeProfileSha(caseDir, profilePath) {
  const statePath = join(caseDir, ".game/state.json");
  if (!existsSync(statePath)) {
    console.error(`✗ state.json 不存在: ${statePath}`);
    return 1;
  }
  if (!existsSync(profilePath)) {
    console.error(`✗ profile 不存在: ${profilePath}`);
    return 1;
  }
  const state = JSON.parse(readFileSync(statePath, "utf-8"));
  const sha = computeProfileSha(profilePath);
  state.phases = state.phases ?? {};
  state.phases.verify = state.phases.verify ?? {};
  state.phases.verify.profileSha = sha;
  state.phases.verify.profilePath = profilePath;
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
  console.log(`✓ profile 冻结: ${profilePath}`);
  console.log(`  sha256 = ${sha.slice(0, 16)}...`);
  return FREEZE_EXIT;
}

/**
 * Phase 5 的 check 脚本入口调用——对比当前正式 profile SHA 和冻结基线。
 * 缺基线直接退出（默认 process.exit(6)），不一致直接退出（默认 process.exit(5)）。
 *
 * @param {object} opts
 * @param {string} opts.caseDir     项目根目录（cases/<slug>）
 * @param {string} opts.profilePath profile 文件绝对路径
 * @param {boolean} [opts.throwOnMismatch=false]  不 exit 而抛异常（测试用）
 */
export function guardProfileSha({ caseDir, profilePath, throwOnMismatch = false }) {
  const statePath = join(caseDir, ".game/state.json");
  if (!existsSync(statePath)) {
    guardFail(`✗ [T6] state.json 不存在，无法校验 profile 冻结基线: ${statePath}`, NO_BASELINE_EXIT, throwOnMismatch);
  }
  if (!existsSync(profilePath)) {
    guardFail(`✗ [T6] profile 不存在，无法校验冻结基线: ${profilePath}`, NO_BASELINE_EXIT, throwOnMismatch);
  }
  let state;
  try {
    state = JSON.parse(readFileSync(statePath, "utf-8"));
  } catch (e) {
    guardFail(`✗ [T6] state.json 解析失败，无法校验 profile 冻结基线: ${e.message}`, NO_BASELINE_EXIT, throwOnMismatch);
  }
  const baseline = state?.phases?.verify?.profileSha;
  const frozenPath = state?.phases?.verify?.profilePath;
  if (!baseline) {
    guardFail(`✗ [T6] 缺少 profile 冻结基线：请先冻结正式 profile\n  node game_skill/skills/scripts/_profile_guard.js ${caseDir} ${profilePath} --freeze`, NO_BASELINE_EXIT, throwOnMismatch);
  }
  if (frozenPath && resolve(frozenPath) !== resolve(profilePath)) {
    guardFail(`✗ [T6] 当前校验的 profile 不是被冻结的正式 profile\n  frozen: ${frozenPath}\n  current: ${profilePath}`, MISMATCH_EXIT, throwOnMismatch);
  }
  const current = computeProfileSha(profilePath);
  if (current !== baseline) {
    guardFail(`✗ [T6] profile 已被篡改！冻结基线 ${baseline.slice(0, 16)}... ≠ 当前 ${current.slice(0, 16)}...\n  profile: ${profilePath}\n  Phase 5 冻结后禁止修改 profile；如果确有正当理由，请重新生成/补全正式 profile 并重新 freeze`, MISMATCH_EXIT, throwOnMismatch);
  }
  return FREEZE_EXIT;
}

function guardFail(message, exitCode, throwOnMismatch) {
  if (throwOnMismatch) {
    const err = new Error(message);
    err.exitCode = exitCode;
    throw err;
  }
  console.error(message);
  process.exit(exitCode);
}

// CLI 入口（仅 freeze 模式；guard 由其他脚本 import）
const scriptUrl = import.meta.url;
const entryUrl = new URL(`file://${resolve(process.argv[1] ?? "")}`).href;
if (scriptUrl === entryUrl) {
  const [caseDir, profilePath, flag] = process.argv.slice(2);
  if (!caseDir || !profilePath) {
    console.error("用法: node _profile_guard.js <caseDir> <profilePath> [--freeze]");
    process.exit(1);
  }
  if (flag === "--freeze") {
    process.exit(freezeProfileSha(resolve(caseDir), resolve(profilePath)));
  } else {
    try {
      guardProfileSha({ caseDir: resolve(caseDir), profilePath: resolve(profilePath) });
      console.log("✓ profile SHA 通过");
      process.exit(0);
    } catch (e) {
      console.error(e.message);
      process.exit(e.exitCode ?? MISMATCH_EXIT);
    }
  }
}
