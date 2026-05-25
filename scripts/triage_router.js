#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvolutionLog, readEvolutionLog } from "./_evolution_log.js";
import { buildTriagePrompt } from "./_triage_prompt.js";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const VALID_DECISIONS = new Set(["execute", "clarify", "reject"]);
const SPEC_IMPACTS = new Set(["none", "spec-correction", "spec-shape-change"]);
const LEAK_RE = /\b(?:Stage|stage)\s*[2345]\b|\bS[2345]\b/u;

export async function routeQuery({ casePath, rawQuery, logDecision = true, forceLocal = false, rekickFrom = null }) {
  const caseDir = resolve(REPO, casePath);
  const caseId = basename(caseDir);
  if (!rawQuery || !rawQuery.trim()) {
    throw new Error("query is required");
  }

  const context = await readRouterContext(caseDir, caseId, rawQuery);
  if (context.reject) {
    const decision = context.reject;
    if (logDecision) await safeLogDecision(caseDir, decision, context);
    return decision;
  }

  const prompt = buildTriagePrompt({
    rawQuery,
    caseId,
    plan: context.plan,
    deliverySummary: context.deliverySummary,
    runnerSummary: context.runnerSummary,
    recentEvolutionLog: rekickFrom ? withRekickContext(context.recentEvolutionLog, rekickFrom) : context.recentEvolutionLog,
    screenshotArtifacts: context.screenshotArtifacts,
    providerConfig: context.providerConfig,
  });

  let decision;
  const useLlm = shouldUseLlm(context.providerConfig, forceLocal);
  if (useLlm) {
    decision = await routeWithLlm({ prompt, context, rawQuery, caseId });
  } else {
    decision = localRoute({ rawQuery, caseId, baselineRef: context.baseline.baselineId, rekickFrom });
  }

  const checked = validateDecision(decision);
  if (!checked.ok) {
    const reject = rejectDecision({
      rawQuery,
      caseId,
      baselineRef: context.baseline.baselineId,
      reason: `router validation failed: ${checked.errors.join("; ")}`,
      guidance: "请把需求改写成明确的 bug、加玩法、调体验或美化请求后重试。",
    });
    if (logDecision) await safeLogDecision(caseDir, reject, context);
    return reject;
  }

  const reentryCheck = rekickFrom ? validateReentryDecision(decision, rekickFrom) : { ok: true };
  if (!reentryCheck.ok) {
    const reject = rejectDecision({
      rawQuery,
      caseId,
      baselineRef: context.baseline.baselineId,
      reason: reentryCheck.reason,
      guidance: "请改写为明确的修复、新增、调体验或美化请求后重试。",
    });
    if (logDecision) await safeLogDecision(caseDir, reject, context, { transport: useLlm ? "llm" : "local-fallback", reentry: Boolean(rekickFrom) });
    return reject;
  }

  if (logDecision) {
    await safeLogDecision(caseDir, decision, context, {
      transport: useLlm ? "llm" : "local-fallback",
      ...(rekickFrom ? safeRekickLogFields(rekickFrom) : {}),
    });
  }
  return decision;
}

export function validateDecision(decision) {
  const errors = [];
  if (!decision || typeof decision !== "object") return { ok: false, errors: ["decision must be an object"] };
  if (!VALID_DECISIONS.has(decision.decision)) errors.push("invalid decision");

  const hasSubtasks = Array.isArray(decision.subtasks) && decision.subtasks.length > 0;
  const hasClarifications = Array.isArray(decision.clarifications) && decision.clarifications.length > 0;
  const hasReason = typeof decision.reason === "string" && decision.reason.length > 0;
  const nonEmptyShapeFields = [hasSubtasks, hasClarifications, hasReason].filter(Boolean).length;
  if (nonEmptyShapeFields !== 1) errors.push("shape fields must be mutually exclusive");

  if (decision.decision === "execute") {
    if (!hasSubtasks) errors.push("execute requires subtasks");
    validateSubtasks(decision.subtasks ?? [], errors);
  } else if (decision.decision === "clarify") {
    if (!hasClarifications) errors.push("clarify requires clarifications");
    for (const item of decision.clarifications ?? []) {
      if (!item || typeof item !== "object") errors.push("clarification must be an object");
      if (typeof item?.id !== "string") errors.push("clarification.id is required");
      if (typeof item?.question !== "string") errors.push("clarification.question is required");
      if (typeof item?.context !== "string") errors.push("clarification.context is required");
      if (LEAK_RE.test(item?.question ?? "")) errors.push("stage number leaked in clarification.question");
    }
  } else if (decision.decision === "reject") {
    if (!hasReason) errors.push("reject requires reason");
    if (LEAK_RE.test(decision.reason ?? "")) errors.push("stage number leaked in reason");
  }

  return { ok: errors.length === 0, errors };
}

