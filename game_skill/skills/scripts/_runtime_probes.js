/**
 * _runtime_probes.js — check_runtime_semantics.js 的 probe scenario 集合
 *
 * 为了让语义测试确定性可控：每个 probe 预设一组 state + actions + expected trace；
 * checker 把这些喂给被测 game 的 window.gameTest.probes.*，执行后用 reducer 复算。
 *
 * 设计原则：
 *   - 每个 probe 只覆盖一个具体语义陷阱（first-hit / no-penetration / position-dependent / ...）
 *   - applicable(mechanics) 返回 true 才跑——避免对不相干 case 触发
 *   - state/actions 是纯数据，不依赖引擎；driver 名映射到 window.gameTest.drivers 里
 *   - expect.traceContains 是结构化断言，checker 统一处理
 */

/**
 * 判定 mechanics.yaml 里是否含某些 primitive（接受 'ray-cast@v1' 字符串数组）
 */
export function hasPrimitives(mechanics, required) {
  const present = new Set();
  for (const node of mechanics?.mechanics ?? []) {
    if (node.primitive) present.add(String(node.primitive));
  }
  return required.every((p) => present.has(p));
}

/**
 * ray-cast grid 模式的 probe 集合。P0 版本 3 条（first-hit / no-penetration / position-dependent）。
 * recycle / capacity-gate 留给 P1 slot-pool / capacity-gate primitive 落地后补。
 */
export const RAY_CAST_GRID_PROBES = [
  {
    id: "first-hit.same-color",
    applicable: (m) => hasPrimitives(m, ["ray-cast@v1", "parametric-track@v1"]),
    description: "pig 在 top col=2，col 2 的 row 0/row 1 都是同色 block；仅 row 0 命中",
    state: {
      pig: { id: "pig-1", color: "red", gridPosition: { row: -1, col: 2 }, segmentId: "top", ammo: 3 },
      blocks: [
        { id: "b-0-2", row: 0, col: 2, color: "red", alive: true, durability: 1 },
        { id: "b-1-2", row: 1, col: 2, color: "red", alive: true, durability: 1 },
      ],
    },
    actions: [{ driver: "dispatchPig", args: ["pig-1"] }],
    settleTicks: 120,
    expect: {
      traceContains: [{
        primitive: "ray-cast@v1",
        sourceId: "pig-1",
        firstHitId: "b-0-2",
      }],
    },
  },

  {
    id: "no-penetration.mismatch",
    applicable: (m) => hasPrimitives(m, ["ray-cast@v1", "parametric-track@v1", "predicate-match@v1"]),
    description: "近行异色、远行同色 — 异色应阻挡，两个 block 都不受击",
    state: {
      pig: { id: "pig-1", color: "red", gridPosition: { row: -1, col: 2 }, segmentId: "top", ammo: 3 },
      blocks: [
        { id: "b-0-2", row: 0, col: 2, color: "blue", alive: true, durability: 1 },
        { id: "b-1-2", row: 1, col: 2, color: "red",  alive: true, durability: 1 },
      ],
    },
    actions: [{ driver: "dispatchPig", args: ["pig-1"] }],
    settleTicks: 120,
    expect: {
      // ray-cast 会返回 b-0-2（最近），但 predicate-match 判异色应阻止 consume
      // 语义是：b-0-2 durability 未变 / b-1-2 也不受击
      traceContains: [{
        primitive: "ray-cast@v1",
        sourceId: "pig-1",
        firstHitId: "b-0-2",
      }],
      // 由于 predicate-match 会拦住，consume 不触发；这条由后续 resource-consume primitive 的 probe 断言
      nonMutation: ["b-0-2", "b-1-2"],
    },
  },

  {
    id: "position-dependent",
    applicable: (m) => hasPrimitives(m, ["ray-cast@v1", "parametric-track@v1"]),
    description: "同一 state 两次派出，pig 起点不同 → 命中的 block 也不同（禁止全局同色索敌）",
    state: {
      // 两次 action 要求 checker 按顺序执行；第一次 pig col=1，第二次 col=4
      pig: { id: "pig-1", color: "red", gridPosition: { row: -1, col: 1 }, segmentId: "top", ammo: 5 },
      blocks: [
        { id: "b-0-1", row: 0, col: 1, color: "red", alive: true, durability: 1 },
        { id: "b-0-4", row: 0, col: 4, color: "red", alive: true, durability: 1 },
      ],
    },
    actions: [
      // 第一次：pig col=1 发射
      { driver: "dispatchPig", args: ["pig-1"] },
      // settle + 重置 pig 到 col=4 通过 probe
      { driver: "__probe", args: ["resetPig", { id: "pig-1", gridPosition: { row: -1, col: 4 }, ammo: 4 }] },
      { driver: "dispatchPig", args: ["pig-1"] },
    ],
    settleTicks: 240,
    expect: {
      // 应观察到两条 ray-cast event：第一条 firstHit=b-0-1，第二条=b-0-4
      traceContains: [
        { primitive: "ray-cast@v1", sourceId: "pig-1", firstHitId: "b-0-1" },
        { primitive: "ray-cast@v1", sourceId: "pig-1", firstHitId: "b-0-4" },
      ],
    },
  },
];

