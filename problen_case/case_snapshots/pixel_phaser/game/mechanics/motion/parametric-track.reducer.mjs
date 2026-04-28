// parametric-track reducer: pure JS reference implementation
// Used by check_mechanics.js to symbolically simulate and verify invariants.

export const id = 'parametric-track';
export const version = 'v1';
export const handles = ['tick'];
export const emittedEvents = ['track.enter-segment', 'track.attack-position', 'track.loop-complete'];

/**
 * Pick which segment t belongs to (returns segment id or null).
 */
function pickSegment(t, segments) {
  if (!segments) return null;
  const tt = ((t % 1) + 1) % 1;
  for (const seg of segments) {
    const [a, b] = seg.range;
    if (a <= tt && tt < b) return seg.id;
    // wrap-around segment (e.g. [0.9, 0.1] if allowed) — not supported here
  }
  return null;
}

/**
 * Position for given t under params.shape.
 */
export function positionAt(t, params) {
  const tt = ((t % 1) + 1) % 1;
  const shape = params.shape || 'ring';
  if (shape === 'ring') {
    const { cx = 0, cy = 0, r = 1 } = params.geometry || {};
    const angle = 2 * Math.PI * tt;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  }
  if (shape === 'line') {
    const { p0 = { x: 0, y: 0 }, p1 = { x: 1, y: 0 } } = params.geometry || {};
    // round-trip: 0->0.5 forward, 0.5->1 back
    const u = tt < 0.5 ? tt * 2 : (1 - tt) * 2;
    return { x: p0.x + (p1.x - p0.x) * u, y: p0.y + (p1.y - p0.y) * u };
  }
  if (shape === 'rect-loop') {
    const {
      x = params.geometry?.left ?? 0,
      y = params.geometry?.top ?? 0,
      width = 1,
      height = 1,
    } = params.geometry || {};
    if (tt < 0.25) {
      const u = tt / 0.25;
      return { x: x + width * u, y };
    }
    if (tt < 0.5) {
      const u = (tt - 0.25) / 0.25;
      return { x: x + width, y: y + height * u };
    }
    if (tt < 0.75) {
      const u = (tt - 0.5) / 0.25;
      return { x: x + width * (1 - u), y: y + height };
    }
    const u = (tt - 0.75) / 0.25;
    return { x, y: y + height * (1 - u) };
  }
  if (shape === 'u-shape') {
    // Legacy alias. If rectangular geometry exists, behave as rect-loop;
    // otherwise keep the old circular semantic fallback for legacy cases.
    if (Number.isFinite(params.geometry?.width) && Number.isFinite(params.geometry?.height)) {
      return positionAt(tt, { ...params, shape: 'rect-loop' });
    }
    const { cx = 0, cy = 0, r = 1 } = params.geometry || {};
    const angle = 2 * Math.PI * tt;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  }
  // custom: expect caller-provided positionFn via params (not supported in pure reducer)
  return { x: 0, y: 0 };
}

function segmentProgress(t, range) {
  if (!Array.isArray(range) || range.length < 2) return 0;
  const [a, b] = range;
  if (b <= a) return 0;
  const tt = ((t % 1) + 1) % 1;
  return Math.max(0, Math.min(1, (tt - a) / (b - a)));
}

function gridPositionAt(t, segmentId, params) {
  const projection = params['grid-projection'] || params.gridProjection;
  if (!projection || !segmentId) return null;

  const explicit = projection['segment-position-map'] || projection.segmentPositionMap;
  if (explicit?.[segmentId]) return { ...explicit[segmentId] };

  const rows = projection.rows ?? projection.boardRows;
  const cols = projection.cols ?? projection.boardCols;
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 0 || cols <= 0) return null;

  const seg = (params.segments || []).find(s => s.id === segmentId);
  const p = segmentProgress(t, seg?.range);
  const outside = projection['outside-offset'] ?? projection.outsideOffset ?? 1;
  const maxRow = rows - 1;
  const maxCol = cols - 1;
  const colForward = Math.max(0, Math.min(maxCol, Math.floor(p * cols)));
  const rowForward = Math.max(0, Math.min(maxRow, Math.floor(p * rows)));
  const colBackward = Math.max(0, Math.min(maxCol, Math.floor((1 - p) * cols)));
  const rowBackward = Math.max(0, Math.min(maxRow, Math.floor((1 - p) * rows)));

  switch (segmentId) {
    case 'top':    return { row: -outside, col: colForward };
    case 'right':  return { row: rowForward, col: cols - 1 + outside };
    case 'bottom': return { row: rows - 1 + outside, col: colBackward };
    case 'left':   return { row: rowBackward, col: -outside };
    default:       return null;
  }
}

function attackPositionKey(segmentId, gridPosition) {
  if (!segmentId || !gridPosition) return null;
  return `${segmentId}:${gridPosition.row}:${gridPosition.col}`;
}

/**
 * Step the reducer for a single agent.
 * action: { type: 'tick', dt: number }
 */
