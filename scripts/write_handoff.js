#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const FOLLOW_UP_PROMPT = "如果遇到 bug、想增加需求、修改现有机制、调整手感/数值、素材/颜色/布局/UI，都可以继续说。";

function readJsonOptional(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function deliveryEvidenceStatus(delivery) {
  if (!delivery?.status) return "missing";
  if (delivery.status === "delivery-pass" || delivery.status === "delivery-with-warnings") return "passed";
  return "blocked";
}

function previewHealthStatus(preview) {
  if (preview?.status === "preview-ready") return "ready";
  if (preview?.status === "preview-blocked") return "blocked";
  return "missing";
}

export function buildHandoff({ plan, delivery, preview }) {
  const previewHealth = previewHealthStatus(preview);
  const deliveryEvidence = deliveryEvidenceStatus(delivery);
  return {
    status: previewHealth === "ready" ? "ready" : "blocked",
    previewStatus: preview?.status ?? "missing",
    deliveryStatus: delivery?.status ?? "missing",
    playSummary: plan?.primaryLoop ?? plan?.rawQuery ?? "游戏已生成，玩法说明缺失。",
    controls: Array.isArray(plan?.controls) ? plan.controls.map((control) => ({
      input: control.input,
      effect: control.effect,
    })) : [],
    checks: {
      deliveryEvidence,
      previewHealth,
      deliveryBlockReason: delivery?.blockReason ?? null,
      previewReason: preview?.reason ?? null,
      failedExpects: (delivery?.detail?.diagnostic?.failedExpects ?? []).slice(0, 8),
      visualWarnings: (delivery?.qualityHints?.visual?.warnings ?? []).slice(0, 8),
    },
    launchCommand: preview?.launchCommand ?? null,
    screenshots: preview?.screenshots ?? {},
    followUpPrompt: FOLLOW_UP_PROMPT,
    timestamp: new Date().toISOString(),
  };
}

export function writeHandoff(casePath) {
  const caseDir = resolve(REPO, casePath);
  const record = buildHandoff({
    plan: readJsonOptional(join(caseDir, "specs/plan.json")),
    delivery: readJsonOptional(join(caseDir, "eval/delivery.json")),
    preview: readJsonOptional(join(caseDir, "eval/preview.json")),
  });
  const evalDir = join(caseDir, "eval");
  mkdirSync(evalDir, { recursive: true });
  writeFileSync(join(evalDir, "handoff.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

function parseArgs(argv) {
  const args = { casePath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    else if (!args.casePath) args.casePath = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.casePath) {
    console.error("Usage: node scripts/write_handoff.js cases/<slug>");
    return args.help ? 0 : 2;
  }
  const record = writeHandoff(args.casePath);
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  return record.status === "ready" ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
