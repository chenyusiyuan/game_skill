import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { runProfileStep } from "./_profile_steps.js";

export function readRuleTraceIds(caseDir) {
  const eventGraphPath = join(caseDir, "specs/event-graph.yaml");
  if (!existsSync(eventGraphPath)) return [];
  try {
    const raw = readFileSync(eventGraphPath, "utf-8");
    const body = raw.split(/^rule-traces:/m)[1];
    if (!body) return [];
    return [...body.matchAll(/^\s*-\s*rule-id:\s*([\w-]+)/gm)].map((m) => m[1]);
  } catch {
    return [];
  }
}

export async function smokeSnapshot(page) {
  return await page.evaluate(() => {
    let stateJson = null;
    try {
      stateJson = JSON.stringify(window.gameState ?? null);
    } catch {}
    const trace = Array.isArray(window.__trace) ? window.__trace : null;
    return {
      traceLength: Array.isArray(trace) ? trace.length : null,
      hasTrace: Array.isArray(trace),
      stateJson,
      phase: window.gameState?.phase ?? window.gameState?.gamePhase ?? null,
    };
  }).catch(() => ({
    traceLength: null,
    hasTrace: false,
    stateJson: null,
    phase: null,
  }));
}

export async function findInteractiveTargets(page, { excludeKeys = [], maxTargets = 8 } = {}) {
  return await page.evaluate(({ excludeKeys, maxTargets }) => {
    const excluded = new Set(excludeKeys);
    const targets = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const keyFor = (kind, x, y, label = "") =>
      `${kind}:${Math.round(x)}:${Math.round(y)}:${String(label).slice(0, 24)}`;

    const inViewport = (x, y) => x >= 0 && y >= 0 && x <= vw && y <= vh;

    const pushTarget = (target) => {
      if (!Number.isFinite(target.pageX) || !Number.isFinite(target.pageY)) return;
      if (!inViewport(target.pageX, target.pageY)) return;
      target.key = target.key ?? keyFor(target.kind, target.pageX, target.pageY, target.label);
      if (excluded.has(target.key)) return;
      targets.push(target);
    };

    const cssPath = (el) => {
      if (!el || el.nodeType !== 1) return null;
      if (el.id) return `#${CSS.escape(el.id)}`;
      const dataAction = el.getAttribute("data-action");
      if (dataAction) return `[data-action="${CSS.escape(dataAction)}"]`;
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && node !== document.body) {
        let part = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (!parent) break;
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
        parts.unshift(part);
        node = parent;
      }
      return parts.length ? parts.join(" > ") : null;
    };

    const isVisibleElement = (el) => {
      const cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
      if (el.disabled) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 8 && r.height >= 8;
    };

    for (const el of document.querySelectorAll("button, a[href], [role=button], [onclick], [data-action], input[type=button], input[type=submit], [tabindex]")) {
      if (!isVisibleElement(el)) continue;
      const r = el.getBoundingClientRect();
      pushTarget({
        kind: "dom",
        label: (el.textContent || el.getAttribute("aria-label") || el.getAttribute("data-action") || el.tagName).trim(),
        selector: cssPath(el),
        pageX: r.left + r.width / 2,
        pageY: r.top + r.height / 2,
        area: r.width * r.height,
      });
    }

    const canvas = document.querySelector("canvas");
    const canvasRect = canvas?.getBoundingClientRect?.();
    const canvasWidth = canvas?.width || canvasRect?.width || 1;
    const canvasHeight = canvas?.height || canvasRect?.height || 1;
    const toCanvasTarget = (kind, x, y, width, height, label, priority = 10) => {
      if (!canvasRect || width < 6 || height < 6) return null;
      const relX = x + width / 2;
      const relY = y + height / 2;
      const pageX = canvasRect.left + (relX / canvasWidth) * canvasRect.width;
      const pageY = canvasRect.top + (relY / canvasHeight) * canvasRect.height;
      return {
        kind,
        label,
        pageX,
        pageY,
        canvasRelX: pageX - canvasRect.left,
        canvasRelY: pageY - canvasRect.top,
        area: width * height,
        priority,
      };
    };

    // PixiJS v7/v8: walk stage display tree and locate visible static/dynamic targets.
    const pixiApp = window.app ?? window.pixiApp ?? (window.PIXI && window.game);
    const pixiStage = pixiApp?.stage;
    const pixiRenderer = pixiApp?.renderer;
    const pixiCanvas = pixiApp?.canvas ?? pixiRenderer?.canvas ?? canvas;
    if (pixiStage && pixiCanvas) {
      const pixiRect = pixiCanvas.getBoundingClientRect();
      const rendererWidth = pixiRenderer?.width || pixiCanvas.width || pixiRect.width || 1;
      const rendererHeight = pixiRenderer?.height || pixiCanvas.height || pixiRect.height || 1;
      const visibleChain = (node) => {
        let cur = node;
        while (cur) {
          if (cur.visible === false || cur.renderable === false || cur.worldVisible === false) return false;
          cur = cur.parent;
        }
        return true;
      };
      const normalizeBounds = (b) => {
        if (!b) return null;
        const x = Number.isFinite(b.x) ? b.x : b.minX;
        const y = Number.isFinite(b.y) ? b.y : b.minY;
        const width = Number.isFinite(b.width) ? b.width : b.maxX - b.minX;
        const height = Number.isFinite(b.height) ? b.height : b.maxY - b.minY;
        if (![x, y, width, height].every(Number.isFinite)) return null;
        return { x, y, width, height };
      };
      const walk = (node) => {
        if (!node || !visibleChain(node)) return;
        const eventMode = String(node.eventMode ?? "");
        const hasPointerListener =
          (typeof node.listenerCount === "function" &&
            (node.listenerCount("pointerdown") > 0 || node.listenerCount("click") > 0 || node.listenerCount("pointertap") > 0));
        const interactive =
          node.interactive === true ||
          eventMode === "static" ||
          eventMode === "dynamic" ||
          node.cursor === "pointer" ||
          hasPointerListener;
        if (interactive && typeof node.getBounds === "function") {
          try {
            const b = normalizeBounds(node.getBounds());
            if (b && b.width >= 6 && b.height >= 6) {
              const pageX = pixiRect.left + ((b.x + b.width / 2) / rendererWidth) * pixiRect.width;
              const pageY = pixiRect.top + ((b.y + b.height / 2) / rendererHeight) * pixiRect.height;
              pushTarget({
                kind: "pixijs",
                label: node.label ?? node.name ?? node.constructor?.name ?? "pixi-target",
                pageX,
                pageY,
                canvasRelX: pageX - pixiRect.left,
                canvasRelY: pageY - pixiRect.top,
                area: b.width * b.height,
                priority: eventMode === "static" || hasPointerListener ? 1 : 3,
              });
            }
          } catch {}
        }
        for (const child of node.children ?? []) walk(child);
      };
      walk(pixiStage);
    }

    // Phaser 3: approximate interactive display objects through obj.input.
    const phaserGame = window.game;
    const scenes = phaserGame?.scene?.scenes ?? [];
    if (Array.isArray(scenes) && scenes.length) {
      for (const scene of scenes) {
        const list = scene.children?.list ?? [];
        for (const obj of list) {
          if (!obj?.input?.enabled && !obj?.input) continue;
          if (obj.visible === false || obj.active === false) continue;
          let x = obj.x ?? 0;
          let y = obj.y ?? 0;
          let width = obj.displayWidth ?? obj.width ?? 0;
          let height = obj.displayHeight ?? obj.height ?? 0;
          if (typeof obj.getBounds === "function") {
            try {
              const b = obj.getBounds();
              x = b.x; y = b.y; width = b.width; height = b.height;
            } catch {
              x -= width * (obj.originX ?? 0.5);
              y -= height * (obj.originY ?? 0.5);
            }
          } else {
            x -= width * (obj.originX ?? 0.5);
            y -= height * (obj.originY ?? 0.5);
          }
          const target = toCanvasTarget("phaser3", x, y, width, height, obj.name || obj.texture?.key || obj.type || "phaser-target", 2);
          if (target) pushTarget(target);
        }
      }
    }

    if (canvasRect && canvasRect.width >= 20 && canvasRect.height >= 20) {
      pushTarget({
        kind: "canvas-fallback",
        label: "canvas-center",
        pageX: canvasRect.left + canvasRect.width / 2,
        pageY: canvasRect.top + canvasRect.height / 2,
        canvasRelX: canvasRect.width / 2,
        canvasRelY: canvasRect.height / 2,
        area: canvasRect.width * canvasRect.height,
        priority: 99,
      });
    }

    return targets
      .sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10) || a.area - b.area)
      .slice(0, maxTargets);
  }, { excludeKeys, maxTargets });
}

