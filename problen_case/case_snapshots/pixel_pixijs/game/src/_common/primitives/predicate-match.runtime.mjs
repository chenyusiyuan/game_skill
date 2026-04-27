/**
 * predicate-match.runtime.mjs — 浏览器 runtime wrapper for predicate-match@v1
 *
 * 业务代码调：
 *   import { predicateMatch } from '../_common/primitives/predicate-match.runtime.mjs';
 *   const ok = predicateMatch({
 *     rule: 'color-match',
 *     node: 'attack-gate',
 *     left: pig, right: block,
 *     params: { fields: ['color'], op: 'eq' },
 *   });
 *
 * 返回 true/false（是否全部 fields 匹配）。自动 push 一条 trace。
 */

import { step as pmStep } from "../mechanics/logic/predicate-match.reducer.mjs";
import { pushTraceEvent, snapshot } from "./_trace.mjs";

export function predicateMatch(ctx) {
  const { rule, node = null, left, right, params = {} } = ctx;
  if (!left || !right) return false;

  const result = pmStep({}, { type: "evaluate", left, right }, params);
  const matched = Boolean(result.matched);

  pushTraceEvent({
    primitive: "predicate-match@v1",
    rule,
    node,
    before: { left: snapshot(left), right: snapshot(right), fields: params.fields ?? [], op: params.op ?? "eq" },
    after: { matched, events: result._events ?? [] },
  });

  return matched;
}
