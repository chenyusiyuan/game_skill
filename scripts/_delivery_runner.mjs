#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { chromium } from "playwright";

const SCREENSHOTS = {
  mount: "eval/screenshots/mount.png",
  afterSteps: "eval/screenshots/after-steps.png",
  final: "eval/screenshots/final.png",
};

const DEFAULT_VIEWPORT = { width: 480, height: 360 };
const STATIC_IDLE_NOISE_WARN_THRESHOLD = 100;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--") && argv[index + 1]) {
      args[arg.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("failed to allocate a free port"));
      });
    });
  });
}

function waitForDevServer({ dev, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const readyPattern = new RegExp(`(Local:\\s+http://127\\.0\\.0\\.1:${port}/|ready in \\d+\\s*ms)`, "u");
    const timeout = setTimeout(() => {
      settle(reject, new Error(`timed out waiting for vite dev readiness on 127.0.0.1:${port}`));
    }, timeoutMs);

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      dev.off("exit", onExit);
      dev.stdout.off("data", onData);
      dev.stderr.off("data", onData);
      fn(value);
    };

    const onExit = (code, signal) => {
      settle(reject, new Error(`vite dev exited before readiness: code=${code ?? "null"} signal=${signal ?? "null"}`));
    };

    const onData = (chunk) => {
      if (readyPattern.test(String(chunk))) settle(resolve);
    };

    dev.once("exit", onExit);
    dev.stdout.on("data", onData);
    dev.stderr.on("data", onData);
  });
}

async function startDevServer({ gameDir, explicitPort, timeoutMs }) {
  const attempts = explicitPort ? 1 : 2;
  let lastError = null;
  let lastOutput = "";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = explicitPort || (await findFreePort());
    const dev = spawn("npx", ["vite", "--port", String(port), "--host", "127.0.0.1", "--strictPort"], {
      cwd: gameDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const devOutput = [];
    dev.stdout.on("data", (chunk) => devOutput.push(String(chunk)));
    dev.stderr.on("data", (chunk) => devOutput.push(String(chunk)));

    try {
      await waitForDevServer({ dev, port, timeoutMs });
      return { dev, port, devOutput };
    } catch (error) {
      lastError = error;
      lastOutput = devOutput.join("").slice(-4000);
      dev.kill("SIGTERM");
    }
  }

  const error = lastError instanceof Error ? lastError : new Error(String(lastError));
  error.devOutput = lastOutput;
  throw error;
}

function writeRunnerResult(caseDir, result) {
  const evalDir = path.join(caseDir, "eval");
  mkdirSync(evalDir, { recursive: true });
  writeFileSync(path.join(evalDir, "runner-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function createDiagnostic(plan = null, viewport = DEFAULT_VIEWPORT) {
  return {
    canvasMounted: false,
    canvasSize: { width: 0, height: 0 },
    canvasContext: "none",
    viewport: { width: viewport.width, height: viewport.height },
    pixelsAvailable: false,
    inputDispatched: false,
    stepsExecuted: 0,
    stepsTotal: plan?.smoke?.steps?.length ?? 0,
    milestonesAny: 0,
    failedExpects: [],
  };
}

function summarizeFailedExpects(expectResults) {
  return expectResults
    .filter((result) => !result.ok)
    .map((result) => {
      const failed = {
        type: result.exp.type,
        observed: result.observed,
      };
      if (result.exp.id) failed.id = result.exp.id;
      if (result.exp.path) failed.path = result.exp.path;
      if (result.exp.type === "canvas-change") failed.needed = result.exp.minChangedPixels;
      if (result.exp.type === "milestone") failed.needed = result.exp.minOccurrences ?? 1;
      if (result.exp.type === "state") failed.needed = result.exp.value;
      return failed;
    });
}

function summarizeCanvasViewportWarning(diagnostic) {
  const { canvasSize, viewport } = diagnostic;
  if (
    canvasSize.width > viewport.width * 1.5 ||
    canvasSize.height > viewport.height * 1.5
  ) {
    return {
      kind: "canvas-exceeds-viewport",
      severity: "warn",
      canvasSize,
      viewport,
    };
  }
  return null;
}

async function saveScreenshot(page, caseDir, screenshots, key) {
  const relativePath = SCREENSHOTS[key];
  const absolutePath = path.join(caseDir, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  await page.screenshot({ path: absolutePath });
  screenshots[key] = relativePath;
}

function consoleWarning(entry) {
  return {
    kind: entry.type === "error" ? "console-error" : "console-warning",
    text: entry.text,
    severity: "warn",
  };
}

function summarizeUnexpectedMilestones(plan, milestones) {
  const expectedIds = new Set((plan.smoke?.expect ?? []).filter((exp) => exp.type === "milestone").map((exp) => exp.id));
  const counts = new Map();
  for (const milestone of milestones) {
    if (expectedIds.has(milestone.id)) continue;
    counts.set(milestone.id, (counts.get(milestone.id) ?? 0) + 1);
  }
  return [...counts.entries()].map(([id, count]) => ({
    kind: "unexpected-milestone",
    id,
    count,
    severity: "warn",
  }));
}

export async function readCanvasPixels(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return { width: 0, height: 0, data: [] };

    const width = canvas.width;
    const height = canvas.height;
    const ctx2d = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx2d) {
      const image = ctx2d.getImageData(0, 0, width, height);
      return { width, height, data: Array.from(image.data) };
    }

    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (gl) {
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return { width, height, data: Array.from(pixels) };
    }

    return { width, height, data: [] };
  });
}

async function readCanvasDiagnostic(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      return {
        canvasMounted: false,
        canvasSize: { width: 0, height: 0 },
        canvasContext: "none",
      };
    }

    let canvasContext = "none";
    if (canvas.getContext("webgl2")) {
      canvasContext = "webgl2";
    } else if (canvas.getContext("webgl")) {
      canvasContext = "webgl";
    } else if (canvas.getContext("2d", { willReadFrequently: true })) {
      canvasContext = "2d";
    }

    return {
      canvasMounted: true,
      canvasSize: { width: canvas.width, height: canvas.height },
      canvasContext,
    };
  });
}

