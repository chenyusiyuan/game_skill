/**
 * slot-pool.runtime.mjs — 浏览器 runtime wrapper for slot-pool@v1
 *
 * 业务代码调：
 *   import { bindSlot, unbindSlot } from '../_common/primitives/index.mjs';
 *   const next = bindSlot({
 *     rule: 'pig-return', node: 'return-to-slot',
 *     pool: state.pool,
 *     occupantId: pig.id,
 *     params: slotParams,
 *   });
 *   state.pool = next.pool;
 */

import { step as slotStep } from "../mechanics/lifecycle/slot-pool.reducer.mjs";
import { pushTraceEvent, snapshot } from "./_trace.mjs";

function runStep(ctx, type) {
  const { rule, node = null, pool, occupantId, slotId, params = {} } = ctx;
  const before = { pool: snapshot(pool) };
  const next = slotStep(
    { pool },
    { type, occupantId, slotId },
    params,
  );
  const events = next._events ?? [];
  pushTraceEvent({
    primitive: "slot-pool@v1",
    rule,
    node,
    before,
    after: { pool: snapshot(next.pool), events },
  });
  return { pool: next.pool, events };
}

export function bindSlot(ctx) {
  return runStep(ctx, "bind");
}

export function unbindSlot(ctx) {
  return runStep(ctx, "unbind");
}
