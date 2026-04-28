#!/usr/bin/env node
/**
 * check_mechanics.js — Phase 3.5 Mechanic Symbolic Check
 *
 * 读取 cases/<slug>/specs/mechanics.yaml，按照 DAG 组装每个 primitive 的
 * reference reducer，跑 mechanics.yaml 中声明的 simulation-scenarios，验证：
 *   1. 每个 primitive 的 invariants 是否持有
 *   2. 至少一个 scenario 能到达 expected-outcome (win/lose/...)
 *   3. PRD @constraint → primitive 字段的 maps-to 值是否一致
 *
 * 这是玩法"前置真值"源，取代 Phase 5 __trace 覆盖率作为玩法结构合格判据。
 *
 * 用法:
 *   node check_mechanics.js <case-dir> [--allow-missing-mechanics] [--log cases/<slug>/.game/log.jsonl]
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MECHANICS_ROOT = resolve(__dirname, "../references/mechanics");

const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const allowMissingMechanics = args.includes("--allow-missing-mechanics");
const log = createLogger(parseLogArg(process.argv));
const errors = [];
const warnings = [];

function fail(msg) { console.log(`  ✗ ${msg}`); errors.push(msg); }
function warn(msg) { console.log(`  ⚠ ${msg}`); warnings.push(msg); }
function ok(msg) { console.log(`  ✓ ${msg}`); }

console.log(`Mechanic symbolic check: ${caseDir}`);

const mechPath = join(caseDir, "specs/mechanics.yaml");
if (!existsSync(mechPath)) {
  if (allowMissingMechanics) {
    warn(`mechanics.yaml 不存在（${mechPath}）；因 --allow-missing-mechanics 跳过（仅 legacy case 使用）`);
    finish(0);
  }
  fail(`mechanics.yaml 不存在: ${mechPath}`);
  finish(1);
}

const mech = readYaml(mechPath);
if (!mech) finish(1);

// 1. 加载 primitive index
const indexPath = join(MECHANICS_ROOT, "_index.yaml");
if (!existsSync(indexPath)) fail(`primitive catalog _index.yaml 不存在: ${indexPath}`);
const idx = readYaml(indexPath) || { primitives: [] };
const primMap = new Map();
for (const p of idx.primitives || []) primMap.set(`${p.id}@${p.version}`, p);

// 2. 预加载所有用到的 reducer
const reducersNeeded = new Set();
for (const node of mech.mechanics || []) {
  if (!node.primitive) { fail(`mechanics.${node.node}.primitive 缺失`); continue; }
  reducersNeeded.add(node.primitive);
}
const reducers = new Map();
for (const pid of reducersNeeded) {
  const meta = primMap.get(pid);
  if (!meta) { fail(`unknown primitive ${pid}（不在 _index.yaml）`); continue; }
  const abs = pathToFileURL(join(MECHANICS_ROOT, meta.reducer)).href;
  try {
    const mod = await import(abs);
    reducers.set(pid, mod);
    ok(`loaded ${pid} reducer`);
  } catch (e) {
    fail(`加载 ${pid} reducer 失败: ${e.message}`);
  }
}
if (errors.length) finish(1);

// 3. Schema sanity
checkShape(mech);
checkInvariantMappings(mech);
checkGridTrackShape(mech);
checkAttackTriggerGranularity(mech);
checkTriggerPayloadCompat(mech, reducers);
checkConstraintCoverage(mech, caseDir);
checkPerNodeStatic(mech, reducers);
checkSpecPrimitiveRefs(mech, caseDir, reducers);
checkScenarioSetup(mech);

// 4. 跑每个 scenario，收集 per-node history，结尾验证每个 node 的 reducer.checkInvariants
const scenarios = mech["simulation-scenarios"] || [];
if (scenarios.length === 0) fail(`mechanics.yaml 未声明 simulation-scenarios（至少需要一条 expected-outcome:win）`);

let anyWin = false;
for (const sc of scenarios) {
  console.log(`  · scenario: ${sc.name}`);
  const result = runScenario(mech, sc, reducers);
  const expected = sc["expected-outcome"];
  const actual = result.outcome;
  const matches = actual === expected
    || (expected === "none" && actual == null)
    || (expected == null && actual == null);
  if (matches) {
    ok(`    outcome=${actual ?? "<none>"} 符合 expected`);
    if (actual === "win") anyWin = true;
  } else {
    fail(`    outcome=${actual ?? "<none>"} 不等于 expected=${expected} (ticks=${result.ticks})`);
  }
  // 对每个 mechanics node 都跑一次 reducer.checkInvariants：
  //   - 有 history  → 拿 history 跑动态不变式
  //   - 无 history  → 仍然拿 []+params 跑一次，抓到纯 params 级不变式（fsm closed/deterministic/reachability）
  for (const node of mech.mechanics || []) {
    const pid = node.primitive;
    const meta = reducers.get(pid);
    if (!meta?.checkInvariants) continue;
    const history = result.histories.get(node.node) || [];
    const { ok: inv_ok, violations } = meta.checkInvariants(history, node.params || {});
    const tag = `${node.node}:${pid}`;
    if (!inv_ok) {
      for (const v of violations) fail(`    [invariant@${tag}] ${v}`);
    } else if (history.length) {
      ok(`    [invariant@${tag}] ${history.length} snapshots, all invariants held`);
    } else {
      ok(`    [invariant@${tag}] no history (static params-only check passed)`);
    }
  }
}

if (!anyWin) fail("no scenario reached 'win' — PRD/mechanics.yaml 可能结构性不可完成");

finish(errors.length ? 1 : 0);

// ---------- impl ----------

function readYaml(p) {
  try { return yaml.load(readFileSync(p, "utf8")); }
  catch (e) { fail(`读取 ${p} 失败: ${e.message}`); return null; }
}

function checkShape(m) {
  if (!Array.isArray(m.mechanics) || m.mechanics.length === 0) fail("mechanics 段为空");
  if (!Array.isArray(m.entities) || m.entities.length === 0) fail("entities 段为空");
  const nodeIds = new Set();
  for (const n of m.mechanics || []) {
    if (!n.node) fail("mechanic 节点缺 node id");
    if (nodeIds.has(n.node)) fail(`duplicate node id: ${n.node}`);
    nodeIds.add(n.node);
  }
}

function checkInvariantMappings(m) {
  const inv = m.invariants || [];
  for (const entry of inv) {
    if (!entry["maps-to"]) { fail(`invariant ${entry.ref} 缺 maps-to`); continue; }
    const { node, field, expected, invariant: invName } = entry["maps-to"];
    const nodes = entry["maps-to"].nodes;
    if (Array.isArray(nodes)) {
      const missingNodes = nodes.filter(n => !m.mechanics.find(item => item.node === n));
      if (missingNodes.length) {
        fail(`invariant ${entry.ref} 指向未知 nodes: ${missingNodes.join(", ")}`);
      } else {
        ok(`invariant ${entry.ref} mapped nodes: ${nodes.join(", ")}`);
      }
      continue;
    }
    const target = m.mechanics.find(n => n.node === node);
    if (!target) { fail(`invariant ${entry.ref} 指向未知 node: ${node}`); continue; }
    if (field !== undefined && expected !== undefined) {
      const actual = getDeep(target.params, field);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        fail(`invariant ${entry.ref}: node=${node}.${field} expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
      } else {
        ok(`invariant ${entry.ref} mapped: ${node}.${field}=${JSON.stringify(actual)}`);
      }
    }
    // invariant-name 形式的映射（如 no-penetration）由 reducer.checkInvariants 负责验证，这里只登记
    if (invName) ok(`invariant ${entry.ref} → ${node}.reducer invariant '${invName}' (enforced at sim time)`);
  }
}

function checkGridTrackShape(m) {
  const hasGridBoard = (m.mechanics || []).some(n => n.primitive === "grid-board@v1");
  if (!hasGridBoard) return;
  const badTracks = (m.mechanics || []).filter(n =>
    n.primitive === "parametric-track@v1" &&
    (n.params?.["grid-projection"] || n.params?.gridProjection) &&
    n.params?.shape === "ring"
  );
  for (const n of badTracks) {
    fail(`grid-track-shape[${n.node}]: grid-board 外圈传送带必须用 shape: rect-loop，不能用 ring。ring 会把正方形棋盘外圈画成圆形轨道`);
  }
  const goodTracks = (m.mechanics || []).filter(n =>
    n.primitive === "parametric-track@v1" &&
    (n.params?.["grid-projection"] || n.params?.gridProjection) &&
    n.params?.shape === "rect-loop"
  );
  if (goodTracks.length > 0) {
    ok(`grid-track-shape: ${goodTracks.length} 条 grid-projection track 使用 rect-loop`);
  }
}

/**
 * 攻击触发粒度检查：当 ray-cast@v1 使用 coord-system:grid 且其 source 来自
 * parametric-track@v1（带 grid-projection），攻击触发事件不能是 track.enter-segment。
 * 
 * enter-segment 每圈只触发 4 次（换段时），而 attack-position 每经过一个格对齐位就触发一次。
 * 使用 enter-segment 会导致攻击频率远低于预期，游戏不可玩。
 */
