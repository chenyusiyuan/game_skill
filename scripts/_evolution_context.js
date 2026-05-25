import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));

const RUBRIC_FIELDS = [
  "content-density",
  "mechanical-differentiation",
  "visual-feedback",
  "hud-information",
  "feel-juice",
  "genre-fitness",
];

const SOURCE_TAGS = ["from-query", "from-genre-knowledge", "from-reasoning", "from-plan", "from-design"];

export function readEvolutionContext(casePath, overrides = {}) {
  const caseDir = resolve(REPO, casePath);
  const plan = overrides.plan ?? readJsonOptional(join(caseDir, "specs/plan.json"));
  const delivery = overrides.delivery ?? readJsonOptional(join(caseDir, "eval/delivery.json"));
  const preview = overrides.preview ?? readJsonOptional(join(caseDir, "eval/preview.json"));
  const runner = overrides.runnerResult ?? overrides.runner ?? readJsonOptional(join(caseDir, "eval/runner-result.json"));
  const baseline = overrides.baseline ?? readJsonOptional(join(caseDir, "eval/baseline.json"));
  const providerConfig = overrides.providerConfig ?? readJsonOptional(join(caseDir, ".game/eval-provider.json"));
  const designText = overrides.designText ?? readTextOptional(join(caseDir, "docs/DESIGN.md"));
  const decisionsText = overrides.decisionsText ?? readTextOptional(join(caseDir, "docs/decisions.md"));
  const primerText = overrides.primerText ?? readTextOptional(join(caseDir, ".game/archetype-primer.md"));
  const rubric = overrides.rubric ?? readJsonOptional(join(caseDir, ".game/rubric.json"));

  const qualityHintsSummary = summarizeQualityHints(delivery?.qualityHints, { rubric });
  const designSummary = summarizeDesign(designText);
  const decisionSummary = summarizeDecisions(decisionsText);

  return {
    caseDir,
    plan,
    delivery,
    preview,
    runner,
    baseline,
    providerConfig,
    primerSummary: summarizePrimer(primerText),
    qualityHintsSummary,
    designSummary,
    decisionSummary,
    baselineSummary: summarizeBaseline(baseline),
    deliverySummary: summarizeDelivery(delivery),
    previewSummary: summarizePreview(preview),
    runnerSummary: summarizeRunner(runner),
    screenshotArtifacts: summarizeScreenshots(caseDir, runner),
    recentEvolutionLog: readRecentEvolutionLog(caseDir),
  };
}

export function summarizeDelivery(delivery) {
  if (!delivery || typeof delivery !== "object") return null;
  return {
    status: delivery.status ?? null,
    blockReason: delivery.blockReason ?? null,
    warningKinds: (delivery.warnings ?? []).map((warning) => warning?.kind).filter(Boolean).slice(0, 12),
    warnings: (delivery.warnings ?? []).slice(0, 8).map((warning) => ({
      kind: warning?.kind,
      severity: warning?.severity,
      count: warning?.count,
      text: warning?.text,
    })),
    runner: delivery.detail?.runner ?? null,
  };
}

export function summarizeRunner(runner) {
  if (!runner || typeof runner !== "object") return null;
  return {
    summary: runner.summary ?? null,
    failedExpects: (runner.failedExpects ?? runner.diagnostic?.failedExpects ?? []).slice(0, 8),
    warnings: (runner.warnings ?? runner.nonFatalWarnings ?? []).slice(0, 8),
    diagnostic: runner.diagnostic
      ? {
          canvasMounted: runner.diagnostic.canvasMounted,
          pixelsAvailable: runner.diagnostic.pixelsAvailable,
          inputDispatched: runner.diagnostic.inputDispatched,
          stepsExecuted: runner.diagnostic.stepsExecuted,
          stepsTotal: runner.diagnostic.stepsTotal,
          milestonesAny: runner.diagnostic.milestonesAny,
          failedExpects: (runner.diagnostic.failedExpects ?? []).slice(0, 8),
        }
      : null,
  };
}

export function summarizeQualityHints(qualityHints, { rubric = null } = {}) {
  const hints = qualityHints && typeof qualityHints === "object" ? qualityHints : {};
  return {
    available: Boolean(qualityHints),
    visual: summarizeVisual(hints.visual),
    rubric: summarizeRubric(hints.rubric ?? rubric),
    scopeReport: summarizeScopeReport(hints.scopeReport),
    loc: summarizeLoc(hints.loc),
    warnings: (hints.warnings ?? []).slice(0, 8).map((warning) => ({
      kind: warning?.kind,
      severity: warning?.severity,
      helperCallCount: warning?.helperCallCount,
    })),
  };
}

