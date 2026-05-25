#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { readCanvasPixels } from "./_delivery_runner.mjs";
import { startViteDevServer } from "./_preview_server.js";
import { writeBaseline } from "./_baseline_writer.js";
import { prepareCaseGame } from "./prepare_case_game.js";
import { scanForbiddenImports } from "./scan_forbidden_imports.js";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REQUIRED_RUNTIME = ["phaser", "vite", "typescript", "playwright"];
const BUILD_TIMEOUT_MS = Number(process.env.BUILD_TIMEOUT_MS) || 120_000;
const PREVIEW_TIMEOUT_MS = Number(process.env.PREVIEW_TIMEOUT_MS) || 60_000;
const DEFAULT_VIEWPORT = { width: 480, height: 360 };
const PREVIEW_SCREENSHOTS = {
  mount: "eval/preview-screenshots/mount.png",
};

function runtimeInvariant() {
  const missing = REQUIRED_RUNTIME.filter((pkg) => !existsSync(join(REPO, "node_modules", pkg)));
  if (missing.length === 0) return { ok: true };
  return { ok: false, reason: "missing-runtime", missing };
}

function runBuildCommand(command, args, cwd, reason) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: BUILD_TIMEOUT_MS,
  });

  if (result.error) {
    return { ok: false, reason, error: result.error.message, stdout: result.stdout, stderr: result.stderr };
  }
  if (result.status !== 0) {
    return { ok: false, reason, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
  }
  return { ok: true, stdout: result.stdout, stderr: result.stderr };
}

function okStep(extra = {}) {
  return { status: "ok", ...extra };
}

function blockedStep(reason, detail = {}) {
  const { status, ...rest } = detail;
  return { ...rest, ...(status !== undefined ? { exitStatus: status } : {}), status: "blocked", reason };
}

function skippedStep(reason = "prior-failure") {
  return { status: "skipped", reason };
}

export function decidePreviewStatus({ health }) {
  const order = ["runtime", "importScan", "prepare", "typecheck", "build", "devServer", "browser", "pageMount", "pageError", "canvas"];
  for (const key of order) {
    const step = health?.[key];
    if (step?.status === "blocked") {
      return { status: "preview-blocked", reason: step.reason ?? key, health };
    }
  }
  return { status: "preview-ready", reason: null, health };
}

