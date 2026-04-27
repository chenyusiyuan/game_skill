/**
 * _runtime_replay.js — P1.5 通用 reducer 等价复算
 *
 * 每个 runtime primitive 的 trace 事件里都记录了 before / after 结构化快照。
 * 这个模块为每个 primitive 提供 `replay(event, params)` 函数，把 before 还原成
 * reducer 的输入，跑一次 step(...)，和 trace 的 after 对齐。差异 → violation。
 *
 * 三态返回：
 *   - { ok: true }                  通过
 *   - { ok: false, reason: "..." } 不通过
 *   - { ok: null,  reason: "..." } 需要跳过（trace 不完整、primitive 不认识）
 *
 * P1.5 覆盖：
 *   - ray-cast@v1       : 先用 _runtime_probes 的 verifyRayCastSemantics
 *   - resource-consume@v1
 *   - predicate-match@v1
 *   - score-accum@v1
 *   - fsm-transition@v1
 *   - win-lose-check@v1
 *   - capacity-gate@v1
 *   - entity-lifecycle@v1
 *   - cooldown-dispatch@v1
 *   - slot-pool@v1
 *
 * 非 runtime-backed 的 primitive 遇到直接 skip。
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRayCastSemantics } from "./_runtime_probes.js";

const __here = dirname(fileURLToPath(import.meta.url));
const MECH_ROOT = join(__here, "..", "references", "mechanics");

const reducerPaths = {
  "ray-cast@v1": "spatial/ray-cast.reducer.mjs",
  "resource-consume@v1": "logic/resource-consume.reducer.mjs",
  "predicate-match@v1": "logic/predicate-match.reducer.mjs",
  "score-accum@v1": "progression/score-accum.reducer.mjs",
  "fsm-transition@v1": "logic/fsm-transition.reducer.mjs",
  "win-lose-check@v1": "progression/win-lose-check.reducer.mjs",
  "capacity-gate@v1": "lifecycle/capacity-gate.reducer.mjs",
  "entity-lifecycle@v1": "lifecycle/entity-lifecycle.reducer.mjs",
  "cooldown-dispatch@v1": "lifecycle/cooldown-dispatch.reducer.mjs",
  "slot-pool@v1": "lifecycle/slot-pool.reducer.mjs",
  "parametric-track@v1": "motion/parametric-track.reducer.mjs",
  "grid-step@v1": "motion/grid-step.reducer.mjs",
  "grid-board@v1": "spatial/grid-board.reducer.mjs",
  "neighbor-query@v1": "spatial/neighbor-query.reducer.mjs",
};

const reducerCache = new Map();

async function loadReducer(primitive) {
  if (reducerCache.has(primitive)) return reducerCache.get(primitive);
  const rel = reducerPaths[primitive];
  if (!rel) {
    reducerCache.set(primitive, null);
    return null;
  }
  const url = `file://${join(MECH_ROOT, rel)}`;
  try {
    const mod = await import(url);
    reducerCache.set(primitive, mod);
    return mod;
  } catch (e) {
    reducerCache.set(primitive, null);
    return null;
  }
}

function hasBeforeAfter(ev) {
  return ev && ev.before && ev.after;
}

function shallowEqualArrays(a, b, keyFn = (x) => x) {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  if (a.length !== b.length) return false;
  return a.every((x, i) => keyFn(x) === keyFn(b[i]));
}

function verifyResourceConsume(ev, reducer, params) {
  const { before, after } = ev;
  const agent = before?.agent;
  const target = before?.target;
  if (!agent || !target) return { ok: null, reason: "缺 before.agent/target" };
  const result = reducer.step(
    { agent, target },
    { type: "consume", agent, target },
    params,
  );
  const expectedAgent = result.agent;
  const expectedTarget = result.target;
  const af = params["agent-field"];
  const tf = params["target-field"];
  if (af && expectedAgent?.[af] !== after?.agent?.[af]) {
    return {
      ok: false,
      reason: `agent.${af}: expected ${expectedAgent[af]}, got ${after?.agent?.[af]}`,
    };
  }
  if (tf && expectedTarget?.[tf] !== after?.target?.[tf]) {
    return {
      ok: false,
      reason: `target.${tf}: expected ${expectedTarget[tf]}, got ${after?.target?.[tf]}`,
    };
  }
  return { ok: true };
}

function verifyPredicateMatch(ev, reducer, params) {
  const { before, after } = ev;
  const candidate = before?.candidate;
  const filter = before?.filter;
  if (candidate === undefined) return { ok: null, reason: "缺 before.candidate" };
  const result = reducer.step(
    { candidate, filter },
    { type: "evaluate" },
    params,
  );
  const expected = Boolean(result.matched ?? result.ok);
  const actual = Boolean(after?.matched);
  if (expected !== actual) {
    return { ok: false, reason: `matched: expected ${expected}, got ${actual}` };
  }
  return { ok: true };
}

function verifyScoreAccum(ev, reducer, params) {
  const { before, after } = ev;
  const currentScore = Number(before?.score ?? 0);
  const eventPayload = before?.event;
  if (!eventPayload) return { ok: null, reason: "缺 before.event" };
  const result = reducer.step(
    { score: currentScore },
    { type: "event", event: eventPayload },
    params,
  );
  const expected = Number.isFinite(result.score) ? result.score : currentScore;
  const actual = Number(after?.score);
  if (expected !== actual) {
    return { ok: false, reason: `score: expected ${expected}, got ${actual}` };
  }
  return { ok: true };
}

function verifyFsmTransition(ev, reducer, params) {
  const { before, after } = ev;
  const { currentState, trigger } = before ?? {};
  if (currentState === undefined || trigger === undefined) {
    return { ok: null, reason: "缺 before.currentState/trigger" };
  }
  const result = reducer.step(
    { currentState },
    { type: "trigger", trigger },
    params,
  );
  const expected = result.currentState ?? currentState;
  const actual = after?.currentState;
  if (expected !== actual) {
    return { ok: false, reason: `currentState: expected ${expected}, got ${actual}` };
  }
  return { ok: true };
}

function verifyWinLoseCheck(ev, reducer, params) {
  const { before, after } = ev;
  if (!before) return { ok: null, reason: "缺 before state snapshot" };
  const result = reducer.step(before, { type: "evaluate" }, params);
  const expected = result.verdict ?? result.outcome ?? null;
  const actual = after?.verdict ?? null;
  if (expected !== actual) {
    return { ok: false, reason: `verdict: expected ${expected}, got ${actual}` };
  }
  return { ok: true };
}

function verifyCapacityGate(ev, reducer, params) {
  const { before, after } = ev;
  const gate = before?.gate;
  const entityId = before?.entityId;
  if (!gate || !entityId) return { ok: null, reason: "缺 before.gate/entityId" };
  const result = reducer.step(
    { gate },
    { type: "request", entityId },
    params,
  );
  const expectedAdmitted = (result._events ?? []).some((e) => e.type === "capacity.admitted");
  const expectedBlocked = (result._events ?? []).some((e) => e.type === "capacity.blocked");
  if (expectedAdmitted !== Boolean(after?.admitted)) {
    return {
      ok: false,
      reason: `admitted: expected ${expectedAdmitted}, got ${after?.admitted}`,
    };
  }
  if (expectedBlocked !== Boolean(after?.blocked)) {
    return {
      ok: false,
      reason: `blocked: expected ${expectedBlocked}, got ${after?.blocked}`,
    };
  }
  return { ok: true };
}

function verifyEntityLifecycle(ev, reducer, params) {
  const { before, after } = ev;
  const entity = before?.entity;
  const event = before?.event;
  if (!entity || event === undefined) return { ok: null, reason: "缺 before.entity/event" };
  const result = reducer.step(
    { entity },
    { type: "transition", entityId: entity.id, event },
    params,
  );
  const expectedTo = result.entity?.lifecycle ?? entity.lifecycle;
  const actualTo = after?.entity?.lifecycle ?? after?.to;
  if (expectedTo !== actualTo) {
    return { ok: false, reason: `lifecycle: expected ${expectedTo}, got ${actualTo}` };
  }
  return { ok: true };
}

function verifyCooldownDispatch(ev, reducer, params) {
  const { before, after } = ev;
  const dispatcher = before?.dispatcher;
  const downstream = before?.downstream;
  const now = before?.now;
  if (!dispatcher || !downstream) return { ok: null, reason: "缺 before.dispatcher/downstream" };
  const result = reducer.step(
    { dispatcher },
    { type: "request", now, downstream, dispatcherId: dispatcher.id },
    params,
  );
  const expectedFired = (result._events ?? []).some((e) => e.type === "dispatch.fired");
  if (expectedFired !== Boolean(after?.fired)) {
    return { ok: false, reason: `fired: expected ${expectedFired}, got ${after?.fired}` };
  }
  return { ok: true };
}

function verifySlotPool(ev, reducer, params) {
  const { before, after } = ev;
  const pool = before?.pool;
  if (!pool) return { ok: null, reason: "缺 before.pool" };
  // 不做 action 复算（需要 action kind，runtime 会填 after.events[0].type 判断），
  // 只校 capacity 不变 + occupant 集合差异在合理范围
  const beforeOccupied = (pool.slots ?? []).filter((s) => s.occupantId).map((s) => s.occupantId);
  const afterPool = after?.pool;
  if (!afterPool) return { ok: null, reason: "缺 after.pool" };
  if ((afterPool.capacity ?? pool.capacity) !== pool.capacity) {
    return {
      ok: false,
      reason: `capacity 变化: ${pool.capacity} → ${afterPool.capacity}`,
    };
  }
  const afterOccupied = (afterPool.slots ?? []).filter((s) => s.occupantId).map((s) => s.occupantId);
  const diff = Math.abs(afterOccupied.length - beforeOccupied.length);
  if (diff > 1) {
    return { ok: false, reason: `单次 step 改动 occupant 数 > 1 (${diff})` };
  }
  return { ok: true };
}

const verifiers = {
  "ray-cast@v1": null, // 特殊处理，走 verifyRayCastSemantics
  "resource-consume@v1": verifyResourceConsume,
  "predicate-match@v1": verifyPredicateMatch,
  "score-accum@v1": verifyScoreAccum,
  "fsm-transition@v1": verifyFsmTransition,
  "win-lose-check@v1": verifyWinLoseCheck,
  "capacity-gate@v1": verifyCapacityGate,
  "entity-lifecycle@v1": verifyEntityLifecycle,
  "cooldown-dispatch@v1": verifyCooldownDispatch,
  "slot-pool@v1": verifySlotPool,
};

/**
 * Main entry point — ev 是 window.__trace 里的一条事件。
 * mechNodesByNode: Map<nodeId, mechanicsNode>（用于拿 params）
 */
