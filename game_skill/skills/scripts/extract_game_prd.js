#!/usr/bin/env node
/**
 * extract_game_prd.js — 从 Game APRD 提取结构化信息
 *
 * 用法:
 *   node extract_game_prd.js <prd-path> --list                                # 列出所有 tag 和关键属性
 *   node extract_game_prd.js <prd-path> --tag <type>                          # 列出特定 type 的 tag
 *   node extract_game_prd.js <prd-path> --json                                # 全量 JSON 输出
 *   node extract_game_prd.js <prd-path> --profile-skeleton <out.json>         # 产 profile skeleton（见下）
 *
 * --profile-skeleton 模式:
 *   从 PRD 的 @check(layer: product) 自动生成 profile 骨架：
 *     - 每条 @check → 一条 assertion stub，id = check id，description = check display
 *     - assertion.check_id = check id（反向绑定，check_playthrough 校验用）
 *     - setup / expect 预留占位注释
 *     - 文件头写 prdHash（SHA1），PRD 变更时 check_playthrough 会警告
 *
 * 退出码: 0 = OK, 1 = 文件不存在或解析错误
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { createHash } from "crypto";
import { mkdirSync } from "fs";

const prdPath = resolve(process.argv[2] ?? "docs/game-prd.md");
const argv = process.argv.slice(3);

function argValue(flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] ?? null;
}

const mode =
  argValue("--tag") !== null ? "--tag" :
  argValue("--profile-skeleton") !== null ? "--profile-skeleton" :
  argv.includes("--json") ? "--json" :
  "--list";

let content;
try {
  content = readFileSync(prdPath, "utf-8");
} catch {
  console.error(`✗ 文件不存在: ${prdPath}`);
  process.exit(1);
}

const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
const fmText = fmMatch ? fmMatch[1] : "";
const body = fmMatch ? content.slice(fmMatch[0].length) : content;

function fmGet(key) {
  const m = fmText.match(new RegExp(`^${key}:\\s*(.+)`, "m"));
  return m ? m[1].trim() : null;
}

// 提取 tag + attrs
const tagRe = /^#{2,4}[ \t]+@([a-z-]+)\(([^)]+)\)[ \t]*(.*)$/gm;
const tags = [];
let m;
while ((m = tagRe.exec(body)) !== null) {
  const type = m[1];
  const id = m[2].trim();
  const display = m[3].trim();
  const afterIdx = m.index + m[0].length;
  const rest = body.slice(afterIdx);
  const attrBlock = rest.match(/^\n?((?:>\s+.+(?:\n|$))+)/);
  const attrs = {};
  if (attrBlock) {
    const lines = [...attrBlock[1].matchAll(/^>\s+([a-zA-Z0-9_-]+):\s*(.*)$/gm)];
    for (const a of lines) attrs[a[1].trim()] = a[2].trim();
  }
  tags.push({ type, id, display, attrs });
}

// 聚合：按 type
const byType = {};
for (const t of tags) {
  (byType[t.type] ??= []).push(t);
}

const meta = {
  project: fmGet("project"),
  runtime: fmGet("runtime"),
  platform: fmGet("platform"),
  genre: (byType.game && byType.game[0]?.attrs?.genre) || null,
  support_level: fmGet("support-level"),
};

function prdHash(text) {
  return createHash("sha1").update(text).digest("hex");
}

if (mode === "--json") {
  console.log(JSON.stringify({ meta, byType }, null, 2));
  process.exit(0);
}

if (mode === "--tag") {
  const type = argValue("--tag");
  if (!type) { console.error("--tag 需要指定 type"); process.exit(1); }
  for (const t of byType[type] ?? []) {
    console.log(`@${t.type}(${t.id}) ${t.display}`);
    for (const [k, v] of Object.entries(t.attrs)) console.log(`  ${k}: ${v}`);
  }
  process.exit(0);
}

if (mode === "--profile-skeleton") {
  const outPath = argValue("--profile-skeleton");
  if (!outPath) { console.error("--profile-skeleton 需要指定输出路径"); process.exit(1); }

  const productChecks = (byType.check ?? []).filter(c => c.attrs.layer === "product");
  const hardRules = (byType.constraint ?? []).filter(c => c.attrs.kind === "hard-rule");

  const skeleton = {
    case_id: meta.project ?? "UNKNOWN",
    description: `${meta.project ?? "game"} - 从 PRD @check 自动生成的骨架，需人工补 setup/expect`,
    game_html_relative: "game/index.html",
    boot_timeout_ms: 5000,
    prd_hash: prdHash(content),
    prd_path: prdPath.includes("/cases/")
      ? prdPath.slice(prdPath.indexOf("/cases/") + 1)
      : "docs/game-prd.md",
    assertions: productChecks.map(c => ({
      id: c.id,
      check_id: c.id,
      kind: "state",
      description: c.display || c.id,
      _todo: "把 setup 和 expect 填完整。method/expect 原文见注释。",
      _prd_method: c.attrs.method ?? "",
      _prd_expect: c.attrs.expect ?? "",
      setup: [{ action: "wait", ms: 200 }],
      expect: {
        selector: "window.gameState",
        op: "truthy",
        value: true,
        _todo: `根据 @check(${c.id}) 的 expect 改成真实判定`,
      },
    })),
    hard_rule_assertions: hardRules.map(h => ({
      id: `hard-rule-${h.id}`,
      hard_rule_id: h.id,
      kind: "hard-rule",
      description: h.display || h.id,
      _todo: "根据 @constraint 填真实断言",
      setup: [],
      expect: {
        selector: "// TODO",
        op: "truthy",
        value: true,
      },
    })),
  };

  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), JSON.stringify(skeleton, null, 2) + "\n", "utf-8");
  console.log(`✓ profile skeleton 写入: ${outPath}`);
  console.log(`  - ${productChecks.length} 条 product @check → assertion stub`);
  console.log(`  - ${hardRules.length} 条 hard-rule @constraint → assertion stub`);
  console.log(`  - prd_hash: ${skeleton.prd_hash.slice(0, 12)}...`);
  console.log(`  补完 setup/expect 后，重命名为 ${meta.project ?? "<project>"}.json 移到 game_skill/skills/scripts/profiles/`);
  process.exit(0);
}

// default: --list
console.log("=== META ===");
for (const [k, v] of Object.entries(meta)) console.log(`${k}: ${v}`);
console.log("");

console.log("=== TAG SUMMARY ===");
const ORDER = ["game","flow","scene","state","entity","rule","input","ui","system","level","resource","constraint","check"];
for (const type of ORDER) {
  if (!byType[type]) continue;
  const ids = byType[type].map((t) => t.id).join(", ");
  console.log(`@${type} (${byType[type].length}): ${ids}`);
}
console.log("");

// Size summary only; Phase 3 Expand is always required.
const sizeSummary = {
  rules: (byType.rule ?? []).length,
  scenes: (byType.scene ?? []).length,
  states: (byType.state ?? []).length,
  systems: (byType.system ?? []).length,
};
console.log("=== SIZE SUMMARY ===");
console.log(`rules=${sizeSummary.rules}, scenes=${sizeSummary.scenes}, states=${sizeSummary.states}, systems=${sizeSummary.systems}`);
console.log("expand_required: true");
console.log("");

// Hard rules
const hardRules = (byType.constraint ?? []).filter((t) => t.attrs.kind === "hard-rule");
if (hardRules.length > 0) {
  console.log("=== HARD RULES ===");
  for (const h of hardRules) console.log(`@constraint(${h.id}): ${h.display}`);
}

process.exit(0);
