#!/usr/bin/env node
/**
 * extract_prd.js — 从 APRD 格式的 prd.md 中提取指定页面或模块的 API / 数据模型
 *
 * 用法:
 *   node extract_prd.js <prd文件> --page <url>              # 按页面提取关联 API
 *   node extract_prd.js <prd文件> --module <id>             # 按模块提取 API + 数据模型
 *   node extract_prd.js <prd文件> --module <id1>,<id2>      # 多个模块
 *   node extract_prd.js <prd文件> --page <url> --module <id> # 混合
 *   node extract_prd.js <prd文件> --list                    # 列出所有可用 page / module
 *
 * 输出: Markdown 格式，写到 stdout
 *
 * 退出码:
 *   0 = 成功
 *   1 = 文件不存在 / 参数错误
 *   2 = 找不到指定 page 或 module（但不崩溃，会列出候选）
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ─── CLI 参数解析 ──────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  printHelp();
  process.exit(0);
}

const prdPath = resolve(args[0]);
const pages   = [];   // 收集 --page 参数
const modules = [];   // 收集 --module 参数
let listMode  = false;

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--list") {
    listMode = true;
  } else if (args[i] === "--page" && args[i + 1]) {
    // 支持逗号分隔
    args[++i].split(",").map(s => s.trim()).filter(Boolean).forEach(p => pages.push(p));
  } else if (args[i] === "--module" && args[i + 1]) {
    args[++i].split(",").map(s => s.trim()).filter(Boolean).forEach(m => modules.push(m));
  } else if (args[i].startsWith("--page=")) {
    args[i].slice(7).split(",").map(s => s.trim()).filter(Boolean).forEach(p => pages.push(p));
  } else if (args[i].startsWith("--module=")) {
    args[i].slice(9).split(",").map(s => s.trim()).filter(Boolean).forEach(m => modules.push(m));
  }
}

if (!listMode && pages.length === 0 && modules.length === 0) {
  console.error("错误：请指定 --page <url>、--module <id> 或 --list");
  printHelp();
  process.exit(1);
}

// ─── 读取文件 ──────────────────────────────────────────────────

let content;
try {
  content = readFileSync(prdPath, "utf-8");
} catch {
  console.error(`错误：文件不存在或无法读取: ${prdPath}`);
  process.exit(1);
}

// ─── 解析 sections ────────────────────────────────────────────

/**
 * 将文档切分为 sections
 * 每个 section: { heading, level, tagType, tagId, body, lineNo }
 */
function parseSections(text) {
  const lines    = text.split("\n");
  const sections = [];
  let cur = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hm   = line.match(/^(#{1,6})\s+(.*)/);
    if (hm) {
      if (cur) {
        cur.body = cur._lines.join("\n").replace(/\n+$/, "");
        delete cur._lines;
        sections.push(cur);
      }
      const level    = hm[1].length;
      const heading  = hm[2].trim();
      const tagMatch = heading.match(/@([\w-]+)\(([^)]+)\)/);
      cur = {
        heading,
        level,
        tagType : tagMatch ? tagMatch[1] : null,
        tagId   : tagMatch ? tagMatch[2].trim() : null,
        _lines  : [],
        body    : "",
        lineNo  : i + 1,
        raw     : line,   // 原始标题行
      };
    } else if (cur) {
      cur._lines.push(line);
    }
  }
  if (cur) {
    cur.body = cur._lines.join("\n").replace(/\n+$/, "");
    delete cur._lines;
    sections.push(cur);
  }
  return sections;
}

/**
 * 从 section.body 提取属性行 `> key: value`
 */
function parseAttrs(body) {
  const attrs = {};
  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    const m = line.match(/^>\s+([\w-]+):\s*(.*)/);
    if (!m) break;
    attrs[m[1]] = m[2].trim();
  }
  return attrs;
}

/** 判断是否是"无"值 */
function isNone(val) {
  if (!val) return true;
  const v = val.trim();
  return v === "—" || v === "–" || v === "-" || v === "[]" || /^(none|null|empty)$/i.test(v);
}

/** 从属性值中提取所有 @tag(id) 引用 */
function extractRefs(attrVal, tagType) {
  if (!attrVal || isNone(attrVal)) return [];
  const re = new RegExp(`@${tagType}\\(([^)]+)\\)`, "g");
  return [...attrVal.matchAll(re)].map(m => m[1].trim());
}

/**
 * 规范化 page url 用于匹配：
 * - 去掉开头 /（可选有无）
 * - 去掉 query string（?xxx）
 * - 去掉 @web-page() / @mobile-page() 包装
 * - 统一小写
 */