export function pixelDiff(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return 0;
  let changed = 0;
  const len = Math.min(a.data.length, b.data.length);
  for (let index = 0; index < len; index += 4) {
    if (
      a.data[index] !== b.data[index] ||
      a.data[index + 1] !== b.data[index + 1] ||
      a.data[index + 2] !== b.data[index + 2] ||
      a.data[index + 3] !== b.data[index + 3]
    ) {
      changed += 1;
    }
  }
  return changed;
}

function assertOp(actual, operator, expected) {
  if (operator === ">=") return actual >= expected;
  if (operator === "<=") return actual <= expected;
  if (operator === ">") return actual > expected;
  if (operator === "<") return actual < expected;
  return Object.is(actual, expected);
}

async function readStatePath(page, statePath) {
  return page.evaluate((pathValue) => {
    const root = globalThis.__state;
    if (!root) return undefined;
    return pathValue.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), root);
  }, statePath);
}

async function dispatchStep(page, step) {
  if (step.type === "keydown") {
    await page.keyboard.down(step.key);
    await page.waitForTimeout(step.durationMs);
    await page.keyboard.up(step.key);
    return;
  }
  if (step.type === "press") {
    await page.keyboard.press(step.key);
    if (step.holdMs) await page.waitForTimeout(step.holdMs);
    return;
  }
  if (step.type === "wait") {
    await page.waitForTimeout(step.durationMs);
    return;
  }
  if (step.type === "click") {
    const viewport = page.viewportSize();
    if (
      step.x < 0 ||
      step.y < 0 ||
      (viewport && (step.x > viewport.width || step.y > viewport.height))
    ) {
      throw new Error(`click coordinate out of viewport: ${step.x},${step.y}`);
    }
    await page.mouse.click(step.x, step.y, { button: step.button || "left" });
    return;
  }
  throw new Error(`unsupported smoke step type: ${step.type}`);
}

