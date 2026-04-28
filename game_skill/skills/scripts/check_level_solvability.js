#!/usr/bin/env node
/**
 * check_level_solvability.js — P2 可玩性验证（board-grid MVP）
 *
 * 读 specs/data.yaml + specs/mechanics.yaml →
 *   若 playability.genre === 'reflex' / 'edu-practice' 则做轻量字段校验；
 *   若 playability.genre !== 'board-grid' 则 ok-skip；
 *   否则按 solution-path.actions 顺序 replay 到对应 primitive reducer，
 *   验证最终 state 满足 win-condition；同时 replay anti-trivial.actions
 *   确认其 expected-win===false，并自动合成 trivial-click-all 反例。
 *
 * 用法: node check_level_solvability.js <case-dir> [--log ...]
 *
 * 退出码:
 *   0 = passed / ok-skip（非 board-grid / 未声明 solution-path）
 *   1 = 解不可达 / anti-trivial 居然通关 / 合法前缀软锁 / schema 缺失
 *   3 = 环境问题（mechanics.yaml 或 data.yaml 缺失、reducer 加载失败）
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";
import { indexMechanics } from "./_runtime_replay.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MECHANICS_ROOT = resolve(__dirname, "../references/mechanics");
const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const log = createLogger(parseLogArg(process.argv));

const errors = [];
const warnings = [];
const oks = [];

console.log(`Level solvability 校验: ${caseDir}`);

const dataPath = join(caseDir, "specs/data.yaml");
const mechPath = join(caseDir, "specs/mechanics.yaml");
if (!existsSync(dataPath)) {
  fail(`data.yaml 不存在: ${dataPath}`);
  finish(3, "missing-data");
}
if (!existsSync(mechPath)) {
  fail(`mechanics.yaml 不存在: ${mechPath}`);
  finish(3, "missing-mechanics");
}

const data = readYaml(dataPath, "data.yaml");
const mech = readYaml(mechPath, "mechanics.yaml");
if (!data || !mech) finish(3, "parse-error");

const playability = data?.playability ?? {};
const genre = playability?.genre;
if (genre === "reflex") {
  checkReflexSchema();
  finish(errors.length === 0 ? 0 : 1, "done:reflex");
}
if (genre === "edu-practice") {
  checkEduSchema();
  finish(errors.length === 0 ? 0 : 1, "done:edu-practice");
}
if (genre !== "board-grid") {
  ok(`playability.genre=${genre ?? "<missing>"}，非 board-grid 或未声明，跳过 level_solvability`);
  finish(0, "ok-skip:no-board-grid");
}

const levels = data?.["solution-path"]?.levels;
if (!Array.isArray(levels) || levels.length === 0) {
  fail(`board-grid 必须声明 solution-path.levels（至少 1 条 per level）`);
  finish(1, "missing-solution-path");
}

const winNodes = (mech.mechanics ?? []).filter((n) => n.primitive === "win-lose-check@v1");
if (winNodes.length === 0) {
  fail(`mechanics.yaml 缺 win-lose-check@v1，无法读取 win-condition`);
  finish(1, "missing-win-condition");
}

let reducers;
try {
  reducers = await loadReducers(mech);
} catch (e) {
  fail(e.message);
  finish(3, "reducer-load-failed");
}

const mechIndex = indexMechanics(mech);
const meaningfulMin = Number(playability?.["meaningful-decisions-min"] ?? 0);

for (const level of levels) {
  const levelId = level?.id ?? "<unknown>";
  console.log(`  ▶ level: ${levelId}`);
  const verdict = await checkLevel(level);
  log.entry({
    type: "check-run",
    phase: "verify",
    step: "level-solvability",
    script: "check_level_solvability.js",
    level: levelId,
    verdict: verdict.ok ? "passed" : "failed",
    steps: verdict.steps,
    errors: verdict.errors,
    warnings: verdict.warnings,
  });
  for (const msg of verdict.warnings) warn(`[level ${levelId}] ${msg}`);
  if (verdict.ok) ok(`[level ${levelId}] solution-path 可达 win (${verdict.steps} steps)`);
  else for (const msg of verdict.errors) fail(`[level ${levelId}] ${msg}`);
}

finish(errors.length === 0 ? 0 : 1, "done");

// ---------- impl ----------

function readYaml(path, label) {
  try {
    return yaml.load(readFileSync(path, "utf-8"));
  } catch (e) {
    fail(`读取 ${label} 失败: ${e.message}`);
    return null;
  }
}

function checkReflexSchema() {
  const levelId = schemaLevelId();
  const violations = [];
  const missing = [];
  for (const key of [
    "target-frequency.min-per-sec",
    "target-frequency.max-per-sec",
    "hit-window-ms",
    "failure-feedback",
    "retry-path",
    "fairness.consecutive-misses-max",
    "fairness.first-target-delay-ms-max",
  ]) {
    if (!hasDeep(playability, key)) missing.push(key);
  }
  if (missing.length > 0) violations.push(...missing.map((key) => `missing:${key}`));

  const minPerSec = Number(playability?.["target-frequency"]?.["min-per-sec"]);
  const maxPerSec = Number(playability?.["target-frequency"]?.["max-per-sec"]);
  const hitWindowMs = Number(playability?.["hit-window-ms"]);
  const missesMax = Number(playability?.fairness?.["consecutive-misses-max"]);
  const firstDelayMax = Number(playability?.fairness?.["first-target-delay-ms-max"]);

  if (Number.isFinite(minPerSec) && Number.isFinite(maxPerSec) && minPerSec > maxPerSec) {
    violations.push("target-frequency.min-per-sec>max-per-sec");
  }
  if (Number.isFinite(hitWindowMs) && hitWindowMs < 100) {
    violations.push("hit-window-ms<100");
  }
  if (Number.isFinite(missesMax) && missesMax < 1) {
    violations.push("consecutive-misses-max<1");
  }
  if (Number.isFinite(firstDelayMax) && firstDelayMax > 5000) {
    violations.push("warning:first-target-delay-ms-max>5000");
    warn(`[level ${levelId}] first-target-delay-ms-max=${firstDelayMax} > 5000`);
  }

  log.entry({
    type: "check-run",
    phase: "verify",
    step: "reflex-schema",
    script: "check_level_solvability.js",
    level: levelId,
    violations,
  });

  const hard = violations.filter((v) => !v.startsWith("warning:"));
  if (hard.length > 0) {
    for (const v of hard) fail(`[level ${levelId}] reflex-schema ${v}`);
  } else {
    ok(`[level ${levelId}] reflex-schema 字段校验通过`);
  }
}

function checkEduSchema() {
  const levelId = schemaLevelId();
  const violations = [];
  const missing = [];
  for (const key of [
    "item-count",
    "correct-feedback",
    "error-feedback",
    "progressive-difficulty.levels",
    "progressive-difficulty.items-per-level",
    "progressive-difficulty.must-cover-all",
    "passing-threshold-pct",
  ]) {
    if (!hasDeep(playability, key)) missing.push(key);
  }
  if (missing.length > 0) violations.push(...missing.map((key) => `missing:${key}`));

  const itemCount = Number(playability?.["item-count"]);
  const levels = Number(playability?.["progressive-difficulty"]?.levels);
  const itemsPerLevel = Number(playability?.["progressive-difficulty"]?.["items-per-level"]);
  const threshold = Number(playability?.["passing-threshold-pct"]);

  if (Number.isFinite(itemCount) && itemCount < 5) violations.push("item-count<5");
  if (Number.isFinite(levels) && Number.isFinite(itemsPerLevel) && Number.isFinite(itemCount) && levels * itemsPerLevel > itemCount) {
    violations.push("progressive-difficulty.coverage>item-count");
  }
  if (Number.isFinite(threshold) && (threshold < 50 || threshold > 95)) {
    violations.push("warning:passing-threshold-pct-out-of-range");
    warn(`[level ${levelId}] passing-threshold-pct=${threshold} 不在 50..95`);
  }

  log.entry({
    type: "check-run",
    phase: "verify",
    step: "edu-schema",
    script: "check_level_solvability.js",
    level: levelId,
    violations,
  });

  const hard = violations.filter((v) => !v.startsWith("warning:"));
  if (hard.length > 0) {
    for (const v of hard) fail(`[level ${levelId}] edu-schema ${v}`);
  } else {
    ok(`[level ${levelId}] edu-schema 字段校验通过`);
  }
}

function schemaLevelId() {
  return data?.["initial-state"]?.level ?? data?.level ?? "global";
}

function hasDeep(obj, path) {
  return getDeep(obj, path) !== undefined && getDeep(obj, path) !== null && getDeep(obj, path) !== "";
}

async function loadReducers(mechanics) {
  const indexPath = join(MECHANICS_ROOT, "_index.yaml");
  if (!existsSync(indexPath)) throw new Error(`primitive catalog _index.yaml 不存在: ${indexPath}`);
  const idx = yaml.load(readFileSync(indexPath, "utf-8")) ?? { primitives: [] };
  const primMap = new Map();
  for (const p of idx.primitives ?? []) primMap.set(`${p.id}@${p.version}`, p);

  const out = new Map();
  for (const node of mechanics.mechanics ?? []) {
    const pid = node.primitive;
    if (!pid || out.has(pid)) continue;
    const meta = primMap.get(pid);
    if (!meta?.reducer) throw new Error(`unknown primitive ${pid}（不在 _index.yaml）`);
    const reducerUrl = pathToFileURL(join(MECHANICS_ROOT, meta.reducer)).href;
    const mod = await import(reducerUrl);
    if (!mod?.step) throw new Error(`${pid} reducer 缺 step()`);
    out.set(pid, mod);
  }
  return out;
}

async function checkLevel(level) {
  const localErrors = [];
  const localWarnings = [];
  const actions = Array.isArray(level?.actions) ? level.actions : [];
  if (actions.length === 0) {
    return { ok: false, steps: 0, errors: ["solution-path.actions 为空"], warnings: localWarnings };
  }
  if (Number.isFinite(meaningfulMin) && meaningfulMin > 0 && actions.length < meaningfulMin) {
    localWarnings.push(`actions.length=${actions.length} < meaningful-decisions-min=${meaningfulMin}`);
  }
  if (level?.["min-steps"] != null && actions.length < Number(level["min-steps"])) {
    localWarnings.push(`actions.length=${actions.length} < min-steps=${level["min-steps"]}`);
  }
  if (level?.["max-steps"] != null && actions.length > Number(level["max-steps"])) {
    localWarnings.push(`actions.length=${actions.length} > max-steps=${level["max-steps"]}`);
  }

  const main = await runPath(level, actions);
  localErrors.push(...main.errors);
  localWarnings.push(...main.warnings);
  if (main.outcome !== "win") {
    localErrors.push(`solution-path 未触发 win-condition（actual=${main.outcome ?? "<none>"}）`);
  }

  const softlock = await runSoftlockProbes(level, actions);
  localErrors.push(...softlock.errors);
  localWarnings.push(...softlock.warnings);

  const anti = level?.["anti-trivial"];
  const wantsNonTrivial = playability?.["trivial-click-all"] === false;
  if (anti?.actions) {
    const antiRun = await runPath(level, anti.actions);
    const expectedWin = anti["expected-win"] === true;
    const actualWin = antiRun.outcome === "win";
    localErrors.push(...antiRun.errors);
    localWarnings.push(...antiRun.warnings.map((w) => `anti-trivial: ${w}`));
    if (actualWin !== expectedWin) {
      localErrors.push(`anti-trivial expected-win=${expectedWin}，actual=${actualWin}`);
    }
  }
  if (wantsNonTrivial) {
    const trivial = await runTrivialClickAllProbe(level);
    localErrors.push(...trivial.errors);
    localWarnings.push(...trivial.warnings);
  }

  return {
    ok: localErrors.length === 0,
    steps: actions.length,
    errors: localErrors,
    warnings: localWarnings,
  };
}

async function runPath(level, actions) {
  const state = buildInitialState(level);
  const histories = new Map();
  return runActionsFromState(state, histories, actions, 0);
}

async function runActionsFromState(state, histories, actions, indexOffset = 0) {
  const pathErrors = [];
  const pathWarnings = [];
  let outcome = await evaluateWin(state, histories);

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i] ?? {};
    const label = action.event ?? action.type ?? `#${i + 1}`;
    const result = await replayAction(state, action, histories);
    const actionIndex = indexOffset + i;
    if (!result.used) pathErrors.push(`action[${actionIndex}] ${label}: 没有匹配的 primitive reducer`);
    pathErrors.push(...result.errors.map((e) => `action[${actionIndex}] ${label}: ${e}`));
    pathWarnings.push(...result.warnings.map((w) => `action[${actionIndex}] ${label}: ${w}`));

    const expectedErrors = checkExpectedEffects(state, action);
    pathErrors.push(...expectedErrors.map((e) => `action[${actionIndex}] ${label}: ${e}`));

    outcome = await evaluateWin(state, histories);
    if (i < actions.length - 1 && outcome === "lose") {
      pathErrors.push(`action[${actionIndex}] ${label}: 合法前缀提前进入 lose，疑似软锁`);
      break;
    }
  }

  return { state, histories, outcome, errors: pathErrors, warnings: pathWarnings };
}

async function runSoftlockProbes(level, actions) {
  const levelId = level?.id ?? "<unknown>";
  const out = { errors: [], warnings: [] };
  const enabled = playability?.["no-softlock-after-valid-prefix"];
  if (enabled === false) {
    log.entry({
      type: "check-run",
      phase: "verify",
      step: "softlock-probe",
      script: "check_level_solvability.js",
      level: levelId,
      prefixLen: null,
      ok: true,
      skipped: true,
    });
    out.warnings.push("playability.no-softlock-after-valid-prefix=false，跳过 softlock probe");
    return out;
  }
  if (enabled !== true) return out;

  const prefixLens = samplePrefixLengths(actions.length);
  if (prefixLens.length === 0) {
    out.warnings.push("solution-path.actions 太短，无法抽样合法前缀 softlock probe");
    return out;
  }

  for (const prefixLen of prefixLens) {
    const state = buildInitialState(level);
    const histories = new Map();
    const prefix = await runActionsFromState(state, histories, actions.slice(0, prefixLen), 0);
    const suffix = await runActionsFromState(state, histories, actions.slice(prefixLen), prefixLen);
    const probeErrors = [
      ...prefix.errors,
      ...suffix.errors,
    ];
    if (prefix.outcome === "lose") probeErrors.push(`prefixLen=${prefixLen} 后 outcome=lose`);
    if (suffix.outcome !== "win") probeErrors.push(`suffix 未触发 win-condition（actual=${suffix.outcome ?? "<none>"}）`);
    const okProbe = probeErrors.length === 0;
    log.entry({
      type: "check-run",
      phase: "verify",
      step: "softlock-probe",
      script: "check_level_solvability.js",
      level: levelId,
      prefixLen,
      ok: okProbe,
    });
    if (!okProbe) {
      out.errors.push(`softlock-after-prefix prefixLen=${prefixLen}: ${probeErrors.slice(0, 4).join("; ")}`);
    }
    out.warnings.push(...prefix.warnings.map((w) => `softlock-prefix(${prefixLen}): ${w}`));
    out.warnings.push(...suffix.warnings.map((w) => `softlock-suffix(${prefixLen}): ${w}`));
  }
  return out;
}

function samplePrefixLengths(actionCount) {
  const maxPrefix = actionCount - 1;
  if (maxPrefix <= 0) return [];
  if (maxPrefix <= 3) return Array.from({ length: maxPrefix }, (_, i) => i + 1);
  return [...new Set([1, Math.ceil(maxPrefix / 2), maxPrefix])].sort((a, b) => a - b);
}

async function runTrivialClickAllProbe(level) {
  const levelId = level?.id ?? "<unknown>";
  const actions = synthesizeTrivialClickAllActions(level);
  const run = await runPath(level, actions);
  const wonByTrivial = run.outcome === "win";
  log.entry({
    type: "check-run",
    phase: "verify",
    step: "trivial-probe",
    script: "check_level_solvability.js",
    level: levelId,
    wonByTrivial,
  });
  const errors = wonByTrivial
    ? [`trivial-click-all-wins（auto actions=${actions.length}）`]
    : [];
  return {
    errors,
    warnings: [
      ...run.warnings,
      ...run.errors.map((e) => `trivial-probe replay 未形成通关路径: ${e}`),
    ],
  };
}

function synthesizeTrivialClickAllActions(level) {
  const state = buildInitialState(level);
  const seen = new Set();
  const units = [];
  for (const collection of ["units", "pigs", "agents"]) {
    for (const item of state.collections?.[collection] ?? []) {
      if (!item?.id || seen.has(item.id)) continue;
      if (item.alive === false) continue;
      if (item.ammo != null && Number(item.ammo) <= 0) continue;
      seen.add(item.id);
      units.push(String(item.id));
    }
  }
  return units.sort((a, b) => a.localeCompare(b)).map((unitId) => ({
    event: "dispatch-pig",
    payload: { unitId },
  }));
}

function buildInitialState(level) {
  const base = clone(data["initial-state"] ?? {});
  const state = {
    ...base,
    collections: clone(base.collections ?? {}),
    fields: { ...(base.fields ?? {}) },
    __winLose: {},
  };

  mergeLevelState(state, level);
  normalizeCollections(state);
  applyEntityDefaults(state);
  return state;
}

function mergeLevelState(state, level) {
  if (level?.["initial-state"]) deepMerge(state, clone(level["initial-state"]));
  if (level?.setup && typeof level.setup === "object") {
    state.collections = { ...(state.collections ?? {}), ...clone(level.setup) };
  }
  const templates = level?.["entity-templates"];
  if (templates && typeof templates === "object") {
    if (Array.isArray(templates)) {
      for (const item of templates) {
        const collection = item.collection || pluralize(item.type || "entity");
        if (!state.collections[collection]) state.collections[collection] = [];
        state.collections[collection].push({ ...item });
      }
    } else {
      for (const [collection, list] of Object.entries(templates)) {
        if (Array.isArray(list)) state.collections[collection] = clone(list);
      }
    }
  }
  if (level?.["conveyor-config"]) state.conveyor = clone(level["conveyor-config"]);
}

function normalizeCollections(state) {
  const directCollections = ["blocks", "pigs", "units", "targets", "cells", "cards", "tiles"];
  for (const key of directCollections) {
    if (Array.isArray(state[key]) && !state.collections[key]) state.collections[key] = state[key];
  }
  if (Array.isArray(state.board?.blocks) && !state.collections.blocks) {
    state.collections.blocks = state.board.blocks;
  }
  if (state.collections.blocks) {
    state.board = state.board ?? {};
    state.board.blocks = state.collections.blocks;
    state.board.cells = state.collections.blocks;
  }

  for (const [key, value] of Object.entries(state)) {
    if (["collections", "fields", "__winLose"].includes(key)) continue;
    if (Array.isArray(value) || (value && typeof value === "object")) continue;
    state.fields[key] = value;
  }

  const levelConfig = findLevelConfig(state);
  if (levelConfig?.blockLayout && !state.collections.blocks) {
    state.collections.blocks = levelConfig.blockLayout.map((b, idx) => ({
      id: b.id ?? `block-${b.row}-${b.col}-${idx}`,
      row: b.row,
      col: b.col,
      color: b.color,
      hp: b.hp ?? levelConfig.blockHp ?? 1,
      maxHp: b.maxHp ?? b.hp ?? levelConfig.blockHp ?? 1,
      alive: b.alive ?? true,
    }));
  }
}

function findLevelConfig(state) {
  const resources = Array.isArray(data.resources) ? data.resources : [];
  const levelId = state.level;
  for (const res of resources) {
    for (const ex of res.examples ?? []) {
      if (String(ex.level) === String(levelId)) return ex;
    }
  }
  return null;
}

function applyEntityDefaults(state) {
  const defaults = new Map();
  for (const ent of mech.entities ?? []) {
    if (ent.id && ent.initial) defaults.set(pluralize(ent.id), ent.initial);
  }
  for (const [collection, list] of Object.entries(state.collections ?? {})) {
    if (!Array.isArray(list)) continue;
    const def = defaults.get(collection) ?? defaults.get(collection.replace(/ies$/, "y").replace(/s$/, ""));
    if (!def) continue;
    state.collections[collection] = list.map((item) => ({ ...clone(def), ...item }));
  }
}

async function replayAction(state, action, histories) {
  const errors = [];
  const warnings = [];
  let used = false;
  const event = materializeEvent(state, action);

  const busResult = await dispatchEventBus(state, event, histories);
  used = used || busResult.used;
  errors.push(...busResult.errors);
  warnings.push(...busResult.warnings);

  if (!used) {
    const direct = await applyDirectAlias(state, action, event, histories);
    used = used || direct.used;
    errors.push(...direct.errors);
    warnings.push(...direct.warnings);
  }
  return { used, errors, warnings };
}

function materializeEvent(state, action) {
  const payload = { ...(action.payload ?? {}) };
  const type = canonicalEventName(action.event ?? action.type);
  const sourceId = payload.sourceId ?? payload.unitId ?? payload.pigId ?? payload.agentId;
  const targetId = payload.targetId ?? payload.blockId ?? payload.rightId;
  const entityId = payload.entityId ?? payload.unitId ?? payload.pigId ?? payload.agentId;
  const source = sourceId ? findEntity(state, sourceId) : null;
  const target = targetId ? findEntity(state, targetId) : null;
  const ev = {
    type,
    ...payload,
    entityId,
    occupantId: payload.occupantId ?? entityId,
    slotId: payload.slotId ?? payload.fromSlot,
  };
  if (source) {
    ev.source = source;
    ev.agent = source;
    ev.left = source;
  }
  if (target) {
    ev.target = target;
    ev.right = target;
    ev.targets = [target];
  }
  return ev;
}

async function dispatchEventBus(state, initialEvent, histories) {
  const queue = [{ ev: initialEvent }];
  const errors = [];
  const warnings = [];
  let used = false;
  let iter = 0;

  while (queue.length && iter++ < 100) {
    const { ev } = queue.shift();
    for (const node of mech.mechanics ?? []) {
      if (!(node["trigger-on"] ?? []).some((trigger) => eventMatches(trigger, ev.type))) continue;
      const reducer = reducers.get(node.primitive);
      if (!reducer?.resolveAction) continue;
      const reducerAction = reducer.resolveAction(node, ev, state);
      if (!reducerAction) continue;
      used = true;
      const stepResult = reducer.step(state, reducerAction, node.params ?? {});
      pushHistory(histories, node.node, stepResult);
      applyReducerResult(state, node, reducer, ev, stepResult, queue);
      errors.push(...checkNodeInvariants(node, reducer, histories));
    }
  }
  if (iter >= 100) errors.push("event bus 超过 100 次传播，疑似循环");
  return { used, errors, warnings };
}

async function applyDirectAlias(state, action, ev, histories) {
  const type = canonicalEventName(action.event ?? action.type);
  if (["dispatch-pig", "dispatch", "input.click-dispatch", "pool.request-unbind"].includes(type)) {
    return applyDispatch(state, ev, histories);
  }
  if (["match.hit", "resource.consume", "consume"].includes(type)) {
    return await applyConsume(state, ev, histories);
  }
  if (["board.cell-removed", "remove-cell", "remove-block", "clear-block"].includes(type)) {
    return applyRemoveCell(state, ev, histories);
  }
  if (["lifecycle.event", "entity-transition"].includes(type)) {
    return applyLifecycle(state, ev, ev.event ?? ev.lifecycleEvent, histories);
  }
  if (["set-field", "state.set"].includes(type)) {
    return applySetField(state, action);
  }
  return { used: false, errors: [], warnings: [] };
}

function applyDispatch(state, ev, histories) {
  const errors = [];
  let used = false;
  const entityId = ev.entityId ?? ev.occupantId;

  for (const node of mech.mechanics ?? []) {
    if (node.primitive !== "slot-pool@v1") continue;
    const reducer = reducers.get(node.primitive);
    const poolState = { pool: state.pools?.[node.node] ?? state.pool ?? state.waitSlots };
    const result = reducer.step(poolState, {
      type: "unbind",
      occupantId: entityId,
      slotId: ev.slotId,
    }, node.params ?? {});
    state.pools = state.pools ?? {};
    state.pools[node.node] = result.pool;
    state.pool = result.pool;
    state.waitSlots = result.pool;
    pushHistory(histories, node.node, result);
    errors.push(...checkNodeInvariants(node, reducer, histories));
    used = true;
  }

  const lifecycle = applyLifecycle(state, ev, ev.lifecycleEvent ?? "dispatched", histories);
  return {
    used: used || lifecycle.used,
    errors: [...errors, ...lifecycle.errors],
    warnings: lifecycle.warnings,
  };
}

function applyLifecycle(state, ev, lifecycleEvent, histories) {
  const errors = [];
  let used = false;
  const entityId = ev.entityId ?? ev.occupantId;
  if (!entityId || !lifecycleEvent) {
    return { used: false, errors: ["lifecycle action 缺 entityId/event"], warnings: [] };
  }
  for (const node of mech.mechanics ?? []) {
    if (node.primitive !== "entity-lifecycle@v1") continue;
    const reducer = reducers.get(node.primitive);
    const result = reducer.step(state, {
      type: "transition",
      entityId,
      event: lifecycleEvent,
    }, node.params ?? {});
    pushHistory(histories, node.node, result);
    errors.push(...checkNodeInvariants(node, reducer, histories));
    if ((result._events ?? []).some((item) => item.type === "lifecycle.invalid-transition")) {
      errors.push(`entity-lifecycle invalid transition: ${JSON.stringify(result._events)}`);
    }
    used = true;
  }
  return { used, errors, warnings: [] };
}

async function applyConsume(state, ev, histories) {
  const errors = [];
  let used = false;
  const agent = ev.agent ?? ev.source ?? findEntity(state, ev.agentId ?? ev.sourceId);
  const target = ev.target ?? ev.right ?? findEntity(state, ev.targetId ?? ev.blockId);
  if (!agent || !target) {
    return { used: false, errors: ["consume action 缺 agent/target 实体"], warnings: [] };
  }
  for (const node of mech.mechanics ?? []) {
    if (node.primitive !== "resource-consume@v1") continue;
    const reducer = reducers.get(node.primitive);
    const result = reducer.step({ agent, target }, { type: "consume", agent, target }, node.params ?? {});
    pushHistory(histories, node.node, result);
    const queue = [];
    applyReducerResult(state, node, reducer, ev, result, queue);
    for (const { ev: nextEv } of queue) {
      nextEv.agent = findEntity(state, result.agent?.id) ?? result.agent;
      nextEv.target = findEntity(state, result.target?.id) ?? result.target;
      const downstream = await dispatchEventBus(state, nextEv, histories);
      errors.push(...downstream.errors);
    }
    errors.push(...checkNodeInvariants(node, reducer, histories));
    used = true;
  }
  return { used, errors, warnings: [] };
}

function applyRemoveCell(state, ev, histories) {
  const errors = [];
  let used = false;
  const cellId = ev.cellId ?? ev.targetId ?? ev.blockId;
  const target = cellId ? findEntity(state, cellId) : null;
  if (target) {
    target.alive = false;
    if (target.hp != null) target.hp = 0;
    used = true;
  }
  for (const node of mech.mechanics ?? []) {
    if (node.primitive !== "grid-board@v1") continue;
    const reducer = reducers.get(node.primitive);
    const result = reducer.step({ cells: state.collections.blocks ?? [] }, { type: "remove-cell", cellId }, node.params ?? {});
    if (Array.isArray(result.cells)) state.collections.blocks = result.cells;
    pushHistory(histories, node.node, result);
    errors.push(...checkNodeInvariants(node, reducer, histories));
    used = true;
  }
  return { used, errors, warnings: [] };
}

function applySetField(state, action) {
  const payload = action.payload ?? {};
  const target = payload.entityId ? findEntity(state, payload.entityId) : state;
  if (!target || !payload.field) return { used: false, errors: ["set-field 缺 target 或 field"], warnings: [] };
  setDeep(target, payload.field, payload.value ?? payload.to);
  return { used: true, errors: [], warnings: [] };
}

function applyReducerResult(state, node, reducer, ev, result, queue) {
  for (const newEv of result._events ?? []) {
    queue.push({ ev: newEv, node });
    if (typeof reducer.applyEffects === "function") {
      reducer.applyEffects(node, newEv, result, state);
    }
  }
  if (node.primitive === "slot-pool@v1" && result.pool) {
    state.pools = state.pools ?? {};
    state.pools[node.node] = result.pool;
    state.pool = result.pool;
    state.waitSlots = result.pool;
  }
  if (node.primitive === "grid-board@v1" && Array.isArray(result.cells)) {
    state.collections.blocks = result.cells;
    state.board = state.board ?? {};
    state.board.blocks = result.cells;
    state.board.cells = result.cells;
  }
}

async function evaluateWin(state, histories) {
  let outcome = null;
  for (const node of winNodes) {
    const reducer = reducers.get(node.primitive);
    const prev = state.__winLose[node.node] ?? {};
    const result = reducer.step(prev, {
      type: "evaluate",
      ctx: buildWinCtx(state),
    }, node.params ?? {});
    state.__winLose[node.node] = result;
    pushHistory(histories, node.node, result);
    if (result.outcome && !outcome) outcome = result.outcome;
  }
  if (!outcome && (state.isWin === true || state.phase === "win" || state.currentScene === "win")) {
    outcome = "win";
  }
  return outcome;
}

function buildWinCtx(state) {
  return {
    collections: state.collections ?? {},
    fields: {
      ...(state.fields ?? {}),
      score: state.score ?? state.fields?.score,
      timeLeft: state.timeLeft ?? state.fields?.timeLeft,
    },
    elapsedMs: state.elapsedMs ?? 0,
  };
}

function checkExpectedEffects(state, action) {
  const checks = normalizeExpectedEffects(action["expected-effect"]);
  const out = [];
  for (const check of checks) {
    const target = check.entity ? findEntity(state, check.entity) : state;
    if (!target) {
      out.push(`expected-effect entity 不存在: ${check.entity}`);
      continue;
    }
    const actual = getDeep(target, check.field);
    const expected = check.to ?? check.value;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      out.push(`expected-effect ${check.entity ?? "state"}.${check.field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }
  return out;
}

function normalizeExpectedEffects(effect) {
  if (!effect) return [];
  if (Array.isArray(effect)) return effect;
  return [effect];
}

function checkNodeInvariants(node, reducer, histories) {
  if (typeof reducer.checkInvariants !== "function") return [];
  const history = histories.get(node.node) ?? [];
  let result;
  if (node.primitive === "grid-board@v1") {
    result = reducer.checkInvariants(history.at(-1) ?? { cells: [] }, node.params ?? {});
  } else {
    result = reducer.checkInvariants(history, node.params ?? {});
  }
  if (result?.ok !== false) return [];
  return (result.violations ?? []).map((v) => `[invariant@${node.node}:${node.primitive}] ${v}`);
}

function pushHistory(histories, nodeId, snap) {
  if (!histories.has(nodeId)) histories.set(nodeId, []);
  histories.get(nodeId).push(clone(stripRuntimeFields(snap)));
}

function findEntity(state, id) {
  if (!id) return null;
  for (const list of Object.values(state.collections ?? {})) {
    if (!Array.isArray(list)) continue;
    const found = list.find((item) => item?.id === id);
    if (found) return found;
  }
  return null;
}

function eventMatches(produced, expected) {
  if (produced === expected) return true;
  if (typeof produced === "string" && produced.endsWith("*")) return expected.startsWith(produced.slice(0, -1));
  if (typeof expected === "string" && expected.endsWith("*")) return produced.startsWith(expected.slice(0, -1));
  return false;
}

function canonicalEventName(name) {
  const raw = String(name ?? "");
  const aliases = {
    "match-hit": "match.hit",
    "match-miss": "match.miss",
    "resource-consume": "resource.consume",
    "board-cell-removed": "board.cell-removed",
    "lifecycle-event": "lifecycle.event",
  };
  return aliases[raw] ?? raw;
}

function pluralize(name) {
  if (!name) return "entities";
  if (name.endsWith("s")) return name;
  if (name.endsWith("y")) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

function getDeep(obj, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((cur, part) => cur?.[part], obj);
}

function setDeep(obj, path, value) {
  const parts = String(path).split(".");
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    cur[part] = cur[part] ?? {};
    cur = cur[part];
  }
  cur[parts.at(-1)] = value;
}

function deepMerge(target, src) {
  for (const [key, value] of Object.entries(src ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) {
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stripRuntimeFields(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripRuntimeFields);
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = stripRuntimeFields(value);
  }
  return out;
}

function ok(msg) { oks.push(msg); console.log(`  ✓ ${msg}`); }
function warn(msg) { warnings.push(msg); console.log(`  ⚠ ${msg}`); }
function fail(msg) { errors.push(msg); console.log(`  ✗ ${msg}`); }

function finish(code, tag) {
  const summary = errors.length === 0
    ? `✓ level_solvability passed (${oks.length} ok, ${warnings.length} warn) [${tag}]`
    : `✗ ${errors.length} 个错误 (${warnings.length} warn) [${tag}]`;
  console.log(`\n${summary}`);
  log.entry({
    type: "check-run",
    phase: "verify",
    step: "level-solvability",
    script: "check_level_solvability.js",
    exit_code: code,
    tag,
    oks: oks.length,
    warnings: warnings.length,
    errors,
  });
  process.exit(code);
}