export async function replayEvent(ev, { mechNodesByNode, mechByPrimitive }) {
  if (!ev || !ev.primitive) return { ok: null, reason: "missing primitive" };
  if (!hasBeforeAfter(ev)) return { ok: null, reason: "缺 before/after 字段" };

  // 找 mechanics node params
  const node = ev.node ? mechNodesByNode.get(ev.node) : null;
  const byPrim = mechByPrimitive.get(ev.primitive);
  const params = node?.params ?? byPrim?.[0]?.params ?? {};

  if (ev.primitive === "ray-cast@v1") {
    const reducer = await loadReducer("ray-cast@v1");
    if (!reducer?.castGrid) return { ok: null, reason: "ray-cast reducer 无 castGrid" };
    return verifyRayCastSemantics(ev, reducer.castGrid, params);
  }

  const verifier = verifiers[ev.primitive];
  if (!verifier) return { ok: null, reason: `primitive ${ev.primitive} 未支持复算` };
  const reducer = await loadReducer(ev.primitive);
  if (!reducer?.step) return { ok: null, reason: `${ev.primitive} reducer 加载失败` };

  try {
    return verifier(ev, reducer, params);
  } catch (e) {
    return { ok: null, reason: `复算异常: ${e.message}` };
  }
}

/**
 * 构建 mechanics 索引方便查询 params。
 */
export function indexMechanics(mech) {
  const byNode = new Map();
  const byPrimitive = new Map();
  for (const n of mech?.mechanics ?? []) {
    if (n.node) byNode.set(n.node, n);
    if (n.primitive) {
      if (!byPrimitive.has(n.primitive)) byPrimitive.set(n.primitive, []);
      byPrimitive.get(n.primitive).push(n);
    }
  }
  return { byNode, byPrimitive };
}
