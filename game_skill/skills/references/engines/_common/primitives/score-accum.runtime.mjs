/**
 * score-accum.runtime.mjs — 浏览器 runtime wrapper for score-accum@v1
 *
 * 业务代码调：
 *   import { accumulateScore } from '../_common/primitives/score-accum.runtime.mjs';
 *   state.score = accumulateScore({
 *     rule: 'score-up', node: 'score-accum',
 *     currentScore: state.score,
 *     eventPayload: { type: 'block.destroyed', block },
 *     params: scoreParams,   // 含 rule table
 *   });
 */

import { step as scStep } from "../../../mechanics/progression/score-accum.reducer.mjs";
import { pushTraceEvent } from "./_trace.mjs";

export function accumulateScore(ctx) {
  const { rule, node = null, currentScore = 0, eventPayload, params = {} } = ctx;
  const before = { score: currentScore, event: eventPayload };
  const result = scStep({ score: currentScore }, { type: "event", event: eventPayload }, params);
  const nextScore = Number.isFinite(result.score) ? result.score : currentScore;
  pushTraceEvent({
    primitive: "score-accum@v1",
    rule,
    node,
    before,
    after: { score: nextScore, delta: nextScore - currentScore, events: result._events ?? [] },
  });
  return nextScore;
}