export function buildSmokeClickStep(target) {
  if (Number.isFinite(target.canvasRelX) && Number.isFinite(target.canvasRelY)) {
    return {
      action: "click",
      selector: "canvas",
      options: { position: { x: target.canvasRelX, y: target.canvasRelY } },
    };
  }
  if (target.selector) {
    return { action: "click", selector: target.selector };
  }
  return { action: "click", x: target.pageX, y: target.pageY };
}

function targetLooksLikeStart(target, before) {
  const label = String(target?.label ?? "").toLowerCase();
  return before?.phase === "idle" ||
    before?.phase === "ready" ||
    /(^|[^a-z])(start|play|begin)([^a-z]|$)|开始|启动|再来|重开/.test(label);
}

function summarizeAttempt(attempt) {
  const delta = attempt.after.traceLength !== null && attempt.before.traceLength !== null
    ? attempt.after.traceLength - attempt.before.traceLength
    : "n/a";
  return `${attempt.target.kind}/${attempt.target.label || "target"} trace_delta=${delta} state_changed=${attempt.stateChanged}`;
}

export async function runTraceInteractionSmoke(page, {
  label = "BOOT-SMOKE",
  requireTrace = true,
  preferPostStartTrace = true,
  maxAttempts = 5,
  waitAfterClickMs = 700,
  settleBetweenAttemptsMs = 650,
  clickTarget = null,
} = {}) {
  const attempts = [];
  const clickedKeys = [];
  let sawStateChange = false;
  let sawTraceGrowth = false;
  let startTraceGrowth = false;

  for (let i = 0; i < maxAttempts; i += 1) {
    if (i > 0) await page.waitForTimeout(settleBetweenAttemptsMs);
    const targets = await findInteractiveTargets(page, { excludeKeys: clickedKeys, maxTargets: 8 });
    const target = targets[0];
    if (!target) {
      attempts.push({ missingTarget: true });
      continue;
    }
    clickedKeys.push(target.key);
    const before = await smokeSnapshot(page);
    if (clickTarget) {
      await clickTarget(target);
    } else {
      await page.mouse.click(target.pageX, target.pageY);
    }
    await page.waitForTimeout(waitAfterClickMs);
    const after = await smokeSnapshot(page);
    const traceDelta = (after.traceLength ?? 0) - (before.traceLength ?? 0);
    const stateChanged = before.stateJson !== after.stateJson;
    const attempt = { target, before, after, traceDelta, stateChanged };
    attempts.push(attempt);
    if (stateChanged) sawStateChange = true;
    if (traceDelta > 0) {
      sawTraceGrowth = true;
      const isStart = targetLooksLikeStart(target, before);
      if (isStart) startTraceGrowth = true;
      if (!preferPostStartTrace || !isStart || i > 0) {
        return {
          ok: true,
          label,
          kind: "trace-growth",
          attempts,
          message: `${label} trace 增长: ${summarizeAttempt(attempt)}`,
        };
      }
    }
  }

  if (sawTraceGrowth && startTraceGrowth) {
    return {
      ok: true,
      label,
      kind: "start-trace-growth",
      attempts,
      warning: true,
      message: `${label} 只观察到 start/boot 链路 trace 增长；未额外命中 post-start 交互目标`,
    };
  }
  if (!requireTrace && sawStateChange) {
    return {
      ok: true,
      label,
      kind: "state-change",
      attempts,
      warning: true,
      message: `${label} 未观察到 trace 增长，但真实点击改变了 gameState`,
    };
  }

  const attemptText = attempts
    .map((a) => a.missingTarget ? "no-target" : summarizeAttempt(a))
    .join("; ");
  return {
    ok: false,
    label,
    attempts,
    message: `${label} 未观察到真实交互后的 trace 增长${sawStateChange ? "（虽有 state 变化）" : ""}: ${attemptText || "no attempts"}`,
  };
}

export async function runProfileRunnerSmoke(page, options = {}) {
  return await runTraceInteractionSmoke(page, {
    label: "PROFILE-SMOKE",
    requireTrace: true,
    preferPostStartTrace: true,
    maxAttempts: options.maxAttempts ?? 5,
    waitAfterClickMs: options.waitAfterClickMs ?? 700,
    settleBetweenAttemptsMs: options.settleBetweenAttemptsMs ?? 650,
    clickTarget: async (target) => {
      await runProfileStep(page, buildSmokeClickStep(target));
    },
  });
}

export function caseDirFromGameDir(gameDir) {
  return resolve(gameDir, "..");
}
