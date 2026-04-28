// fsm-transition reducer
export const id = 'fsm-transition';
export const version = 'v1';
export const handles = ['trigger'];
export const emittedEvents = ['fsm.invalid-trigger', 'fsm.exited-*', 'fsm.entered-*'];

export function resolveAction(node, ev, _state) {
  const map = node.params?.['event-trigger-map'] || {};
  const trigger = map[ev.type] || ev.trigger || ev.type;
  return { type: 'trigger', trigger };
}

export function step(state, action, params) {
  if (action.type !== 'trigger') return state;
  const cur = state.state || params.initial;
  const rule = (params.transitions || []).find(r => r.from === cur && r.on === action.trigger);
  if (!rule) return { ...state, _events: [{ type: 'fsm.invalid-trigger', from: cur, trigger: action.trigger }] };
  return {
    ...state,
    state: rule.to,
    _events: [
      { type: `fsm.exited-${cur}` },
      { type: `fsm.entered-${rule.to}` },
    ],
  };
}

export function checkInvariants(history, params) {
  const violations = [];
  const states = params.states || [];
  // closed
  for (const t of params.transitions || []) {
    if (!states.includes(t.from)) violations.push(`closed: transition from '${t.from}' not in states`);
    if (!states.includes(t.to))   violations.push(`closed: transition to '${t.to}' not in states`);
  }
  // deterministic
  const seen = new Set();
  for (const t of params.transitions || []) {
    const k = `${t.from}|${t.on}`;
    if (seen.has(k)) violations.push(`deterministic: duplicate transition for ${k}`);
    seen.add(k);
  }
  // reachability (BFS from initial)
  const adj = new Map();
  for (const t of params.transitions || []) {
    if (!adj.has(t.from)) adj.set(t.from, []);
    adj.get(t.from).push(t.to);
  }
  const visited = new Set([params.initial]);
  const q = [params.initial];
  while (q.length) {
    const s = q.shift();
    for (const n of adj.get(s) || []) if (!visited.has(n)) { visited.add(n); q.push(n); }
  }
  for (const s of states) if (!visited.has(s)) violations.push(`reachability: state '${s}' unreachable from initial`);
  return { ok: violations.length === 0, violations };
}
