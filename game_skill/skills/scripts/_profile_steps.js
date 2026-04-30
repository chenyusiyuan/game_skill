/**
 * Shared setup-step runner for product profiles and smoke checks.
 *
 * Keep click shape parsing here so check_playthrough.js and smoke scripts do
 * not drift on top-level x/y vs Playwright's options.position form.
 */

export function readClickPosition(step = {}) {
  if (Number.isFinite(step.x) && Number.isFinite(step.y)) {
    return { x: step.x, y: step.y, source: "top-level" };
  }
  const nested = step.options?.position;
  if (Number.isFinite(nested?.x) && Number.isFinite(nested?.y)) {
    return { x: nested.x, y: nested.y, source: "options.position" };
  }
  return null;
}

export function hasRealClickStep(assertion = {}) {
  for (const step of assertion.setup ?? []) {
    if (step.action !== "click") continue;
    if (step.selector) return true;
    if (readClickPosition(step)) return true;
  }
  return false;
}

export function hasRealUserInputStep(assertion = {}) {
  for (const step of assertion.setup ?? []) {
    if (step.action === "click" && (step.selector || readClickPosition(step))) return true;
    if (step.action === "press" && step.key) return true;
    if (step.action === "fill" && step.selector) return true;
  }
  return false;
}

export function clickOptionsForStep(step = {}, { timeout = 2000 } = {}) {
  const options = { timeout };
  const pos = readClickPosition(step);
  if (step.selector && pos) {
    options.position = { x: pos.x, y: pos.y };
  }
  return options;
}

export async function snapshotGameStateJson(page) {
  return await page.evaluate(() => {
    try {
      return JSON.stringify(window.gameState ?? null);
    } catch {
      return null;
    }
  });
}

export async function runProfileStep(page, step = {}, options = {}) {
  if (step.action === "click") {
    const pos = readClickPosition(step);
    if (step.selector) {
      await page.click(step.selector, clickOptionsForStep(step, { timeout: options.clickTimeout ?? 2000 }));
      return;
    }
    if (pos) {
      await page.mouse.click(pos.x, pos.y);
      return;
    }
    throw new Error("click step 需要 selector 或 x/y 坐标（支持 step.x/y 与 step.options.position）");
  }
  if (step.action === "wait") {
    await page.waitForTimeout(step.ms ?? 100);
    return;
  }
  if (step.action === "eval") {
    await page.evaluate(step.js ?? step.code);
    return;
  }
  if (step.action === "fill") {
    await page.fill(step.selector, step.value);
    return;
  }
  if (step.action === "press") {
    await page.keyboard.press(step.key);
    return;
  }
  throw new Error(`unsupported setup action: ${step.action}`);
}
