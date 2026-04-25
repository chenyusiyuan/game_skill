#!/usr/bin/env node
/**
 * check_game_prd.js — Game APRD 格式完整性检查
 *
 * 用法:
 *   node check_game_prd.js [prd文件路径]
 *   node check_game_prd.js               # 默认检查 docs/game-prd.md
 *
 * 退出码:
 *   0 = 通过（可能有 warning）
 *   1 = 有错误
 *
 * 校验范围:
 *   - Front-matter 必填字段（game-aprd / project / platform / runtime / mode / language）
 *   - runtime 枚举值（phaser3 | pixijs | canvas | dom-ui，或在 engines/_index.json 中登记的）
 *   - Tag 语法与必填属性（@game / @flow / @scene / @state / @entity / @rule / @input / @ui /
 *     @system / @level / @resource / @constraint / @check）
 *   - 固定章节顺序（§1 ~ §10，§11 可选）
 *   - 跨引用完整性（所有 @tag(id) 引用必须有对应定义）
 *   - 符号规范（禁止全角冒号/括号/竖线）
 *   - 强约束落点（@constraint.kind: hard-rule 需关联 @check.layer: product）
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const prdPath = resolve(process.argv[2] ?? "docs/game-prd.md");
const scriptDir = dirname(fileURLToPath(import.meta.url));

let content;
try {
  content = readFileSync(prdPath, "utf-8");
} catch {
  console.error(`✗ 文件不存在: ${prdPath}`);
  process.exit(1);
}

const errors = [];
const warnings = [];
const err = (code, msg, hint = "") => errors.push({ code, msg, hint });
const warn = (code, msg, hint = "") => warnings.push({ code, msg, hint });
let tags = []; // 声明在顶部，避免 TDZ 问题

// ─── 1. Front-matter ───────────────────────────────────────────────────────

const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
if (!fmMatch) {
  err("FM001", "缺少 front-matter（文件开头应有 --- ... --- 块）",
      "在第一行添加 --- 开始 front-matter");
  report();
  process.exit(1);
}
const fmText = fmMatch[1];
const body = content.slice(fmMatch[0].length);
let fmYaml = {};
try {
  fmYaml = yaml.load(fmText) ?? {};
} catch (e) {
  err("FM018", `front-matter YAML 解析失败: ${e.message}`,
      "确保 front-matter 是合法 YAML，尤其是冒号、引号、缩进");
}

function fmGet(key) {
  const m = fmText.match(new RegExp(`^${key}:\\s*(.+)`, "m"));
  return m ? m[1].trim() : null;
}

function scalarString(value) {
  if (value === undefined || value === null) return null;
  return String(value).trim();
}

function loadPaletteIds() {
  const palettePath = resolve(scriptDir, "../references/common/color-palettes.yaml");
  if (!existsSync(palettePath)) {
    err("FM019", `缺少色板库: ${palettePath}`, "恢复 references/common/color-palettes.yaml");
    return new Set();
  }
  try {
    const paletteDoc = yaml.load(readFileSync(palettePath, "utf-8")) ?? {};
    const ids = new Set();
    const fallbackId = paletteDoc["fallback-default"]?.id;
    if (fallbackId) ids.add(fallbackId);
    for (const p of paletteDoc.palettes ?? []) {
      if (p?.id) ids.add(p.id);
    }
    if (ids.size === 0) {
      err("FM019", "color-palettes.yaml 未登记任何 palette id",
          "至少需要 fallback-default.id 和 palettes[].id");
    }
    return ids;
  } catch (e) {
    err("FM019", `color-palettes.yaml 解析失败: ${e.message}`,
        "修复色板库 YAML 语法");
    return new Set();
  }
}

const gameAprd = fmGet("game-aprd");
const project = fmGet("project");
const platform = fmGet("platform");
const runtime = fmGet("runtime");
const mode = fmGet("mode");
const language = fmGet("language");
const supportLevel = fmGet("support-level");
const deliveryTarget = fmGet("delivery-target");
const mustHaveFeatures = fmGet("must-have-features");

if (!gameAprd) err("FM002", "缺少 game-aprd 版本字段", '添加: game-aprd: "0.1"');
if (!project) err("FM003", "缺少 project 字段（kebab-case）", "添加: project: my-game-slug");
if (!platform) err("FM004", "缺少 platform 字段", "添加: platform: [web]");
if (!runtime) err("FM005", "缺少 runtime 字段", "添加: runtime: dom-ui   # phaser3 | pixijs | canvas | dom-ui | three");
if (!mode) err("FM006", "缺少 mode 字段", "添加: mode: 单机");
if (!language) warn("FM007", "缺少 language 字段", "建议: language: zh-CN");

// runtime 枚举：优先读 engines/_index.json，否则 fallback 到内置 5 个
const DEFAULT_RUNTIMES = ["phaser3", "pixijs", "canvas", "dom-ui", "three"];
let validRuntimes = DEFAULT_RUNTIMES;
try {
  const idxPath = resolve(scriptDir, "../references/engines/_index.json");
  if (existsSync(idxPath)) {
    const idx = JSON.parse(readFileSync(idxPath, "utf-8"));
    if (Array.isArray(idx.engines) && idx.engines.length > 0) {
      validRuntimes = idx.engines.map((e) => e.id);
    }
  }
} catch {
  // 保持 DEFAULT_RUNTIMES
}
if (runtime && !validRuntimes.includes(runtime)) {
  err("FM008", `runtime: ${runtime} 不在允许列表 [${validRuntimes.join("|")}] 内`,
      "新增引擎需先挂到 references/engines/_index.json");
}

// is-3d 与 runtime=three 的一致性校验
const is3dRaw = fmGet("is-3d");
const is3d = is3dRaw === "true" ? true : is3dRaw === "false" ? false : null;
if (is3dRaw !== null && is3d === null) {
  err("FM016", `is-3d=${is3dRaw} 非法，只能是 true 或 false`,
      "默认 false；仅当用户明确要求 3D 时置为 true 并配合 runtime: three");
}
if (is3d === true && runtime && runtime !== "three") {
  err("FM016", `is-3d: true 但 runtime=${runtime}，不是 three`,
      "is-3d: true 时 runtime 必须是 three；若本游戏是 2D 请改 is-3d: false");
}
if (is3d === false && runtime === "three") {
  err("FM016", "runtime: three 但 is-3d: false",
      "runtime: three 要求 is-3d: true；若本游戏是 2D 请换 phaser3/pixijs/canvas/dom-ui");
}
if (is3dRaw === null) {
  warn("FM017", "front-matter 缺少 is-3d 字段",
       "建议显式声明: is-3d: false（2D 默认）或 is-3d: true（3D，配合 runtime: three）");
}

// support-level 允许空（Phase 2.x strategy 回写），但若填写则校验值
if (supportLevel && !["直接支持", "降级支持", "暂不支持"].includes(supportLevel) && supportLevel !== "-") {
  err("FM009", `support-level: ${supportLevel} 非法`,
      "取值: 直接支持 | 降级支持 | 暂不支持（或 - 表示 Phase 2.x strategy 未回写）");
}

const VALID_DELIVERY_TARGETS = ["prototype", "playable-mvp", "feature-complete-lite"];
if (deliveryTarget && !VALID_DELIVERY_TARGETS.includes(deliveryTarget)) {
  err("FM013", `delivery-target=${deliveryTarget} 非法`,
      `合法值: ${VALID_DELIVERY_TARGETS.join(" | ")}`);
} else if (!deliveryTarget) {
  warn("FM014", "front-matter 缺少 delivery-target 字段",
       "建议: delivery-target: playable-mvp  # 或 prototype / feature-complete-lite");
}

if (!mustHaveFeatures) {
  warn("FM015", "front-matter 缺少 must-have-features 字段",
       "建议: must-have-features: [核心玩法1, 核心玩法2]，避免 strategy 默认走最小闭环");
}

// ─── 2. 符号规范（全角符号检测） ────────────────────────────────────────────

const FULL_WIDTH_CHARS = [
  { char: "：", name: "全角冒号", hint: "用半角 : 代替" },
  { char: "（", name: "全角左括号", hint: "用半角 ( 代替" },
  { char: "）", name: "全角右括号", hint: "用半角 ) 代替" },
  { char: "｜", name: "全角竖线", hint: "用半角 | 代替" },
  { char: "【", name: "全角左方括号", hint: "用半角 [ 代替" },
  { char: "】", name: "全角右方括号", hint: "用半角 ] 代替" },
];
const attrLines = [...body.matchAll(/^>\s+(.+)$/gm)];
for (const m of attrLines) {
  const line = m[1];
  for (const { char, name, hint } of FULL_WIDTH_CHARS) {
    if (line.includes(char)) {
      err("SY001", `属性行出现${name}: ${line.slice(0, 60)}`, hint);
    }
  }
}

// ─── 3. 章节顺序 ────────────────────────────────────────────────────────────

const REQUIRED_SECTIONS = [
  { n: 1, name: "项目概述" },
  { n: 2, name: "目标玩家与使用场景" },
  { n: 3, name: "核心玩法边界与 MVP 定义" },
  { n: 4, name: "主干流程" },
  { n: 5, name: "场景规格" },
  { n: 6, name: "状态与实体" },
  { n: 7, name: "规则与系统" },
  { n: 8, name: "资源与数据" },
  { n: 9, name: "运行方式与框架策略" },
  { n: 10, name: "校验点与验收标准" },
];
const h2s = [...body.matchAll(/^##\s+(\d+)\.\s*(.+?)\s*$/gm)].map((m) => ({
  n: Number(m[1]),
  name: m[2].trim(),
  idx: m.index,
}));
let expectedN = 1;
for (const s of REQUIRED_SECTIONS) {
  const found = h2s.find((h) => h.n === s.n);
  if (!found) {
    err("SE001", `缺少章节 §${s.n} ${s.name}`,
        `即使本版暂无内容，也要保留 ## ${s.n}. ${s.name} 标题 + 一句说明`);
  }
}
// 顺序校验
let prev = 0;
for (const h of h2s) {
  if (h.n <= prev && h.n <= 11) {
    err("SE002", `章节顺序异常：§${h.n} ${h.name} 出现在 §${prev} 之后`,
        "严格按 §1 ~ §11 顺序排列");
  }
  if (h.n > prev) prev = h.n;
}

// ─── 4. Tag 解析 ─────────────────────────────────────────────────────────────

const TAG_SPEC = {
  game: { required: ["genre", "platform", "runtime", "mode", "core-loop", "player-goal"] },
  flow: { required: ["entry", "main-scene", "exit"] },
  scene: { required: ["entry"] },
  state: { required: [] },
  entity: { required: ["type"] },
  rule: { required: ["trigger", "effect"] },
  input: { required: ["device", "targets"] },
  ui: { required: ["scene", "role"] },
  system: { required: ["depends", "outputs"] },
  level: { required: ["difficulty"] },
  resource: { required: ["type", "source"] },
  constraint: { required: ["kind"] },
  check: { required: ["layer"] },
};

const tagRe = /^#{2,4}[ \t]+@([a-z-]+)\(([^)]+)\)[ \t]*(.*)$/gm;
tags = []; // { type, id, display, attrs: {}, lineIdx }
let m;
while ((m = tagRe.exec(body)) !== null) {
  const type = m[1];
  const id = m[2].trim();
  const display = m[3].trim();
  // 抓取紧随的 > key: value 行（支持同行尾结束或立即换行）
  const afterIdx = m.index + m[0].length;
  const rest = body.slice(afterIdx);
  const attrBlock = rest.match(/^\n?((?:>\s+.+(?:\n|$))+)/);
  const attrs = {};
  if (attrBlock) {
    const lines = [...attrBlock[1].matchAll(/^>\s+([a-zA-Z0-9_-]+):\s*(.*)$/gm)];
    for (const a of lines) attrs[a[1].trim()] = a[2].trim();
  }
  tags.push({ type, id, display, attrs, lineIdx: m.index });
}

// 4.1 类型校验
for (const t of tags) {
  const spec = TAG_SPEC[t.type];
  if (!spec) {
    err("TG001", `未知 tag 类型: @${t.type}(${t.id})`,
        `允许的类型: ${Object.keys(TAG_SPEC).map((x) => "@" + x).join(" / ")}`);
    continue;
  }
  for (const req of spec.required) {
    if (!(req in t.attrs) || t.attrs[req] === "" || t.attrs[req] === undefined) {
      err("TG002", `@${t.type}(${t.id}) 缺少必填属性: ${req}`,
          `在 @${t.type}(${t.id}) 下增加 > ${req}: <值>`);
    }
  }
}

// 4.2 @game 强制存在且唯一
const games = tags.filter((t) => t.type === "game");
if (games.length === 0) {
  err("TG003", "缺少 @game 根对象", "在 §1 添加 ### @game(main) <游戏名>");
} else if (games.length > 1) {
  err("TG004", `@game 对象不唯一（发现 ${games.length} 个）`, "只保留一个 @game 根对象");
}

// 4.3 runtime 一致性：front-matter vs @game.runtime
if (games.length === 1 && games[0].attrs.runtime && runtime) {
  if (games[0].attrs.runtime !== runtime) {
    err("TG005", `front-matter runtime=${runtime} 与 @game.runtime=${games[0].attrs.runtime} 不一致`,
        "两处必须一致");
  }
}

// 4.3.1 genre 枚举校验（9 大类 enum）
const VALID_GENRES = [
  "board-grid", "platform-physics", "simulation", "strategy-battle",
  "single-reflex", "quiz-rule", "social-multi", "edu-practice", "narrative"
];
if (games.length === 1 && games[0].attrs.genre) {
  const g = games[0].attrs.genre;
  if (!VALID_GENRES.includes(g)) {
    err("TG007", `@game.genre=${g} 不在 9 大类 enum 内`,
        `合法值: ${VALID_GENRES.join(" | ")}。Phase 2.x strategy 依赖该字段做 engine 推荐`);
  }
}

// 4.3.2 color-scheme 结构校验（替代旧的 visual-style 枚举校验）
// 新流程：Phase 2 从 brief 关键词自动推断 color-scheme，写入 PRD front-matter。
const visualStyle = fmGet("visual-style");
if (visualStyle) {
  warn("FM011", `发现旧字段 visual-style: ${visualStyle}，已废弃`,
       "请移除 visual-style，改用 color-scheme 段作为唯一视觉事实源");
}

const colorScheme = fmYaml?.["color-scheme"];
const validPaletteIds = loadPaletteIds();
const REQUIRED_COLOR_SCHEME_KEYS = [
  "palette-id", "primary", "secondary", "accent", "background", "surface",
  "text", "text-muted", "success", "error", "border", "font-family",
  "border-radius", "shadow", "fx-hint",
];
const HEX_COLOR_KEYS = [
  "primary", "secondary", "accent", "background", "surface",
  "text", "text-muted", "success", "error", "border",
];
const VALID_FX_HINTS = ["soft", "pixel", "glow", "bounce", "ink"];

if (!colorScheme || typeof colorScheme !== "object" || Array.isArray(colorScheme)) {
  err("FM010", "front-matter 缺少 color-scheme 段",
      "Phase 2 必须从 brief/theme-keywords 自动推断 color-scheme，并从 color-palettes.yaml 复制完整硬值");
} else {
  for (const key of REQUIRED_COLOR_SCHEME_KEYS) {
    if (!scalarString(colorScheme[key])) {
      err("FM010", `color-scheme 缺少 ${key}`,
          "必须从 color-palettes.yaml 复制完整色板硬值，禁止只写 palette-id");
    }
  }

  const paletteId = scalarString(colorScheme["palette-id"]);
  if (paletteId && validPaletteIds.size > 0 && !validPaletteIds.has(paletteId)) {
    err("FM010", `color-scheme.palette-id=${paletteId} 不存在于 color-palettes.yaml`,
        `合法 palette-id: ${[...validPaletteIds].join(" | ")}`);
  }

  const themeKeywords = colorScheme["theme-keywords"];
  if (!Array.isArray(themeKeywords) || themeKeywords.length === 0) {
    warn("FM011", "color-scheme 缺少 theme-keywords 或为空",
         "建议保留 Phase 2 用于选择 palette 的关键词，方便审查动态选择依据");
  }

  for (const key of HEX_COLOR_KEYS) {
    const value = scalarString(colorScheme[key]);
    if (value && !/^#[0-9a-fA-F]{6}$/.test(value)) {
      err("FM010", `color-scheme.${key}=${value} 不是 #RRGGBB 色值`,
          "从 color-palettes.yaml 复制标准 hex 色值");
    }
  }

  const fxHint = scalarString(colorScheme["fx-hint"]);
  if (fxHint && !VALID_FX_HINTS.includes(fxHint)) {
    err("FM010", `color-scheme.fx-hint=${fxHint} 不在白名单`,
        `合法值: ${VALID_FX_HINTS.join(" | ")}`);
  }
}

// 4.3.3 project-slug 唯一性（必须含数字/时间戳后缀）
if (project) {
  const hasSuffix = /-\d{3}$|-\d{4}-\d{2}-\d{2}/.test(project);
  if (!hasSuffix) {
    warn("FM012", `project=${project} 未包含数字/时间戳后缀，可能与其他 case 撞名`,
         "改成 xxx-001 或 xxx-2026-04-24-120530，避免覆盖已有 cases/ 目录");
  }
}

// 4.4 engine-plan 回写一致性（Phase 2.x strategy 回写后）
const enginePlanMatch = fmText.match(/^engine-plan:\s*\n((?:\s+.+\n)+)/m);
if (enginePlanMatch) {
  const epRuntimeMatch = enginePlanMatch[1].match(/runtime:\s*(\S+)/);
  if (epRuntimeMatch && runtime && epRuntimeMatch[1] !== runtime) {
    warn("TG006", `engine-plan.runtime=${epRuntimeMatch[1]} 与 front-matter runtime=${runtime} 不一致`,
         "Phase 2.x strategy 回写后两者应统一");
  }
}

// ─── 5. 跨引用完整性 ────────────────────────────────────────────────────────

const tagIds = new Set(tags.map((t) => `${t.type}:${t.id}`));
// 扫描所有 @type(id) 引用（除了 tag 定义本身的标题）
const refRe = /@([a-z-]+)\(([^)]+)\)/g;
const headingTagPositions = new Set(tags.map((t) => t.lineIdx));

let rm;
const tagTitleRe = /^#{2,4}[ \t]+@[a-z-]+\([^)]+\)/gm;
const titleRanges = [];
let tm;
while ((tm = tagTitleRe.exec(body)) !== null) {
  titleRanges.push([tm.index, tm.index + tm[0].length]);
}
const isInTitle = (idx) => titleRanges.some(([a, b]) => idx >= a && idx < b);

while ((rm = refRe.exec(body)) !== null) {
  if (isInTitle(rm.index)) continue;
  const refType = rm[1];
  const refId = rm[2].trim();
  // 过滤非本 tag 体系的引用（文档内可能有 @tailwindcss/browser 之类不算）
  if (!TAG_SPEC[refType]) continue;
  const key = `${refType}:${refId}`;
  if (!tagIds.has(key)) {
    err("XR001", `引用的 @${refType}(${refId}) 未在本文档内定义`,
        `请在对应章节新增 ### @${refType}(${refId}) 定义，或修正引用 id`);
  }
}

// ─── 6. 强约束落点校验 ─────────────────────────────────────────────────────

const hardRules = tags.filter((t) => t.type === "constraint" && t.attrs.kind === "hard-rule");
const productChecks = tags.filter((t) => t.type === "check" && t.attrs.layer === "product");
if (hardRules.length > 0 && productChecks.length === 0) {
  warn("HR001", `存在 ${hardRules.length} 个 hard-rule 约束但无 @check(layer: product)`,
       "每条强约束应有至少一个产品侧 @check 对应，便于 Phase 5 Playwright 验证");
}

// ─── 6.1 @rule.effect 伪代码风格校验 ────────────────────────────────────────

const PSEUDO_TOKENS = ["→", "->", ";", "==", "!=", ">=", "<=", "+=", "-=", "="];
const PROSE_MARKERS = [
  /系统会/, /玩家会/, /玩家感受到/, /给予玩家/, /友好.*反馈/,
  /优雅地/, /合适的(逻辑|反馈|时机)/, /恰当地/, /适当的/,
];
for (const t of tags.filter((t) => t.type === "rule")) {
  const eff = t.attrs.effect ?? "";
  if (!eff) continue;

  // 6.1.1 必须含至少一个伪代码 token
  const hasToken = PSEUDO_TOKENS.some((tok) => eff.includes(tok));
  if (!hasToken) {
    err("RL001", `@rule(${t.id}).effect 不含任何伪代码符号（→/->/;/=/==/+=/-= 等）`,
        "改成伪代码风格，例: \"cond → a += 1 ; b = true\"，详见 game-aprd-format.md 的 @rule.effect 约定");
  }

  // 6.1.2 禁止散文 / 感受性描述
  for (const re of PROSE_MARKERS) {
    if (re.test(eff)) {
      err("RL002", `@rule(${t.id}).effect 含散文/感受性描述: "${eff.slice(0, 60)}..."`,
          "改成可执行步骤，禁用\"系统会/玩家会/优雅/合适的\"等表述");
      break;
    }
  }

  // 6.1.3 长度 warning，建议拆 rule
  if (eff.length > 120) {
    warn("RL003", `@rule(${t.id}).effect 长度 ${eff.length} 字符（> 120），建议拆成多条 @rule`,
         "用 priority 或中间字段把长 effect 切成两步");
  }
}

// ─── 6.2 @rule.effect 语义 lint（P2-2 新增） ─────────────────────────────────
// 扫 effect 里的 <entity-ref>.<field> 引用，如果 <entity-ref> 对应一个已声明的
// @entity（按 id 直接匹配，或按 type 别名匹配——比如 "player"、"enemy" 这种
// 常见别名），则校验 <field> 必须在 @entity.fields 中声明过。
// 约束强度：warning（不 block）。目的是抓打错字段名 / 漏声明字段的情况。

function parseEntityFields(raw) {
  const out = new Set();
  if (!raw) return out;
  const body = raw.replace(/^\s*[\[{]|[\]}]\s*$/g, "");
  for (const pair of body.split(/[,;]/)) {
    const m = pair.trim().match(/^([a-zA-Z_][\w-]*)/);
    if (m) out.add(m[1]);
  }
  return out;
}

// entityFieldsByName: 多种命名方式下都能查到 fields
//   - 按 id 完整匹配：player, enemy, boss, item
//   - 按 type 别名（attrs.type）：如果 type 唯一，也能查
const entityFieldsByName = new Map();
for (const t of tags.filter(x => x.type === "entity")) {
  const fields = parseEntityFields(t.attrs.fields);
  entityFieldsByName.set(t.id, fields);
  // 同时按 type 别名登记（如果只有一个 entity 是该 type）
  const ty = t.attrs.type;
  if (ty && ![...entityFieldsByName.keys()].some(k => k === ty)) {
    // 查同 type 是否多于一个
    const sameType = tags.filter(x => x.type === "entity" && x.attrs.type === ty);
    if (sameType.length === 1) entityFieldsByName.set(ty, fields);
  }
}

// 常见同义词 alias 到已知 entity id（比如 attacker/target/enemy 都映射到 @entity(enemy|player) 的 fields）
// 策略：若别名不在 entityFieldsByName 里，就把它视作"未知主语"跳过，不报错。
// 但如果别名在 entityFieldsByName 里，就严校验它的 field。

const ALIAS_TO_ENTITY = {
  attacker: ["player", "enemy"],
  target: ["player", "enemy"],
  self: ["player"],
  me: ["player"],
  opponent: ["enemy", "player"],
};

function resolveAliasFields(name) {
  if (entityFieldsByName.has(name)) return entityFieldsByName.get(name);
  const candidates = ALIAS_TO_ENTITY[name] || [];
  // 并集：别名可能指多个 entity 之一，所以 field 存在于任一候选就算通过
  const union = new Set();
  for (const c of candidates) {
    const f = entityFieldsByName.get(c);
    if (f) for (const k of f) union.add(k);
  }
  return union.size ? union : null;
}

// 扫 <ident>.<field> 引用（包含 state./gameState. 前缀的情况）
const FIELD_REF_RE = /\b([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)\b/g;
const SKIP_SUBJECTS = new Set([
  // 内置全局 / API，不校验
  "Math", "JSON", "window", "document", "console",
  // 常见局部变量 / 表达式容器
  "rect", "arr", "item", "card", "value", "index", "node", "el",
]);

for (const t of tags.filter(x => x.type === "rule")) {
  const eff = t.attrs.effect ?? "";
  if (!eff) continue;
  const seen = new Set();
  let mm;
  FIELD_REF_RE.lastIndex = 0;
  while ((mm = FIELD_REF_RE.exec(eff)) !== null) {
    const subject = mm[1];
    const field = mm[2];
    const key = `${subject}.${field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (SKIP_SUBJECTS.has(subject)) continue;

    // 若 subject 是 state / gameState，下一层才是 entity 别名（state.player.hp）
    // FIELD_REF_RE 已经把 state.player 匹到了，next iteration 会匹 player.hp
    if (subject === "state" || subject === "gameState") continue;

    const fields = resolveAliasFields(subject);
    if (fields === null) continue;   // 未声明实体/别名，跳过
    if (!fields.has(field)) {
      warn("RL004", `@rule(${t.id}).effect 引用 ${subject}.${field}，但该字段未在对应 @entity.fields 中声明`,
           `在 @entity(${subject}) 或其类型别名指向的 entity 的 fields 中补充 ${field}，或检查拼写`);
    }
  }
}

// ─── 7. @game 的列表属性与对象定义一致性 ───────────────────────────────────

if (games.length === 1) {
  const g = games[0];
  const listAttrs = {
    scenes: "scene",
    states: "state",
    levels: "level",
    resources: "resource",
    controls: "input",
  };
  for (const [attr, targetType] of Object.entries(listAttrs)) {
    const v = g.attrs[attr];
    if (!v) continue;
    const matches = [...v.matchAll(/@([a-z-]+)\(([^)]+)\)/g)];
    for (const mm of matches) {
      if (!tagIds.has(`${mm[1]}:${mm[2]}`)) {
        err("GL001", `@game.${attr} 引用的 @${mm[1]}(${mm[2]}) 未定义`,
            `请在对应章节新增 ### @${mm[1]}(${mm[2]})`);
      }
      if (mm[1] !== targetType) {
        err("GL002", `@game.${attr} 应只引用 @${targetType}，但发现 @${mm[1]}(${mm[2]})`,
            `修改为 @${targetType}(...) 或移到对应属性`);
      }
    }
  }
}

// ─── 报告 ───────────────────────────────────────────────────────────────────

function report() {
  const relPath = prdPath.replace(process.cwd() + "/", "");
  console.log(`\nGame APRD 检查: ${relPath}`);
  console.log(`  tags: ${tags.length} | errors: ${errors.length} | warnings: ${warnings.length}`);
  if (errors.length > 0) {
    console.log("\n✗ Errors:");
    for (const e of errors) {
      console.log(`  [${e.code}] ${e.msg}`);
      if (e.hint) console.log(`           💡 ${e.hint}`);
    }
  }
  if (warnings.length > 0) {
    console.log("\n⚠ Warnings:");
    for (const w of warnings) {
      console.log(`  [${w.code}] ${w.msg}`);
      if (w.hint) console.log(`           💡 ${w.hint}`);
    }
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.log("\n✓ 全部通过");
  } else if (errors.length === 0) {
    console.log("\n✓ 无 error，仅有 warning（可 task_done）");
  }
}

report();

// ─── 日志输出 ─────────────────────────────────────────────────────────────────
import { createLogger, parseLogArg } from "./_logger.js";
const logPath = parseLogArg(process.argv);
const log = createLogger(logPath);
log.entry({
  type: "check-run",
  phase: "prd",
  script: "check_game_prd.js",
  exit_code: errors.length > 0 ? 1 : 0,
  tags_count: tags.length,
  errors: errors.map(e => ({ code: e.code, msg: e.msg })),
  warnings: warnings.map(w => ({ code: w.code, msg: w.msg })),
});

process.exit(errors.length > 0 ? 1 : 0);
