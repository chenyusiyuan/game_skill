// grid-step reducer
export const id = 'grid-step';
export const version = 'v1';
export const handles = ['move'];
export const emittedEvents = ['grid.moved', 'grid.blocked'];

const PRESETS = {
  'four-dir':  [{dr:-1,dc:0},{dr:1,dc:0},{dr:0,dc:-1},{dr:0,dc:1}],
  'eight-dir': [{dr:-1,dc:0},{dr:1,dc:0},{dr:0,dc:-1},{dr:0,dc:1},
                {dr:-1,dc:-1},{dr:-1,dc:1},{dr:1,dc:-1},{dr:1,dc:1}],
};

function resolveSteps(params) {
  return PRESETS[params['step-set']] || params.custom || PRESETS['four-dir'];
}

export function step(state, action, params) {
  if (action.type !== 'move') return state;
  const { dr, dc, nowMs, blockers = [] } = action;
  const cd = params['move-cooldown'] ?? 0;
  if ((nowMs - (state.lastMoveTick || 0)) < cd) {
    return { ...state, _events: [{ type: 'grid.blocked', reason: 'cooldown' }] };
  }
  const steps = resolveSteps(params);
  const valid = steps.some(s => s.dr === dr && s.dc === dc);
  if (!valid) return { ...state, _events: [{ type: 'grid.blocked', reason: 'invalid-step' }] };
  const nr = state.row + dr, nc = state.col + dc;
  const b = params.bounds || { rows: Infinity, cols: Infinity };
  if (nr < 0 || nr >= b.rows || nc < 0 || nc >= b.cols) {
    return { ...state, _events: [{ type: 'grid.blocked', reason: 'bounds' }] };
  }
  if (blockers.some(bk => bk.alive && bk.row === nr && bk.col === nc)) {
    return { ...state, _events: [{ type: 'grid.blocked', reason: 'blocker' }] };
  }
  return { ...state, row: nr, col: nc, lastMoveTick: nowMs, _events: [{ type: 'grid.moved', row: nr, col: nc }] };
}

export function checkInvariants(history, params) {
  const violations = [];
  const steps = resolveSteps(params);
  const b = params.bounds || { rows: Infinity, cols: Infinity };
  for (let i = 1; i < (history || []).length; i++) {
    const a = history[i - 1], c = history[i];
    const dr = c.row - a.row, dc = c.col - a.col;
    if (dr === 0 && dc === 0) continue;
    if (!steps.some(s => s.dr === dr && s.dc === dc)) violations.push(`step-validity: delta (${dr},${dc}) not in step-set`);
    if (c.row < 0 || c.row >= b.rows || c.col < 0 || c.col >= b.cols) violations.push(`bounds: (${c.row},${c.col}) out of bounds`);
    if ((c.lastMoveTick - a.lastMoveTick) < (params['move-cooldown'] ?? 0)) violations.push(`cooldown: interval too short`);
  }
  return { ok: violations.length === 0, violations };
}
