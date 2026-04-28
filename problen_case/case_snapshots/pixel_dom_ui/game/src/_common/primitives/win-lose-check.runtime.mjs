/**
 * win-lose-check.runtime.mjs — 浏览器 runtime wrapper for win-lose-check@v1
 *
 * 业务代码调：
 *   import { checkWinLose } from '../_common/primitives/win-lose-check.runtime.mjs';
 *   const verdict = checkWinLose({
 *     rule: 'check-outcome', node: 'outcome',
 *     state: { aliveBlocks: state.blocks.filter(b => b.alive).length,
 *              pigAmmo: state.pigs.reduce((s,p) => s + p.ammo, 0) },
 *     params: winLoseParams,
 *   });
 *   if (verdict === 'win') ...
 */

import { step as wlStep } from "../../../mechanics/progression/win-lose-check.reducer.mjs";
import { pushTraceEvent, snapshot } from "./_trace.mjs";

export function checkWinLose(ctx) {
  const { rule, node = null, state, params = {} } = ctx;
  const before = snapshot(state);
  const result = wlStep(before, { type: "evaluate", ctx: before }, params);
  const verdict = result.verdict ?? result.outcome ?? null;
  pushTraceEvent({
    primitive: "win-lose-check@v1",
    rule,
    node,
    before,
    after: { verdict, events: result._events ?? [] },
  });
  return verdict;
}