function normalizeUrl(raw) {
  if (!raw) return "";
  let s = raw.trim();
  // 去掉 @xxx-page(...) 包装
  const m = s.match(/@(?:web|mobile)-page\(([^)]+)\)/);
  if (m) s = m[1];
  // 去掉 query string
  s = s.split("?")[0];
  // 统一有无开头 /
  if (!s.startsWith("/")) s = "/" + s;
  return s.toLowerCase();
}

/**
 * 规范化 module id：
 * - 去掉 @server-module(...) 包装
 * - 小写
 */
function normalizeModuleId(raw) {
  if (!raw) return "";
  const m = raw.match(/@server-module\(([^)]+)\)/);
  if (m) return m[1].trim().toLowerCase();
  return raw.trim().toLowerCase();
}

// ─── 构建索引 ─────────────────────────────────────────────────

const sections = parseSections(content);

const byTagType = {};
for (const sec of sections) {
  if (sec.tagType) {
    if (!byTagType[sec.tagType]) byTagType[sec.tagType] = new Map();
    byTagType[sec.tagType].set(sec.tagId, sec);
  }
}

const getTag  = (type, id) => byTagType[type]?.get(id) ?? null;
const allTags = (type)     => [...(byTagType[type]?.values() ?? [])];

// ─── --list 模式 ──────────────────────────────────────────────

if (listMode) {
  const webPages    = allTags("web-page");
  const mobilePages = allTags("mobile-page");
  const mods        = allTags("server-module");
  const apis        = allTags("api");
  const models      = allTags("data-model");

  const lines = [`# PRD 内容索引\n\n来源：${prdPath}\n`];

  if (webPages.length) {
    lines.push(`## Web 页面 (${webPages.length})`);
    for (const s of webPages) {
      const attrs = parseAttrs(s.body);
      const apiList = extractRefs(attrs.apis, "api");
      lines.push(`- @web-page(${s.tagId})  ${s.heading.replace(/@web-page\([^)]+\)\s*/, "")}` +
                 (apiList.length ? `  → APIs: ${apiList.join(", ")}` : ""));
    }
    lines.push("");
  }

  if (mobilePages.length) {
    lines.push(`## Mobile 页面 (${mobilePages.length})`);
    for (const s of mobilePages) {
      const attrs = parseAttrs(s.body);
      const apiList = extractRefs(attrs.apis, "api");
      lines.push(`- @mobile-page(${s.tagId})  ${s.heading.replace(/@mobile-page\([^)]+\)\s*/, "")}` +
                 (apiList.length ? `  → APIs: ${apiList.join(", ")}` : ""));
    }
    lines.push("");
  }

  if (mods.length) {
    lines.push(`## 服务端模块 (${mods.length})`);
    for (const s of mods) {
      const attrs   = parseAttrs(s.body);
      const apiList = extractRefs(attrs.apis, "api");
      const modList = extractRefs(attrs.models, "data-model");
      lines.push(`- @server-module(${s.tagId})  ${s.heading.replace(/@server-module\([^)]+\)\s*/, "")}`);
      if (apiList.length)  lines.push(`    APIs:   ${apiList.join(", ")}`);
      if (modList.length)  lines.push(`    Models: ${modList.join(", ")}`);
    }
    lines.push("");
  }

  if (apis.length) {
    lines.push(`## API 接口 (${apis.length})`);
    for (const s of apis) {
      const attrs = parseAttrs(s.body);
      lines.push(`- @api(${s.tagId})  [${attrs.method ?? "?"}] ${attrs.path ?? ""}  ${s.heading.replace(/@api\([^)]+\)\s*/, "")}`);
    }
    lines.push("");
  }

  if (models.length) {
    lines.push(`## 数据模型 (${models.length})`);
    for (const s of models) {
      lines.push(`- @data-model(${s.tagId})  ${s.heading.replace(/@data-model\([^)]+\)\s*/, "")}`);
    }
  }

  // 没有 --page / --module，只输出索引就结束
  if (pages.length === 0 && modules.length === 0) {
    console.log(lines.join("\n"));
    process.exit(0);
  }

  // 有 --page / --module，先输出索引，再用分隔线衔接详情
  console.log(lines.join("\n"));
  console.log("\n" + "─".repeat(60) + "\n");
}

// ─── 收集要输出的 api / model / page section ──────────────────

const warnings       = [];
const collectedApis   = new Map();   // id → section
const collectedModels = new Map();   // id → section
const collectedPages  = new Map();   // tagId → section（--page 时收集，用于输出页面说明）
const sources         = [];          // 描述来源（用于输出头部）

