/**
 * resource-consume.runtime.mjs — 浏览器 runtime wrapper for resource-consume@v1
 *
 * 业务代码调：
 *   import { consumeResource } from '../_common/primitives/resource-consume.runtime.mjs';
 *   const result = consumeResource({
 *     rule: 'attack-consume',
 *     node: 'attack-consume',
 *     agent: pig, target: block,
 *     params: { 'agent-field': 'pig.ammo', 'target-field': 'block.durability', amount: 1 },
 *   });
 *   Object.assign(pig, result.agent);
 *   Object.assign(block, result.target);
 *
 * runtime 返回 { agent, target, events }；自动推 trace。
 */

import { step as rcStep } from "../mechanics/logic/resource-consume.reducer.mjs";
import { pushTraceEvent, snapshot } from "./_trace.mjs";

export function consumeResource(ctx) {
  const { rule, node = null, agent, target, params = {} } = ctx;
  if (!agent || !target) return { agent, target, events: [] };

  const before = {
    agent: snapshot(agent),
    target: snapshot(target),
    agentField: params["agent-field"] ?? null,
    targetField: params["target-field"] ?? null,
    amount: params.amount ?? 1,
  };
  const result = rcStep({}, { type: "consume", agent, target }, params);
  const events = result._events ?? [];

  pushTraceEvent({
    primitive: "resource-consume@v1",
    rule,
    node,
    before,
    after: {
      agent: snapshot(result.agent),
      target: snapshot(result.target),
      events,
    },
  });

  return { agent: result.agent, target: result.target, events };
}
