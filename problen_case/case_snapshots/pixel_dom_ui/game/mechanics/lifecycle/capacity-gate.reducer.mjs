// capacity-gate reducer
export const id = "capacity-gate";
export const version = "v1";
export const handles = ["request", "release"];
export const emittedEvents = ["capacity.admitted", "capacity.blocked", "capacity.released"];

export function resolveAction(_node, ev, _state) {
  if (ev?.type === "capacity.request") return { type: "request", entityId: ev.entityId };
  if (ev?.type === "capacity.release") return { type: "release", entityId: ev.entityId };
  return null;
}

export function applyEffects(_node, _ev, _result, _state) {
  // self-contained
}

function cloneGate(gate, params) {
  const capacity = gate?.capacity ?? params?.capacity ?? Infinity;
  const active = Array.isArray(gate?.active) ? gate.active.slice() : [];
  return { capacity, active };
}

export function step(state, action, params = {}) {
  const gate = cloneGate(state.gate, params);
  const next = { ...gate };

  if (action.type === "request") {
    const { entityId } = action;
    if (!entityId) return state;
    if (next.active.includes(entityId)) {
      // idempotent admit
      return { ...state, gate: next, _events: [] };
    }
    if (next.active.length >= next.capacity) {
      return {
        ...state,
        gate: next,
        _events: [{ type: "capacity.blocked", entityId }],
      };
    }
    next.active = [...next.active, entityId];
    return {
      ...state,
      gate: next,
      _events: [{ type: "capacity.admitted", entityId }],
    };
  }

  if (action.type === "release") {
    const { entityId } = action;
    if (!entityId) return state;
    if (!next.active.includes(entityId)) {
      return { ...state, gate: next, _events: [] };
    }
    next.active = next.active.filter((id) => id !== entityId);
    return {
      ...state,
      gate: next,
      _events: [{ type: "capacity.released", entityId }],
    };
  }

  return state;
}

export function checkInvariants(history, params) {
  const violations = [];
  const capacity = params?.capacity ?? Infinity;
  let pendingRequest = null;
  for (const rec of history || []) {
    const gate = rec.gate;
    if (gate && gate.active && gate.active.length > capacity) {
      violations.push(`capacity-cap: active=${gate.active.length} > capacity=${capacity}`);
    }
    if (gate && Array.isArray(gate.active)) {
      const seen = new Set();
      for (const id of gate.active) {
        if (seen.has(id)) {
          violations.push(`membership-uniqueness: ${id} appears twice in active`);
        }
        seen.add(id);
      }
    }
    const events = rec._events || [];
    for (const e of events) {
      if (e.type === "capacity.blocked" && pendingRequest) {
        pendingRequest = null;
      }
    }
  }
  return { ok: violations.length === 0, violations };
}