export function step(state, action, params) {
  if (action.type !== 'tick') return state;
  const dt = action.dt || 0;
  const next = { ...state };
  const oldT = state.t ?? 0;
  const oldSeg = state.segmentId ?? pickSegment(oldT, params.segments);
  let newT = oldT + (state.speed || 0) * dt;
  const loopComplete = Math.floor(newT) > Math.floor(oldT);
  newT = ((newT % 1) + 1) % 1;
  const newSeg = pickSegment(newT, params.segments);
  next.t = newT;
  next.segmentId = newSeg;
  next.position = positionAt(newT, params);
  const gridPosition = gridPositionAt(newT, newSeg, params);
  if (gridPosition) next.gridPosition = gridPosition;
  const oldAttackPositionKey = state.attackPositionKey ?? null;
  const newAttackPositionKey = attackPositionKey(newSeg, gridPosition);
  if (newAttackPositionKey) next.attackPositionKey = newAttackPositionKey;
  // 构造快照时剔除 _events 避免循环引用
  const agentSnap = { ...next };
  delete agentSnap._events;
  next._events = [];
  if (newAttackPositionKey && newAttackPositionKey !== oldAttackPositionKey) {
    next._events.push({
      type: 'track.attack-position',
      agent: agentSnap,
      segmentId: newSeg,
      gridPosition,
      fromPositionKey: oldAttackPositionKey,
      toPositionKey: newAttackPositionKey,
    });
  }
  if (oldSeg !== newSeg && newSeg !== null) {
    next._events.push({
      type: 'track.enter-segment',
      agent: agentSnap,
      fromSegment: oldSeg,
      toSegment: newSeg,
    });
  }
  if (loopComplete) {
    next.lapCount = (state.lapCount || 0) + 1;
    agentSnap.lapCount = next.lapCount;
    next._events.push({ type: 'track.loop-complete', agent: agentSnap, lapCount: next.lapCount });
  }
  return next;
}

/**
 * Invariant checks. Must be cheap — called every simulation step or at end.
 */
export function checkInvariants(history, params) {
  const violations = [];
  if (!Array.isArray(history) || history.length < 2) {
    return { ok: true, violations };
  }
  const speed = history[0].speed ?? 0;
  // 1. monotonicity: t must advance (mod 1) when speed > 0
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].t ?? 0;
    const curr = history[i].t ?? 0;
    const advanced =
      curr > prev || (prev > 0.9 && curr < 0.1); // wrap
    if (speed > 0 && !advanced && prev !== curr) {
      violations.push(`monotonicity: t went backwards at step ${i} (${prev}->${curr})`);
    }
  }
  // 2. periodicity: P(0) == P(1) — check analytically
  const p0 = positionAt(0, params);
  const p1 = positionAt(0.9999, params);
  const distSq = (p0.x - p1.x) ** 2 + (p0.y - p1.y) ** 2;
  // closed shapes should satisfy P(0) ~= P(1-); tolerance scales with geometry size.
  const scale = params.geometry?.r ?? Math.max(
    params.geometry?.width ?? 0,
    params.geometry?.height ?? 0,
    Math.hypot(
    (params.geometry?.p1?.x ?? 1) - (params.geometry?.p0?.x ?? 0),
    (params.geometry?.p1?.y ?? 0) - (params.geometry?.p0?.y ?? 0),
    ),
  ) ?? 1;
  const tol = Math.max(0.01, scale * 0.02);    // 2% 半径或至少 0.01
  if (['ring', 'rect-loop', 'u-shape', 'line'].includes(params.shape) && Math.sqrt(distSq) > tol) {
    violations.push(`periodicity: ${params.shape} shape not closed (|P(0)-P(1-)|=${Math.sqrt(distSq).toFixed(4)} > tol=${tol.toFixed(4)})`);
  }
  // 3. coverage: if simulation long enough, every segment visited
  if (params.segments && params.segments.length > 1 && speed > 0) {
    const visited = new Set(history.map(s => s.segmentId).filter(Boolean));
    const expected = new Set(params.segments.map(s => s.id));
    // require simulation >= one loop worth
    const simulatedLoops = (history[history.length - 1].t ?? 0) + (history[history.length - 1].lapCount || 0);
    if (simulatedLoops >= 1) {
      for (const segId of expected) {
        if (!visited.has(segId)) {
          violations.push(`coverage: segment '${segId}' never visited in ${history.length} steps (expected after 1 lap)`);
        }
      }
    }
  }
  // 4. segment-exclusive
  if (params.segments) {
    const ranges = params.segments.map(s => s.range).sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < ranges.length; i++) {
      const [a, b] = ranges[i];
      if (a < 0 || b > 1 || a >= b) {
        violations.push(`segment-exclusive: invalid range [${a}, ${b}]`);
      }
      if (i > 0 && a < ranges[i - 1][1]) {
        violations.push(`segment-exclusive: overlap between segments`);
      }
    }
    // union coverage
    const union = ranges.reduce((acc, [a, b]) => acc + (b - a), 0);
    if (Math.abs(union - 1) > 1e-6) {
      violations.push(`segment-exclusive: ranges union = ${union}, not [0,1)`);
    }
  }
  // 5. position-consistency: reducer 输出的位置必须等于 P(t)
  for (let i = 0; i < history.length; i++) {
    const rec = history[i];
    if (!rec || !rec.position || rec.t === undefined) continue;
    const expected = positionAt(rec.t, params);
    const distSq = (expected.x - rec.position.x) ** 2 + (expected.y - rec.position.y) ** 2;
    const scale = params.geometry?.r ?? 1;
    if (Math.sqrt(distSq) > Math.max(0.01, scale * 0.001)) {
      violations.push(`position-consistency: step ${i} position != P(t)`);
    }
  }
  return { ok: violations.length === 0, violations };
}