function checkAttackTriggerGranularity(m) {
  const nodes = m.mechanics || [];
  // 找到所有使用 grid-projection 的 parametric-track 节点
  const gridTracks = nodes.filter(n =>
    n.primitive === "parametric-track@v1" &&
    (n.params?.["grid-projection"] || n.params?.gridProjection)
  );
  if (gridTracks.length === 0) return;

  // 找到所有 ray-cast 节点，检查其 trigger-on 是否使用了 enter-segment
  const rayCasts = nodes.filter(n =>
    n.primitive === "ray-cast@v1" &&
    n.params?.["coord-system"] === "grid"
  );
  for (const rc of rayCasts) {
    const triggers = rc["trigger-on"] || [];
    if (triggers.includes("track.enter-segment")) {
      fail(`attack-trigger-granularity[${rc.node}]: ray-cast(coord-system:grid) 的 trigger-on 使用了 track.enter-segment，这只在段切换时触发（每圈 4 次）。应改用 track.attack-position（每格对齐位触发一次），否则攻击频率严重不足`);
    }
  }
}

/**
 * 通用 trigger-on payload 兼容性检查。
 * 
 * 对于每个 event-driven 节点（有 trigger-on），检查其 trigger-on 事件
 * 的 payload 是否满足该节点 reducer 的 resolveAction 需求。
 *
 * 已知的 payload 需求（从 reducer .md Event Interface Contract 提取）：
 * - resource-consume@v1: 需要 ev.left/ev.agent + ev.right/ev.target（双实体）
 * - ray-cast@v1: 需要 ev.agent 或 ev.source（含坐标）
 * - predicate-match@v1: 需要 ev.source/ev.agent + ev.targets[]/ev.right
 * - score-accum@v1: 只需 ev.type 匹配 rules[].on
 */
