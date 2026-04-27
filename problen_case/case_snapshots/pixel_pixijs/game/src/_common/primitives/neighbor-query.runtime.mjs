/**
 * neighbor-query.runtime.mjs — 浏览器 runtime wrapper for neighbor-query@v1
 *
 * 业务代码调：
 *   import { queryNeighbors } from '../_common/primitives/neighbor-query.runtime.mjs';
 *   const list = queryNeighbors({
 *     rule: 'cluster-match', node: 'find-neighbors',
 *     source: cell,
 *     targets: state.board,
 *     params: { adjacency: '4-way' },
 *   });
 */

import { step as nqStep } from "../mechanics/spatial/neighbor-query.reducer.mjs";
import { pushTraceEvent, snapshot } from "./_trace.mjs";

export function queryNeighbors(ctx) {
  const { rule, node = null, source, targets = [], params = {} } = ctx;
  if (!source) return [];
  const result = nqStep({}, { type: "query", source, targets }, params);
  const neighbors = Array.isArray(result.neighbors) ? result.neighbors : [];
  pushTraceEvent({
    primitive: "neighbor-query@v1",
    rule,
    node,
    before: { source: snapshot(source), targetsCount: targets.length, adjacency: params.adjacency ?? "4-way" },
    after: { neighbors: neighbors.map(snapshot), events: result._events ?? [] },
  });
  return neighbors;
}