function validateSubtasks(subtasks, errors) {
  const seen = new Set();
  let previousStage = 0;
  for (const subtask of subtasks) {
    if (!subtask || typeof subtask !== "object") {
      errors.push("subtask must be an object");
      continue;
    }
    if (typeof subtask.id !== "string" || !/^s[2-5]-\d{3}$/u.test(subtask.id)) errors.push("subtask.id format");
    if (![2, 3, 4, 5].includes(subtask.stage)) errors.push("subtask.stage range");
    if (typeof subtask.subIntent !== "string" || subtask.subIntent.length === 0) errors.push("subtask.subIntent");
    if (subtask.subIntent?.length > 30) errors.push("subtask.subIntent too long");
    if (LEAK_RE.test(subtask.subIntent ?? "")) errors.push("stage number leaked in subIntent");
    if (!SPEC_IMPACTS.has(subtask.specImpact)) errors.push("subtask.specImpact");
    if (!Array.isArray(subtask.evidenceRequired)) errors.push("subtask.evidenceRequired");
    if (typeof subtask.stopIfFails !== "boolean") errors.push("subtask.stopIfFails");
    if (!Array.isArray(subtask.dependsOn)) errors.push("subtask.dependsOn");
    if (!Array.isArray(subtask.expectedArtifacts)) errors.push("subtask.expectedArtifacts");
    if (subtask.stage < previousStage) errors.push("subtask stage order");
    previousStage = subtask.stage;
    for (const dependency of subtask.dependsOn ?? []) {
      if (!seen.has(dependency)) errors.push(`dependsOn references unknown or later subtask: ${dependency}`);
    }
    seen.add(subtask.id);
  }
}

async function readRouterContext(caseDir, caseId, rawQuery) {
  if (!existsSync(caseDir)) {
    return { reject: rejectDecision({ rawQuery, caseId, reason: `case does not exist: ${caseDir}`, guidance: "请传入 cases/<id>。" }) };
  }

  const required = {
    plan: join(caseDir, "specs/plan.json"),
    delivery: join(caseDir, "eval/delivery.json"),
    runner: join(caseDir, "eval/runner-result.json"),
    baseline: join(caseDir, "eval/baseline.json"),
    provider: join(caseDir, ".game/eval-provider.json"),
  };

  for (const [name, filePath] of Object.entries(required)) {
    if (!existsSync(filePath)) {
      const reason =
        name === "baseline"
          ? "baseline 缺失; no passing baseline; run delivery first"
          : `required context missing: ${relativeCasePath(caseDir, filePath)}`;
      return { reject: rejectDecision({ rawQuery, caseId, reason, guidance: "请先跑一次 Stage 1 delivery 并确认 eval 工件齐全。" }) };
    }
  }

  const plan = await readJson(required.plan);
  const delivery = await readJson(required.delivery);
  const runner = await readJson(required.runner);
  const baseline = await readJson(required.baseline);
  const providerConfig = await readJson(required.provider);

  if (!baseline?.baselineId) {
    return {
      reject: rejectDecision({
        rawQuery,
        caseId,
        reason: "baseline 缺少 baselineId; no passing baseline; run delivery first",
        guidance: "请先跑一次 Stage 1 delivery 生成有效 baseline。",
      }),
    };
  }

  if (!["delivery-pass", "delivery-with-warnings"].includes(delivery?.status)) {
    return {
      reject: rejectDecision({
        rawQuery,
        caseId,
        baselineRef: baseline.baselineId,
        reason: `当前 delivery 状态为 ${delivery?.status ?? "unknown"}，不适合进入演进环。`,
        guidance: "请先修复 Stage 1 delivery。",
      }),
    };
  }

  return {
    plan,
    delivery,
    runner,
    baseline,
    providerConfig,
    deliverySummary: summarizeDelivery(delivery),
    runnerSummary: summarizeRunner(runner),
    screenshotArtifacts: await summarizeScreenshots(caseDir, runner),
    recentEvolutionLog: (await readEvolutionLog(caseDir)).slice(-5),
  };
}

