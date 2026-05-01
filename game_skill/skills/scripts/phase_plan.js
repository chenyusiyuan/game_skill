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
  "stage-1-vertical-slice": {
    startAt: "understand",
    stopAfter: "deliver",
    allowE2E: true,
    layeredVerify: false,
    allowedPhases: [...PHASES],
    allowedStages: [1],
    stageType: "vertical-slice",
    userConfirmationRequired: true,
    description: "Stage 1 Vertical Slice：生成最小完整玩法闭环，结束后生成 preserve.lock 并等待用户确认。",
  },
  "stage-2-content": {
    startAt: "mechanics",
    stopAfter: "deliver",
    allowE2E: true,
    layeredVerify: false,
    allowedPhases: ["mechanics", "expand", "codegen", "verify", "deliver"],
    allowedStages: [2],
    stageType: "content",
    userConfirmationRequired: true,
    description: "Stage 2 Content：在 preserve.lock 不变的前提下扩展内容规模，结束后建议用户确认。",
  },
  "stage-3-variety": {
    startAt: "mechanics",
    stopAfter: "deliver",
    allowE2E: true,
    layeredVerify: false,
    allowedPhases: ["mechanics", "expand", "codegen", "verify", "deliver"],
    allowedStages: [3],
    stageType: "variety",
    userConfirmationRequired: false,
    description: "Stage 3 Variety：增加局内变化，默认自动推进但可被用户反馈打断。",
  },
  "stage-4-progression": {
    startAt: "mechanics",
    stopAfter: "deliver",
    allowE2E: true,
    layeredVerify: false,
    allowedPhases: ["mechanics", "expand", "codegen", "verify", "deliver"],
    allowedStages: [4],
    stageType: "progression",
    userConfirmationRequired: false,
    description: "Stage 4 Progression：补齐资源循环、升级和推进系统，默认自动推进。",
  },
  "stage-5-polish": {
    startAt: "mechanics",
    stopAfter: "deliver",
    allowE2E: true,
    layeredVerify: false,
    allowedPhases: ["mechanics", "expand", "codegen", "verify", "deliver"],
    allowedStages: [5],
    stageType: "polish",
    userConfirmationRequired: false,
    description: "Stage 5 Polish：只做平衡、表现和交付收敛，默认自动完成交付。",
  },
  "iteration-code-bug": {
    startAt: "verify",
    stopAfter: "verify",
    allowE2E: false,
    layeredVerify: true,
    allowedPhases: ["verify"],
    allowedStages: "current",
    iterationCategory: "code-bug",
    userConfirmationRequired: false,
    description: "Iteration Code Bug：只修 game/ 中的运行问题，回本 stage verify。",
  },
  "iteration-tuning": {
    startAt: "expand",
    stopAfter: "verify",
    allowE2E: false,
    layeredVerify: false,
    allowedPhases: ["expand", "verify"],
    allowedStages: "current",
    iterationCategory: "tuning",
    userConfirmationRequired: false,
    description: "Iteration Tuning：只改 data.yaml 等数值事实源，回本 stage verify。",
  },
  "iteration-art-change": {
    startAt: "expand",
    stopAfter: "verify",
    allowE2E: false,
    layeredVerify: false,
    allowedPhases: ["expand", "codegen", "verify"],
    allowedStages: "current",
    iterationCategory: "art-change",
    userConfirmationRequired: false,
    description: "Iteration Art Change：只重跑视觉、素材和表现绑定相关路径。",
  },
  "iteration-scope-change": {
    startAt: "mechanics",
    stopAfter: "verify",
    allowE2E: false,
    layeredVerify: false,
    allowedPhases: ["mechanics", "expand", "codegen", "verify"],
    allowedStages: "current",
    iterationCategory: "scope-change",
    userConfirmationRequired: true,
    description: "Iteration Scope Change：重建当前 stage contract，并重跑本 stage Phase 3-5。",
  },
  "iteration-rework": {
    startAt: "mechanics",
    stopAfter: "verify",
    allowE2E: false,
    layeredVerify: false,
    allowedPhases: ["mechanics", "expand", "codegen", "verify"],
    allowedStages: "current",
    iterationCategory: "rework",
    userConfirmationRequired: true,
    description: "Iteration Rework：按目标 stage 反向 patch，再重放后续 stage。",
  },
  "iteration-extension": {
    startAt: "codegen",
    stopAfter: "deliver",
    allowE2E: true,
    layeredVerify: false,
    allowedPhases: ["codegen", "verify", "deliver"],
    allowedStages: "current",
    iterationCategory: "extension",
    userConfirmationRequired: true,
    description: "Iteration Extension：创建 extension-contract-N，用 patch-based codegen 交付后追加。",
  },
  "iteration-pivot": {
    startAt: "understand",
    stopAfter: "deliver",
    allowE2E: true,
    layeredVerify: false,
    allowedPhases: [...PHASES],
    allowedStages: [1],
    stageType: "vertical-slice",
    iterationCategory: "pivot",
    userConfirmationRequired: true,
    description: "Iteration Pivot：归档旧 game/specs/preserve，重写 PRD + design-strategy 并从 Stage 1 重启。",
  },
};