/**
 * 根据 api id 列表收集 api sections
 * apiIds: string[]
 * sourceLabel: 用于 warning 的来源描述
 */
function collectApis(apiIds, sourceLabel) {
  for (const id of apiIds) {
    if (collectedApis.has(id)) continue;
    const sec = getTag("api", id);
    if (!sec) {
      warnings.push(`⚠️  ${sourceLabel} 引用了 @api(${id})，但文档中找不到该 API section`);
    } else {
      collectedApis.set(id, sec);
    }
  }
}

/**
 * 根据 data-model id 列表收集 model sections
 */
function collectModels(modelIds, sourceLabel) {
  for (const id of modelIds) {
    if (collectedModels.has(id)) continue;
    const sec = getTag("data-model", id);
    if (!sec) {
      warnings.push(`⚠️  ${sourceLabel} 引用了 @data-model(${id})，但文档中找不到该 data-model section`);
    } else {
      collectedModels.set(id, sec);
    }
  }
}

// ── 处理 --page ───────────────────────────────────────────────

const allPageSections = [
  ...allTags("web-page").map(s => ({ ...s, kind: "web-page" })),
  ...allTags("mobile-page").map(s => ({ ...s, kind: "mobile-page" })),
];

for (const rawPage of pages) {
  const normalizedInput = normalizeUrl(rawPage);

  // 找匹配的 page sections（web-page 和 mobile-page 都找）
  const matched = allPageSections.filter(s => normalizeUrl(s.tagId) === normalizedInput);

  if (matched.length === 0) {
    warnings.push(`⚠️  找不到页面 "${rawPage}"（已规范化为 "${normalizedInput}"）`);
    // 给出候选
    const candidates = allPageSections
      .map(s => `  - @${s.kind}(${s.tagId})`)
      .join("\n");
    warnings.push(`    可用页面：\n${candidates}`);
    continue;
  }

  for (const pageSec of matched) {
    const attrs   = parseAttrs(pageSec.body);
    const apiIds  = extractRefs(attrs.apis, "api");
    const refdocs = extractRefs(attrs.refdoc ?? "", "").length === 0
      ? (attrs.refdoc && !isNone(attrs.refdoc)
          ? attrs.refdoc.replace(/^\[|\]$/g, "").split(",").map(s => s.trim()).filter(Boolean)
          : [])
      : [];
    // refdoc 是路径列表，不是 tag 引用，单独解析
    const refdocPaths = attrs.refdoc
      ? attrs.refdoc.replace(/^\[|\]$/g, "").split(",").map(s => s.trim()).filter(s => s && !isNone(s))
      : [];

    const label   = `@${pageSec.kind}(${pageSec.tagId})`;
    const title   = pageSec.heading.replace(/@[\w-]+\([^)]+\)\s*/, "");

    sources.push(`页面: ${label}  ${title}`);
    collectedPages.set(pageSec.tagId, { sec: pageSec, refdocPaths });

    if (apiIds.length === 0) {
      warnings.push(`ℹ️  ${label} 没有关联 API（apis 属性为空或 —）`);
    } else {
      collectApis(apiIds, label);
    }
  }
}

// ── 处理 --module ─────────────────────────────────────────────

for (const rawModule of modules) {
  const normalizedId = normalizeModuleId(rawModule);

  // 精确匹配
  let modSec = getTag("server-module", normalizedId);

  // 精确匹配失败时做模糊匹配（包含关系）
  if (!modSec) {
    const allMods = allTags("server-module");
    const fuzzy   = allMods.filter(s => s.tagId.toLowerCase().includes(normalizedId));
    if (fuzzy.length === 1) {
      modSec = fuzzy[0];
      warnings.push(`ℹ️  "${rawModule}" 模糊匹配到 @server-module(${modSec.tagId})`);
    } else if (fuzzy.length > 1) {
      warnings.push(`⚠️  "${rawModule}" 模糊匹配到多个模块，请使用精确 id：`);
      fuzzy.forEach(s => warnings.push(`    - ${s.tagId}`));
      continue;
    } else {
      warnings.push(`⚠️  找不到模块 "${rawModule}"`);
      const allIds = allTags("server-module").map(s => `  - ${s.tagId}`).join("\n");
      warnings.push(`    可用模块：\n${allIds}`);
      continue;
    }
  }

  const attrs    = parseAttrs(modSec.body);
  const apiIds   = extractRefs(attrs.apis, "api");
  const modelIds = extractRefs(attrs.models, "data-model");
  const label    = `@server-module(${modSec.tagId})`;

  sources.push(`模块: ${label}  ${modSec.heading.replace(/@server-module\([^)]+\)\s*/, "")}`);

  if (apiIds.length === 0) {
    warnings.push(`ℹ️  ${label} 没有关联 API`);
  } else {
    collectApis(apiIds, label);
  }

  if (modelIds.length === 0) {
    warnings.push(`ℹ️  ${label} 没有关联数据模型`);
  } else {
    collectModels(modelIds, label);
  }
}

