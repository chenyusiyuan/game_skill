import { appendEvolutionLog } from "./_evolution_log.js";

const LIFE_WORDS = /命|生命|life|lives|health|hp|扣命|掉血|失去/u;
const LIFE_NOT_DEDUCT_RE = /不扣命|不掉命|不掉血|不扣血|不失去生命|不减少生命|不减命/u;

export async function evaluateMustNot({ casePath, plan, runnerResult, subtaskId = null, writeLog = true }) {
  const mustNot = plan?.acceptance?.mustNot ?? [];
  if (!Array.isArray(mustNot) || mustNot.length === 0) {
    return { passed: true, violations: [], skipped: [] };
  }

  const violations = [];
  const skipped = [];
  for (const item of mustNot) {
    const match = findReverseMustHave({ plan, mustNot: item });
    if (!match) {
      skipped.push(skipRecord(item, "no-corresponding-mustHave"));
      continue;
    }

    const verdict = evaluateMatchedMustNot({ plan, mustNot: item, match, runnerResult });
    if (verdict.status === "skipped") {
      skipped.push(skipRecord(item, verdict.reason, match.mustHave?.id));
      continue;
    }
    if (verdict.status === "violated") {
      violations.push({
        id: item.id,
        text: item.text,
        evidence: {
          matchedMustHaveId: match.mustHave?.id ?? null,
          ...verdict.evidence,
        },
      });
    }
  }

  if (writeLog && skipped.length > 0) {
    await appendEvolutionLog({
      casePath,
      entry: {
        kind: "mustnot-skipped",
        timestamp: new Date().toISOString(),
        subtaskId,
        skipped,
      },
    });
  }

  if (writeLog && violations.length > 0) {
    await appendEvolutionLog({
      casePath,
      entry: {
        kind: "mustnot-violation",
        timestamp: new Date().toISOString(),
        subtaskId,
        violations,
      },
    });
  }

  return { passed: violations.length === 0, violations, skipped };
}

function findReverseMustHave({ plan, mustNot }) {
  const mustNotText = normalizeText(mustNot?.text);
  const mechanicsByName = new Map((plan?.requiredMechanics ?? []).map((mechanic) => [mechanic?.name, mechanic]));
  const candidates = (plan?.acceptance?.mustHave ?? []).map((mustHave) => {
    const mechanicTexts = (mustHave?.mechanicRefs ?? [])
      .map((ref) => mechanicsByName.get(ref)?.summary ?? ref)
      .join(" ");
    const combined = normalizeText([
      mustHave?.text,
      mechanicTexts,
      plan?.primaryLoop,
      plan?.loseCondition,
      plan?.winCondition,
    ].filter(Boolean).join(" "));
    return { mustHave, combined, score: scoreCandidate(mustNotText, combined, mustHave) };
  });

  const scored = candidates.filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}

function evaluateMatchedMustNot({ plan, mustNot, match, runnerResult }) {
  const text = normalizeText(`${mustNot?.text ?? ""} ${match.combined}`);
  if (LIFE_NOT_DEDUCT_RE.test(text)) {
    return evaluateLifeDeductMustNot({ plan, match, runnerResult });
  }

  const evidenceResults = (match.mustHave?.evidence ?? [])
    .map((evidence) => ({ evidence, result: findExpectResult(runnerResult, evidence) }))
    .filter((item) => item.result);
  if (evidenceResults.length === 0) {
    return { status: "skipped", reason: "matched-mustHave-has-no-runner-evidence" };
  }
  const failed = evidenceResults.filter((item) => item.result.ok !== true);
  if (failed.length > 0) {
    return {
      status: "violated",
      evidence: {
        type: "reverse-mustHave-evidence",
        failed: failed.map((item) => summarizeEvidenceResult(item.result)),
      },
    };
  }
  return { status: "passed" };
}

function evaluateLifeDeductMustNot({ plan, match, runnerResult }) {
  const stateEvidence = [
    ...(match.mustHave?.evidence ?? []),
    ...(plan?.smoke?.expect ?? []),
  ].find((evidence) => evidence?.type === "state" && /lives|life|health|hp/u.test(String(evidence.path ?? "")));
  if (!stateEvidence) {
    return { status: "skipped", reason: "life-state-evidence-missing" };
  }

  const result = findExpectResult(runnerResult, stateEvidence);
  if (!result || typeof result.observed !== "number") {
    return { status: "skipped", reason: "life-state-observation-missing" };
  }

  const initialLives = inferInitialLives(plan) ?? Math.max(Number(stateEvidence.value ?? 0), result.observed);
  if (result.observed >= initialLives) {
    return {
      status: "violated",
      evidence: {
        type: "derived-life-decrement",
        path: stateEvidence.path,
        observed: result.observed,
        expected: `< ${initialLives}`,
      },
    };
  }
  return { status: "passed" };
}

function scoreCandidate(mustNotText, combined, mustHave) {
  let score = 0;
  if (LIFE_WORDS.test(mustNotText) && LIFE_WORDS.test(combined)) score += 10;
  for (const ref of mustHave?.mechanicRefs ?? []) {
    if (mustNotText.includes(ref)) score += 4;
    if (/life|lives|生命|命/u.test(ref) && LIFE_WORDS.test(mustNotText)) score += 6;
  }

  const mustNotTokens = keywordTokens(mustNotText);
  const combinedTokens = keywordTokens(combined);
  for (const token of mustNotTokens) {
    if (combinedTokens.has(token)) score += 1;
  }
  return score;
}

function keywordTokens(text) {
  const tokens = new Set();
  for (const match of text.matchAll(/[A-Za-z0-9_-]+|[\u4e00-\u9fff]{2}/gu)) {
    tokens.add(match[0].toLowerCase());
  }
  return tokens;
}

function findExpectResult(runnerResult, evidence) {
  return (runnerResult?.expectResults ?? []).find((result) => {
    const exp = result?.exp ?? {};
    if (exp.type !== evidence?.type) return false;
    if (evidence.type === "canvas-change") return true;
    if (evidence.type === "milestone") return exp.id === evidence.id;
    if (evidence.type === "state") {
      return exp.path === evidence.path && (exp.operator || "==") === (evidence.operator || "==") && exp.value === evidence.value;
    }
    return false;
  });
}

function inferInitialLives(plan) {
  const text = normalizeText([plan?.primaryLoop, plan?.loseCondition, JSON.stringify(plan?.requiredMechanics ?? [])].join(" "));
  const match = text.match(/(\d+)\s*(?:条)?命/u);
  return match ? Number(match[1]) : null;
}

function summarizeEvidenceResult(result) {
  const exp = result?.exp ?? {};
  return {
    type: exp.type,
    id: exp.id,
    path: exp.path,
    operator: exp.operator,
    expected: exp.value,
    observed: result?.observed,
  };
}

function skipRecord(item, reason, matchedMustHaveId = null) {
  return {
    id: item?.id ?? null,
    text: item?.text ?? "",
    reason,
    matchedMustHaveId,
  };
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/gu, "").toLowerCase();
}
