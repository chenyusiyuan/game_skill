#!/usr/bin/env node
/**
 * _logger.js — 统一日志工具
 *
 * 为所有 check_*.js 脚本和 Agent 流程提供 NDJSON 日志记录。
 * 日志写入项目根目录下的 `cases/{slug}/.game/log.jsonl`。
 *
 * 用法（脚本侧）：
 *   import { createLogger } from "./_logger.js";
 *   const log = createLogger(logFilePath);  // 传入 --log 参数值
 *   log.entry({ phase: "verify", step: "boot", ... });
 *   log.close();
 *
 * 用法（Agent 侧 — 通过 shell 追加）：
 *   echo '{"timestamp":"...","type":"user-feedback",...}' >> cases/{slug}/.game/log.jsonl
 */

import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";

/**
 * 日志事件类型枚举：
 *
 * phase-start       — 阶段开始
 * phase-end         — 阶段结束（含 status: completed | failed）
 * check-run         — 校验脚本运行一轮（含 script, exit_code, errors, warnings）
 * fix-applied       — 修复代码后记录（含 round, failures, fix_description, files_changed）
 * balance-check     — 数值平衡校验结果
 * user-feedback     — 用户反馈的 bug / 问题描述
 * user-fix          — 根据用户反馈做的修复
 */

export function createLogger(logFilePath) {
  if (!logFilePath) {
    // 无日志路径时返回 no-op logger
    return {
      entry() {},
      close() {},
      get path() { return null; },
    };
  }

  mkdirSync(dirname(logFilePath), { recursive: true });

  function entry(data) {
    const record = {
      timestamp: new Date().toISOString(),
      ...data,
    };
    appendFileSync(logFilePath, JSON.stringify(record) + "\n", "utf-8");
  }

  return {
    entry,
    close() {}, // NDJSON append 模式，无需关闭
    get path() { return logFilePath; },
  };
}

/**
 * 从命令行参数中解析 --log <path>
 */
export function parseLogArg(argv) {
  const idx = argv.indexOf("--log");
  if (idx >= 0 && argv[idx + 1]) {
    return argv[idx + 1];
  }
  return null;
}
