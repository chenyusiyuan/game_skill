#!/usr/bin/env node
/**
 * render_case_report.js — 渲染案例评估报告
 *
 * 用法:
 *   node render_case_report.js <report.json>              # 单 case，输出 Markdown
 *   node render_case_report.js <dir1> <dir2> ... --batch  # 多 workspace 汇总
 *
 * 单 case 模式读 <report.json>；批量模式从每个目录读 eval/report.json。
 */

import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";

const args = process.argv.slice(2);
const batchIdx = args.indexOf("--batch");
const batchMode = batchIdx >= 0;

function readReport(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
}

function renderOne(r) {
  const lines = [];
  lines.push(`# Case: ${r.case}`);
  lines.push("");
  lines.push(`**runtime**: ${r.runtime}  |  **时间**: ${r.timestamps?.start ?? "-"} → ${r.timestamps?.end ?? "-"}`);
  lines.push("");
  lines.push("## 链路层指标");
  for (const [k, v] of Object.entries(r.chain_metrics ?? {})) lines.push(`- ${k}: ${v}`);
  lines.push("");
  lines.push("## 工程层指标");
  for (const [k, v] of Object.entries(r.engineering_metrics ?? {})) lines.push(`- ${k}: ${v}`);
  if (r.contract_metrics && Object.keys(r.contract_metrics).length > 0) {
    lines.push("");
    lines.push("## 契约层指标");
    for (const [k, v] of Object.entries(r.contract_metrics ?? {})) lines.push(`- ${k}: ${v}`);
  }
  lines.push("");
  lines.push("## 产品层指标");
  for (const [k, v] of Object.entries(r.product_metrics ?? {})) lines.push(`- ${k}: ${v}`);
  if (r.requirement_metrics && Object.keys(r.requirement_metrics).length > 0) {
    lines.push("");
    lines.push("## 需求层指标");
    for (const [k, v] of Object.entries(r.requirement_metrics ?? {})) lines.push(`- ${k}: ${v}`);
  }
  lines.push("");
  lines.push("## 产出物");
  for (const [k, v] of Object.entries(r.artifacts ?? {})) lines.push(`- ${k}: \`${v}\``);
  return lines.join("\n");
}

function renderBatch(reports) {
  const lines = [];
  lines.push("# 批量评估报告");
  lines.push("");
  lines.push("| case | runtime | support | engine-rounds | hard-rules | checks | must-have |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const r of reports) {
    if (!r) continue;
    const sup = r.chain_metrics?.support_level ?? "-";
    const rounds = r.engineering_metrics?.project_check_rounds ?? "-";
    const hr = r.product_metrics?.hard_rules_passing ?? "-";
    const ck = r.product_metrics?.checks_passing ?? "-";
    const mh = r.requirement_metrics
      ? `${r.requirement_metrics.must_have_delivered ?? "-"}/${r.requirement_metrics.must_have_total ?? "-"}`
      : "-";
    lines.push(`| ${r.case} | ${r.runtime} | ${sup} | ${rounds} | ${hr} | ${ck} | ${mh} |`);
  }
  lines.push("");
  lines.push("## 每案例细节");
  for (const r of reports) {
    if (!r) continue;
    lines.push("");
    lines.push(renderOne(r));
  }
  return lines.join("\n");
}

if (batchMode) {
  const dirs = args.filter((a) => a !== "--batch");
  const reports = dirs.map((d) => readReport(join(resolve(d), "eval", "report.json")));
  console.log(renderBatch(reports.filter(Boolean)));
} else {
  const path = resolve(args[0] ?? "eval/report.json");
  const r = readReport(path);
  if (!r) { console.error(`✗ 读不到 ${path}`); process.exit(1); }
  console.log(renderOne(r));
}
