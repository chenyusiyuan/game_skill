/**
 * _trace.mjs — 所有 primitive runtime 共用的 trace 辅助
 *
 * 设计：
 *   - 浏览器环境把结构化事件 push 到 window.__trace
 *   - Node 环境静默 no-op（Node-side 单测导入 runtime 时不造成副作用）
 *   - 统一 trace schema，方便 check_runtime_semantics.js 按 primitive + node 分发复算
 *
 * 所有 runtime 在计算完 before/after 后统一调：
 *   pushTraceEvent({ primitive, rule, node, before, after });
 */

export function getTraceSink() {
  if (typeof window === "undefined") return null;
  if (!Array.isArray(window.__trace)) window.__trace = [];
  return window.__trace;
}

export function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function pushTraceEvent({ primitive, rule = null, node = null, before, after }) {
  const sink = getTraceSink();
  if (!sink) return;
  sink.push({ primitive, rule, node, t: now(), before, after });
}

/**
 * 浅 clone 帮助：基础属性 + 已知嵌套（position / gridPosition）
 * 所有 runtime 用统一的 clone 逻辑，保证 trace 快照不被后续 mutation 破坏。
 */
export function snapshot(obj) {
  if (obj == null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(snapshot);
  const out = { ...obj };
  if (obj.gridPosition) out.gridPosition = { ...obj.gridPosition };
  if (obj.position) out.position = { ...obj.position };
  return out;
}
