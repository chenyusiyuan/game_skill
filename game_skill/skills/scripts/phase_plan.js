#!/usr/bin/env node
/**
 * phase_plan.js — produce a hard execution boundary for staged game-skill runs.
 *
 * This helper is intentionally lightweight. It does not mutate state; it gives
 * the main agent a machine-readable plan so "逐层确认" cannot silently turn into
 * a full E2E/codegen loop.
 */

import { existsSync } from "fs";
import { readState, writeState, isResumable } from "./_state.js";

const PHASES = [
  "understand",
  "prd",
  "spec-clarify",
  "mechanics",
  "expand",
  "codegen",
  "verify",
  "deliver",
];

const MODE_PRESETS = {
  full: {
    startAt: "understand",
    stopAfter: "deliver",
    allowE2E: true,
    layeredVerify: false,
    description: "完整生成、校验和交付。",
  },
  "mechanics-only": {
    startAt: "understand",
    stopAfter: "mechanics",
    allowE2E: false,
    layeredVerify: false,
    description: "只确认玩法原语、数值可行性和 win 可达，不进入 codegen。",
  },
  "expand-only": {
    startAt: "spec-clarify",
    stopAfter: "expand",
    allowE2E: false,
    layeredVerify: false,
    description: "只产出 specs/contract 并通过 expand gate，不写游戏代码。",
  },
  "codegen-only": {
    startAt: "codegen",
    stopAfter: "codegen",
    allowE2E: false,
    layeredVerify: false,
    description: "基于已有 PRD/specs 生成代码并跑工程自检，不进入交付 E2E。",
  },
  "verify-layered": {
    startAt: "verify",
    stopAfter: "verify",
    allowE2E: false,
    layeredVerify: true,
    description: "逐层诊断已有 case，失败即停，不运行 verify_all 修复循环。",
  },
  "verify-e2e": {
    startAt: "verify",
    stopAfter: "deliver",
    allowE2E: true,
    layeredVerify: false,
    description: "最终交付回归，允许 verify_all 生成正式 report。",
  },
  resume: {
    startAt: null,
    stopAfter: null,
    allowE2E: false,
    layeredVerify: false,
    description: "从 .game/state.json 决定恢复点；默认不自动进入 E2E。",
  },
};

