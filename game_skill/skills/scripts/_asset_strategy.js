/**
 * _asset_strategy.js — 从 PRD front-matter 读 asset-strategy 段
 *
 * 这是一段由 LLM 在 Phase 2 写入的"素材策略声明"，下游所有 asset check
 * 脚本读它来动态调整行为（bypass / 放宽 / 严格化），避免"一种默认套所有游戏"。
 *
 * 字段语义见 SKILL.md / prd.md 里的"asset-strategy 决策脚手架"段。
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";

export const MODES = ["library-first", "generated-only", "none"];
export const COHERENCE_LEVELS = ["strict", "flexible", "n/a"];

export const DEFAULT_STRATEGY = {
  mode: "library-first",
  rationale: "(default, no explicit strategy in PRD)",
  "visual-core-entities": [],
  "visual-peripheral": [],
  "style-coherence": { level: "flexible", note: "" },
  _isDefault: true,
};

/**
 * 从 cases/<slug>/docs/game-prd.md 读 asset-strategy 段；缺失返回 DEFAULT_STRATEGY
 * @param {string} caseDir
 * @returns {object} strategy
 */
export function readAssetStrategy(caseDir) {
  const prdPath = join(caseDir, "docs/game-prd.md");
  if (!existsSync(prdPath)) return DEFAULT_STRATEGY;
  try {
    const content = readFileSync(prdPath, "utf-8");
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return DEFAULT_STRATEGY;
    const doc = yaml.load(fm[1]) ?? {};
    const s = doc["asset-strategy"];
    if (!s || typeof s !== "object") return DEFAULT_STRATEGY;
    return {
      mode: s.mode ?? "library-first",
      rationale: s.rationale ?? "",
      "visual-core-entities": Array.isArray(s["visual-core-entities"]) ? s["visual-core-entities"] : [],
      "visual-peripheral": Array.isArray(s["visual-peripheral"]) ? s["visual-peripheral"] : [],
      "style-coherence": s["style-coherence"] ?? { level: "flexible", note: "" },
      _isDefault: false,
    };
  } catch { return DEFAULT_STRATEGY; }
}

/**
 * 根据 style-coherence.level 返回 T17 pack 一致性阈值
 *   strict   → 0.85
 *   flexible → 0.50
 *   n/a      → null（不检查）
 *   （未声明时 0.70 保持原行为）
 */
export function packCoherenceThreshold(strategy) {
  const level = String(strategy?.["style-coherence"]?.level ?? "flexible");
  if (level === "strict") return 0.85;
  if (level === "flexible") return 0.50;
  if (level === "n/a") return null;
  return 0.70;
}
