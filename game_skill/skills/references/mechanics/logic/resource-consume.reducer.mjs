// resource-consume reducer
export const id = 'resource-consume';
export const version = 'v1';
export const handles = ['consume'];
export const emittedEvents = ['resource.consumed', 'resource.agent-zero', 'resource.target-zero'];

/**
 * 触发事件通常为 match.hit，事件携带 left/right。
 */
export function resolveAction(_node, ev, _state) {
  const agent = ev.left || ev.agent;
  const target = ev.right || ev.target;
  if (!agent || !target) return null;
  return { type: 'consume', agent, target };
}

/**
 * 把消耗后的字段写回 state.collections，并响应归零事件：
 *   - resource.agent-zero  → agent.alive=false
 *   - resource.target-zero → target.alive=false
 */
export function applyEffects(_node, ev, result, state) {
  const agentId = result?.agent?.id;
  const targetId = result?.target?.id;
  if (agentId) _updateEntity(state, agentId, result.agent);
  if (targetId) _updateEntity(state, targetId, result.target);
  if (ev?.type === 'resource.target-zero') {
    const t = _findEntity(state, ev.targetId);
    if (t) t.alive = false;
  }
  if (ev?.type === 'resource.agent-zero') {
    const a = _findEntity(state, ev.agentId);
    if (a) a.alive = false;
  }
}

function _updateEntity(state, id, patch) {
  const e = _findEntity(state, id);
  if (e) Object.assign(e, patch);
}
function _findEntity(state, id) {
  for (const list of Object.values(state.collections || {})) {
    const e = list.find(x => x.id === id);
    if (e) return e;
  }
  return null;
}

function getField(obj, ref) {
  // ref like "pig.value" — obj is already the agent/target, so take last segment
  const parts = ref.split('.');
  return obj[parts[parts.length - 1]];
}
function setField(obj, ref, value) {
  const parts = ref.split('.');
  const key = parts[parts.length - 1];
  return { ...obj, [key]: value };
}

export function step(state, action, params) {
  if (action.type !== 'consume') return state;
  const { agent, target } = action;
  const amount = params.amount ?? 1;
  const agentOld = getField(agent, params['agent-field']) ?? 0;
  const targetOld = getField(target, params['target-field']) ?? 0;
  const agentNew = Math.max(0, agentOld - amount);
  const targetNew = Math.max(0, targetOld - amount);
  const events = [{ type: 'resource.consumed', agent: agent.id, target: target.id, amount }];
  if (agentOld > 0 && agentNew === 0) events.push({ type: 'resource.agent-zero', agentId: agent.id });
  if (targetOld > 0 && targetNew === 0) events.push({ type: 'resource.target-zero', targetId: target.id });
  return {
    ...state,
    agent: setField(agent, params['agent-field'], agentNew),
    target: setField(target, params['target-field'], targetNew),
    _events: events,
  };
}

export function checkInvariants(history, params) {
  const violations = [];
  const zeroFiredAgent = new Set();
  const zeroFiredTarget = new Set();
  for (const rec of history || []) {
    const events = rec._events || [];
    for (const e of events) {
      if (e.type === 'resource.agent-zero') {
        if (zeroFiredAgent.has(e.agentId)) violations.push(`deterministic-events: agent ${e.agentId} zero fired twice`);
        zeroFiredAgent.add(e.agentId);
      }
      if (e.type === 'resource.target-zero') {
        if (zeroFiredTarget.has(e.targetId)) violations.push(`deterministic-events: target ${e.targetId} zero fired twice`);
        zeroFiredTarget.add(e.targetId);
      }
    }
    // non-negative check
    const agentVal = rec.agent ? getField(rec.agent, params['agent-field']) : null;
    const targetVal = rec.target ? getField(rec.target, params['target-field']) : null;
    if (agentVal !== null && agentVal < 0) violations.push(`non-negative: agent field went to ${agentVal}`);
    if (targetVal !== null && targetVal < 0) violations.push(`non-negative: target field went to ${targetVal}`);
  }
  return { ok: violations.length === 0, violations };
}