function checkTriggerPayloadCompat(m, reducers) {
  const nodes = m.mechanics || [];

  // 已知需要双实体 payload 的 primitives
  const needsBothEntities = new Set([
    "resource-consume@v1",
  ]);

  // 已知只产出单实体 payload 的事件
  const singleEntityEvents = new Set([
    "track.enter-segment",
    "track.attack-position",
    "track.loop-complete",
    "grid.moved",
    "grid.blocked",
  ]);

  for (const n of nodes) {
    const triggers = n["trigger-on"] || [];
    if (triggers.length === 0) continue;
    const pid = n.primitive;

    for (const evt of triggers) {
      if (needsBothEntities.has(pid) && singleEntityEvents.has(evt)) {
        fail(`trigger-payload-compat[${n.node}]: ${pid} 需要 ev.agent + ev.target 双实体 payload，但 trigger-on "${evt}" 只携带单实体。应改为监听 match.hit 等双实体事件`);
      }
    }
  }
}

/**
 * 扫描 PRD，抽出所有 @constraint(... kind=hard-rule ...) 的 id，
 * 要求 mechanics.yaml.invariants[].ref 覆盖每一条 hard-rule。
 * 这是链路的核心语义门禁：PRD 的硬约束必须被编译到原语字段或 reducer invariant 上，
 * 不得被 decomposer 漏掉。
 */
