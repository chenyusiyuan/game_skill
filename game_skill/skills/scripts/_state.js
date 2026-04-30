#!/usr/bin/env node
/**
 * _state.js — 统一 state.json 读写 helper
 *
 * 目标：让主 agent / 子 agent / check 脚本走同一套 API，避免 schema 漂移。
 *
 * 用法：
 *   import { readState, writeState, initState, markPhase, markSubtask,
 *            commitExpand, isResumable } from "./_state.js";
 *
 *   const st = readState("cases/foo/.game/state.json");
 *   writeState(path, initState({ project: "foo", runtime: "canvas" }));
 *   writeState(path, markPhase(st, "prd", "running"));
 *   writeState(path, markSubtask(st, "scene", "completed", "specs/.pending/scene.yaml"));
 *   writeState(path, commitExpand(st));   // 所有 subtask 完成后一次性提交
 *
 * 设计原则：
 *   - schema 见 schemas/state.schema.json（schemaVersion: 1）
 *   - 所有写入自动更新 updatedAt
 *   - 不做 JSON schema 强校验（避免依赖 ajv）；只做字段级 defensive check
 *   - 向后兼容：readState 对旧 schema（v0 漂移版）尽量转成 v1 内存结构，但 writeState 只产 v1
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";

export const STATE_SCHEMA_VERSION = 1;

const CORE_PHASE_NAMES = ["understand", "prd", "spec-clarify", "design-strategy", "expand", "codegen", "verify"];
const STAGE_PHASE_NAMES = ["stage-1", "stage-2", "stage-3", "stage-4", "stage-5"];
const PHASE_NAMES = [...CORE_PHASE_NAMES, ...STAGE_PHASE_NAMES];
// mechanics 是 Phase 3.0 产物（primitive DAG），排在其余 expanders 之前。
// 它与 rule/event-graph 的关系：rule 和 event-graph 必须引用 mechanics.yaml 的 node id。
const EXPAND_SUBTASKS = ["mechanics", "scene", "rule", "data", "assets", "event-graph", "implementation-contract"];

/**
 * 读取 state.json。文件不存在返回 null；存在但 schema 旧则转换到 v1 内存结构。
 */
export function readState(filePath) {
  if (!existsSync(filePath)) return null;
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  if (raw.schemaVersion === STATE_SCHEMA_VERSION) return normalizeV1(raw);
  return migrateLegacy(raw);
}

/**
 * 写入 state.json（原子写）。自动更新 updatedAt。
 */
export function writeState(filePath, state) {
  const out = { ...state, updatedAt: new Date().toISOString() };
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp";
  writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n", "utf-8");
  // renameSync is atomic on POSIX; fallback to writeFileSync if unavailable
  try {
    const { renameSync } = require("fs");
    renameSync(tmp, filePath);
  } catch {
    writeFileSync(filePath, JSON.stringify(out, null, 2) + "\n", "utf-8");
  }
  return out;
}

/**
 * 初始化一个新 state 对象（不写入磁盘）。
 */
export function initState({ project, runtime, visualStyle, deliveryTarget }) {
  if (!project) throw new Error("initState: project is required");
  const now = new Date().toISOString();
  const st = {
    schemaVersion: STATE_SCHEMA_VERSION,
    project,
    createdAt: now,
    updatedAt: now,
    currentPhase: "understand",
    phases: {
      understand: { status: "pending" },
      prd: { status: "pending" },
      "spec-clarify": { status: "pending" },
      "design-strategy": { status: "pending" },
      expand: {
        status: "pending",
        subtasks: Object.fromEntries(EXPAND_SUBTASKS.map(k => [k, { status: "pending" }])),
      },
      codegen: { status: "pending" },
      verify: { status: "pending" },
      "stage-1": { status: "pending" },
      "stage-2": { status: "pending" },
      "stage-3": { status: "pending" },
      "stage-4": { status: "pending" },
      "stage-5": { status: "pending" },
    },
  };
  if (runtime) st.runtime = runtime;
  if (visualStyle) st.visualStyle = visualStyle;
  if (deliveryTarget) st.deliveryTarget = deliveryTarget;
  return st;
}

/**
 * 标记某个 phase 的状态。自动维护 startedAt / finishedAt / currentPhase。
 */
