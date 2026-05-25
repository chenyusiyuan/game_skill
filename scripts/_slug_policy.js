export const MODEL_SLUG_ALIASES = ["glm", "kimi", "opus", "gpt"];

const MODEL_ALIAS_PATTERN = MODEL_SLUG_ALIASES.join("|");
const PROJECT_SLUG_RE = new RegExp(`^([a-z0-9]+(?:-[a-z0-9]+)?)-(${MODEL_ALIAS_PATTERN})-([1-9][0-9]*)$`, "u");

export function slugPolicySummary() {
  return "<game-name>-<model>-<number>, where game-name is 1-2 lowercase words, model is one of glm/kimi/opus/gpt, and number is a positive integer; example: space-shooter-glm-1";
}

export function parseProjectSlug(slug) {
  const match = String(slug ?? "").trim().match(PROJECT_SLUG_RE);
  if (!match) return null;
  return {
    gameName: match[1],
    modelAlias: match[2],
    number: Number(match[3]),
  };
}

export function inferModelSlugAlias(model) {
  const text = String(model ?? "").trim().toLowerCase();
  if (!text || /^<.*>$/.test(text) || /\bunknown\b/u.test(text.replaceAll(/[-_]/g, " "))) return null;
  if (text.includes("glm")) return "glm";
  if (text.includes("kimi") || text.includes("moonshot")) return "kimi";
  if (text.includes("opus")) return "opus";
  if (text.includes("gpt") || text.includes("openai") || text.includes("codex")) return "gpt";
  return null;
}

export function validateProjectSlug(slug, { hostModel = null } = {}) {
  const errors = [];
  const parsed = parseProjectSlug(slug);
  if (!parsed) {
    errors.push(`invalid project slug "${slug}": must use ${slugPolicySummary()}`);
    return { parsed: null, inferredModelAlias: null, errors };
  }

  const hostModelText = String(hostModel ?? "").trim();
  if (!hostModelText) return { parsed, inferredModelAlias: null, errors };

  const inferredModelAlias = inferModelSlugAlias(hostModelText);
  if (!inferredModelAlias) {
    errors.push(`cannot infer project slug model alias from host model "${hostModelText}"; expected a glm, kimi/moonshot, opus, or gpt/openai/codex model id`);
    return { parsed, inferredModelAlias: null, errors };
  }
  if (parsed.modelAlias !== inferredModelAlias) {
    errors.push(`project slug model alias "${parsed.modelAlias}" does not match host model "${hostModelText}" (expected "${inferredModelAlias}"; omit version numbers in the slug)`);
  }
  return { parsed, inferredModelAlias, errors };
}