function checkConstraintCoverage(m, caseDir) {
  const prdPath = join(caseDir, "docs/game-prd.md");
  if (!existsSync(prdPath)) { warn(`无 docs/game-prd.md，跳过 constraint 覆盖率检查`); return; }
  const prd = readFileSync(prdPath, "utf8");
  const hardIds = [];
  const lines = prd.split(/\r?\n/);
  const idRe = /@constraint\s*\(\s*([^)\s,]+)\s*[),]([^\n]*)/;
  for (let i = 0; i < lines.length; i++) {
    const m1 = lines[i].match(idRe);
    if (!m1) continue;
    const id = m1[1].trim();
    const tail = m1[2] || "";
    // 在本行 + 接下来 6 行的窗口内找 kind 信息，接受两种形式：
    //   - 同行内 @constraint(id, kind:hard-rule, ...) / @constraint(id){kind:hard-rule}
    //   - 紧跟 markdown 引用块 "> kind: hard-rule"
    const window = [tail, ...lines.slice(i + 1, i + 7)].join("\n");
    if (/kind\s*[:=]\s*["']?hard-rule/.test(window)) {
      if (!hardIds.includes(id)) hardIds.push(id);
    }
  }
  if (hardIds.length === 0) {
    warn(`PRD 未声明 kind:hard-rule 的 @constraint；此项检查无作用`);
    return;
  }
  const covered = new Set();
  for (const entry of m.invariants || []) {
    const ref = String(entry.ref || "");
    const rm = ref.match(/@constraint\s*\(\s*([^)\s]+)\s*\)/);
    if (rm) covered.add(rm[1]);
    else covered.add(ref.trim()); // 也允许纯 id
  }
  const missing = hardIds.filter(id => !covered.has(id));
  if (missing.length) {
    for (const id of missing) {
      fail(`constraint-coverage: hard-rule '@constraint(${id})' 未映射到 mechanics.yaml.invariants（decomposer 漏映射或 ref 写法不对）`);
    }
  } else {
    ok(`constraint-coverage: ${hardIds.length} 条 hard-rule 全部映射 (${hardIds.join(", ")})`);
  }
}

function getDeep(obj, path) {
  if (!obj) return undefined;
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
  return cur;
}

/**
 * 静态门禁（不跑 scenario 就能做的逐节点检查）：
 *   1. params-only invariant —— 对每个 mechanics node 用空 history 调一次
 *      reducer.checkInvariants(params)，抓到**不需要运行时事件**就能判定的违规
 *      （如 fsm-transition 的 closed / deterministic / reachability）。
 *      这样即便该 node 不会被 orchestrator 触发，结构性错误也不会漏网。
 *   2. trigger-on 拓扑完备性 —— node 的每个 trigger-on 事件必须在 reducer
 *      自声明的 `emittedEvents` 里有 producer，或这个节点本身是根
 *      （无 trigger-on）。没有 producer 的 trigger-on 直接 fail。
 *   3. 节点健全性 —— trigger-on 非空但 reducer 未导出 resolveAction，或
 *      无 trigger-on 且 reducer 不 handles 'tick' 且不是 win-lose-check，
 *      则 fail（说明 orchestrator 无法驱动它）。
 *
 * grid-board 的 checkInvariants 签名是 (state, params) 而非 (history, params)，
 * 不适用于本静态检查（它是 state-shape 校验），这里跳过。
 */
function checkPerNodeStatic(mech, reducers) {
  const nodes = mech.mechanics || [];
  // 先收集每个 node 可能产出的事件。事件清单只来自 reducer.emittedEvents，
  // 避免 checker 维护一份会漂移的白名单。
  const allProduced = new Set();
  for (const ev of mech["external-events"] || []) allProduced.add(ev);
  for (const n of nodes) {
    const red = reducers.get(n.primitive);
    const list = red && Array.isArray(red.emittedEvents) ? red.emittedEvents : [];
    for (const ev of list) allProduced.add(ev);
  }

  for (const n of nodes) {
    const pid = n.primitive;
    const red = reducers.get(pid);
    if (!red) {
      fail(`node '${n.node}': primitive '${pid}' 未在 _index.yaml 注册`);
      continue;
    }
    // 1. params-only invariant（跳过 grid-board 这种 state-shape 校验）
    if (typeof red.checkInvariants === "function" && pid !== "grid-board@v1") {
      const { ok: s_ok, violations } = red.checkInvariants([], n.params || {});
      if (!s_ok) {
        for (const v of violations) fail(`static[${n.node}:${pid}] ${v}`);
      }
    }
    // 2. trigger-on 拓扑 producer 检查
    const triggers = n["trigger-on"] || [];
    for (const ev of triggers) {
      if (![...allProduced].some(produced => eventMatches(produced, ev))) {
        fail(`trigger-topology[${n.node}]: trigger-on '${ev}' 无上游 producer（检查 mechanics.yaml 是否缺少产出该事件的 node）`);
      }
    }
    // 3. 节点健全性：orchestrator 能驱动它吗？
    const hasTick = (red.handles || []).includes("tick");
    const isWinLose = pid === "win-lose-check@v1";
    const isBoard   = pid === "grid-board@v1"; // board 只作为 state 容器，被动
    if (triggers.length === 0 && !hasTick && !isWinLose && !isBoard) {
      fail(`node-driver[${n.node}:${pid}]: 既无 trigger-on 又不 handles 'tick'，orchestrator 无法驱动`);
    }
    if (triggers.length > 0 && typeof red.resolveAction !== "function") {
      fail(`node-driver[${n.node}:${pid}]: 声明了 trigger-on 但 reducer 未导出 resolveAction 钩子`);
    }
  }
}

