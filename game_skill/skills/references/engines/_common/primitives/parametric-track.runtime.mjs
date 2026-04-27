/**
 * parametric-track.runtime.mjs — 浏览器 runtime wrapper for parametric-track@v1
 *
 * 业务代码调：
 *   import { tickTrack } from '../_common/primitives/parametric-track.runtime.mjs';
 *   const next = tickTrack({
 *     rule: 'pig-move',
 *     node: 'pig-on-track',
 *     agent: pig,      // 需含 {t, speed, segmentId?, position?, gridPosition?}
 *     dt: 1,
 *     params: trackParams,
 *   });
 *   Object.assign(pig, next);   // 业务直接合并结果到游戏状态
 *
 * runtime 会自动：
 *   - 推进 t → 位置、segmentId、gridPosition、attackPositionKey 等衍生字段
 *   - 若有 _events（segment 切换 / loop 完成 / attack-position 变化）一并 push trace
 */

import { step as trackStep, positionAt } from "../../../mechanics/motion/parametric-track.reducer.mjs";
import { pushTraceEvent, snapshot } from "./_trace.mjs";

/**
 * 推进 agent 一个 dt 时间步，返回新的 agent 字段快照。
 * 若触发任何 _events（segment 切换 / attack-position 变化 / loop 完成），自动 push 一条 trace。
 *
 * @returns agent 下一步状态（包含 t / segmentId / position / gridPosition / attackPositionKey / lapCount）
 */
export function tickTrack(ctx) {
  const { rule, node = null, agent, dt = 0, params } = ctx;
  if (!agent) throw new Error("tickTrack: ctx.agent required");

  const before = snapshot(agent);
  const next = trackStep(before, { type: "tick", dt }, params);
  const events = Array.isArray(next._events) ? next._events : [];
  const afterSnap = { ...next };
  delete afterSnap._events;

  if (events.length > 0) {
    pushTraceEvent({
      primitive: "parametric-track@v1",
      rule,
      node,
      before,
      after: { agent: afterSnap, events },
    });
  }

  return afterSnap;
}

/** 纯函数透传：给定 t 和 params 拿位置（业务可能只需要看位置而不推进 state）。 */
export { positionAt };