export function summarizeDesign(markdown) {
  if (!markdown) return { available: false, anchors: [], mustAvoid: [], requiredAnchors: requiredAnchorStatus([]) };
  const anchors = extractDesignAnchors(markdown);
  return {
    available: true,
    anchors,
    anchorCount: anchors.length,
    mustAvoid: extractMustAvoid(markdown),
    requiredAnchors: requiredAnchorStatus(anchors),
  };
}

export function summarizeDecisions(markdown) {
  if (!markdown) {
    return {
      available: false,
      sourceCounts: Object.fromEntries(SOURCE_TAGS.map((source) => [source, 0])),
      phaseA: [],
      phaseB: [],
      demoted: [],
    };
  }
  const phaseA = parseDecisionChunks(markdown, "A");
  const phaseB = parseDecisionChunks(markdown, "B");
  const all = [...phaseA, ...phaseB];
  const sourceCounts = Object.fromEntries(SOURCE_TAGS.map((source) => [source, 0]));
  for (const item of all) {
    if (item.source && Object.hasOwn(sourceCounts, item.source)) sourceCounts[item.source] += 1;
  }
  return {
    available: true,
    sourceCounts,
    phaseA: phaseA.slice(0, 12).map(publicDecisionChunk),
    phaseB: phaseB.slice(0, 12).map(publicDecisionChunk),
    demoted: all
      .filter((item) => item.text.includes("降级理由"))
      .slice(0, 8)
      .map((item) => ({ title: item.title || "<untitled>", source: item.source ?? "unknown" })),
  };
}

export function summarizeBaseline(baseline) {
  if (!baseline || typeof baseline !== "object") return null;
  return {
    baselineKind: baseline.baselineKind ?? "delivery",
    baselineId: baseline.baselineId ?? null,
    createdAt: baseline.createdAt ?? null,
    planHash: baseline.planHash ?? null,
    deliverySummary: baseline.deliverySummary ?? null,
    previewSummary: baseline.previewSummary ?? null,
    qualityHintsSummary: baseline.qualityHintsSummary ?? null,
    designSummary: baseline.designSummary ?? null,
    decisionSummary: baseline.decisionSummary ?? null,
    artifactPointers: baseline.artifactPointers ?? null,
  };
}

export function summarizePreview(preview) {
  if (!preview || typeof preview !== "object") return null;
  return {
    status: preview.status ?? null,
    reason: preview.reason ?? null,
    health: summarizePreviewHealth(preview.health),
    screenshots: preview.screenshots ?? {},
    launchCommand: preview.launchCommand ?? null,
    pageErrors: (preview.pageErrors ?? []).slice(0, 5),
    consoleErrors: (preview.consoleErrors ?? []).slice(0, 5),
  };
}

export function summarizeScreenshots(caseDir, runner) {
  const screenshots = runner?.screenshots ?? {};
  const out = {};
  for (const [name, relPath] of Object.entries(screenshots)) {
    const filePath = resolve(caseDir, relPath);
    try {
      const info = statSync(filePath);
      out[name] = { path: relPath, sizeBytes: info.size };
    } catch {
      out[name] = { path: relPath, missing: true };
    }
  }
  return out;
}

export function deriveMechanicAnchor(designSummary, kind = "mechanic") {
  const anchors = new Set(designSummary?.anchors ?? []);
  const ordered =
    kind === "ui" || kind === "visual"
      ? ["uiSurfaces.primary", "visualIdentity.palette", "coreLoop.successSignal", "coreLoop.primaryAction"]
      : kind === "feedback"
        ? ["coreLoop.successSignal", "uiSurfaces.primary", "coreLoop.primaryAction"]
        : ["coreLoop.primaryAction", "coreLoop.successSignal", "uiSurfaces.primary"];
  return ordered.find((anchor) => anchors.has(anchor)) ?? null;
}

export function appendPublicDecisionLog({ decisionsPath, subtaskId, title, decision, basis, risk }) {
  const existing = readTextOptional(decisionsPath);
  if (existing === null) throw new Error("docs/decisions.md missing; cannot append public decision log");
  const marker = `evolution-subtask:${subtaskId}`;
  if (existing.includes(marker)) return false;
  const entry = [
    "",
    `### B.N ${title} — 来源: from-design`,
    "",
    `<!-- ${marker} -->`,
    "",
    `**决策**: ${decision}`,
    "",
    `**依据**: ${basis}`,
    "",
    `**风险**: ${risk}`,
    "",
  ].join("\n");
  writeFileSync(decisionsPath, `${existing.trimEnd()}\n${entry}`, "utf8");
  return true;
}