function eventMatches(produced, expected) {
  if (produced === expected) return true;
  if (typeof produced === "string" && produced.endsWith("*")) {
    return expected.startsWith(produced.slice(0, -1));
  }
  return false;
}

function triggerMatches(trigger, actual) {
  return eventMatches(trigger, actual) || eventMatches(actual, trigger);
}

function checkSpecPrimitiveRefs(mech, caseDir, reducers) {
  const nodeIds = new Set((mech.mechanics || []).map(n => n.node).filter(Boolean));
  const allowedEvents = collectAllowedEvents(mech, reducers);
  checkRulePrimitiveRefs(join(caseDir, "specs/rule.yaml"), nodeIds);
  checkEventGraphPrimitiveRefs(join(caseDir, "specs/event-graph.yaml"), nodeIds, allowedEvents);
}

function checkScenarioSetup(mech) {
  for (const sc of mech["simulation-scenarios"] || []) {
    for (const [collection, list] of Object.entries(sc.setup || {})) {
      if (!Array.isArray(list)) {
        fail(`scenario[${sc.name}].setup.${collection}: 必须是数组`);
        continue;
      }
      for (const item of list) {
        if (typeof item.alive !== "boolean") {
          fail(`scenario[${sc.name}].setup.${collection}.${item.id || "<unknown>"}: 必须显式声明 alive: true|false`);
        }
      }
    }
  }
}

function collectAllowedEvents(mech, reducers) {
  const allowed = new Set(mech["external-events"] || []);
  for (const n of mech.mechanics || []) {
    for (const ev of n["produces-events"] || []) allowed.add(ev);
    for (const ev of n["trigger-on"] || []) allowed.add(ev);
    const red = reducers.get(n.primitive);
    for (const ev of red?.emittedEvents || []) allowed.add(ev);
  }
  return allowed;
}

function checkRulePrimitiveRefs(path, nodeIds) {
  if (!existsSync(path)) {
    warn(`spec-linkage: 缺 specs/rule.yaml，跳过 primitive-node-ref 校验`);
    return;
  }
  const spec = readYaml(path);
  const rules = Array.isArray(spec?.rules) ? spec.rules : [];
  if (rules.length === 0) {
    fail(`spec-linkage[rule]: rule.yaml 缺少 rules[]，无法校验 primitive-node-ref`);
    return;
  }
  for (const r of rules) {
    const refs = collectPrimitiveRefs(r);
    const id = r.id || "<unknown>";
    if (refs.length === 0) {
      fail(`spec-linkage[rule:${id}]: 缺 primitive-node-ref（每条 rule 必须锚定 mechanics node，UI-only 用 none + reason）`);
      continue;
    }
    validatePrimitiveRefs(`rule:${id}`, refs, nodeIds);
  }
}

