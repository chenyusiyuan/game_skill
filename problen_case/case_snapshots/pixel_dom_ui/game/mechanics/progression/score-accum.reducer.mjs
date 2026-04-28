// score-accum reducer
export const id = 'score-accum';
export const version = 'v1';
export const handles = ['event'];
export const emittedEvents = ['score.updated'];

export function resolveAction(_node, ev, _state) {
  return { type: 'event', event: ev.type };
}

export function applyEffects(node, _ev, result, state) {
  state.fields = state.fields || {};
  const field = node.params?.['score-field'] || 'game.score';
  state.fields[field] = result.score || 0;
}

export function step(state, action, params) {
  if (action.type !== 'event') return state;
  const matched = (params.rules || []).filter(r => r.on === action.event);
  if (matched.length === 0) return state;
  const delta = matched.reduce((s, r) => s + (r.delta ?? 0), 0);
  const next = (state.score || 0) + delta;
  return { ...state, score: next, _events: [{ type: 'score.updated', score: next, delta }] };
}

export function checkInvariants(history, params) {
  const violations = [];
  for (let i = 1; i < (history || []).length; i++) {
    const prev = history[i - 1].score || 0;
    const curr = history[i].score || 0;
    const allNonNeg = (params.rules || []).every(r => (r.delta ?? 0) >= 0);
    if (allNonNeg && curr < prev) violations.push(`monotone-nondecreasing: score went ${prev}->${curr}`);
  }
  return { ok: violations.length === 0, violations };
}