function localRoute({ rawQuery, caseId, baselineRef, rekickFrom = null }) {
  const query = rawQuery.trim();
  if (rekickFrom) {
    return localRekickRoute({ rawQuery: query, caseId, baselineRef, rekickFrom });
  }

  if (isRedesign(query)) {
    return rejectDecision({
      rawQuery,
      caseId,
      baselineRef,
      reason: "query 要求推倒重做整份 plan;这属于非演进范畴。",
      guidance: "请走首轮生成 SOP 重新生成。",
    });
  }

  if (isVague(query)) {
    return {
      decision: "clarify",
      rawQuery,
      caseId,
      baselineRef,
      clarifications: [
        {
          id: "c-001",
          question: "你说的感觉不对，是输入响应、砖块碰撞、关卡节奏，还是画面反馈最影响体验？",
          context: "router 检测到问题描述过宽，无法定位到一个可复现的修改目标。",
        },
      ],
      conflicts: [],
    };
  }

  if (isForcedMisroute(query) && isDeepen(query)) {
    const subtask = makeSubtask({ stage: 3, index: 1, rawQuery: query });
    subtask.subIntent = "球速太慢调参";
    return {
      decision: "execute",
      rawQuery,
      caseId,
      baselineRef,
      subtasks: [subtask],
      conflicts: [],
    };
  }

  const intents = [];
  const newFeature = isNewFeature(query);
  const fix = isFix(query) && !(newFeature && isProgressMilestoneAddition(query) && !hasExplicitRepairIssue(query));
  if (fix) intents.push(makeSubtask({ stage: 2, index: intents.length + 1, rawQuery: query }));
  if (newFeature) intents.push(makeSubtask({ stage: 3, index: intents.length + 1, rawQuery: query }));
  if (isDeepen(query)) intents.push(makeSubtask({ stage: 4, index: intents.length + 1, rawQuery: query }));
  if (isPolish(query)) intents.push(makeSubtask({ stage: 5, index: intents.length + 1, rawQuery: query }));

  if (intents.length === 0) {
    return {
      decision: "clarify",
      rawQuery,
      caseId,
      baselineRef,
      clarifications: [
        {
          id: "c-001",
          question: "你希望优先修复哪个已经存在的问题，还是想增加新的玩法、调整手感或优化画面？",
          context: "router 无法从当前 query 中稳定识别单一修改方向。",
        },
      ],
      conflicts: [],
    };
  }

  intents.sort((a, b) => a.stage - b.stage);
  intents.forEach((subtask, offset) => {
    subtask.id = `s${subtask.stage}-${String(offset + 1).padStart(3, "0")}`;
  });

  return {
    decision: "execute",
    rawQuery,
    caseId,
    baselineRef,
    subtasks: intents,
    conflicts: [],
  };
}

function makeSubtask({ stage, index, rawQuery }) {
  const byStage = {
    2: {
      subIntent: repairIntent(rawQuery),
      specImpact: "none",
      evidenceRequired: ["repro-seed", "before-after-runner-summary"],
      expectedArtifacts: ["game/src/**/*.ts"],
    },
    3: {
      subIntent: newFeatureIntent(rawQuery),
      specImpact: "spec-shape-change",
      evidenceRequired: ["new-mustHave-pass", "regression-pass"],
      expectedArtifacts: ["specs/plan.json", "game/src/**/*.ts"],
    },
    4: {
      subIntent: "玩法体验调整",
      specImpact: "none",
      evidenceRequired: ["before-after-runner-summary", "regression-pass"],
      expectedArtifacts: ["game/src/**/*.ts"],
    },
    5: {
      subIntent: "表现层优化",
      specImpact: "none",
      evidenceRequired: ["visual-metadata-before-after", "regression-pass"],
      expectedArtifacts: ["game/src/**/*.ts", "assets/**"],
    },
  };
  return {
    id: `s${stage}-${String(index).padStart(3, "0")}`,
    stage,
    stopIfFails: stage === 4 ? false : true,
    dependsOn: [],
    ...byStage[stage],
  };
}