export function mustAvoidBlocksPaddleSpeed(mustAvoid = []) {
  return mustAvoid.some((item) => /挡板|paddle/u.test(item) && /速度|移动|过快|太快|更快|加速|响应/u.test(item));
}

export function qualityBacklog(qualityHintsSummary) {
  const hints = qualityHintsSummary ?? {};
  const visualWarnings = hints.visual?.warnings ?? [];
  const rubric = hints.rubric ?? {};
  const lowRubric = RUBRIC_FIELDS.filter((field) => {
    const value = Number(rubric[field]?.score ?? rubric[field]);
    return Number.isFinite(value) && value <= 3;
  });
  return {
    visualWarnings,
    lowRubric,
    loc: hints.loc ?? null,
    hasStage4Signal: lowRubric.some((field) =>
      ["content-density", "mechanical-differentiation", "feel-juice", "genre-fitness"].includes(field),
    ),
    hasStage5Signal:
      visualWarnings.length > 0 || lowRubric.some((field) => ["visual-feedback", "hud-information"].includes(field)),
  };
}

function summarizeVisual(visual) {
  if (!visual || typeof visual !== "object") return null;
  return {
    available: Boolean(visual.available),
    reason: visual.reason,
    colorCount: numberOrNull(visual.colorCount),
    shapeRegions: numberOrNull(visual.shapeRegions),
    hudOccupancy: numberOrNull(visual.hudOccupancy),
    centerActivity: numberOrNull(visual.centerActivity),
    warnings: (visual.warnings ?? []).filter((item) => typeof item === "string").slice(0, 12),
  };
}

function summarizeRubric(rubric) {
  if (!rubric || typeof rubric !== "object") return null;
  const out = {
    available: rubric.available ?? true,
    reason: rubric.reason,
    missing: rubric.missing,
  };
  for (const field of RUBRIC_FIELDS) {
    if (!Object.hasOwn(rubric, field)) continue;
    out[field] = summarizeRubricValue(rubric[field]);
  }
  return out;
}

function summarizeRubricValue(value) {
  if (value && typeof value === "object") {
    return {
      score: numberOrNull(value.score ?? value.value),
      note: typeof value.note === "string" ? value.note.slice(0, 160) : undefined,
    };
  }
  return { score: numberOrNull(value) };
}

function summarizeScopeReport(scopeReport) {
  if (!scopeReport || typeof scopeReport !== "object") return null;
  return {
    available: Boolean(scopeReport.available),
    fromQueryCount: numberOrNull(scopeReport.fromQueryCount),
    fromGenreKnowledgeCount: numberOrNull(scopeReport.fromGenreKnowledgeCount),
    fromReasoningCount: numberOrNull(scopeReport.fromReasoningCount),
    counts: scopeReport.counts ?? null,
    demotedCount: numberOrNull(scopeReport.demotedCount),
    demoted: (scopeReport.demoted ?? scopeReport.demotedChunks ?? []).slice(0, 8).map((item) => ({
      title: item?.title ?? "<untitled>",
      source: item?.source ?? "unknown",
    })),
    scopeLeaks: (scopeReport.scopeLeaks ?? []).slice(0, 8),
  };
}

function summarizeLoc(loc) {
  if (!loc || typeof loc !== "object") return null;
  return {
    scaffoldLoc: numberOrNull(loc.scaffoldLoc),
    businessLoc: numberOrNull(loc.businessLoc),
    helperImportCount: numberOrNull(loc.helperImportCount),
    helperCallCount: numberOrNull(loc.helperCallCount),
  };
}