function usage() {
  return [
    `Usage: node phase_plan.js [--mode ${Object.keys(MODE_PRESETS).join("|")}]`,
    "                          [--project PROJECT] [--stage N] [--stop-before PHASE] [--stop-after PHASE] [--write-state]",
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
    stage: process.env.STAGE ? Number(process.env.STAGE) : null,
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
    if (arg === "--stage") {
      out.stage = Number(argv[++i]);
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

function assertStage(value, field) {
  if (value == null) return;
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error(`${field}: expected integer stage 1-5`);
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

function resolveAllowedStages(preset, options, state) {
  if (Array.isArray(preset.allowedStages)) return preset.allowedStages;
  if (preset.allowedStages !== "current") return [];
  const stage = options.stage ?? inferCurrentStage(state);
  return stage ? [stage] : [];
}

function inferCurrentStage(state) {
  const planned = state?.phasePlan?.currentStage;
  if (Number.isInteger(planned) && planned >= 1 && planned <= 5) return planned;
  const match = /^stage-([1-5])$/.exec(state?.currentPhase ?? "");
  if (match) return Number(match[1]);
  for (const name of ["stage-5", "stage-4", "stage-3", "stage-2", "stage-1"]) {
    const status = state?.phases?.[name]?.status;
    if (status === "running" || status === "completed") return Number(name.slice("stage-".length));
  }
  return null;
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
  assertStage(options.stage, "--stage");
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

  const phaseWindow = startAt && stopAfter ? phaseSlice(startAt, stopAfter) : [];
  const plannedPhases = Array.isArray(preset.allowedPhases)
    ? preset.allowedPhases.filter((phase) => phaseWindow.includes(phase))
    : phaseWindow;
  const allowedStages = resolveAllowedStages(preset, options, state);
  const hardStop = stopBefore ? `before:${stopBefore}` : (stopAfter ? `after:${stopAfter}` : "none");
  const allowE2E = Boolean(preset.allowE2E && plannedPhases.includes("deliver") && !stopBefore);

  const instructions = [];
  const handoffChecks = [];
  if (!allowE2E) {
    instructions.push("Do not run verify_all.js as an E2E repair loop in this mode.");
  }
  if (!plannedPhases.includes("codegen")) {
    instructions.push("Do not start Phase 4 Codegen.");
  }
  if (preset.layeredVerify) {
    instructions.push("Run verification layers one by one and stop on the first failing layer.");
  }
  if (allowedStages.length > 0) {
    const stageLabel = preset.stageType ? ` (${preset.stageType})` : "";
    instructions.push(`Operate only stage(s): ${allowedStages.join(", ")}${stageLabel}.`);
  }
  if (preset.allowedStages === "current" && allowedStages.length === 0) {
    instructions.push("Resolve the current stage from state or pass --stage before applying iteration changes.");
  }
  if (preset.iterationCategory) {
    instructions.push(`Run prd_diff.js --classify and preserve_preflight.js before ${preset.iterationCategory} iteration work.`);
  }
  if (preset.userConfirmationRequired) {
    instructions.push("Stop for user confirmation after the stage acceptance checks pass.");
  }
  if (hardStop !== "none") {
    instructions.push(`Stop at ${hardStop} and report evidence before continuing.`);
  }
  if (plannedPhases.includes("codegen")) {
    handoffChecks.push({
      at: "Phase 4 tail",
      check: "check_game_boots.js",
      purpose: "boot-smoke: discover a real interactive target, click it, and require runtime trace evidence before Phase 5",
    });
  }
  if (plannedPhases.includes("verify")) {
    handoffChecks.push({
      at: "Phase 5 entry",
      check: "check_profile_runner_smoke.js",
      purpose: "profile-smoke: run one minimal generated setup step through the shared runner before the real profile",
    });
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
    allowedPhases: plannedPhases,
    allowedStages,
    stageType: preset.stageType ?? null,
    iterationCategory: preset.iterationCategory ?? null,
    userConfirmationRequired: Boolean(preset.userConfirmationRequired),
    allowE2E,
    layeredVerify: Boolean(preset.layeredVerify),
    instructions,
    handoffChecks,
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
        allowedPhases: plan.allowedPhases,
        allowedStages: plan.allowedStages,
        stageType: plan.stageType,
        iterationCategory: plan.iterationCategory,
        currentStage: plan.allowedStages?.[0] ?? null,
        userConfirmationRequired: plan.userConfirmationRequired,
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