function readJsonOptional(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function previewRecord({ decision, screenshots = {}, launchCommand, pageErrors = [], consoleErrors = [] }) {
  return {
    status: decision.status,
    reason: decision.reason,
    health: decision.health,
    screenshots,
    launchCommand,
    pageErrors,
    consoleErrors,
    timestamp: new Date().toISOString(),
  };
}

function writePreview(caseDir, record) {
  const evalDir = join(caseDir, "eval");
  mkdirSync(evalDir, { recursive: true });
  writeFileSync(join(evalDir, "preview.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function readViewport(caseDir) {
  const plan = readJsonOptional(join(caseDir, "specs/plan.json"));
  return plan?.smoke?.viewport ?? DEFAULT_VIEWPORT;
}

async function savePreviewScreenshot(page, caseDir, key) {
  const relPath = PREVIEW_SCREENSHOTS[key];
  const absPath = join(caseDir, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  await page.screenshot({ path: absPath });
  return relPath;
}

async function maybeWritePreviewBaseline({ caseDir, preview }) {
  if (preview.status !== "preview-ready") return null;
  const existing = readJsonOptional(join(caseDir, "eval/baseline.json"));
  const existingKind = existing?.baselineKind ?? (existing?.baselineId ? "delivery" : null);
  if (existingKind === "delivery") return null;

  const deliveryRecord = readJsonOptional(join(caseDir, "eval/delivery.json")) ?? { status: "not-run", warnings: [] };
  const runnerResult = readJsonOptional(join(caseDir, "eval/runner-result.json")) ?? null;
  return writeBaseline({
    casePath: caseDir,
    deliveryRecord,
    runnerResult,
    planPath: join(caseDir, "specs/plan.json"),
    baselineKind: "preview",
    previewRecord: preview,
  });
}

export async function runPreviewCheck({ casePath, explicitPort = null }) {
  const caseDir = resolve(REPO, casePath);
  const gameDir = join(caseDir, "game");
  const caseRel = caseDir.startsWith(REPO) ? caseDir.slice(REPO.length + 1) : casePath;
  const launchCommand = `node scripts/start_preview.js ${caseRel}`;
  const health = {
    runtime: skippedStep(),
    importScan: skippedStep(),
    prepare: skippedStep(),
    typecheck: skippedStep(),
    build: skippedStep(),
    devServer: skippedStep(),
    browser: skippedStep(),
    pageMount: skippedStep(),
    pageError: skippedStep(),
    canvas: skippedStep(),
  };

  const runtime = runtimeInvariant();
  health.runtime = runtime.ok ? okStep() : blockedStep(runtime.reason, { missing: runtime.missing });
  if (!runtime.ok) {
    const decision = decidePreviewStatus({ health });
    const record = previewRecord({ decision, launchCommand });
    writePreview(caseDir, record);
    return record;
  }

  const importScan = scanForbiddenImports(caseDir);
  health.importScan = importScan.ok ? okStep() : blockedStep(importScan.reason, { violations: importScan.violations });
  if (!importScan.ok) {
    const decision = decidePreviewStatus({ health });
    const record = previewRecord({ decision, launchCommand });
    writePreview(caseDir, record);
    return record;
  }

  try {
    prepareCaseGame(caseDir);
    health.prepare = okStep();
  } catch (error) {
    health.prepare = blockedStep("prepare-failed", { error: error instanceof Error ? error.message : String(error) });
    const decision = decidePreviewStatus({ health });
    const record = previewRecord({ decision, launchCommand });
    writePreview(caseDir, record);
    return record;
  }

  const typecheck = runBuildCommand("npx", ["tsc", "--noEmit"], gameDir, "typecheck-failed");
  health.typecheck = typecheck.ok ? okStep() : blockedStep(typecheck.reason, typecheck);
  if (!typecheck.ok) {
    const decision = decidePreviewStatus({ health });
    const record = previewRecord({ decision, launchCommand });
    writePreview(caseDir, record);
    return record;
  }

  const build = runBuildCommand("npx", ["vite", "build"], gameDir, "vite-build-failed");
  health.build = build.ok ? okStep() : blockedStep(build.reason, build);
  if (!build.ok) {
    const decision = decidePreviewStatus({ health });
    const record = previewRecord({ decision, launchCommand });
    writePreview(caseDir, record);
    return record;
  }

  let dev = null;
  let browser = null;
  let context = null;
  const screenshots = {};
  const pageErrors = [];
  const consoleErrors = [];

  try {
    try {
      const started = await startViteDevServer({
        gameDir,
        explicitPort,
        timeoutMs: Math.min(PREVIEW_TIMEOUT_MS, 30_000),
      });
      dev = started.dev;
      health.devServer = okStep({ port: started.port });
    } catch (error) {
      health.devServer = blockedStep("dev-server-failed", {
        error: error instanceof Error ? error.message : String(error),
        devOutput: error instanceof Error ? error.devOutput : undefined,
      });
      const decision = decidePreviewStatus({ health });
      const record = previewRecord({ decision, launchCommand, screenshots, pageErrors, consoleErrors });
      writePreview(caseDir, record);
      return record;
    }

    try {
      browser = await chromium.launch({ headless: true });
      health.browser = okStep();
    } catch (error) {
      health.browser = blockedStep("browser-launch-failed", { error: error instanceof Error ? error.message : String(error) });
      const decision = decidePreviewStatus({ health });
      const record = previewRecord({ decision, launchCommand, screenshots, pageErrors, consoleErrors });
      writePreview(caseDir, record);
      return record;
    }

    context = await browser.newContext({ viewport: readViewport(caseDir) });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error instanceof Error ? error.message : String(error)));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto(`http://127.0.0.1:${health.devServer.port}/`, { waitUntil: "load", timeout: PREVIEW_TIMEOUT_MS });
    const canvasHandle = await page.waitForSelector("canvas", { timeout: 5000 }).catch(() => null);
    if (!canvasHandle) {
      health.pageMount = blockedStep("canvas-not-found");
      const decision = decidePreviewStatus({ health });
      const record = previewRecord({ decision, launchCommand, screenshots, pageErrors, consoleErrors });
      writePreview(caseDir, record);
      return record;
    }
    health.pageMount = okStep();
    await page.waitForTimeout(500);
    screenshots.mount = await savePreviewScreenshot(page, caseDir, "mount");

    if (pageErrors.length > 0) {
      health.pageError = blockedStep("pageerror-on-mount", { pageErrors });
      const decision = decidePreviewStatus({ health });
      const record = previewRecord({ decision, launchCommand, screenshots, pageErrors, consoleErrors });
      writePreview(caseDir, record);
      return record;
    }
    health.pageError = okStep();

    const pixels = await readCanvasPixels(page);
    if (pixels.width === 0 || pixels.height === 0 || pixels.data.length === 0) {
      health.canvas = blockedStep("canvas-pixels-unavailable", {
        canvasSize: { width: pixels.width, height: pixels.height },
      });
      const decision = decidePreviewStatus({ health });
      const record = previewRecord({ decision, launchCommand, screenshots, pageErrors, consoleErrors });
      writePreview(caseDir, record);
      return record;
    }
    health.canvas = okStep({ canvasSize: { width: pixels.width, height: pixels.height } });

    const decision = decidePreviewStatus({ health });
    const record = previewRecord({ decision, launchCommand, screenshots, pageErrors, consoleErrors });
    writePreview(caseDir, record);
    await maybeWritePreviewBaseline({ caseDir, preview: record });
    return record;
  } catch (error) {
    health.pageMount = blockedStep("preview-runner-exception", { error: error instanceof Error ? error.message : String(error) });
    const decision = decidePreviewStatus({ health });
    const record = previewRecord({ decision, launchCommand, screenshots, pageErrors, consoleErrors });
    writePreview(caseDir, record);
    return record;
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (dev) dev.kill("SIGTERM");
  }
}

function parseArgs(argv) {
  const args = { casePath: null, port: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") args.port = Number(argv[++index]);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    else if (!args.casePath) args.casePath = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.casePath) {
    console.error("Usage: node scripts/check_preview.js cases/<slug>");
    return args.help ? 0 : 2;
  }
  const record = await runPreviewCheck({ casePath: args.casePath, explicitPort: args.port });
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  return record.status === "preview-ready" ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
