/**
 * grid-step.runtime.mjs — 浏览器 runtime wrapper for grid-step@v1
 *
 * 业务代码调：
 *   import { gridMove } from '../_common/primitives/grid-step.runtime.mjs';
 *   const next = gridMove({
 *     rule: 'player-move', node: 'player-input',
 *     agent: player,
 *     direction: { dx: 1, dy: 0 },
 *     blockers: state.walls,   // 可选，{row,col} 数组
 *     params: { bounds: { rows, cols } },
 *   });
 *   Object.assign(player, next);
 */

import { step as gsStep } from "../mechanics/motion/grid-step.reducer.mjs";
import { pushTraceEvent, snapshot } from "./_trace.mjs";

export function gridMove(ctx) {
  const { rule, node = null, agent, direction, blockers = [], params = {} } = ctx;
  if (!agent || !direction) return agent;
  const before = snapshot(agent);
  const result = gsStep(before, { type: "move", direction, blockers }, params);
  const after = { ...result };
  delete after._events;
  pushTraceEvent({
    primitive: "grid-step@v1",
    rule,
    node,
    before,
    after: { agent: after, events: result._events ?? [] },
  });
  return after;
}
