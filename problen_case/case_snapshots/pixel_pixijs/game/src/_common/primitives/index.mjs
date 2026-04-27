/**
 * index.mjs — engines/_common/primitives 聚合导出
 *
 * 业务代码推荐的引用方式（canvas / pixijs 共享）：
 *   import {
 *     rayCastGrid, rayCastGridFirstHit,
 *     tickTrack, positionAt,
 *     predicateMatch,
 *     consumeResource,
 *     gridMove,
 *     addCell, removeCell,
 *     queryNeighbors,
 *     fireTrigger,
 *     checkWinLose,
 *     accumulateScore,
 *   } from '../_common/primitives/index.mjs';
 *
 * 单个 primitive 的更细粒度导入也可以：
 *   import { rayCastGridFirstHit } from '../_common/primitives/ray-cast.runtime.mjs';
 *
 * 设计约束（check_implementation_contract.js P1.4 会校验这几条）：
 *   - 所有 runtime 都自动推 window.__trace 结构化事件（primitive / rule / node / before / after）
 *   - runtime = reducer 的薄 wrapper，行为与 references/mechanics/**.reducer.mjs 严格等价
 *   - business code 一旦使用了某 primitive 的 runtime API，就不得再手写同等逻辑
 */

// motion
export { tickTrack, positionAt } from "./parametric-track.runtime.mjs";
export { gridMove } from "./grid-step.runtime.mjs";

// spatial
export { rayCastGrid, rayCastGridFirstHit } from "./ray-cast.runtime.mjs";
export { addCell, removeCell } from "./grid-board.runtime.mjs";
export { queryNeighbors } from "./neighbor-query.runtime.mjs";

// logic
export { predicateMatch } from "./predicate-match.runtime.mjs";
export { consumeResource } from "./resource-consume.runtime.mjs";
export { fireTrigger } from "./fsm-transition.runtime.mjs";

// progression
export { checkWinLose } from "./win-lose-check.runtime.mjs";
export { accumulateScore } from "./score-accum.runtime.mjs";

// lifecycle (P1.2 新增 4 个)
export { bindSlot, unbindSlot } from "./slot-pool.runtime.mjs";
export { requestCapacity, releaseCapacity } from "./capacity-gate.runtime.mjs";
export { transitionLifecycle } from "./entity-lifecycle.runtime.mjs";
export { requestDispatch } from "./cooldown-dispatch.runtime.mjs";

// 共享 trace 工具（runtime 内部用；业务极少直接用）
export { pushTraceEvent, getTraceSink, snapshot } from "./_trace.mjs";
