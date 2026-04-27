/**
 * cooldown-dispatch.runtime.mjs — 浏览器 runtime wrapper for cooldown-dispatch@v1
 *
 * 业务代码：
 *   import { requestDispatch } from '../_common/primitives/index.mjs';
 *   function onClickDispatchPig() {
 *     const r = requestDispatch({
 *       rule: 'dispatch-pig', node: 'input-gate',
 *       dispatcher: state.dispatcher,
 *       downstream: { kind: 'lifecycle-event', event: 'dispatched', entityId: nextPig.id },
 *       params: dispatchParams,
 *     });
 *     state.dispatcher = r.dispatcher;
 *     if (r.fired) proceedWithDispatch(r.downstream);
 *   }
 */

import { step as cdStep } from "../mechanics/lifecycle/cooldown-dispatch.reducer.mjs";
import { pushTraceEvent, snapshot, now as defaultNow } from "./_trace.mjs";

export function requestDispatch(ctx) {
  const {
    rule,
    node = null,
    dispatcher,
    downstream,
    params = {},
    now: clock,
  } = ctx;
  const at = Number.isFinite(clock) ? clock : defaultNow();
  const before = { dispatcher: snapshot(dispatcher), downstream, now: at };
  const next = cdStep(
    { dispatcher },
    { type: "request", now: at, downstream, dispatcherId: dispatcher?.id },
    params,
  );
  const events = next._events ?? [];
  const fired = events.some((e) => e.type === "dispatch.fired");
  const rejectedCooldown = events.some((e) => e.type === "dispatch.rejected-cooldown");
  const rejectedForbidden = events.some((e) => e.type === "dispatch.rejected-forbidden");
  pushTraceEvent({
    primitive: "cooldown-dispatch@v1",
    rule,
    node,
    before,
    after: {
      dispatcher: snapshot(next.dispatcher),
      fired,
      rejectedCooldown,
      rejectedForbidden,
      events,
    },
  });
  return {
    dispatcher: next.dispatcher,
    fired,
    rejectedCooldown,
    rejectedForbidden,
    downstream: fired ? downstream : null,
    events,
  };
}
