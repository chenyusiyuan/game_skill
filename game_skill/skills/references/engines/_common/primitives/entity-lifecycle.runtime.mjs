/**
 * entity-lifecycle.runtime.mjs — 浏览器 runtime wrapper for entity-lifecycle@v1
 *
 * 业务代码：
 *   import { transitionLifecycle } from '../_common/primitives/index.mjs';
 *   const r = transitionLifecycle({
 *     rule: 'pig-exhausted', node: 'pig-return',
 *     entity: pig,
 *     event: 'exhausted',
 *     params: pigLifecycleParams,
 *   });
 *   if (r.changed) Object.assign(pig, r.entity);
 */

import { step as lifeStep } from "../../../mechanics/lifecycle/entity-lifecycle.reducer.mjs";
import { pushTraceEvent, snapshot } from "./_trace.mjs";

export function transitionLifecycle(ctx) {
  const { rule, node = null, entity, event, params = {} } = ctx;
  const before = { entity: snapshot(entity), event };
  const next = lifeStep({ entity }, { type: "transition", entityId: entity?.id, event }, params);
  const events = next._events ?? [];
  const entered = events.find((e) => e.type === "lifecycle.entered");
  const invalid = events.find((e) => e.type === "lifecycle.invalid-transition");
  pushTraceEvent({
    primitive: "entity-lifecycle@v1",
    rule,
    node,
    before,
    after: {
      entity: snapshot(next.entity),
      from: before.entity?.lifecycle ?? null,
      to: next.entity?.lifecycle ?? null,
      changed: Boolean(entered),
      invalid: Boolean(invalid),
      events,
    },
  });
  return {
    entity: next.entity,
    from: before.entity?.lifecycle ?? null,
    to: next.entity?.lifecycle ?? null,
    changed: Boolean(entered),
    invalid: Boolean(invalid),
    events,
  };
}
