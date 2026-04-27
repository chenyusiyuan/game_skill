/**
 * fx.spec.js — 特效运行时 共享接口
 *
 * 目的：rule.yaml 的 effect-on-*.visual 用标准动词描述（"particle-burst"、
 * "screen-shake"…），但每个引擎的真实 API 完全不同。之前靠 LLM 手写翻译，
 * 经常翻错或干脆不翻（就变成用户吐槽的"没特效"）。
 *
 * 此接口统一入口，codegen 产的业务代码一律走：
 *
 *   import { playEffect } from './adapters/<engine>-fx.js';
 *   playEffect('screen-shake', { intensity: 3, duration: 150 });
 *   playEffect('particle-burst', { x, y, color: '#ff0', count: 12 });
 *
 * 动词白名单（和 rule.yaml.visual / check_skill_compliance.js 保持一致）：
 */
export const FX_VERBS = Object.freeze([
  "particle-burst",
  "screen-shake",
  "tint-flash",
  "float-text",
  "scale-bounce",
  "pulse",
  "fade-out",
]);

/**
 * 每个动词的标准参数 schema。adapter 的 playEffect 不必严格校验，但需要
 * 认识这些字段（默认值见下）；传未知 key 时打 warn 但不抛。
 *
 * 坐标系约定：所有 x/y 都是业务坐标（游戏世界坐标），由 adapter 决定怎么
 * 翻译到引擎实际坐标（phaser/pixi 直接用；canvas 直接用；dom 需要额外
 * 传 containerRect 做偏移）。
 */
export const FX_DEFAULTS = Object.freeze({
  "particle-burst":  { x: 0, y: 0, color: "#ffffff", count: 10, lifetime: 500, speed: 100 },
  "screen-shake":    { intensity: 3, duration: 150 },
  "tint-flash":      { target: null, color: "#ffffff", duration: 100 },
  "float-text":      { x: 0, y: 0, text: "", color: "#ffffff", duration: 800, distance: 40 },
  "scale-bounce":    { target: null, from: 1.0, to: 1.2, duration: 200 },
  "pulse":           { target: null, amplitude: 0.1, duration: 600, repeat: -1 },
  "fade-out":        { target: null, duration: 300, destroyOnEnd: true },
});

/**
 * adapter 必须实现的签名：
 *
 *   export function createFx(engineCtx): Fx
 *
 *   Fx = {
 *     playEffect(verb: string, ctx: object): { done: Promise<void> } | void,
 *     // 可选：清理所有正在播放的特效（切场景时用）
 *     clearAll?(): void,
 *   }
 *
 * engineCtx 是引擎自己的挂钩点（phaser 的 Scene 实例 / pixi 的 Application /
 * canvas 的 CanvasRenderingContext2D）。adapter 自己存在 closure 里。
 *
 * 错误行为：
 * - verb 不在 FX_VERBS 里 → console.warn 后 no-op，不抛
 * - ctx 缺必要字段 → 用 FX_DEFAULTS 兜底，不抛
 */

/**
 * 工具：合并 ctx 和默认值。adapter 的 playEffect 实现里第一步调它。
 */
export function resolveFxParams(verb, ctx = {}) {
  if (!FX_VERBS.includes(verb)) {
    console.warn(`[fx] unknown verb: ${verb}`);
    return null;
  }
  return { ...FX_DEFAULTS[verb], ...ctx };
}