export function markPhase(state, phaseName, status, { error } = {}) {
  if (!PHASE_NAMES.includes(phaseName)) {
    throw new Error(`markPhase: unknown phase ${phaseName}`);
  }
  assertPhaseAllowedByPlan(state, phaseName, status);
  const now = new Date().toISOString();
  const phase = { ...(state.phases?.[phaseName] ?? { status: "pending" }) };
  const prevStatus = phase.status;
  phase.status = status;

  if (status === "running" && prevStatus !== "running") {
    phase.startedAt = phase.startedAt ?? now;
    phase.attempts = (phase.attempts ?? 0) + 1;
  }
  if (status === "completed" || status === "failed" || status === "skipped") {
    phase.finishedAt = now;
  }
  if (error) phase.error = error;

  const next = {
    ...state,
    phases: { ...state.phases, [phaseName]: phase },
  };

  if (status === "running") next.currentPhase = phaseName;
  if (status === "completed") {
    const nextPhase = nextPhaseAfter(phaseName);
    next.currentPhase = nextPhase ?? "done";
    if (!nextPhase) next.completedAt = now;
  }
  if (status === "failed") next.currentPhase = "failed";

  return next;
}

/**
 * 标记 expand 的某个子任务状态。仅对 expand 阶段有效。
 */
export function markSubtask(state, subtaskName, status, { output, error } = {}) {
  if (!EXPAND_SUBTASKS.includes(subtaskName)) {
    throw new Error(`markSubtask: unknown subtask ${subtaskName}`);
  }
  assertSubtaskAllowedByPlan(state, subtaskName, status);
  const now = new Date().toISOString();
  const expand = { ...(state.phases?.expand ?? {}) };
  const subtasks = { ...(expand.subtasks ?? {}) };
  const sub = { ...(subtasks[subtaskName] ?? { status: "pending" }) };
  const prev = sub.status;
  sub.status = status;
  if (status === "running" && prev !== "running") sub.startedAt = sub.startedAt ?? now;
  if (status === "completed" || status === "failed") sub.finishedAt = now;
  if (output) sub.output = output;
  if (error) sub.error = error;
  subtasks[subtaskName] = sub;
  expand.subtasks = subtasks;

  return {
    ...state,
    phases: { ...state.phases, expand },
  };
}

/**
 * 提交 expand：要求所有 subtask 全部 completed，否则抛错。
 * 调用方在 shell 里已经把 specs/.pending/*.yaml mv 到 specs/ 后调用本函数。
 */
export function commitExpand(state) {
  const subs = state.phases?.expand?.subtasks ?? {};
  const ok = s => s === "completed" || s === "skipped";
  const missing = EXPAND_SUBTASKS.filter(k => !ok(subs[k]?.status));
  if (missing.length > 0) {
    throw new Error(`commitExpand: subtasks not completed: ${missing.join(", ")}`);
  }
  const outputs = EXPAND_SUBTASKS
    .filter(k => subs[k]?.status === "completed")
    .map(k => `specs/${k}.yaml`);
  const next = markPhase(state, "expand", "completed");
  next.phases.expand.outputs = outputs;
  return next;
}

/**
 * 判断当前 state 是否可以从中断中恢复。
 * 返回 { resumable: true, resumeFrom: <phaseName>, unfinishedSubtasks?: [...] }
 */
export function isResumable(state) {
  if (!state) return { resumable: false, reason: "no state" };
  if (state.currentPhase === "done") return { resumable: false, reason: "already done" };
  if (state.currentPhase === "failed") return { resumable: false, reason: "previously failed, needs manual intervention" };

  for (const p of resumablePhaseOrder(state)) {
    const status = state.phases?.[p]?.status;
    if (status === "running" || status === "pending") {
      const info = { resumable: true, resumeFrom: p };
      if (p === "expand") {
        const subs = state.phases.expand.subtasks ?? {};
        info.unfinishedSubtasks = EXPAND_SUBTASKS.filter(
          k => subs[k]?.status !== "completed"
        );
      }
      return info;
    }
  }
  return { resumable: false, reason: "all phases completed" };
}

// ---------- internal ----------

function nextPhaseAfter(name) {
  if (STAGE_PHASE_NAMES.includes(name)) {
    const idx = STAGE_PHASE_NAMES.indexOf(name);
    return idx >= 0 && idx < STAGE_PHASE_NAMES.length - 1 ? STAGE_PHASE_NAMES[idx + 1] : null;
  }
  const idx = CORE_PHASE_NAMES.indexOf(name);
  if (idx < 0 || idx >= CORE_PHASE_NAMES.length - 1) return null;
  return CORE_PHASE_NAMES[idx + 1];
}

function normalizeV1(raw) {
  const phases = { ...(raw.phases ?? {}) };
  for (const p of PHASE_NAMES) {
    phases[p] = phases[p] ?? defaultPhaseForMissing(raw, p);
  }
  const expand = { ...(phases.expand ?? { status: "pending" }) };
  const subtasks = { ...(expand.subtasks ?? {}) };
  for (const k of EXPAND_SUBTASKS) {
    subtasks[k] = subtasks[k] ?? { status: "pending" };
  }
  expand.subtasks = subtasks;
  phases.expand = expand;
  return { ...raw, phases };
}