function localRekickRoute({ rawQuery, caseId, baselineRef, rekickFrom }) {
  const payload = rekickFrom?.kickBackPayload ?? {};
  const suggestedStage = Number(payload.suggestedStage ?? payload.inferredStage);
  const originalId = rekickFrom?.originalSubtaskId ?? null;
  const originalStage = Number(rekickFrom?.originalSubtask?.stage ?? parseStageFromSubtaskId(originalId) ?? 0);

  if (![2, 3, 4, 5].includes(suggestedStage)) {
    return rejectDecision({
      rawQuery,
      caseId,
      baselineRef,
      reason: "kick-back signal did not include a routable target",
      guidance: "请把需求改写成明确的修复、新增、调体验或美化请求后重试。",
    });
  }

  if (suggestedStage < originalStage) {
    return rejectDecision({
      rawQuery,
      caseId,
      baselineRef,
      reason: "re-entry would break subtask ordering",
      guidance: "请拆成更小的独立演进请求。",
    });
  }

  const subtask = makeSubtask({ stage: suggestedStage, index: nextIndexFromSubtaskId(originalId), rawQuery });
  subtask.id = `s${suggestedStage}-${String(nextIndexFromSubtaskId(originalId)).padStart(3, "0")}`;
  subtask.subIntent = inferRekickSubIntent({ stage: suggestedStage, rawQuery, payload, fallback: subtask.subIntent });

  return {
    decision: "execute",
    rawQuery,
    caseId,
    baselineRef,
    subtasks: [subtask],
    conflicts: [],
  };
}

function inferRekickSubIntent({ stage, rawQuery, payload, fallback }) {
  const text = `${payload.inferredIntent ?? ""} ${rawQuery}`;
  if (stage === 2) return repairIntent(text).slice(0, 30);
  if (stage === 3) return newFeatureIntent(text).slice(0, 30);
  if (stage === 4) return "玩法体验调整";
  if (stage === 5) return "表现层优化";
  return fallback;
}

function validateReentryDecision(decision, rekickFrom) {
  if (decision.decision !== "execute") return { ok: true };
  const original = rekickFrom?.originalSubtask ?? null;
  const originalStage = Number(original?.stage ?? parseStageFromSubtaskId(rekickFrom?.originalSubtaskId) ?? 0);
  const same = (decision.subtasks ?? []).some((subtask) => {
    return original
      && subtask.id === original.id
      && subtask.stage === original.stage
      && subtask.subIntent === original.subIntent
      && subtask.specImpact === original.specImpact;
  });
  if (same) {
    return { ok: false, reason: "re-entry returned the same routing without a useful change" };
  }
  if ((decision.subtasks ?? []).some((subtask) => subtask.stage < originalStage)) {
    return { ok: false, reason: "re-entry would break subtask ordering" };
  }
  return { ok: true };
}

function withRekickContext(recentEvolutionLog, rekickFrom) {
  return [
    ...(recentEvolutionLog ?? []),
    {
      kind: "re-entry-context",
      originalSubtaskId: rekickFrom?.originalSubtaskId,
      kickBackPayload: rekickFrom?.kickBackPayload,
    },
  ];
}

function safeRekickLogFields(rekickFrom) {
  return {
    reentry: true,
    rekickOriginalSubtaskId: rekickFrom?.originalSubtaskId ?? null,
    kickBackSuggestedRoute: rekickFrom?.kickBackPayload?.suggestedStage ?? null,
    kickBackKind: rekickFrom?.kickBackPayload?.forbidden ?? null,
  };
}

function parseStageFromSubtaskId(subtaskId) {
  const match = String(subtaskId ?? "").match(/^s([2-5])-\d{3}$/u);
  return match ? Number(match[1]) : null;
}