function checkEventGraphPrimitiveRefs(path, nodeIds, allowedEvents) {
  if (!existsSync(path)) {
    warn(`spec-linkage: 缺 specs/event-graph.yaml，跳过 primitive-node-ref 校验`);
    return;
  }
  const spec = readYaml(path);
  const modules = Array.isArray(spec?.modules) ? spec.modules : [];
  if (modules.length === 0) {
    fail(`spec-linkage[event-graph]: event-graph.yaml 缺少 modules[]，无法校验 primitive-node-ref`);
    return;
  }
  for (const mod of modules) {
    const id = mod.id || "<unknown>";
    const refs = collectPrimitiveRefs(mod);
    if (refs.length === 0) {
      fail(`spec-linkage[event-graph:${id}]: 缺 primitive-node-ref（每个模块必须锚定 mechanics node，UI-only 用 none + reason）`);
      continue;
    }
    const activeRefs = refs.filter(ref => ref.value !== "none");
    validatePrimitiveRefs(`event-graph:${id}`, refs, nodeIds);
    if (activeRefs.length > 0) {
      validateEventLabels(`event-graph:${id}.listens`, mod.listens || [], allowedEvents, true);
      validateEventLabels(`event-graph:${id}.emits`, mod.emits || [], allowedEvents, false);
    }
  }
}

function collectPrimitiveRefs(obj, out = []) {
  if (!obj || typeof obj !== "object") return out;
  if (Array.isArray(obj)) {
    for (const item of obj) collectPrimitiveRefs(item, out);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === "primitive-node-ref") {
      out.push({ value: String(v ?? ""), holder: obj });
    } else {
      collectPrimitiveRefs(v, out);
    }
  }
  return out;
}

function validatePrimitiveRefs(label, refs, nodeIds) {
  for (const ref of refs) {
    if (ref.value === "none") {
      if (!ref.holder["primitive-node-ref-reason"]) {
        fail(`spec-linkage[${label}]: primitive-node-ref=none 但缺 primitive-node-ref-reason`);
      }
      continue;
    }
    if (!nodeIds.has(ref.value)) {
      fail(`spec-linkage[${label}]: primitive-node-ref '${ref.value}' 不存在于 mechanics[].node`);
    }
  }
}

function validateEventLabels(label, events, allowedEvents, allowExternal) {
  const list = Array.isArray(events) ? events : [events].filter(Boolean);
  for (const ev of list) {
    const name = typeof ev === "string" ? ev : ev?.event || ev?.type;
    if (!name) continue;
    if (allowExternal && /^(input|ui|pointer|keyboard)\./.test(name)) continue;
    if ([...allowedEvents].some(allowed => eventMatches(allowed, name))) continue;
    fail(`spec-linkage[${label}]: event '${name}' 未来自 mechanics emitted/trigger/external-events`);
  }
}


/**
 * 跑一条 scenario。我们把 primitive 组装成一个 orchestrator：
 *   - 每 tick 给所有 motion 原语发 {type:'tick', dt}
 *   - motion 产生的事件（如 enter-segment）触发 trigger-on 匹配的下游 node（如 ray-cast.query）
 *   - 事件流转用 BFS 扩展
 *   - 每步后跑 win-lose-check 的 evaluate
 *
 * 关键契约（P1-2 + P1-extra）：
 *   - orchestrator 不感知任何 primitive 细节；构造 action 与写回 state 都走 reducer
 *     的 `resolveAction(node, ev, state)` / `applyEffects(node, ev, result, state)` 钩子
 *   - history 里保留 reducer.step() 返回的**完整结构**（含 source/resolvedDirection/
 *     targetsSnapshot/returnedHits 等 reducer 契约字段），不做裁剪，让 checkInvariants
 *     能拿到同一份字段重算
 */
