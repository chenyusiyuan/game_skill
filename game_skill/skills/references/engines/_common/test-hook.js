/**
 * test-hook.js — Playwright 桥 共享实现（纯 JS，无引擎依赖）
 *
 * 替代 codegen 以前散写的：
 *   window.gameState = state;
 *   window.simulateCorrectMatch = () => {...};
 *   window.gameTest = { clickStartButton: () => {...} };
 *
 * 统一入口：
 *
 *   import { exposeTestHooks } from '../_common/test-hook.js';
 *   exposeTestHooks({
 *     state,                        // 游戏 state 对象，会挂为 window.gameState
 *     hooks: {                      // 下方 "hooks" 对象会挂为 window.gameTest.*
 *       clickStartButton() { ... },
 *       clickRetryButton() { ... },
 *       getCards() { ... },
 *     },
 *     // 同步 expose（用 simulate* 方式调用的老式断言需要）
 *     simulators: {
 *       simulateCorrectMatch() { ... },
 *       simulateWrongMatch() { ... },
 *     },
 *   });
 *
 * 这样 Playwright assertion 不管怎么调都能找到：
 *   window.gameState / window.gameTest.<name> / window.simulate<Name>
 */

export function exposeTestHooks({ state, hooks = {}, simulators = {} }) {
  if (typeof window === "undefined") return;
  if (!state) {
    console.warn("[test-hook] state is required");
    return;
  }
  window.gameState = state;

  // namespace hooks under window.gameTest
  const ns = (window.gameTest ??= {});
  for (const [k, fn] of Object.entries(hooks)) {
    if (typeof fn !== "function") continue;
    ns[k] = fn;
  }

  // legacy flat simulators on window
  for (const [k, fn] of Object.entries(simulators)) {
    if (typeof fn !== "function") continue;
    window[k] = fn;
  }

  // sanity hint
  if (!ns.clickStartButton) {
    console.warn("[test-hook] hooks.clickStartButton 未提供，Playwright 断言会找不到入口");
  }
}

/**
 * 辅助：断言期望暴露的 hook 名都挂上了。Phase 4 codegen 末尾可以调一下做自检。
 */
export function assertHooksExposed(expectedNames) {
  if (typeof window === "undefined") return { ok: true, missing: [] };
  const missing = [];
  for (const name of expectedNames) {
    const ref = name.includes(".")
      ? name.split(".").reduce((o, k) => o?.[k], window)
      : window[name];
    if (typeof ref !== "function" && ref === undefined) missing.push(name);
  }
  return { ok: missing.length === 0, missing };
}
