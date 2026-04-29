// win-lose-check reducer
export const id = 'win-lose-check';
export const version = 'v1';
export const handles = ['evaluate'];
export const emittedEvents = ['win', 'lose', 'settle'];

function evaluateClause(clause, ctx) {
  switch (clause.kind) {
    case 'all-cleared': {
      const col = ctx.collections?.[clause.collection] || [];
      return col.length > 0 && col.every(c => !c.alive);
    }
    case 'count-reaches': {
      const col = ctx.collections?.[clause.collection] || [];
      return col.filter(c => c.alive).length >= (clause.threshold ?? 0);
    }
    case 'count-falls-below': {
      const col = ctx.collections?.[clause.collection] || [];
      return col.filter(c => c.alive).length < (clause.threshold ?? 1);
    }
    case 'out-of-resource': {
      const val = ctx.fields?.[clause.field] ?? 0;
      return val <= (clause.threshold ?? 0);
    }
    case 'score-reaches': {
      const val = ctx.fields?.[clause.field] ?? 0;
      return val >= (clause.threshold ?? 0);
    }
    case 'time-up': {
      return (ctx.elapsedMs ?? 0) >= (clause.threshold ?? 0);
    }
    default: return false;
  }
}

export function step(state, action, params) {
  if (action.type !== 'evaluate') return state;
  const ctx = action.ctx || {};
  const winHit = (params.win  || []).some(c => evaluateClause(c, ctx));
  const loseHit = (params.lose || []).some(c => evaluateClause(c, ctx));
  const settleHit = (params.settle || []).some(c => evaluateClause(c, ctx));
  const events = [];
  if (winHit && !state.resolved)   events.push({ type: 'win' });
  if (loseHit && !state.resolved)  events.push({ type: 'lose' });
  if (settleHit && !state.resolved) events.push({ type: 'settle' });
  const outcome = loseHit ? 'lose' : (winHit ? 'win' : (settleHit ? 'settle' : null));
  return {
    ...state,
    resolved: state.resolved || winHit || loseHit || settleHit,
    outcome: state.outcome || outcome,
    _events: events,
  };
}

export function checkInvariants(history, params) {
  const violations = [];
  // mutually-exclusive：同一 tick 不能同时产出多个 terminal 事件
  for (const rec of history || []) {
    const events = rec._events || [];
    const terminalCount = events.filter(e => ['win', 'lose', 'settle'].includes(e.type)).length;
    if (terminalCount > 1) {
      violations.push(`mutually-exclusive: multiple terminal events in same tick`);
    }
  }
  // terminal：一旦 resolved 就不能再改 outcome
  let resolved = false;
  for (const rec of history || []) {
    if (resolved && rec.outcome && rec.outcome !== (history.find(h => h.resolved)?.outcome)) {
      violations.push(`terminal: outcome changed after resolution`);
    }
    if (rec.resolved) resolved = true;
  }
  // NOTE: "reachable / anyWin" 属于**跨 scenario** 的全局判定，
  // 由 orchestrator（check_mechanics.js 的 scenarios 循环末尾）负责，
  // reducer 只负责单条 history 的结构不变式。单独的 lose-scenario history 里
  // 当然没有 outcome==='win'，这是合法情况，不该被这里当成违规。
  return { ok: violations.length === 0, violations };
}