function runScenario(mech, sc, reducers) {
  const state = buildInitialState(mech, sc);
  // history 以 node.node 为 key（同一 primitive 可能有多个 node 实例，不能混）
  const histories = new Map();
  const pushHist = (nodeId, snap) => {
    if (!histories.has(nodeId)) histories.set(nodeId, []);
    histories.get(nodeId).push(snap);
  };

  const maxTicks = sc["max-ticks"] || 300;
  const dt = 1 / 60; // 60fps 离散
  let outcome = null;
  const initialEvents = (sc["initial-events"] || []).map(ev =>
    typeof ev === "string" ? { type: ev } : ev
  ).filter(ev => ev?.type);

  for (let tick = 0; tick < maxTicks && !outcome; tick++) {
    const eventBus = tick === 0 ? initialEvents.map(ev => ({ ev, node: null })) : [];

    // 1. 对所有 motion 节点发 tick
    for (const node of mech.mechanics) {
      const red = reducers.get(node.primitive);
      if (!red || !red.handles?.includes("tick")) continue;
      for (const ent of state.entities[node["applies-to"]] || []) {
        if (!ent.alive) continue;
        const next = red.step(ent, { type: "tick", dt }, node.params || {});
        Object.assign(ent, next);
        pushHist(node.node, shallow(ent));
        for (const ev of next._events || []) eventBus.push({ ev, node });
      }
    }

    // 2. 事件驱动原语（trigger-on）
    let iter = 0;
    while (eventBus.length && iter++ < 100) {
      const { ev } = eventBus.shift();
      for (const node of mech.mechanics) {
        if (!(node["trigger-on"] || []).some(trigger => triggerMatches(trigger, ev.type))) continue;
        const red = reducers.get(node.primitive);
        if (!red) continue;
        // 通过 reducer 钩子生成 action；reducer 未提供钩子则 skip
        // （P1-extra：禁止在 orchestrator 里硬编码 primitive id）
        if (typeof red.resolveAction !== "function") continue;
        const action = red.resolveAction(node, ev, state);
        if (!action) continue;
        const result = red.step(state, action, node.params || {});
        // P1-2：history 保留 reducer.step() 完整返回，不与 action 混合，
        // 以保证 reducer.checkInvariants 能拿到它自己声明的契约字段
        pushHist(node.node, shallow(result));
        // result._events 继续投入总线，同时让 reducer 自己施加副作用
        for (const newEv of result._events || []) {
          eventBus.push({ ev: newEv, node });
          if (typeof red.applyEffects === "function") {
            red.applyEffects(node, newEv, result, state);
          }
        }
      }
    }

    // 3. 每 tick 评估 win-lose
    for (const node of mech.mechanics) {
      if (node.primitive !== "win-lose-check@v1") continue;
      const red = reducers.get(node.primitive);
      const ctx = buildWinCtx(state, tick, dt);
      const s = red.step(state.winLose || {}, { type: "evaluate", ctx }, node.params || {});
      state.winLose = s;
      pushHist(node.node, shallow({ ...s, outcome: s.outcome }));
      if (s.outcome && !outcome) outcome = s.outcome;
    }
  }

  return { outcome, histories, ticks: maxTicks };
}

function buildInitialState(mech, sc) {
  const state = { entities: {}, collections: {}, fields: {}, winLose: {} };
  for (const [name, list] of Object.entries(sc.setup || {})) {
    // setup 段的 key 是 collection 名（pigs/blocks/...），转成单数的 entity id 只为便于 apply
    // 我们同时按集合与 entity 类型做索引。
    state.collections[name] = list.map(item => ({ ...item }));
    // 同时把 "pigs"→"pig" 这种映射做一下（简单 s 去尾）
    const entityType = name.endsWith("s") ? name.slice(0, -1) : name;
    state.entities[entityType] = state.collections[name];
  }
  return state;
}

function buildWinCtx(state, tick, dt) {
  return {
    collections: state.collections,
    fields: state.fields,
    elapsedMs: tick * dt * 1000,
  };
}

function shallow(obj) {
  // structuredClone 支持同一对象在多处引用（按 DAG 复制而非去重），
  // 但对真正循环引用会抛；reducer 侧约定返回值无循环。
  if (obj == null) return obj;
  try {
    return structuredClone(_stripEvents(obj));
  } catch {
    // 回退：跳过循环
    const seen = new WeakSet();
    return JSON.parse(JSON.stringify(obj, (k, v) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return undefined;
        seen.add(v);
      }
      return v;
    }));
  }
}
// 事件列表里可能含反向引用 reducer-produced state，对 history 快照一般不需要；
// 我们保留 _events（上面已让 reducer 返回独立副本），只过滤 agent 里潜在的 event 字段。
function _stripEvents(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(_stripEvents);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "_events" && Array.isArray(v)) {
      out[k] = v.map(ev => {
        const { ...rest } = ev || {};
        return rest;
      });
    } else {
      out[k] = v;
    }
  }
  return out;
}

function finish(code = 0) {
  const status = errors.length === 0 ? "pass" : "fail";
  console.log(`Mechanic check: ${status} (errors=${errors.length}, warnings=${warnings.length})`);
  log?.entry?.({ kind: "check_mechanics", status, errors, warnings });
  process.exit(code);
}
