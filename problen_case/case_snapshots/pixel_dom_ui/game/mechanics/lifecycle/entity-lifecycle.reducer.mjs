// entity-lifecycle reducer
export const id = "entity-lifecycle";
export const version = "v1";
export const handles = ["transition"];
export const emittedEvents = ["lifecycle.entered.*", "lifecycle.invalid-transition"];

export const STATES = Object.freeze(["waiting", "active", "returning", "dead"]);

export function resolveAction(node, ev, _state) {
  // Support lifecycle.event trigger
  if (ev?.type === "lifecycle.event" && ev.entityId && ev.event) {
    return { type: "transition", entityId: ev.entityId, event: ev.event };
  }
  // Support resource.agent-zero trigger (for exhaustion scenarios)
  // When agent runs out of resource, transition to dead state
  if (ev?.type === "resource.agent-zero" && node.params?.transition === "dead") {
    return { type: "transition", entityId: ev.agentId, event: "exhausted" };
  }
  // Support track.loop-complete trigger (for recycle scenarios)
  if (ev?.type === "track.loop-complete" && node.params?.transition === "returning") {
    return { type: "transition", entityId: ev.agent?.id, event: "returned" };
  }
  return null;
}

export function applyEffects(_node, _ev, _result, _state) {
  // self-contained
}

function findTransition(params, from, event) {
  const list = Array.isArray(params?.transitions) ? params.transitions : [];
  return list.find((t) => t.from === from && t.event === event) || null;
}

/**
 * state shape:
 *   - { entity: { id, lifecycle, ... } } for scoped entity
 *   - { collections: { pigs: [...], ... } } for global state with collections
 * transition action modifies only `lifecycle`. Other fields untouched.
 */
export function step(state, action, params = {}) {
  if (action.type !== "transition") return state;

  // Find entity either from state.entity or from state.collections
  let entity = state.entity;
  if (!entity && state.collections && action.entityId) {
    for (const list of Object.values(state.collections)) {
      const found = list.find(e => e.id === action.entityId);
      if (found) {
        entity = found;
        break;
      }
    }
  }

  if (!entity) return state;
  const from = entity.lifecycle ?? "waiting";
  if (from === "dead") {
    return {
      ...state,
      _events: [
        { type: "lifecycle.invalid-transition", entityId: entity.id, from, event: action.event, reason: "dead-is-terminal" },
      ],
    };
  }
  const t = findTransition(params, from, action.event);
  if (!t) {
    return {
      ...state,
      _events: [
        { type: "lifecycle.invalid-transition", entityId: entity.id, from, event: action.event },
      ],
    };
  }
  if (!STATES.includes(t.to)) {
    return {
      ...state,
      _events: [
        { type: "lifecycle.invalid-transition", entityId: entity.id, from, event: action.event, reason: `unknown-state:${t.to}` },
      ],
    };
  }

  // Update entity in place (for collections) or return new state
  entity.lifecycle = t.to;
  // Sync alive field with lifecycle: dead => alive=false
  if (t.to === "dead") {
    entity.alive = false;
  }

  return {
    ...state,
    entity: entity,
    _events: [{ type: "lifecycle.entered", entityId: entity.id, from, to: t.to }],
  };
}

export function checkInvariants(history, _params) {
  const violations = [];
  let sawDead = new Map();
  for (const rec of history || []) {
    const e = rec.entity;
    if (!e) continue;
    if (e.lifecycle && !STATES.includes(e.lifecycle)) {
      violations.push(`enum-state: ${e.id}.lifecycle=${e.lifecycle} ∉ ${STATES.join("|")}`);
    }
    if (sawDead.has(e.id) && e.lifecycle !== "dead") {
      violations.push(`dead-is-terminal: ${e.id} resurrected to ${e.lifecycle}`);
    }
    if (e.lifecycle === "dead") sawDead.set(e.id, true);
  }
  return { ok: violations.length === 0, violations };
}
