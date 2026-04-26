#!/usr/bin/env node
/**
 * extract_guardrails.js — 从 PRD 抽"玩法硬约束" 摘录
 *
 * 用法:
 *   node extract_guardrails.js <prd-path> <out-path>
 *
 * 目的:
 *   对抗 /compact 把玩法硬约束冲掉。Phase 2 末尾把 PRD 中最关键的"玩法是什么、
 *   不能偏什么"压到 ≤500 chars 的单页 guardrails.md。Phase 4/5 开头主 agent 必须
 *   Read 这份文件，把关键项落进 TodoWrite。
 *
 * 输出内容（由 PRD 机械派生，不预设 genre 模板）:
 *   - must-have-features（front-matter）
 *   - @constraint(kind:hard-rule) 的 id + display + kind
 *   - 核心 @rule 列表（≤10 条，按 PRD 中出现顺序）
 *
 * 退出码: 0 = OK, 1 = PRD 不存在
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

const prdPath = resolve(process.argv[2] ?? "docs/game-prd.md");
const outPath = resolve(process.argv[3] ?? ".game/guardrails.md");

let content;
try {
  content = readFileSync(prdPath, "utf-8");
} catch {
  console.error(`✗ PRD 不存在: ${prdPath}`);
  process.exit(1);
}

const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
const fmText = fmMatch ? fmMatch[1] : "";
const body = fmMatch ? content.slice(fmMatch[0].length) : content;

function fmGet(key) {
  const m = fmText.match(new RegExp(`^${key}:\\s*(.+)`, "m"));
  return m ? m[1].trim() : null;
}

// must-have-features 可能是 [a, b, c] 或 YAML 列表
const mustHaveRaw = fmGet("must-have-features") ?? "";
const mustHave = mustHaveRaw
  .replace(/^\s*[\[{]|[\]}]\s*$/g, "")
  .split(",")
  .map(s => s.replace(/^\s*[-]\s*/, "").trim())
  .filter(Boolean);

// @tag 解析（轻量，和 check_game_prd.js 对齐）
const tagRe = /^#{2,4}[ \t]+@([a-z-]+)\(([^)]+)\)[ \t]*(.*)$/gm;
const tags = [];
let m;
while ((m = tagRe.exec(body)) !== null) {
  const afterIdx = m.index + m[0].length;
  const rest = body.slice(afterIdx);
  const attrBlock = rest.match(/^\n?((?:>\s+.+(?:\n|$))+)/);
  const attrs = {};
  if (attrBlock) {
    const lines = [...attrBlock[1].matchAll(/^>\s+([a-zA-Z0-9_-]+):\s*(.*)$/gm)];
    for (const a of lines) attrs[a[1].trim()] = a[2].trim();
  }
  tags.push({ type: m[1], id: m[2].trim(), display: m[3].trim(), attrs });
}

const hardRules = tags.filter(t => t.type === "constraint" && t.attrs.kind === "hard-rule");
const rules = tags.filter(t => t.type === "rule").slice(0, 10);

const lines = [
  `# Guardrails — ${fmGet("project") ?? "(no project)"}`,
  "",
  "**Phase 4/5 agent 开工前必读**。",
  "这份文件由 Phase 2 机械抽取，列出 PRD 中不可偏离的玩法硬约束。",
  "/compact 会保留这份文件，请随时回读对齐。",
  "",
];

if (mustHave.length > 0) {
  lines.push("## Must-have features");
  for (const f of mustHave) lines.push(`- ${f}`);
  lines.push("");
}

if (hardRules.length > 0) {
  lines.push("## Hard rules（禁区）");
  for (const r of hardRules) {
    const detail = r.attrs.detail ?? r.attrs.rationale ?? r.display;
    lines.push(`- **${r.id}**: ${detail}`);
  }
  lines.push("");
}

if (rules.length > 0) {
  lines.push("## 核心 @rule（按 PRD 顺序，最多 10 条）");
  for (const r of rules) {
    const effSnippet = (r.attrs.effect ?? "").slice(0, 80);
    lines.push(`- \`${r.id}\`: ${effSnippet}`);
  }
  lines.push("");
}

lines.push("## 操作指引");
lines.push("- codegen 必须在每条 @rule 触发处 `window.__trace.push({rule, before, after, t})`");
lines.push("- 不允许为了过校验而改 profile 或 check 脚本");
lines.push("- Must-have features 不得降级；若做不到，返回 failed 并报 user");

// 允许超长：保留 must-have 和 hard-rules 完整度比卡 500 字更重要
const out = lines.join("\n") + "\n";
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out, "utf-8");

console.log(`✓ guardrails 写入: ${outPath}`);
console.log(`  - must-have: ${mustHave.length}`);
console.log(`  - hard-rules: ${hardRules.length}`);
console.log(`  - rules: ${rules.length}`);
console.log(`  - 字符数: ${out.length}`);

process.exit(0);