function defaultPhaseForMissing(raw, phaseName) {
  if (phaseName === "design-strategy") {
    const downstreamStarted = ["expand", "codegen", "verify"].some((p) =>
      ["running", "completed", "failed"].includes(raw.phases?.[p]?.status)
    );
    if (downstreamStarted) return { status: "skipped", reason: "missing in older state; downstream phase already started" };
  }
  return { status: "pending" };
}

function resumablePhaseOrder(state) {
  const stagePlanActive = Array.isArray(state?.phasePlan?.allowedStages) &&
    state.phasePlan.allowedStages.length > 0;
  const stageCurrent = /^stage-\d$/.test(String(state?.currentPhase ?? ""));
  return (stagePlanActive || stageCurrent) ? PHASE_NAMES : CORE_PHASE_NAMES;
}

function assertPhaseAllowedByPlan(state, phaseName, status) {
  if (status !== "running" && status !== "completed") return;
  const plan = state?.phasePlan;
  if (!plan?.plannedPhases) return;
  const planned = new Set(plan.plannedPhases);
  if (planned.has(phaseName)) return;
  const stageMatch = String(phaseName).match(/^stage-(\d)$/);
  if (stageMatch && Array.isArray(plan.allowedStages) && plan.allowedStages.includes(Number(stageMatch[1]))) return;
  if (phaseName === "expand" && planned.has("mechanics") && status === "running") return;
  throw new Error(`phase boundary: mode=${plan.mode || "<unknown>"} does not allow phase '${phaseName}' status=${status}; hardStop=${plan.hardStop || "<none>"}`);
}

function assertSubtaskAllowedByPlan(state, subtaskName, status) {
  if (status !== "running" && status !== "completed") return;
  const plan = state?.phasePlan;
  if (!plan?.plannedPhases) return;
  const planned = new Set(plan.plannedPhases);
  if (planned.has("expand")) return;
  if (planned.has("mechanics") && subtaskName === "mechanics") return;
  throw new Error(`phase boundary: mode=${plan.mode || "<unknown>"} does not allow expand subtask '${subtaskName}' status=${status}; hardStop=${plan.hardStop || "<none>"}`);
}

/**
 * 把旧漂移 schema（projectId / 扁平 phase / 无 schemaVersion）尽量转到 v1 结构。
 * 只在 readState 时用，不写回磁盘。
 */
function migrateLegacy(raw) {
  const project = raw.project ?? raw.projectId ?? "legacy";
  const createdAt = raw.createdAt ?? raw.startedAt ?? new Date().toISOString();
  const phases = {};
  for (const p of PHASE_NAMES) {
    const src = raw.phases?.[p] ?? raw[p] ?? defaultPhaseForMissing(raw, p);
    phases[p] = {
      status: src.status ?? "pending",
      ...(src.startedAt ? { startedAt: src.startedAt } : {}),
      ...(src.completedAt ? { finishedAt: src.completedAt } : {}),
      ...(src.finishedAt ? { finishedAt: src.finishedAt } : {}),
    };
  }
  // 老 case 通常没有 mechanics subtask。如果 expand 已 completed，把 mechanics 标为 skipped
  // （保持 commitExpand 通过），表示历史产物不具备原语基线；新 case 必须 completed。
  if (!phases.expand.subtasks) {
    phases.expand.subtasks = Object.fromEntries(
      EXPAND_SUBTASKS.map(k => {
        const status = phases.expand.status === "completed"
          ? (k === "mechanics" ? "skipped" : "completed")
          : "pending";
        return [k, { status }];
      })
    );
  } else if (!phases.expand.subtasks.mechanics) {
    // 已有 subtasks 但缺 mechanics（新增 primitive 链路后的老 state）
    phases.expand.subtasks.mechanics = {
      status: phases.expand.status === "completed" ? "skipped" : "pending",
    };
  }
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    project,
    createdAt,
    currentPhase: raw.currentPhase ?? "understand",
    phases,
    ...(raw.runtime ? { runtime: raw.runtime } : {}),
    ...(raw["visual-style"] ? { visualStyle: raw["visual-style"] } : {}),
    ...(raw.visualStyle ? { visualStyle: raw.visualStyle } : {}),
    ...(raw["delivery-target"] ? { deliveryTarget: raw["delivery-target"] } : {}),
    ...(raw.deliveryTarget ? { deliveryTarget: raw.deliveryTarget } : {}),
    _migrated: true,
  };
}
