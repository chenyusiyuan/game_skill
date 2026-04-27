/**
 * fsm-transition.runtime.mjs — 浏览器 runtime wrapper for fsm-transition@v1
 *
 * 业务代码调：
 *   import { fireTrigger } from '../_common/primitives/fsm-transition.runtime.mjs';
 *   const nextState = fireTrigger({
 *     rule: 'phase-playing', node: 'phase-fsm',
 *     currentState: 'start',
 *     trigger: 'click-start',
 *     params: fsmParams,   // 含 states / transitions
 *   });
 */

import { step as fsmStep } from "../../../mechanics/logic/fsm-transition.reducer.mjs";
import { pushTraceEvent } from "./_trace.mjs";

export function fireTrigger(ctx) {
  const { rule, node = null, currentState, trigger, params = {} } = ctx;
  const result = fsmStep({ currentState }, { type: "trigger", trigger }, params);
  const events = result._events ?? [];
  pushTraceEvent({
    primitive: "fsm-transition@v1",
    rule,
    node,
    before: { currentState, trigger },
    after: { currentState: result.currentState ?? currentState, events },
  });
  return result.currentState ?? currentState;
}
