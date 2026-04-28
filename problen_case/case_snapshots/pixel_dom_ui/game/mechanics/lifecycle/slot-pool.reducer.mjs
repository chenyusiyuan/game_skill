// slot-pool reducer
export const id = "slot-pool";
export const version = "v1";
export const handles = ["bind", "unbind"];
export const emittedEvents = ["pool.bound", "pool.unbound", "pool.overflow"];

export function resolveAction(_node, ev, _state) {
  if (ev?.type === "pool.request-bind") {
    return { type: "bind", occupantId: ev.occupantId };
  }
  if (ev?.type === "pool.request-unbind") {
    return { type: "unbind", occupantId: ev.occupantId, slotId: ev.slotId };
  }
  return null;
}

export function applyEffects(_node, _ev, _result, _state) {
  // pool 是自包含的：step 返回的新 state 已经是权威。
}

/**
 * Pool state shape:
 *   state.pool = {
 *     capacity: number,
 *     slots: [{ id, occupantId }]
 *   }
 */
function cloneSlots(slots) {
  return (slots || []).map((s) => ({ id: s.id, occupantId: s.occupantId ?? null }));
}

function initPool(state, params) {
  if (state.pool && Array.isArray(state.pool.slots)) {
    return { ...state.pool, slots: cloneSlots(state.pool.slots) };
  }
  const ids = Array.isArray(params["slot-ids"]) && params["slot-ids"].length > 0
    ? params["slot-ids"]
    : Array.from({ length: params.capacity ?? 0 }, (_, i) => `slot-${i}`);
  return {
    capacity: params.capacity ?? ids.length,
    slots: ids.map((slotId) => ({ id: slotId, occupantId: null })),
  };
}

export function step(state, action, params = {}) {
  const pool = initPool(state, params);
  const nextSlots = cloneSlots(pool.slots);

  if (action.type === "bind") {
    const { occupantId } = action;
    if (!occupantId) return state;
    // already bound somewhere? idempotent no-op.
    if (nextSlots.some((s) => s.occupantId === occupantId)) {
      return { ...state, pool: { ...pool, slots: nextSlots }, _events: [] };
    }
    const empty = nextSlots.find((s) => s.occupantId === null);
    if (!empty) {
      return {
        ...state,
        pool: { ...pool, slots: nextSlots },
        _events: [{ type: "pool.overflow", occupantId }],
      };
    }
    empty.occupantId = occupantId;
    return {
      ...state,
      pool: { ...pool, slots: nextSlots },
      _events: [{ type: "pool.bound", occupantId, slotId: empty.id }],
    };
  }

  if (action.type === "unbind") {
    const { occupantId, slotId } = action;
    const slot = slotId
      ? nextSlots.find((s) => s.id === slotId)
      : nextSlots.find((s) => s.occupantId === occupantId);
    if (!slot || slot.occupantId === null) {
      return { ...state, pool: { ...pool, slots: nextSlots }, _events: [] };
    }
    const freedId = slot.occupantId;
    slot.occupantId = null;
    return {
      ...state,
      pool: { ...pool, slots: nextSlots },
      _events: [{ type: "pool.unbound", occupantId: freedId, slotId: slot.id }],
    };
  }

  return state;
}

export function checkInvariants(history, params) {
  const violations = [];
  const capacity = params?.capacity ?? Infinity;
  for (const rec of history || []) {
    const pool = rec.pool;
    if (!pool) continue;
    const occupied = pool.slots.filter((s) => s.occupantId !== null);
    if (occupied.length > capacity) {
      violations.push(`capacity-cap: occupied=${occupied.length} > capacity=${capacity}`);
    }
    const seen = new Set();
    for (const s of occupied) {
      if (seen.has(s.occupantId)) {
        violations.push(`unique-occupancy: ${s.occupantId} bound to multiple slots`);
      }
      seen.add(s.occupantId);
    }
  }
  return { ok: violations.length === 0, violations };
}