function nextIndexFromSubtaskId(subtaskId) {
  const match = String(subtaskId ?? "").match(/^s[2-5]-(\d{3})$/u);
  return match ? Number(match[1]) + 1 : 1;
}

function repairIntent(query) {
  const milestone = query.match(/milestone\s+([A-Za-z0-9_-]+)/u)?.[1];
  if (milestone) return `${milestone} 未触发`.slice(0, 30);
  if (/boss|Boss|BOSS/u.test(query) && /掉帧|卡顿|帧/u.test(query)) return "boss 掉帧修复";
  if (/按了没反应|输入|按键/u.test(query)) return "输入失效修复";
  if (/没触发|不触发/u.test(query)) return "触发异常修复";
  return "现有异常修复";
}

function newFeatureIntent(query) {
  if (/累计|破坏\s*10|10\s*个砖|进度\s*milestone|progress/u.test(query)) return "新增破坏进度";
  if (/连击/u.test(query)) return "新增连击系统";
  if (/成就/u.test(query)) return "新增成就检测";
  if (/道具栏/u.test(query)) return "新增道具栏";
  if (/二段跳/u.test(query)) return "新增二段跳";
  return "新增玩法内容";
}

function isFix(query) {
  return /修|bug|错误|失效|没触发|不触发|卡住|卡顿|掉帧|按了没反应|milestone/u.test(query);
}

function hasExplicitRepairIssue(query) {
  return /bug|错误|失效|没触发|不触发|卡住|卡顿|掉帧|按了没反应|milestone\s+[A-Za-z0-9_-]+/u.test(query);
}

function isNewFeature(query) {
  return /加|新增|加入|添加|成就|新机制|新系统|连击系统|道具栏|二段跳|商店|新关卡/u.test(query);
}

function isProgressMilestoneAddition(query) {
  return /milestone|进度/u.test(query);
}

function isForcedMisroute(query) {
  return /误路由|错路由|misroute/u.test(query);
}

function isDeepen(query) {
  return /手感|节奏|难度|反馈弱|太快|太慢|不舒服|平滑|打击感|更舒服/u.test(query) && !isVague(query);
}

function isPolish(query) {
  return /UI|ui|颜色|音效|视觉|画面|布局|排布|太挤|不醒目|字体|特效|更清楚/u.test(query);
}

function isVague(query) {
  return /^(游戏)?感觉不对[。！!,.，\s]*$/u.test(query) || /^(不好玩|有问题|怪怪的)[。！!,.，\s]*$/u.test(query);
}

function isRedesign(query) {
  return /重新设计|推倒重做|从零开始|重做整份|重新生成|换一个游戏|完全重来/u.test(query);
}

function rejectDecision({ rawQuery, caseId, baselineRef, reason, guidance }) {
  return {
    decision: "reject",
    rawQuery,
    caseId,
    ...(baselineRef ? { baselineRef } : {}),
    reason,
    guidance,
  };
}

async function routeWithLlm({ prompt, context, rawQuery, caseId }) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const candidate = await callOpenRouter({
        prompt,
        providerConfig: context.providerConfig,
      });
      const parsed = parseJsonObject(candidate);
      const checked = validateDecision(parsed);
      if (checked.ok) return parsed;
      lastError = new Error(checked.errors.join("; "));
    } catch (error) {
      lastError = error;
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  return rejectDecision({
    rawQuery,
    caseId,
    baselineRef: context.baseline.baselineId,
    reason: `router LLM unavailable: ${message}`,
    guidance: "请稍后重试，或使用本地 deterministic router。",
  });
}

async function callOpenRouter({ prompt, providerConfig }) {
  if (providerConfig?.evalProvider !== "openrouter-api") {
    throw new Error(`unsupported provider for LLM transport: ${providerConfig?.evalProvider ?? "unknown"}`);
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const model = normalizeOpenRouterModel(providerConfig.evalModel);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: prompt.messages,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`);
    const payload = await response.json();
    return payload?.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

function shouldUseLlm(providerConfig, forceLocal) {
  if (forceLocal) return false;
  if (process.env.MINI_GAME_EVOLUTION_ROUTER_TRANSPORT !== "llm") return false;
  return providerConfig?.evalProvider === "openrouter-api";
}

function normalizeOpenRouterModel(model) {
  if (model === "kimi-k2.6") return "moonshotai/kimi-k2.6";
  return model;
}

function parseJsonObject(raw) {
  const text = String(raw ?? "").trim().replace(/^```json\s*/u, "").replace(/^```\s*/u, "").replace(/\s*```$/u, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("LLM did not return JSON");
  }
}

