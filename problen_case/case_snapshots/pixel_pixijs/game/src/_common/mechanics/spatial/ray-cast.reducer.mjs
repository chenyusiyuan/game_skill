// ray-cast reducer: pure JS reference implementation
// For grid-mode: step by (dx, dy) until out of bounds / first hit.
// For pixel-mode: segment vs rectangle intersect (skipped here; grid is enough for POC).

export const id = 'ray-cast';
export const version = 'v1';
export const handles = ['query'];
export const emittedEvents = ['ray.hit-candidate', 'ray.miss'];

/**
 * Orchestrator-facing hook: 根据事件/节点配置组装 action。
 * 返回 null 表示 orchestrator 跳过此节点。
 */
export function resolveAction(node, ev, state) {
  const src = ev.agent || ev.source;
  if (!src) return null;
  const targetsRef = node.params?.targets?.from;
  const targets = (state.collections && state.collections[targetsRef])
    || (state.entities && state.entities[targetsRef])
    || [];
  return { type: 'query', source: src, targets };
}

/**
 * ray-cast 本身无外部副作用（不改 state.collections）。
 */
export function applyEffects(_node, _ev, _result, _state) {
  return;
}

/**
 * Resolve direction vector given current state and params.
 */
export function resolveDirection(sourceState, params) {
  const d = params.direction || {};
  if (d.mode === 'fixed') return d.value || { dx: 0, dy: 0 };
  if (d.mode === 'normal-to-track') {
    const map = d['segment-direction-map'] || {};
    const seg = sourceState.segmentId;
    return map[seg] || { dx: 0, dy: 0 };
  }
  if (d.mode === 'toward-field') {
    const target = d.targetPoint || { x: 0, y: 0 };
    const dx = target.x - (sourceState.position?.x ?? 0);
    const dy = target.y - (sourceState.position?.y ?? 0);
    const mag = Math.hypot(dx, dy) || 1;
    return { dx: dx / mag, dy: dy / mag };
  }
  return { dx: 0, dy: 0 };
}

/**
 * Grid-mode cast: start at source grid pos, step (dx, dy), collect hits.
 * sourceGrid: { row, col }
 * targets: [{ id, row, col, alive, ...fields }]
 * returns: [{ target, distance }] sorted by distance asc
 */
export function castGrid(sourceGrid, direction, targets, params) {
  const { dx, dy } = direction;
  const hits = [];
  if (dx === 0 && dy === 0) return hits;
  const maxDist = params['max-distance'] ?? 50;
  for (let step = 1; step <= maxDist; step++) {
    const row = sourceGrid.row + dy * step;
    const col = sourceGrid.col + dx * step;
    const hit = targets.find(t => t.alive && t.row === row && t.col === col);
    if (hit) {
      hits.push({ target: hit, distance: step });
      if (params['stop-on'] !== 'all-hits') break;
    }
  }
  return hits;
}

function pickGridPoint(source) {
  const p = source?.gridPosition || source?.position || source;
  if (!p || !Number.isFinite(p.row) || !Number.isFinite(p.col)) return null;
  return { row: p.row, col: p.col };
}

/**
 * Reducer step: given an action { type: 'query', source, targets }, produce events.
 * Does not mutate targets.
 */
export function step(state, action, params) {
  if (action.type !== 'query') return state;
  const direction = resolveDirection(action.source, params);
  const coord = params['coord-system'] || 'grid';
  let hits = [];
  if (coord === 'grid') {
    const sourceGrid = pickGridPoint(action.source);
    if (sourceGrid) {
      hits = castGrid(sourceGrid, direction, action.targets || [], params);
    }
  }
  // pixel mode not implemented in reducer (POC-scope)
  const events = [];
  if (hits.length > 0) {
    events.push({
      type: 'ray.hit-candidate',
      source: action.source,
      targets: hits.map(h => h.target),
      distances: hits.map(h => h.distance),
    });
  } else {
    events.push({ type: 'ray.miss', source: action.source });
  }
  // 返回结构必须包含 invariant 所需的全部字段：
  //   source / resolvedDirection / targetsSnapshot / returnedHits
  // 供 check_mechanics 把 history 传给 checkInvariants 做 no-penetration 重算。
  // 这些字段**独立于 events 内的同名字段**（事件里的 source 可以与 action.source 共享引用，
  // 但这里我们深拷一份，防止 orchestrator 的循环检测把顶层字段吞掉）。
  const sourceSnap = _cloneSource(action.source);
  return {
    ...state,
    _events: events,
    source: sourceSnap,
    resolvedDirection: direction,
    targetsSnapshot: (action.targets || []).map(t => ({ ...t })),
    returnedHits: hits.map(h => ({ ...h.target })),
    lastHits: hits.map(h => ({ distance: h.distance, target: { ...h.target } })),
  };
}

function _cloneSource(src) {
  if (!src) return src;
  const out = { ...src };
  if (src.gridPosition) out.gridPosition = { ...src.gridPosition };
  if (src.position)     out.position = { ...src.position };
  return out;
}

/**
 * Invariant check: given a recorded cast, verify no-penetration and source-dependency.
 * history 期望字段（与 step() 返回契约一致）：
 *   rec.source             — 发射体快照
 *   rec.resolvedDirection  — {dx,dy}
 *   rec.targetsSnapshot    — 调用时的 targets 完整拷贝（含所有 alive 状态）
 *   rec.returnedHits       — 返回给外界的命中目标数组（顺序敏感）
 */
export function checkInvariants(history, params) {
  const violations = [];
  if (!Array.isArray(history)) return { ok: true, violations };
  const coord = params['coord-system'] || 'grid';
  if (coord !== 'grid') return { ok: true, violations };
  for (let i = 0; i < history.length; i++) {
    const rec = history[i];
    if (!rec) continue;
    // 只审查真正走过 ray-cast query 的记录（有 resolvedDirection 即说明 reducer.step 正确生成了这条快照）
    if (!rec.resolvedDirection) continue;
    const src = pickGridPoint(rec.source);
    if (!src) {
      violations.push(`source-dependency: step ${i} 无 source.gridPosition/position，reducer 被以非法 action 调用`);
      continue;
    }
    const dir = rec.resolvedDirection;
    if (!dir || (dir.dx === 0 && dir.dy === 0)) continue;
    const snap = rec.targetsSnapshot;
    if (!Array.isArray(snap)) {
      violations.push(`no-penetration: step ${i} 缺 targetsSnapshot，orchestrator 未保留 reducer 输出`);
      continue;
    }
    // Re-run cast and compare: if returnedHits[0] is not the nearest alive target on ray, violate.
    const redo = castGrid(src, dir, snap, params);
    const expectedFirst = redo[0]?.target;
    const actualFirst = (rec.returnedHits || [])[0];
    // stop-on:first-hit 模式下，返回的命中必须是射线最近命中；若不是即视为穿透
    if (expectedFirst && actualFirst && expectedFirst.id !== actualFirst.id) {
      violations.push(
        `no-penetration: at step ${i}, returned target id=${actualFirst.id} but nearest on ray is id=${expectedFirst.id}`,
      );
    }
    // 若 expected 有最近目标但 returnedHits 为空，也是穿透/漏命中
    if (expectedFirst && !actualFirst) {
      violations.push(
        `no-penetration: at step ${i}, nearest target id=${expectedFirst.id} should have been hit but returnedHits is empty`,
      );
    }
  }
  return { ok: violations.length === 0, violations };
}
