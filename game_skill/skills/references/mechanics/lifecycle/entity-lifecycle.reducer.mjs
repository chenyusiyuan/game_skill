// entity-lifecycle reducer
export const id = "entity-lifecycle";
export const version = "v1";
export const handles = ["transition"];
export const emittedEvents = ["lifecycle.entered", "lifecycle.invalid-transition"];

export const STATES = Object.freeze(["waiting", "active", "returning", "dead"]);

export function resolveAction(_node, ev, _state) {
  if (ev?.type === "lifecycle.event" && ev.entityId && ev.event) {
    return { type: "transition", entityId: ev.entityId, event: ev.event };
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
 * state shape (scoped to one entity):
 *   { entity: { id, lifecycle, ... } }
 * transition action modifies only `lifecycle`. Other fields untouched.
 */
export function step(state, action, params = {}) {
  if (action.type !== "transition") return state;
  const entity = state.entity;
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
  const nextEntity = { ...entity, lifecycle: t.to };
  return {
    ...state,
    entity: nextEntity,
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