function summarizeDelivery(delivery) {
  return {
    status: delivery?.status,
    warnings: (delivery?.warnings ?? []).slice(0, 5).map((warning) => ({
      kind: warning?.kind,
      severity: warning?.severity,
      count: warning?.count,
      text: warning?.text,
    })),
  };
}

function summarizeRunner(runner) {
  return {
    summary: runner?.summary ?? null,
    failedExpects: (runner?.failedExpects ?? runner?.diagnostic?.failedExpects ?? []).slice(0, 5),
    warnings: (runner?.warnings ?? runner?.nonFatalWarnings ?? []).slice(0, 5),
    diagnostic: runner?.diagnostic
      ? {
          canvasMounted: runner.diagnostic.canvasMounted,
          pixelsAvailable: runner.diagnostic.pixelsAvailable,
          inputDispatched: runner.diagnostic.inputDispatched,
          stepsExecuted: runner.diagnostic.stepsExecuted,
          stepsTotal: runner.diagnostic.stepsTotal,
          milestonesAny: runner.diagnostic.milestonesAny,
          failedExpects: (runner.diagnostic.failedExpects ?? []).slice(0, 5),
        }
      : null,
  };
}

async function summarizeScreenshots(caseDir, runner) {
  const screenshots = runner?.screenshots ?? {};
  const entries = {};
  for (const [name, relPath] of Object.entries(screenshots)) {
    const filePath = resolve(caseDir, relPath);
    try {
      const info = await stat(filePath);
      entries[name] = { path: relPath, sizeBytes: info.size };
    } catch {
      entries[name] = { path: relPath, missing: true };
    }
  }
  return entries;
}

async function safeLogDecision(caseDir, decision, context = {}, extra = {}) {
  try {
    await appendEvolutionLog({
      casePath: caseDir,
      entry: {
        kind: "triage-decision",
        timestamp: new Date().toISOString(),
        decision: decision.decision,
        rawQuery: decision.rawQuery,
        caseId: decision.caseId,
        baselineRef: decision.baselineRef ?? context?.baseline?.baselineId ?? null,
        subtaskIds: (decision.subtasks ?? []).map((subtask) => subtask.id),
        clarificationIds: (decision.clarifications ?? []).map((item) => item.id),
        provider: context?.providerConfig?.evalProvider ?? null,
        model: context?.providerConfig?.evalModel ?? null,
        ...extra,
      },
    });
  } catch {
    // The CLI output remains the source of truth if logging is unavailable.
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function relativeCasePath(caseDir, filePath) {
  return filePath.slice(dirname(caseDir).length + 1);
}

function parseArgs(argv) {
  const args = { casePath: null, query: null, queryFile: null, forceLocal: false, rekickFrom: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--query") args.query = argv[++index] ?? "";
    else if (arg === "--query-file") args.queryFile = argv[++index] ?? "";
    else if (arg === "--local") args.forceLocal = true;
    else if (arg === "--rekick-from" || arg === "--rekick") args.rekickFrom = parseRekickArg(argv[++index] ?? "");
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    else if (!args.casePath) args.casePath = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.casePath || (!args.query && !args.queryFile)) {
    console.error('Usage: node scripts/triage_router.js cases/<id> --query "..."');
    return args.help ? 0 : 1;
  }
  const rawQuery = args.queryFile ? await readFile(resolve(REPO, args.queryFile), "utf8") : args.query;
  const decision = await routeQuery({
    casePath: args.casePath,
    rawQuery,
    forceLocal: args.forceLocal,
    rekickFrom: args.rekickFrom,
  });
  process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  if (
    decision.decision === "reject" &&
    /^(router LLM unavailable|router validation failed):/u.test(decision.reason ?? "")
  ) {
    return 2;
  }
  return 0;
}

function parseRekickArg(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid --rekick-from JSON: ${message}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
