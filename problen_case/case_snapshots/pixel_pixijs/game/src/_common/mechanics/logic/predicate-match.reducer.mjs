// predicate-match reducer
export const id = 'predicate-match';
export const version = 'v1';
export const handles = ['evaluate'];
export const emittedEvents = ['match.hit', 'match.miss'];

/**
 * 从上游事件（通常是 ray.hit-candidate / neighbor.found）中挑 left/right。
 */
export function resolveAction(_node, ev, _state) {
  const left = ev.source || ev.agent;
  const right = (ev.targets && ev.targets[0])
    || (ev.neighbors && ev.neighbors[0])
    || ev.right
    || null;
  if (!left || !right) return null;
  return { type: 'evaluate', left, right };
}

export function applyEffects(_node, _ev, _result, _state) {
  return;
}

function compare(a, b, op) {
  switch (op) {
    case 'eq':  return a === b;
    case 'neq': return a !== b;
    case 'gt':  return a > b;
    case 'lt':  return a < b;
    case 'in':  return Array.isArray(b) && b.includes(a);
    default:    return false;
  }
}

export function step(state, action, params) {
  if (action.type !== 'evaluate') return state;
  const { left, right } = action;
  const fields = params.fields || [];
  const op = params.op || 'eq';
  let allMatch = true;
  for (const f of fields) {
    if (left[f] === undefined || right[f] === undefined) {
      return {
        ...state,
        left: { ...left },
        right: { ...right },
        matched: false,
        _events: [{ type: 'match.miss', reason: 'field-missing', field: f }],
      };
    }
    if (!compare(left[f], right[f], op)) { allMatch = false; break; }
  }
  return {
    ...state,
    left: { ...left },
    right: { ...right },
    matched: allMatch,
    _events: [{ type: allMatch ? 'match.hit' : 'match.miss', left, right }],
  };
}

export function checkInvariants(history, params) {
  const violations = [];
  for (const rec of history || []) {
    if (!rec || !rec.left || !rec.right) continue;
    const { left, right } = rec;
    for (const f of params.fields || []) {
      if (left[f] === undefined) violations.push(`fields-exist: left.${f} missing`);
      if (right[f] === undefined) violations.push(`fields-exist: right.${f} missing`);
    }
  }
  return { ok: violations.length === 0, violations };
}
