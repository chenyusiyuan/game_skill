/**
 * test-hook.js — Playwright 桥 共享实现（纯 JS，无引擎依赖）
 *
 * 两代 API 并存（双写兼容）：
 *
 * 旧 API（保留，零破坏）：
 *   exposeTestHooks({
 *     state,
 *     hooks:      { clickStartButton, clickRetryButton, getCards },
 *     simulators: { simulateCorrectMatch },
 *   });
 *   → window.gameState / window.gameTest.clickStartButton / window.simulateCorrectMatch
 *
 * 新 API（三分类，check_runtime_semantics.js 依赖）：
 *   exposeTestHooks({
 *     state,
 *     observers: { getSnapshot, getTrace, getAssetUsage },
 *     drivers:   { clickStartButton, clickRetryButton },
 *     probes:    { resetWithScenario, stepTicks, seedRng },
 *   });
 *   → window.gameTest.observers.getSnapshot
 *     window.gameTest.drivers.clickStartButton
 *     window.gameTest.probes.resetWithScenario
 *
 * 兼容映射（一次 expose 调用兼容两种形态）：
 *   - hooks 的每个函数自动 mirror 到 window.gameTest.drivers.<name>
 *   - hooks 的每个函数 **仍**平铺到 window.gameTest.<name>（兼容旧 profile）
 *   - probes **不平铺**，只能通过 window.gameTest.probes.* 访问
 *   - observers **不平铺**，只能通过 window.gameTest.observers.* 访问
 */

// 启发式：hook 名看起来像 probe 就警告（鼓励迁移到 probes 入参）
const PROBE_LIKE_KEYS =
  /^(resetWith|seed|setScenario|setRng|stepTicks?|tick|advance|forceState)/;

export function exposeTestHooks({
  state,
  hooks = {},
  simulators = {},
  observers = {},
  drivers = {},
  probes = {},
} = {}) {
  if (typeof window === "undefined") return;
  if (!state) {
    console.warn("[test-hook] state is required");
    return;
  }
  window.gameState = state;

  const ns = (window.gameTest ??= {});

  // Flat legacy hooks: window.gameTest.<name>
  for (const [k, fn] of Object.entries(hooks)) {
    if (typeof fn !== "function") continue;
    ns[k] = fn;
  }

  // Legacy flat simulators on window
  for (const [k, fn] of Object.entries(simulators)) {
    if (typeof fn !== "function") continue;
    window[k] = fn;
  }

  // New namespaced categories (additive; never overwrite each other)
  const observersNs = (ns.observers ??= {});
  for (const [k, fn] of Object.entries(observers)) {
    if (typeof fn !== "function") continue;
    observersNs[k] = fn;
  }

  const driversNs = (ns.drivers ??= {});
  // hooks mirror into drivers so new-API consumers can find the same entrypoints
  for (const [k, fn] of Object.entries(hooks)) {
    if (typeof fn !== "function") continue;
    if (!(k in driversNs)) driversNs[k] = fn;
  }
  for (const [k, fn] of Object.entries(drivers)) {
    if (typeof fn !== "function") continue;
    driversNs[k] = fn;
  }

  const probesNs = (ns.probes ??= {});
  for (const [k, fn] of Object.entries(probes)) {
    if (typeof fn !== "function") continue;
    probesNs[k] = fn;
  }

  // Deprecation: flag probe-like names that were passed via legacy hooks
  for (const k of Object.keys(hooks)) {
    if (PROBE_LIKE_KEYS.test(k) && !(k in probesNs)) {
      console.warn(
        `[test-hook] "${k}" looks like a probe; pass it via \`probes\` instead of \`hooks\` (future versions will require this).`,
      );
    }
  }

  if (!ns.clickStartButton && !driversNs.clickStartButton) {
    console.warn(
      "[test-hook] neither hooks.clickStartButton nor drivers.clickStartButton was provided; Playwright assertions may not find an entry point",
    );
  }
}

/**
 * 辅助：断言期望暴露的 hook 名都挂上了。Phase 4 codegen 末尾可以调一下做自检。
 * 支持点分路径：'gameTest.drivers.clickStartButton' / 'gameTest.probes.resetWithScenario'
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