function summarizePrimer(primerText) {
  if (!primerText) return { available: false };
  const title = primerText.split(/\r?\n/u).find((line) => /^#\s+/u.test(line))?.replace(/^#\s+/u, "").trim() ?? null;
  return { available: true, title, lineCount: primerText.split(/\r?\n/u).length };
}

function summarizePreviewHealth(health) {
  if (!health || typeof health !== "object") return null;
  return Object.fromEntries(Object.entries(health).map(([key, value]) => [
    key,
    {
      status: value?.status ?? null,
      reason: value?.reason ?? null,
      port: value?.port,
      canvasSize: value?.canvasSize,
    },
  ]));
}

function requiredAnchorStatus(anchors) {
  const set = new Set(anchors);
  return {
    "visualIdentity.palette": set.has("visualIdentity.palette"),
    "uiSurfaces.primary": set.has("uiSurfaces.primary"),
    "coreLoop.primaryAction": set.has("coreLoop.primaryAction"),
    "coreLoop.successSignal": set.has("coreLoop.successSignal"),
  };
}

function sectionText(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = markdown.match(new RegExp(`(?:^|\\n)##\\s+${escaped}\\b[\\s\\S]*?(?=\\n##\\s+|\\n---\\s*$|$)`, "u"));
  return match?.[0] ?? "";
}

function designContractText(markdown) {
  const sampleIndex = markdown.search(/\n---\s*\n\s*##\s*跨品类样例/u);
  return sampleIndex >= 0 ? markdown.slice(0, sampleIndex) : markdown;
}

function extractDesignAnchors(markdown) {
  const contract = designContractText(markdown);
  const anchors = new Set();
  const visualIdentity = sectionText(contract, "visualIdentity");
  const uiSurfaces = sectionText(contract, "uiSurfaces");
  const coreLoop = sectionText(contract, "coreLoop");
  const mustAvoid = sectionText(contract, "mustAvoid");

  if (/visualIdentity\s*:/u.test(visualIdentity) && /palette\s*:/u.test(visualIdentity)) anchors.add("visualIdentity.palette");
  if (/uiSurfaces\s*:/u.test(uiSurfaces) && /primary\s*:/u.test(uiSurfaces)) anchors.add("uiSurfaces.primary");
  if (/coreLoop\s*:/u.test(coreLoop) && /primaryAction\s*:/u.test(coreLoop)) anchors.add("coreLoop.primaryAction");
  if (/coreLoop\s*:/u.test(coreLoop) && /successSignal\s*:/u.test(coreLoop)) anchors.add("coreLoop.successSignal");

  for (const item of extractMustAvoidFromSection(mustAvoid)) {
    for (const anchor of mustAvoidAnchorVariants(item)) anchors.add(anchor);
  }
  return Array.from(anchors).sort();
}

function extractMustAvoid(markdown) {
  return extractMustAvoidFromSection(sectionText(designContractText(markdown), "mustAvoid"));
}

function extractMustAvoidFromSection(section) {
  const out = [];
  for (const line of String(section ?? "").split(/\r?\n/u)) {
    const match = line.match(/^\s*-\s+(.+)$/u);
    if (!match) continue;
    const normalized = normalizeMustAvoidItem(match[1]);
    if (normalized && !/^<.*>$/u.test(normalized)) out.push(normalized);
  }
  return out;
}

function normalizeMustAvoidItem(item) {
  return item
    .replace(/\s+#.*$/u, "")
    .replace(/[`"'“”‘’]/gu, "")
    .replace(/[。.,，;；]+$/u, "")
    .trim();
}

function mustAvoidAnchorVariants(item) {
  const normalized = normalizeMustAvoidItem(item);
  if (!normalized || /^<.*>$/u.test(normalized)) return [];
  const slug = normalized
    .toLowerCase()
    .replace(/\s+/gu, "-")
    .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return Array.from(new Set([normalized, slug].filter(Boolean))).map((value) => `mustAvoid.${value}`);
}

function parseDecisionChunks(markdown, sectionLetter) {
  const nextLetters = sectionLetter === "A" ? "B\\.|C\\." : "C\\.";
  const section = markdown.match(new RegExp(`(?:^|\\n)##\\s+${sectionLetter}\\.[\\s\\S]*?(?=\\n##\\s+(?:${nextLetters})|$)`, "u"))?.[0] ?? "";
  const chunks = [];
  for (const chunk of section.split(new RegExp(`(?=^###\\s+${sectionLetter}\\.)`, "mu"))) {
    const heading = chunk.match(new RegExp(`^###\\s+${sectionLetter}\\.[^\\n]+`, "mu"))?.[0];
    if (!heading) continue;
    const title = heading
      .replace(new RegExp(`^###\\s+${sectionLetter}\\.\\S+\\s*`, "u"), "")
      .replace(/\s*[—-]\s*来源[:：].*$/u, "")
      .trim();
    chunks.push({ title, source: extractSourceTag(chunk), text: chunk });
  }
  return chunks;
}

function extractSourceTag(chunk) {
  const sourceLine = chunk.split(/\r?\n/u).find((line) => /来源[:：]/u.test(line));
  if (!sourceLine || sourceLine.includes("|")) return null;
  const match = sourceLine.match(/来源[:：]\s*<?\s*([a-z-]+)\s*>?/u);
  return match?.[1] ?? null;
}

function publicDecisionChunk(item) {
  return {
    title: item.title || "<untitled>",
    source: item.source ?? "unknown",
  };
}

function readRecentEvolutionLog(caseDir) {
  const logPath = join(caseDir, "eval/evolution-log.jsonl");
  const text = readTextOptional(logPath);
  if (!text) return [];
  return text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(-5);
}

function readJsonOptional(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readTextOptional(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