// ─── 输出 ─────────────────────────────────────────────────────

const out = [];

// 头部
out.push(`# PRD 提取结果`);
out.push(``);
out.push(`> 来源文件：${prdPath}`);
out.push(``);

if (sources.length) {
  out.push(`## 提取来源`);
  for (const s of sources) out.push(`- ${s}`);
  out.push(``);
}

// warnings
if (warnings.length) {
  out.push(`## 提示`);
  for (const w of warnings) out.push(w);
  out.push(``);
}

// 页面说明（--page 时输出）
if (collectedPages.size > 0) {
  out.push(`## 页面说明 (${collectedPages.size})`);
  out.push(``);
  for (const [tagId, { sec, refdocPaths }] of collectedPages) {
    const kind  = sec.tagType;  // "web-page" or "mobile-page"
    const title = sec.heading.replace(/.*@[\w-]+\([^)]+\)\s*/, "");
    // url → filename
    const path     = tagId.split("?")[0].replace(/^\//, "");
    const filename = (path === "" ? "home" : path) + ".html";
    out.push(`### @${kind}(${tagId}) ${title}`);
    out.push(`> 输出文件: ${filename}`);
    if (refdocPaths.length > 0) {
      out.push(`> refdoc: ${refdocPaths.join(", ")}`);
    }
    out.push(sec.body);
    out.push(``);
  }
}

// API sections
if (collectedApis.size > 0) {
  out.push(`## API 接口 (${collectedApis.size})`);
  out.push(``);
  for (const [id, sec] of collectedApis) {
    // 用原始标题行（保留层级），但统一输出为 ###
    out.push(`### @api(${id}) ${sec.heading.replace(/.*@api\([^)]+\)\s*/, "")}`);
    out.push(sec.body);
    out.push(``);
  }
}

// 数据模型 sections（仅 --module 时有）
if (collectedModels.size > 0) {
  out.push(`## 数据模型 (${collectedModels.size})`);
  out.push(``);
  for (const [id, sec] of collectedModels) {
    out.push(`### @data-model(${id}) ${sec.heading.replace(/.*@data-model\([^)]+\)\s*/, "")}`);
    out.push(sec.body);
    out.push(``);
  }
}

if (collectedApis.size === 0 && collectedModels.size === 0 && warnings.length === 0) {
  out.push(`_没有找到任何内容_`);
}

console.log(out.join("\n"));

// 有 "找不到" 类错误时退出码 2，警告（ℹ️）不影响退出码
const hasError = warnings.some(w => w.startsWith("⚠️"));
process.exit(hasError ? 2 : 0);

// ─── 工具函数（供外部参考）──────────────────────────────────

/**
 * 将 PRD url 转换为原型 HTML 文件名
 * "/" → "home.html"
 * "/note-detail" → "note-detail.html"
 * "/note-detail?note_id=uuid" → "note-detail.html"（strip query）
 */
export function urlToFilename(url) {
  const path = url.split("?")[0].replace(/^\//, "");
  return (path === "" ? "home" : path) + ".html";
}

// ─── 帮助信息 ─────────────────────────────────────────────────

function printHelp() {
  console.log(`
extract_prd.js — 从 prd.md 提取 API / 数据模型

用法:
  node extract_prd.js <prd文件> [选项]

选项:
  --page <url>      按页面提取页面说明 + 关联 API（可多次使用，或逗号分隔）
  --module <id>     按服务端模块提取 API + 数据模型（可多次使用，或逗号分隔）
  --list            列出文档中所有可用的 page / module / api / data-model
  --help            显示此帮助

示例:
  node extract_prd.js docs/prd.md --list
  node extract_prd.js docs/prd.md --page /notes
  node extract_prd.js docs/prd.md --page /notes,/note-detail
  node extract_prd.js docs/prd.md --module notes
  node extract_prd.js docs/prd.md --module auth,notes
  node extract_prd.js docs/prd.md --page /notes --module auth
`.trim());
}
