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
 *     - setup 预留真实 click 占位；不生成 expect
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
  argValue("--emit-rule-traces") !== null ? "--emit-rule-traces" :
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
    description: `${meta.project ?? "game"} - 从 PRD @check 自动生成的驱动脚本骨架，需人工补真实 setup`,
    game_html_relative: "game/index.html",
    boot_timeout_ms: 5000,
    prd_hash: prdHash(content),
    prd_path: prdPath.includes("/cases/")
      ? prdPath.slice(prdPath.indexOf("/cases/") + 1)
      : "docs/game-prd.md",
    assertions: productChecks.map(c => ({
      id: c.id,
      check_id: c.id,
      kind: "interaction",
      description: c.display || c.id,
      _todo: "把 setup 补成真实 UI 操作。profile 禁止写 expect，产品真相由 window.__trace + runtime errors 判定。",
      _prd_method: c.attrs.method ?? "",
      _prd_expect: c.attrs.expect ?? "",
      setup: [
        { action: "wait", ms: 200 },
        {
          action: "click",
          selector: "#btn-start",
          _todo: "替换为真实开始/主操作按钮；canvas 可改为 { action: \"click\", x: <number>, y: <number> }",
        },
        { action: "wait", ms: 500 },
      ],
    })),
    hard_rule_assertions: hardRules.map(h => ({
      id: `hard-rule-${h.id}`,
      hard_rule_id: h.id,
      kind: "hard-rule",
      description: h.display || h.id,
      _todo: "根据 @constraint 填真实 UI 驱动步骤；禁止写 expect",
      setup: [
        { action: "wait", ms: 200 },
        {
          action: "click",
          selector: "#btn-start",
          _todo: "替换为真实开始/主操作按钮；canvas 可改为 { action: \"click\", x: <number>, y: <number> }",
        },
        { action: "wait", ms: 500 },
      ],
    })),
  };

  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), JSON.stringify(skeleton, null, 2) + "\n", "utf-8");
  console.log(`✓ profile skeleton 写入: ${outPath}`);
  console.log(`  - ${productChecks.length} 条 product @check → assertion stub`);
  console.log(`  - ${hardRules.length} 条 hard-rule @constraint → assertion stub`);
  console.log(`  - prd_hash: ${skeleton.prd_hash.slice(0, 12)}...`);
  console.log(`  补完真实 setup 后，另存为 ${meta.project ?? "<project>"}.json 并在 Phase 5 首次 check 前 freeze`);
  process.exit(0);
}

