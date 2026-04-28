// cooldown-dispatch reducer
export const id = "cooldown-dispatch";
export const version = "v1";
export const handles = ["request"];
export const emittedEvents = [
  "dispatch.fired",
  "dispatch.rejected-cooldown",
  "dispatch.rejected-forbidden",
];

const DEFAULT_FORBIDDEN = [
  "state.win-set",
  "state.lose-set",
  "state.score-set",
  "__trace.push",
];

export function resolveAction(_node, ev, _state) {
  if (ev?.type === "dispatch.request") {
    return {
      type: "request",
      now: ev.now,
      downstream: ev.downstream,
      dispatcherId: ev.dispatcherId,
    };
  }
  return null;
}

export function applyEffects(_node, _ev, _result, _state) {
  // self-contained
}

function matchAllowed(allowed, downstream) {
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.some((rule) => {
    if (!rule || !rule.kind) return false;
    if (rule.kind !== downstream.kind) return false;
    if (rule.event !== undefined && rule.event !== downstream.event) return false;
    return true;
  });
}

function matchForbidden(forbidden, downstream) {
  const list = Array.isArray(forbidden) && forbidden.length > 0 ? forbidden : DEFAULT_FORBIDDEN;
  return list.includes(downstream.kind);
}

export function step(state, action, params = {}) {
  if (action.type !== "request") return state;
  const dispatcher = state.dispatcher ?? { id: action.dispatcherId ?? "default", lastFiredAt: null };
  const cooldownMs = params["cooldown-ms"] ?? dispatcher.cooldownMs ?? 0;
  const now = Number.isFinite(action.now) ? action.now : 0;
  const downstream = action.downstream ?? null;

  if (!downstream || !downstream.kind) {
    return {
      ...state,
      _events: [{ type: "dispatch.rejected-forbidden", reason: "missing-downstream" }],
    };
  }

  if (matchForbidden(params["forbidden-kinds"], downstream)) {
    return {
      ...state,
      dispatcher: { ...dispatcher },
      _events: [{ type: "dispatch.rejected-forbidden", downstream, reason: "forbidden-kind" }],
    };
  }

  if (!matchAllowed(params["allowed-events"], downstream)) {
    return {
      ...state,
      dispatcher: { ...dispatcher },
      _events: [{ type: "dispatch.rejected-forbidden", downstream, reason: "not-whitelisted" }],
    };
  }

  if (dispatcher.lastFiredAt !== null && now - dispatcher.lastFiredAt < cooldownMs) {
    return {
      ...state,
      dispatcher: { ...dispatcher },
      _events: [
        {
          type: "dispatch.rejected-cooldown",
          remainingMs: cooldownMs - (now - dispatcher.lastFiredAt),
        },
      ],
    };
  }

  return {
    ...state,
    dispatcher: { ...dispatcher, lastFiredAt: now, cooldownMs },
    _events: [{ type: "dispatch.fired", at: now, downstream }],
  };
}

export function checkInvariants(history, params) {
  const violations = [];
  const cooldownMs = params?.["cooldown-ms"] ?? 0;
  const firings = [];
  for (const rec of history || []) {
    for (const e of rec._events || []) {
      if (e.type === "dispatch.fired") firings.push(e.at ?? 0);
      if (e.type === "dispatch.fired" && e.downstream) {
        if (DEFAULT_FORBIDDEN.includes(e.downstream.kind)) {
          violations.push(`forbidden-blacklist: downstream.kind=${e.downstream.kind}`);
        }
      }
    }
  }
  for (let i = 1; i < firings.length; i++) {
    if (firings[i] - firings[i - 1] < cooldownMs) {
      violations.push(`cooldown-respected: gap=${firings[i] - firings[i - 1]} < ${cooldownMs}`);
    }
  }
  return { ok: violations.length === 0, violations };
}
