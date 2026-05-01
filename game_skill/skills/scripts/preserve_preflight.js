#!/usr/bin/env node
/**
 * preserve_preflight.js - preview whether user feedback conflicts with preserve.lock.
 *
 * Usage:
 *   node preserve_preflight.js <case-dir> <feedback-file>
 */

import { existsSync, readFileSync } from "fs";
import { join, relative, resolve } from "path";
import yaml from "js-yaml";

function usage() {
  return [
    "Usage: node preserve_preflight.js <case-dir> <feedback-file>",
    "",
    "Reads cases/<slug>/.game/preserve.lock.yaml and the raw user feedback.",
    "Prints JSON: { conflicts, recommended-type, requires-user-confirm }.",
  ].join("\n");
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const positionals = args.filter((arg) => !arg.startsWith("--"));
const caseDir = positionals[0] ? resolve(positionals[0]) : null;
const feedbackPath = positionals[1] ? resolve(positionals[1]) : null;
const conflicts = [];

let feedback = "";
let lock = null;

if (!caseDir) {
  conflicts.push(conflict("missing-case-dir", "<arg>", "case-dir is required"));
} else {
  const lockPath = join(caseDir, ".game/preserve.lock.yaml");
  if (!existsSync(lockPath)) {
    conflicts.push(conflict("preserve-lock-missing", relative(process.cwd(), lockPath), "preserve.lock is required before branch iteration"));
  } else {
    try {
      lock = yaml.load(readFileSync(lockPath, "utf8")) ?? {};
    } catch (err) {
      conflicts.push(conflict("preserve-lock-invalid", relative(process.cwd(), lockPath), err.message));
    }
  }
}

if (!feedbackPath || !existsSync(feedbackPath)) {
  conflicts.push(conflict("feedback-missing", feedbackPath ?? "<arg>", "feedback-file is required"));
} else {
  feedback = readFileSync(feedbackPath, "utf8");
}

const recommendedType = recommendType(feedback);
if (lock && feedback) {
  collectPreserveConflicts(lock, feedback, conflicts, recommendedType);
}

const result = {
  conflicts,
  "recommended-type": conflicts.length ? escalateRecommendedType(recommendedType, conflicts) : recommendedType,
  "requires-user-confirm": conflicts.length >= 1,
};

console.log(JSON.stringify(result, null, 2));
process.exit(0);

function conflict(type, value, reason) {
  return { type, value: String(value ?? ""), reason };
}

function collectPreserveConflicts(lockDoc, rawText, out, category) {
  const text = rawText.toLowerCase();
  const entities = Array.isArray(lockDoc["core-entities"]) ? lockDoc["core-entities"] : [];
  const winLose = Array.isArray(lockDoc["win-lose-conditions"]) ? lockDoc["win-lose-conditions"] : [];
  const zones = Array.isArray(lockDoc["core-ui-zones"]) ? lockDoc["core-ui-zones"] : [];
  const inputModel = String(lockDoc["input-model"] ?? "");

  for (const entity of entities) {
    const id = String(entity?.id ?? "");
    if (id && containsToken(text, id)) {
      out.push(conflict("stage-1-core-entity", id, "feedback mentions a preserved core entity"));
    }
    for (const field of entity?.fields ?? []) {
      const fieldName = String(field ?? "");
      if (fieldName && containsToken(text, fieldName)) {
        out.push(conflict("stage-1-core-field", `${id}.${fieldName}`, "feedback mentions a preserved core entity field"));
      }
    }
  }

  for (const zone of zones) {
    const zoneId = String(zone ?? "");
    if (zoneId && containsToken(text, zoneId)) {
      out.push(conflict("stage-1-core-ui-zone", zoneId, "feedback mentions a preserved core UI zone"));
    }
  }

  if (inputModel && inputModel !== "unknown" && inputModel !== "mixed" && /点击|click|tap|键盘|keyboard|拖拽|drag|滑动|swipe/.test(rawText)) {
    const requested = inferInputModel(rawText);
    if (requested && requested !== inputModel) {
      out.push(conflict("stage-1-input-model", `${inputModel} -> ${requested}`, "feedback asks to change the preserved input model"));
    }
  }

  const preserveKeywords = /核心|胜负|胜利|失败|输赢|win|lose|玩法换成|换成.*玩法|改成.*玩法/i;
  if (preserveKeywords.test(rawText) && (entities.length > 0 || winLose.length > 0)) {
    out.push(conflict("preserve-core-loop", category, "feedback targets core loop or win/lose conditions protected by preserve.lock"));
  }
}

function containsToken(text, token) {
  const normalized = String(token).toLowerCase().trim();
  if (!normalized || normalized.length < 2) return false;
  return text.includes(normalized);
}

function inferInputModel(text) {
  if (/键盘|keyboard|wasd|方向键/i.test(text)) return "keyboard";
  if (/拖拽|drag|滑动|swipe/i.test(text)) return "drag";
  if (/点击|点按|click|tap/i.test(text)) return "click";
  return null;
}

function recommendType(text) {
  const checks = [
    ["pivot", /换成.*玩法|改成.*玩法|玩法.*换成|这不是我要的游戏|核心玩法|重新做|重做/i],
    ["rework", /撤销|回滚|退回|回到\s*stage\s*\d+|回到第?\s*\d+\s*阶段|去掉\s*stage\s*\d+|不要.*(?:boss|道具|升级|系统)/i],
    ["extension", /排行榜|分享|成就|多人|联机|leaderboard|share|achievement|multiplayer|加(?:一个)?(?:新功能|新特性|系统)/i],
    ["scope-change", /\d+\s*关.*(?:改|变|到|成)\s*\d+\s*关|关数|几关|加(?:一个)?关卡选择|level select/i],
    ["code-bug", /崩|闪退|白屏|报错|console.*error|undefined|null|exception|不能点|无响应|卡住|没反应|打不开|404|加载失败/i],
    ["art-change", /风格|配色|颜色|字体|素材|贴图|音效|图标|动画|特效|color|palette|sprite|audio/i],
    ["tuning", /太难|太简单|血量|时间|分数|速度|频率|伤害|冷却|金币|生命|改(?:一下)?(?:数值|难度|时间|分数)|微调/i],
  ];
  for (const [category, re] of checks) {
    if (re.test(text)) return category;
  }
  return "ambiguous";
}

function escalateRecommendedType(category, items) {
  if (items.some((item) => item.type === "preserve-core-loop" || item.type === "stage-1-input-model")) return "pivot";
  if (category === "ambiguous") return "rework";
  return category;
}
