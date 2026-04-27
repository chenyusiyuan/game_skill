/**
 * capacity-gate.runtime.mjs — 浏览器 runtime wrapper for capacity-gate@v1
 *
 * 业务代码：
 *   import { requestCapacity, releaseCapacity } from '../_common/primitives/index.mjs';
 *   const r = requestCapacity({
 *     rule: 'dispatch-pig', node: 'capacity-check',
 *     gate: state.gate, entityId: pig.id,
 *     params: gateParams,
 *   });
 *   if (!r.admitted) return; // blocked
 *   state.gate = r.gate;
 */

import { step as gateStep } from "../mechanics/lifecycle/capacity-gate.reducer.mjs";
import { pushTraceEvent, snapshot } from "./_trace.mjs";

function runStep(ctx, type) {
  const { rule, node = null, gate, entityId, params = {} } = ctx;
  const before = { gate: snapshot(gate), entityId };
  const next = gateStep({ gate }, { type, entityId }, params);
  const events = next._events ?? [];
  const admitted = events.some((e) => e.type === "capacity.admitted");
  const blocked = events.some((e) => e.type === "capacity.blocked");
  const released = events.some((e) => e.type === "capacity.released");
  pushTraceEvent({
    primitive: "capacity-gate@v1",
    rule,
    node,
    before,
    after: { gate: snapshot(next.gate), events, admitted, blocked, released },
  });
  return { gate: next.gate, admitted, blocked, released, events };
}

export function requestCapacity(ctx) {
  return runStep(ctx, "request");
}

export function releaseCapacity(ctx) {
  return runStep(ctx, "release");
}