function usage() {
  return [
    "Usage: node phase_plan.js [--mode full|mechanics-only|expand-only|codegen-only|verify-layered|verify-e2e|resume]",
    "                          [--project PROJECT] [--stop-before PHASE] [--stop-after PHASE] [--write-state]",
    "",
    "Examples:",
    "  node phase_plan.js --mode verify-layered --project pixel-flow-001",
    "  node phase_plan.js --mode mechanics-only --stop-after mechanics",
    "  node phase_plan.js --mode full --stop-before codegen",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    mode: process.env.PHASE_MODE || "full",
    project: process.env.PROJECT || null,
    stopBefore: null,
    stopAfter: null,
    writeState: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--mode") {
      out.mode = argv[++i];
      continue;
    }
    if (arg === "--project") {
      out.project = argv[++i];
      continue;
    }
    if (arg === "--stop-before") {
      out.stopBefore = argv[++i];
      continue;
    }
    if (arg === "--stop-after") {
      out.stopAfter = argv[++i];
      continue;
    }
    if (arg === "--write-state") {
      out.writeState = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function assertPhase(name, field) {
  if (name == null) return;
  if (!PHASES.includes(name)) {
    throw new Error(`${field}: unknown phase "${name}", expected one of: ${PHASES.join(", ")}`);
  }
}

function previousPhase(name) {
  const idx = PHASES.indexOf(name);
  if (idx <= 0) return null;
  return PHASES[idx - 1];
}

function phaseSlice(startAt, stopAfter) {
  const start = PHASES.indexOf(startAt);
  const end = PHASES.indexOf(stopAfter);
  if (start < 0 || end < 0 || start > end) return [];
  return PHASES.slice(start, end + 1);
}

function mapResumePhase(resumeInfo) {
  if (!resumeInfo?.resumable) return null;
  if (resumeInfo.resumeFrom === "expand") {
    const unfinished = resumeInfo.unfinishedSubtasks || [];
    if (unfinished.includes("mechanics")) return "mechanics";
    return "expand";
  }
  return resumeInfo.resumeFrom;
}

function buildPlan(options) {
  if (options.help) {
    return { help: usage() };
  }

  const preset = MODE_PRESETS[options.mode];
  if (!preset) {
    throw new Error(`unknown mode "${options.mode}", expected one of: ${Object.keys(MODE_PRESETS).join(", ")}`);
  }

  assertPhase(options.stopBefore, "--stop-before");
  assertPhase(options.stopAfter, "--stop-after");
  if (options.stopBefore && options.stopAfter) {
    throw new Error("--stop-before and --stop-after are mutually exclusive");
  }

  const statePath = options.project ? `cases/${options.project}/.game/state.json` : null;
  const state = statePath && existsSync(statePath) ? readState(statePath) : null;
  const resume = statePath ? isResumable(state) : null;

  let startAt = preset.startAt;
  let stopAfter = options.stopAfter || preset.stopAfter;
  let stopBefore = options.stopBefore || null;

  if (options.mode === "resume") {
    startAt = mapResumePhase(resume);
    stopAfter = startAt;
    if (!startAt && resume?.reason === "already done") {
      startAt = "verify";
      stopAfter = "verify";
    }
  }

  if (stopBefore) {
    const prev = previousPhase(stopBefore);
    stopAfter = prev || stopBefore;
  }

  const plannedPhases = startAt && stopAfter ? phaseSlice(startAt, stopAfter) : [];
  const hardStop = stopBefore ? `before:${stopBefore}` : (stopAfter ? `after:${stopAfter}` : "none");
  const allowE2E = Boolean(preset.allowE2E && plannedPhases.includes("deliver") && !stopBefore);

  const instructions = [];
  if (!allowE2E) {
    instructions.push("Do not run verify_all.js as an E2E repair loop in this mode.");
  }
  if (!plannedPhases.includes("codegen")) {
    instructions.push("Do not start Phase 4 Codegen.");
  }
  if (preset.layeredVerify) {
    instructions.push("Run verification layers one by one and stop on the first failing layer.");
  }
  if (hardStop !== "none") {
    instructions.push(`Stop at ${hardStop} and report evidence before continuing.`);
  }

  return {
    mode: options.mode,
    description: preset.description,
    project: options.project,
    statePath,
    stateExists: Boolean(state),
    resume,
    startAt,
    stopBefore,
    stopAfter,
    hardStop,
    plannedPhases,
    allowE2E,
    layeredVerify: Boolean(preset.layeredVerify),
    instructions,
  };
}

try {
  const plan = buildPlan(parseArgs(process.argv.slice(2)));
  if (plan.help) {
    console.log(plan.help);
  } else {
    if (plan.project && process.argv.includes("--write-state")) {
      if (!plan.statePath || !plan.stateExists) {
        throw new Error("--write-state requires an existing cases/<project>/.game/state.json");
      }
      const st = readState(plan.statePath);
      const stored = {
        mode: plan.mode,
        plannedPhases: plan.plannedPhases,
        hardStop: plan.hardStop,
        stopBefore: plan.stopBefore,
        stopAfter: plan.stopAfter,
        allowE2E: plan.allowE2E,
        layeredVerify: plan.layeredVerify,
        createdAt: new Date().toISOString(),
      };
      writeState(plan.statePath, { ...st, phasePlan: stored });
      plan.wroteState = true;
    }
    console.log(JSON.stringify(plan, null, 2));
  }
} catch (err) {
  console.error(`[phase_plan] ${err.message}`);
  console.error(usage());
  process.exit(2);
}