/**
 * 返回适用当前 mechanics 的所有 probe 集合
 */
export function selectApplicableProbes(mechanics) {
  return RAY_CAST_GRID_PROBES.filter((p) => {
    try { return p.applicable(mechanics); }
    catch { return false; }
  });
}

/**
 * 比对 trace 事件是否满足 expect.traceContains 的某一条断言。
 * 断言形态：{ primitive, sourceId, firstHitId? }
 * 返回 true 代表匹配。
 */
export function traceEventMatches(event, assertion) {
  if (!event || !assertion) return false;
  if (assertion.primitive && event.primitive !== assertion.primitive) return false;
  if (assertion.sourceId) {
    const src = event?.before?.source?.id ?? event?.source?.id ?? event?.sourceId;
    if (String(src ?? "") !== String(assertion.sourceId)) return false;
  }
  if (assertion.firstHitId) {
    const first = event?.after?.returnedHits?.[0]?.id
      ?? event?.returnedHits?.[0]?.id;
    if (String(first ?? "") !== String(assertion.firstHitId)) return false;
  }
  return true;
}

/**
 * 用 ray-cast reducer 的 castGrid 复算一次 trace，比对 trace 的 returnedHits[0] 是否 == reducer 算出的 nearest。
 * 返回 { ok, expectedId, actualId, reason }。
 *
 * trace event 必须具备 before.source / before.targetsSnapshot / before.resolvedDirection
 * 以及 after.returnedHits（P1.1 runtime primitive 落地后会自动填，P0 过渡期允许缺失，caller 应处理）。
 */
export function verifyRayCastSemantics(event, castGrid, params = {}) {
  const before = event?.before;
  const after = event?.after;
  if (!before?.source || !Array.isArray(before?.targetsSnapshot) || !before?.resolvedDirection) {
    return { ok: null, reason: "skip: event 缺 before.source/targetsSnapshot/resolvedDirection（运行时 primitive 未启用）" };
  }
  const sourceGrid = before.source.gridPosition
    ?? (Number.isFinite(before.source.row) && Number.isFinite(before.source.col)
        ? { row: before.source.row, col: before.source.col }
        : null);
  if (!sourceGrid) return { ok: null, reason: "skip: before.source 无 gridPosition" };
  const redo = castGrid(sourceGrid, before.resolvedDirection, before.targetsSnapshot, params);
  const expectedId = redo?.[0]?.target?.id ?? null;
  const actualId = after?.returnedHits?.[0]?.id ?? null;
  if (expectedId === actualId) return { ok: true, expectedId, actualId };
  return {
    ok: false,
    expectedId,
    actualId,
    reason: `reducer 复算 nearest=${expectedId ?? "<none>"}，runtime returnedHits[0]=${actualId ?? "<none>"}`,
  };
}
