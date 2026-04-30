import { existsSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import yaml from "js-yaml";

export const PATTERN_START = "<!-- pipeline-patterns:start -->";
export const PATTERN_END = "<!-- pipeline-patterns:end -->";
export const ABSTRACTED_STATUSES = new Set(["abstracted", "fixed", "closed"]);

export const ORIGIN_LAYERS = [
  "PRD",
  "Spec clarify",
  "Mechanics DAG",
  "Scene / rule / data / assets / event-graph / implementation-contract expand",
  "Primitive runtime",
  "Codegen / engine template",
  "Profile",
  "Checker bug / checker 规则误报",
  "Other",
];

export function patternsPathFor(caseDir) {
  return join(caseDir, ".pipeline_patterns.md");
}

export function readPatternDoc(filePath) {
  if (!existsSync(filePath)) return { intro: "# Pipeline Patterns\n\n", data: { patterns: [] }, outro: "" };
  const text = readFileSync(filePath, "utf-8");
  const start = text.indexOf(PATTERN_START);
  const end = text.indexOf(PATTERN_END);
  if (start < 0 || end < 0 || end <= start) {
    return { intro: text.trimEnd() + "\n\n", data: { patterns: [] }, outro: "" };
  }
  const intro = text.slice(0, start);
  const block = text.slice(start + PATTERN_START.length, end);
  const yamlBody = block.match(/```yaml\s*([\s\S]*?)```/)?.[1] ?? "";
  let data = { patterns: [] };
  try {
    data = yaml.load(yamlBody) ?? { patterns: [] };
  } catch {
    data = { patterns: [] };
  }
  if (!Array.isArray(data.patterns)) data.patterns = [];
  return { intro, data, outro: text.slice(end + PATTERN_END.length) };
}

export function writePatternDoc(filePath, doc) {
  const body = yaml.dump(doc.data, { lineWidth: 120, noRefs: true });
  const text = [
    doc.intro.trimEnd(),
    "",
    PATTERN_START,
    "```yaml",
    body.trimEnd(),
    "```",
    PATTERN_END,
    doc.outro.trim() ? `\n${doc.outro.trim()}\n` : "",
  ].join("\n");
  writeFileSync(filePath, text.endsWith("\n") ? text : text + "\n", "utf-8");
}

export function recordPattern(doc, {
  patternId,
  originLayer,
  example,
  nextAbstraction,
  status = "open",
  note = null,
  now = new Date(),
}) {
  const id = String(patternId ?? "").trim();
  if (!id) throw new Error("--pattern is required");
  if (!ORIGIN_LAYERS.includes(originLayer)) {
    throw new Error(`--origin must be one of: ${ORIGIN_LAYERS.join(" | ")}`);
  }
  const today = now.toISOString().slice(0, 10);
  const patterns = doc.data.patterns;
  let entry = patterns.find((p) => p?.["pattern-id"] === id);
  if (!entry) {
    entry = {
      "pattern-id": id,
      "first-seen": today,
      "last-seen": today,
      count: 0,
      "origin-layer": originLayer,
      examples: [],
      "next-abstraction": nextAbstraction || "",
      status,
    };
    patterns.push(entry);
  }
  entry["last-seen"] = today;
  entry.count = Number(entry.count ?? 0) + 1;
  entry["origin-layer"] = originLayer;
  if (nextAbstraction) entry["next-abstraction"] = nextAbstraction;
  if (status) entry.status = status;
  if (note) entry.note = note;
  const ex = example || basename(process.cwd());
  if (ex && !entry.examples.includes(ex)) entry.examples.push(ex);
  return entry;
}

export function thresholdViolations(patterns) {
  return (patterns ?? []).filter((p) =>
    Number(p?.count ?? 0) >= 3 &&
    !ABSTRACTED_STATUSES.has(String(p?.status ?? "open")),
  );
}
