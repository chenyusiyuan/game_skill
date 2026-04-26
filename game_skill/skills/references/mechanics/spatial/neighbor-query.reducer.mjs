// neighbor-query reducer
export const id = 'neighbor-query';
export const version = 'v1';
export const handles = ['query'];
export const emittedEvents = ['neighbor.found', 'neighbor.empty'];

export function resolveAction(node, ev, state) {
  const center = ev.agent || ev.source || ev.center;
  if (!center) return null;
  const targetsRef = node.params?.targets?.from;
  const targets = (state.collections && state.collections[targetsRef]) || [];
  return { type: 'query', center, targets };
}

export function applyEffects(_node, _ev, _result, _state) {
  return;
}

function neighbors(shape, row, col, radius) {
  const out = [];
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      if (dr === 0 && dc === 0) continue;
      if (shape === 'four' && Math.abs(dr) + Math.abs(dc) > radius) continue;
      if (shape === 'eight' && (Math.abs(dr) > radius || Math.abs(dc) > radius)) continue;
      if (shape === 'hex' && Math.abs(dr) + Math.abs(dc) + Math.abs(dr + dc) > 2 * radius) continue;
      out.push({ row: row + dr, col: col + dc });
    }
  }
  return out;
}

export function step(state, action, params) {
  if (action.type !== 'query') return state;
  const { center, targets = [] } = action;
  const radius = params.radius ?? 1;
  const coords = neighbors(params.shape || 'four', center.row, center.col, radius);
  const hits = targets.filter(t => t.alive && coords.some(co => co.row === t.row && co.col === t.col));
  const events = hits.length
    ? [{ type: 'neighbor.found', center, neighbors: hits }]
    : [{ type: 'neighbor.empty', center }];
  return { ...state, _events: events };
}

export function checkInvariants(history, params) {
  const violations = [];
  for (const rec of history || []) {
    if (!rec.center || !rec.returned) continue;
    for (const n of rec.returned) {
      if (n.row === rec.center.row && n.col === rec.center.col) violations.push(`symmetry: center returned as neighbor`);
      if (n.alive === false) violations.push(`alive-only: dead neighbor returned id=${n.id}`);
      const chebyshev = Math.max(Math.abs(n.row - rec.center.row), Math.abs(n.col - rec.center.col));
      if (chebyshev > (params.radius ?? 1)) violations.push(`radius-correctness: chebyshev=${chebyshev} > ${params.radius}`);
    }
  }
  return { ok: violations.length === 0, violations };
}