async function collectExpectResults({ page, plan, milestones, changedPixels }) {
  const expectResults = [];

  for (const exp of plan.smoke.expect) {
    if (exp.type === "canvas-change") {
      expectResults.push({
        exp,
        ok: changedPixels >= exp.minChangedPixels,
        observed: changedPixels,
      });
      continue;
    }

    if (exp.type === "milestone") {
      const deadline = Date.now() + exp.timeoutMs;
      const need = exp.minOccurrences ?? 1;
      while (Date.now() < deadline) {
        const seen = milestones.filter((milestone) => milestone.id === exp.id).length;
        if (seen >= need) break;
        await page.waitForTimeout(100);
      }
      const seen = milestones.filter((milestone) => milestone.id === exp.id).length;
      expectResults.push({ exp, ok: seen >= need, observed: seen });
      continue;
    }

    if (exp.type === "state") {
      const observed = await readStatePath(page, exp.path);
      expectResults.push({
        exp,
        ok: assertOp(observed, exp.operator || "==", exp.value),
        observed,
      });
    }
  }

  return expectResults;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const caseDir = args["case-dir"];
  if (!caseDir) {
    throw new Error("missing --case-dir");
  }

  const screenshots = {};
  let diagnostic = createDiagnostic();
  const runnerPayload = (result) => {
    const payload = { ...result, diagnostic };
    if (Object.keys(screenshots).length > 0) payload.screenshots = screenshots;
    return payload;
  };
  const finish = (result) => {
    writeRunnerResult(caseDir, runnerPayload(result));
    return 1;
  };
  const succeed = (result) => {
    writeRunnerResult(caseDir, runnerPayload(result));
    return 0;
  };

  let plan;
  try {
    plan = JSON.parse(readFileSync(path.join(caseDir, "specs/plan.json"), "utf8"));
  } catch (error) {
    return finish({
      ok: false,
      chainBlocked: true,
      reason: "plan-parser-exception",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const viewport = plan.smoke?.viewport ?? DEFAULT_VIEWPORT;
  diagnostic = createDiagnostic(plan, viewport);

  const explicitPort = args.port ? Number(args.port) : null;
  let port = explicitPort;
  let dev = null;
  let browser = null;
  let context = null;

  try {
    try {
      const started = await startDevServer({
        gameDir: path.join(caseDir, "game"),
        explicitPort,
        timeoutMs: 30_000,
      });
      dev = started.dev;
      port = started.port;
    } catch (error) {
      return finish({
        ok: false,
        chainBlocked: true,
        reason: "dev-server-failed",
        error: error instanceof Error ? error.message : String(error),
        devOutput: error instanceof Error ? error.devOutput : undefined,
      });
    }

    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      return finish({
        ok: false,
        chainBlocked: true,
        reason: "browser-launch-failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleEntries = [];
    const milestones = [];

    page.on("pageerror", (error) => pageErrors.push(error instanceof Error ? error.message : String(error)));
    page.on("console", (msg) => {
      const text = msg.text();
      const type = msg.type();
      if (type === "warning" || type === "error") {
        consoleEntries.push({ type, text });
      }
      if (text.startsWith("[milestone]")) {
        try {
          const json = text.slice("[milestone]".length).trim();
          milestones.push({ ...JSON.parse(json), at: Date.now() });
        } catch (error) {
          consoleEntries.push({
            type: "warning",
            text: `failed to parse milestone beacon: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    });

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    const canvasHandle = await page.waitForSelector("canvas", { timeout: 5000 }).catch(() => null);
    if (!canvasHandle) {
      return finish({
        ok: false,
        chainBlocked: false,
        reason: "canvas-not-found",
        pageErrors,
        consoleEntries,
      });
    }
    diagnostic.canvasMounted = true;
    await page.waitForTimeout(500);
    await saveScreenshot(page, caseDir, screenshots, "mount");
    Object.assign(diagnostic, await readCanvasDiagnostic(page));

    if (pageErrors.length > 0) {
      return finish({
        ok: false,
        chainBlocked: false,
        reason: "pageerror-on-mount",
        pageErrors,
        consoleEntries,
      });
    }

    const idleBeforePixels = await readCanvasPixels(page);
    diagnostic.canvasSize = { width: idleBeforePixels.width, height: idleBeforePixels.height };
    diagnostic.pixelsAvailable = idleBeforePixels.data.length > 0;
    if (idleBeforePixels.width === 0 || idleBeforePixels.height === 0 || idleBeforePixels.data.length === 0) {
      return finish({
        ok: false,
        chainBlocked: false,
        reason: "canvas-pixels-unavailable",
        pageErrors,
        consoleEntries,
      });
    }
    await page.waitForTimeout(200);
    const idleAfterPixels = await readCanvasPixels(page);
    diagnostic.canvasSize = { width: idleAfterPixels.width, height: idleAfterPixels.height };
    diagnostic.pixelsAvailable = idleAfterPixels.data.length > 0;
    const idleNoise = pixelDiff(idleBeforePixels, idleAfterPixels);
    const baselinePixels = idleAfterPixels;

    try {
      for (const step of plan.smoke.steps) {
        await dispatchStep(page, step);
        diagnostic.stepsExecuted += 1;
      }
      diagnostic.inputDispatched = true;
    } catch (error) {
      return finish({
        ok: false,
        chainBlocked: false,
        reason: "input-dispatch-failed",
        error: error instanceof Error ? error.message : String(error),
        pageErrors,
        consoleEntries,
        milestones,
      });
    }

    await page.waitForTimeout(100);
    const afterPixels = await readCanvasPixels(page);
    const changedPixels = pixelDiff(baselinePixels, afterPixels);
    const noiseRatio = idleNoise / Math.max(changedPixels, 1);
    await saveScreenshot(page, caseDir, screenshots, "afterSteps");
    diagnostic.milestonesAny = milestones.length;
    const expectResults = await collectExpectResults({ page, plan, milestones, changedPixels });
    diagnostic.failedExpects = summarizeFailedExpects(expectResults);
    await page.waitForTimeout(300);
    const postMilestonePixels = await readCanvasPixels(page);
    const postMilestoneChangedPixels = pixelDiff(afterPixels, postMilestonePixels);
    await saveScreenshot(page, caseDir, screenshots, "final");

    if (pageErrors.length > 0) {
      return finish({
        ok: false,
        chainBlocked: false,
        reason: "pageerror-after-input",
        pageErrors,
        consoleEntries,
        milestones,
        changedPixels,
        idleNoise,
        noiseRatio,
        postMilestoneChangedPixels,
        expectResults,
      });
    }

    if (!expectResults.every((result) => result.ok)) {
      return finish({
        ok: false,
        chainBlocked: false,
        reason: "expect-not-met",
        expectResults,
        milestones,
        pageErrors,
        consoleEntries,
        changedPixels,
        idleNoise,
        noiseRatio,
        postMilestoneChangedPixels,
      });
    }

    const warnings = [
      ...consoleEntries.filter((entry) => entry.type === "warning" || entry.type === "error").slice(0, 5).map(consoleWarning),
      ...summarizeUnexpectedMilestones(plan, milestones),
    ];
    const canvasViewportWarning = summarizeCanvasViewportWarning(diagnostic);
    if (canvasViewportWarning) warnings.push(canvasViewportWarning);
    if (milestones.length > 0 && postMilestoneChangedPixels === 0) {
      warnings.push({
        kind: "canvas-static-after-milestone",
        text: "canvas did not change after milestone capture",
        severity: "warn",
      });
    }
    if (idleNoise < STATIC_IDLE_NOISE_WARN_THRESHOLD) {
      warnings.push({
        kind: "idle-frozen",
        text: "canvas changed very little during the idle sample; games with time pressure, NPCs, countdowns, or continuous effects should advance at least one delta-based state while idle",
        idleNoise,
        threshold: STATIC_IDLE_NOISE_WARN_THRESHOLD,
        severity: "warn",
      });
    }
    if (idleNoise < STATIC_IDLE_NOISE_WARN_THRESHOLD && postMilestoneChangedPixels === 0) {
      warnings.push({
        kind: "static-between-inputs",
        text: "canvas stayed static while idle and after milestone capture; consider a delta-based update loop for countdowns, movement, meters, or feedback",
        idleNoise,
        postMilestoneChangedPixels,
        severity: "warn",
      });
    }
    return succeed({
      ok: true,
      summary: {
        changedPixels,
        idleNoise,
        noiseRatio,
        postMilestoneChangedPixels,
        milestoneCount: milestones.length,
        stepsCount: plan.smoke.steps.length,
      },
      screenshots,
      milestones,
      expectResults,
      nonblockingTodosCount: (plan.nonblockingTodos ?? []).length,
      warnings,
    });
  } catch (error) {
    return finish({
      ok: false,
      chainBlocked: true,
      reason: "runner-exception",
      error: error instanceof Error ? error.stack || error.message : String(error),
    });
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (dev) dev.kill("SIGTERM");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await run();
  process.exit(exitCode);
}