if (mode === "--emit-rule-traces") {
  // T2: 机械抽每条 @rule.effect 的事件签名
  // 输出到 yaml 文件（通常 specs/event-graph.yaml 的补丁段）
  const outPath = argValue("--emit-rule-traces");
  if (!outPath) { console.error("--emit-rule-traces 需要指定输出路径"); process.exit(1); }

  // 字段读写动作的 token。顺序：多字符 op 优先，避免 == 被拆成 =
  const OP_TOKENS = [
    { re: /\+=/, op: "inc" },
    { re: /-=/, op: "dec" },
    { re: /\*=/, op: "mul" },
    { re: /\/=/, op: "div" },
    { re: /==/, op: "check" },
    { re: /!=/, op: "check" },
    { re: />=/, op: "check" },
    { re: /<=/, op: "check" },
    { re: />/,  op: "check" },
    { re: /</,  op: "check" },
    { re: /=/,  op: "assign" },
  ];

  // 从 @entity 抓 fields，和 check_game_prd.js 的逻辑一致（供 subject 解析用）
  const entityFieldsByName = new Map();
  for (const t of (byType.entity ?? [])) {
    const raw = t.attrs.fields ?? "";
    const out = new Set();
    const strip = raw.replace(/^\s*[\[{]|[\]}]\s*$/g, "");
    for (const pair of strip.split(/[,;]/)) {
      const mm = pair.trim().match(/^([a-zA-Z_][\w-]*)/);
      if (mm) out.add(mm[1]);
    }
    entityFieldsByName.set(t.id, out);
    const ty = t.attrs.type;
    if (ty && !entityFieldsByName.has(ty)) {
      const sameType = (byType.entity ?? []).filter(x => x.attrs.type === ty);
      if (sameType.length === 1) entityFieldsByName.set(ty, out);
    }
  }

  // P2-1: state / gameState 不 skip —— check_game_prd 允许 state.score += 10 作为合法 effect
  // 但之前 extractor 把它们放进 SKIP 导致 trace push 时缺字段。现在保留抽取。
  const SKIP_SUBJECTS = new Set(["Math","JSON","window","document","console","rect","arr","item","card","value","index","node","el"]);

  // 拆分一条 effect 为多个动作串：按 ";" 或 "→" / "->" / "," 分段
  function splitActions(effect) {
    // P2-1 fix: PRD 里 @rule.effect 常被写成 `"xxx"` 连引号；先去掉首尾引号
    const cleaned = effect.trim().replace(/^["']+|["']+$/g, "");
    return cleaned
      .split(/[;,]|→|->/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function parseActionToken(action) {
    // 找第一个 op token 命中的位置，左侧是 lhs，右侧是 rhs
    for (const { re, op } of OP_TOKENS) {
      const m = action.match(re);
      if (!m) continue;
      const idx = action.indexOf(m[0]);
      const lhs = action.slice(0, idx).trim();
      const rhs = action.slice(idx + m[0].length).trim();
      return { lhs, rhs, op };
    }
    return null;
  }

  function parseFieldRef(expr) {
    // 形如 pig.ammo / state.score / player.hp
    const m = expr.match(/^([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)$/);
    if (!m) return null;
    return { subject: m[1], field: m[2] };
  }

  const traces = [];
  for (const t of (byType.rule ?? [])) {
    const eff = t.attrs.effect ?? "";
    if (!eff) continue;
    const trigger = t.attrs.trigger ?? "";
    const actions = [];
    for (const seg of splitActions(eff)) {
      const parsed = parseActionToken(seg);
      if (!parsed) continue;
      const ref = parseFieldRef(parsed.lhs);
      if (!ref) continue;
      if (SKIP_SUBJECTS.has(ref.subject)) continue;
      actions.push({
        subject: ref.subject,
        field: ref.field,
        op: parsed.op,
        rhs: parsed.rhs.replace(/^["']+|["']+$/g, "").slice(0, 80),
      });
    }
    traces.push({
      "rule-id": t.id,
      trigger: trigger.slice(0, 120),
      effect: eff.slice(0, 200),
      actions,
    });
  }

  // 写成 yaml 片段。由于不想引 js-yaml 重依赖，直接手写（字段平坦）
  const lines = [
    "# 由 extract_game_prd.js --emit-rule-traces 机械生成。",
    "# 每条 @rule 在 codegen 的执行点必须 window.__trace.push({rule, before, after, t})",
    "# check_playthrough.js 用 trace 覆盖率判定玩法是否真的跑起来。",
    `# prd_hash: ${prdHash(content)}`,
    `# generated_at: ${new Date().toISOString()}`,
    "rule-traces:",
  ];
  for (const tr of traces) {
    lines.push(`  - rule-id: ${tr["rule-id"]}`);
    lines.push(`    trigger: ${JSON.stringify(tr.trigger)}`);
    lines.push(`    effect: ${JSON.stringify(tr.effect)}`);
    if (tr.actions.length === 0) {
      lines.push(`    actions: []`);
    } else {
      lines.push(`    actions:`);
      for (const a of tr.actions) {
        lines.push(`      - { subject: ${a.subject}, field: ${a.field}, op: ${a.op}, rhs: ${JSON.stringify(a.rhs)} }`);
      }
    }
  }
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), lines.join("\n") + "\n", "utf-8");

  const ruleCount = traces.length;
  const emptyRules = traces.filter(t => t.actions.length === 0).map(t => t["rule-id"]);
  console.log(`✓ rule-traces 写入: ${outPath}`);
  console.log(`  - ${ruleCount} 条 @rule 抽出 trace 签名`);
  if (emptyRules.length > 0) {
    console.log(`  ⚠ ${emptyRules.length} 条 @rule 未抽到 <entity>.<field> 动作: ${emptyRules.join(", ")}`);
    console.log(`    这些 rule 在 check_game_prd.js 的 RL005 里会被判 error，请在 PRD 里补充`);
  }
  process.exit(0);
}


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
