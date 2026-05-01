#!/usr/bin/env node
/**
 * check_resource_loop.js — symbolic resource-loop gate.
 *
 * CLI:
 *   node check_resource_loop.js <case-dir> [--log <path>]
 *
 * Exit codes:
 *   0 = resource loop passed
 *   1 = symbolic or trace ratio failure
 *   3 = missing/invalid design-strategy.yaml
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";

function usage() {
  return [
    "Usage: node check_resource_loop.js <case-dir> [--log <path>]",
    "",
    "Checks docs/design-strategy.yaml resource-loop for isolated resources, infinite growth, and optional trace ratio.",
  ].join("\n");
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const caseDir = resolve(firstPositional(args) ?? ".");
const log = createLogger(parseLogArg(process.argv));
const errors = [];
const warnings = [];
const oks = [];

function ok(msg) { console.log(`  ✓ ${msg}`); oks.push(msg); }
function warn(msg) { console.log(`  ⚠ ${msg}`); warnings.push(msg); }
function fail(msg) { console.log(`  ✗ ${msg}`); errors.push(msg); }

console.log(`Resource loop check: ${caseDir}`);

const strategyPath = join(caseDir, "docs/design-strategy.yaml");
if (!existsSync(strategyPath)) {
  fail(`design-strategy.yaml 不存在: ${strategyPath}`);
  finish(3);
}

const strategy = readYaml(strategyPath);
if (!strategy) finish(3);
const loop = strategy["resource-loop"];
if (!loop || typeof loop !== "object" || Array.isArray(loop)) {
  fail("resource-loop 必须是 object");
  finish(1);
}

const resources = (Array.isArray(loop.resources) ? loop.resources : [])
  .map(resourceId)
  .filter(Boolean);
const resourceSet = new Set(resources);
if (resources.length === 0) {
  fail("resource-loop.resources 为空");
  finish(1);
}

const edges = [
  ...collectSourceEdges(loop.sources, resourceSet),
  ...collectSinkEdges(loop.sinks, resourceSet),
];

for (const resource of resources) {
  const hasIn = edges.some((edge) => edge.kind === "source" && edge.to === resource);
  const hasOut = edges.some((edge) => edge.kind === "sink" && edge.from === resource);
  if (!hasIn) fail(`资源缺少 source in-edge: ${resource}`);
  if (!hasOut) fail(`资源缺少 sink out-edge: ${resource}`);
  if (hasIn && hasOut) ok(`资源 ${resource} 有 source/sink 闭环边`);
}

checkPositiveFeedbackScc(resources, edges);
checkTraceRatio(caseDir);

finish(errors.length ? 1 : 0);

function collectSourceEdges(items, resourceSet) {
  const out = [];
  for (const [idx, item] of asArray(items).entries()) {
    const from = stringOrNull(item?.from);
    const to = stringOrNull(item?.to);
    if (from && to) {
      validateResourceRef(from, `sources[${idx}].from`, resourceSet);
      validateResourceRef(to, `sources[${idx}].to`, resourceSet);
      out.push({ kind: "source", sign: "positive", from, to, raw: item });
    } else if (from) {
      validateResourceRef(from, `sources[${idx}].from`, resourceSet);
      out.push({ kind: "source", sign: "positive", from: `__source_${idx}`, to: from, raw: item });
    } else if (to) {
      validateResourceRef(to, `sources[${idx}].to`, resourceSet);
      out.push({ kind: "source", sign: "positive", from: `__source_${idx}`, to, raw: item });
    } else {
      fail(`sources[${idx}] 缺 from/to`);
    }
  }
  return out;
}

function collectSinkEdges(items, resourceSet) {
  const out = [];
  for (const [idx, item] of asArray(items).entries()) {
    const from = stringOrNull(item?.from);
    const to = stringOrNull(item?.to);
    if (from && to) {
      validateResourceRef(from, `sinks[${idx}].from`, resourceSet);
      validateResourceRef(to, `sinks[${idx}].to`, resourceSet);
      out.push({ kind: "sink", sign: "negative", from, to, raw: item });
    } else if (to) {
      validateResourceRef(to, `sinks[${idx}].to`, resourceSet);
      out.push({ kind: "sink", sign: "negative", from: to, to: `__sink_${idx}`, raw: item });
    } else if (from) {
      validateResourceRef(from, `sinks[${idx}].from`, resourceSet);
      out.push({ kind: "sink", sign: "negative", from, to: `__sink_${idx}`, raw: item });
    } else {
      fail(`sinks[${idx}] 缺 from/to`);
    }
  }
  return out;
}

function validateResourceRef(value, label, resourceSet) {
  if (!resourceSet.has(value)) fail(`${label} 未在 resources[] 声明: ${value}`);
}

function checkPositiveFeedbackScc(resources, edges) {
  const sccs = tarjan(resources, edges.filter((edge) => resourceSet.has(edge.from) && resourceSet.has(edge.to)));
  for (const scc of sccs) {
    const nodes = new Set(scc);
    const internal = edges.filter((edge) => nodes.has(edge.from) && nodes.has(edge.to));
    if (internal.length === 0) continue;
    const hasCycle = scc.length > 1 || internal.some((edge) => edge.from === edge.to);
    if (!hasCycle) continue;
    const allPositive = internal.every((edge) => edge.sign === "positive");
    const outgoingSink = edges.some((edge) => edge.kind === "sink" && nodes.has(edge.from) && !nodes.has(edge.to));
    if (allPositive && !outgoingSink) {
      fail(`SCC 内部只有正反馈且无出向 sink: ${scc.join(", ")}`);
    }
  }
  if (errors.length === 0) ok("未发现无限增殖 SCC");
}

function checkTraceRatio(root) {
  const reportPath = join(root, "eval/report.json");
  if (!existsSync(reportPath)) {
    warn("eval/report.json 不存在，跳过 resource trace 产出/消耗比");
    return;
  }
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf-8"));
  } catch (err) {
    warn(`eval/report.json 解析失败，跳过 resource trace 比例: ${err.message}`);
    return;
  }
  const traces = collectTraceArrays(report).flat().filter((event) => event && typeof event === "object");
  const resourceEvents = traces.filter(isResourceEvent);
  if (resourceEvents.length === 0) {
    warn("report.json 未发现 resource trace 事件，跳过产出/消耗比");
    return;
  }
  let produced = 0;
  let consumed = 0;
  for (const event of resourceEvents) {
    const amount = inferAmount(event);
    if (amount > 0) produced += amount;
    else if (amount < 0) consumed += Math.abs(amount);
  }
  if (consumed === 0) {
    fail(`resource trace 消耗为 0（produced=${produced}），疑似无限增殖`);
    return;
  }
  const ratio = produced / consumed;
  if (ratio >= 1.1 && ratio <= 1.3) ok(`resource trace 产出/消耗比 ${ratio.toFixed(2)} in [1.1, 1.3]`);
  else fail(`resource trace 产出/消耗比 ${ratio.toFixed(2)} 不在 [1.1, 1.3]`);
}

function collectTraceArrays(value, out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    if (value.some(isTraceLike)) out.push(value);
    for (const item of value) collectTraceArrays(item, out);
    return out;
  }
  for (const [key, item] of Object.entries(value)) {
    if ((key === "__trace" || key === "trace" || key === "session_trace") && Array.isArray(item)) out.push(item);
    else collectTraceArrays(item, out);
  }
  return out;
}

function isTraceLike(event) {
  return event && typeof event === "object" && ("type" in event || "rule" in event || "resource" in event);
}

function isResourceEvent(event) {
  const text = `${event.type ?? ""} ${event.kind ?? ""} ${event.rule ?? ""}`.toLowerCase();
  return Boolean(event.resource || event.resources || /resource|wallet|currency|energy|coin|xp/.test(text));
}

function inferAmount(event) {
  for (const key of ["delta", "change", "amount", "value"]) {
    const n = Number(event[key]);
    if (Number.isFinite(n) && n !== 0) return signedByText(event, n);
  }
  const before = Number(event.before?.amount ?? event.before?.value ?? event.before?.count);
  const after = Number(event.after?.amount ?? event.after?.value ?? event.after?.count);
  if (Number.isFinite(before) && Number.isFinite(after) && after !== before) return after - before;
  const text = `${event.type ?? ""} ${event.kind ?? ""} ${event.rule ?? ""}`.toLowerCase();
  if (/consume|spend|sink|cost|decrease/.test(text)) return -1;
  if (/produce|gain|source|reward|increase/.test(text)) return 1;
  return 0;
}

function signedByText(event, n) {
  const text = `${event.type ?? ""} ${event.kind ?? ""} ${event.rule ?? ""}`.toLowerCase();
  if (n > 0 && /consume|spend|sink|cost|decrease/.test(text)) return -n;
  if (n < 0 && /produce|gain|source|reward|increase/.test(text)) return Math.abs(n);
  return n;
}

function tarjan(nodes, edges) {
  const graph = new Map(nodes.map((node) => [node, []]));
  for (const edge of edges) graph.get(edge.from)?.push(edge.to);
  const stack = [];
  const onStack = new Set();
  const indexes = new Map();
  const low = new Map();
  const out = [];
  let idx = 0;

  const visit = (node) => {
    indexes.set(node, idx);
    low.set(node, idx);
    idx += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!indexes.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node), low.get(next)));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node), indexes.get(next)));
      }
    }
    if (low.get(node) === indexes.get(node)) {
      const scc = [];
      let current;
      do {
        current = stack.pop();
        onStack.delete(current);
        scc.push(current);
      } while (current !== node);
      out.push(scc);
    }
  };

  for (const node of nodes) {
    if (!indexes.has(node)) visit(node);
  }
  return out;
}

function readYaml(path) {
  try {
    return yaml.load(readFileSync(path, "utf-8")) ?? {};
  } catch (err) {
    fail(`读取 ${path} 失败: ${err.message}`);
    return null;
  }
}

function resourceId(item) {
  if (typeof item === "string") return item;
  if (item && typeof item.id === "string") return item.id;
  return null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstPositional(argv) {
  const valueFlags = new Set(["--log"]);
  for (let i = 0; i < argv.length; i += 1) {
    if (valueFlags.has(argv[i])) {
      i += 1;
      continue;
    }
    if (!argv[i].startsWith("--")) return argv[i];
  }
  return null;
}

function finish(code) {
  log.entry({
    type: "check-run",
    phase: "stage",
    step: "resource-loop",
    script: "check_resource_loop.js",
    exit_code: code,
    oks,
    warnings,
    errors,
  });
  process.exit(code);
}
