/**
 * ray-cast.runtime.mjs — 浏览器 runtime wrapper for ray-cast@v1
 *
 * 关系：
 *   references/mechanics/spatial/ray-cast.reducer.mjs  — 纯函数语义（reducer；Node 和 browser 通用）
 *   这个文件                                             — runtime：薄 wrapper，帮业务代码
 *     (1) 自动 push window.__trace 结构化事件（before/after）；
 *     (2) 复用 reducer 的 castGrid，确保跑 check_mechanics 和跑真实浏览器语义等价；
 *     (3) 在 browser 环境拦掉 reducer 可能依赖的 Node-only 路径（当前 ray-cast 无此问题，
 *         其它 primitive 若有，再按需拆）。
 *
 * 业务代码只需：
 *   import { rayCastGridFirstHit } from '../_common/primitives/ray-cast.runtime.mjs';
 *   const hit = rayCastGridFirstHit({
 *     rule: 'attack-consume', node: 'attack-consume',
 *     source: pig, targets: state.blocks, direction: {dx: 0, dy: 1},
 *     params: { 'coord-system': 'grid', 'stop-on': 'first-hit' },
 *   });
 */

import { castGrid } from "../mechanics/spatial/ray-cast.reducer.mjs";
import { pushTraceEvent, snapshot } from "./_trace.mjs";

/** 把 source 的 grid 位置归一成 {row, col}；接受 source.gridPosition 或 source 自身。 */
function pickGridPoint(src) {
  const p = src?.gridPosition || src?.position || src;
  if (!p || !Number.isFinite(p.row) || !Number.isFinite(p.col)) return null;
  return { row: p.row, col: p.col };
}

/**
 * 在 grid 模式下从 source 沿 direction 射出一条射线。
 * 自动 push 一条 trace 事件。
 */
export function rayCastGrid(ctx) {
  const {
    rule,
    node = null,
    source,
    targets = [],
    direction,
    params = { "coord-system": "grid", "stop-on": "first-hit" },
  } = ctx;

  const sourceGrid = pickGridPoint(source);
  if (!sourceGrid) return params["stop-on"] === "all-hits" ? [] : null;

  const hits = castGrid(sourceGrid, direction, targets, params);
  const returnedHits = hits.map((h) => ({ ...h.target }));

  pushTraceEvent({
    primitive: "ray-cast@v1",
    rule,
    node,
    before: {
      source: snapshot(source),
      targetsSnapshot: targets.map(snapshot),
      resolvedDirection: { ...direction },
    },
    after: { returnedHits },
  });

  if (params["stop-on"] === "all-hits") return returnedHits;
  return returnedHits[0] ?? null;
}

/** 便捷：只要首个命中（== rayCastGrid + stop-on: first-hit）。 */
export function rayCastGridFirstHit(ctx) {
  return rayCastGrid({
    ...ctx,
    params: { ...(ctx.params ?? {}), "coord-system": "grid", "stop-on": "first-hit" },
  });
}
