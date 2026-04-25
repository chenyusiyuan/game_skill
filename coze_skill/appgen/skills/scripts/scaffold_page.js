#!/usr/bin/env node
/**
 * scaffold_page.js — 从 design.html 提取 <head> 骨架，生成原型页面初始文件
 *
 * 用法：
 *   node scaffold_page.js <design.html> <输出路径> <页面标题> [--prd <prd.md>] [--page <url>] [--skill-dir <dir>]
 *
 * 示例（仅骨架，无 API 注释）：
 *   node scaffold_page.js design/mobile/selected/design.html prototype/mobile/home.html "首页"
 *
 * 示例（含 API 文档注释）：
 *   node scaffold_page.js design/web/selected/design.html prototype/web/grooming.html "洗护排队列表" \
 *     --prd docs/prd.md --page /grooming --skill-dir /path/to/skills
 *
 * 提取内容（均来自 design.html，原样复制）：
 *   - <meta> 标签
 *   - <link> 标签（字体、图标库等）
 *   - Tailwind CDN <script src>
 *   - tailwind.config = { ... } 完整块
 *   - <style> 块
 *   - jQuery <script src>（若 design.html 没有则自动补上）
 *   - <body> 的 class 属性
 *
 * 固定注入：
 *   - API 文档注释（@prd-api 块，传入 --prd/--page 时生成）
 *   - 四个导航辅助函数 navPush / navReplace / navReset / navBack
 *   - $(function(){ ... }) 交互初始化占位
 *
 * API 注释格式（可用 grep "@prd-api" 定位，删除时去掉整个注释块）：
 *   <!-- @prd-api: {api-id}
 *   {method} {path}
 *   ...
 *   -->
 *
 * 退出码：
 *   0 = 成功
 *   1 = 参数错误或文件不存在
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname, basename } from "path";
import { execSync } from "child_process";

// ─── 参数解析 ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error("用法: node scaffold_page.js <design.html> <输出路径> <页面标题> [--prd <prd.md>] [--page <url>] [--skill-dir <dir>]");
  process.exit(1);
}

const designPath = resolve(args[0]);
const outputPath = resolve(args[1]);
const pageTitle  = args[2];

// 可选参数
let prdPath  = null;
let pageUrl  = null;
let skillDir = null;
for (let i = 3; i < args.length; i++) {
  if (args[i] === "--prd"       && args[i+1]) { prdPath  = resolve(args[++i]); }
  if (args[i] === "--page"      && args[i+1]) { pageUrl  = args[++i]; }
  if (args[i] === "--skill-dir" && args[i+1]) { skillDir = resolve(args[++i]); }
}

const withApi = prdPath && pageUrl && skillDir;

// ─── 读取 design.html ─────────────────────────────────────────────────────

let designHtml;
try {
  designHtml = readFileSync(designPath, "utf-8");
} catch (e) {
  console.error(`无法读取 design.html：${designPath}`);
  process.exit(1);
}

// ─── 提取工具函数 ──────────────────────────────────────────────────────────

function extractTags(html, tagPattern) {
  const results = [];
  const re = new RegExp(tagPattern, "gi");
  let m;
  while ((m = re.exec(html)) !== null) {
    results.push(m[0].replace(/^\s+/, "").trim());
  }
  return results;
}

function extractTailwindConfig(html) {
  const assignIdx = html.search(/tailwind\.config\s*=/);
  if (assignIdx === -1) return null;
  const braceStart = html.indexOf("{", assignIdx);
  if (braceStart === -1) return null;
  let depth = 0, inString = false, stringChar = "", escaped = false;
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (!inString && (ch === '"' || ch === "'")) { inString = true; stringChar = ch; continue; }
    if (inString && ch === stringChar) { inString = false; continue; }
    if (inString) continue;
    if (ch === "{") { depth++; continue; }
    if (ch === "}") { if (--depth === 0) return html.slice(braceStart, i + 1); }
  }
  return null;
}

function extractStyleBlocks(html) {
  const results = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const content = m[1].trim();
    if (content) results.push(content);
  }
  return results;
}

function extractBodyClass(html) {
  const m = html.match(/<body[^>]*\bclass=["']([^"']*)["'][^>]*>/i);
  return m ? m[1].trim() : "bg-background text-on-surface";
}

// ─── 提取 design.html 内容 ────────────────────────────────────────────────

const metaTags = extractTags(designHtml, "<meta[^>]*/?>")
  .filter(t => !t.includes('http-equiv="X-UA-Compatible"'));

const linkTags = extractTags(designHtml, "<link[^>]*/?>")
  .filter(t => !t.includes("canonical") && !t.includes("favicon"));

/** 从 link 标签列表中识别图标库，用于 scaffold-info 注释。
 *  未检测到任何图标库时，默认回退到 FontAwesome（并自动补充引入）。
 */
function detectIconLibs(links) {
  const libs = [];
  for (const tag of links) {
    if (/font-awesome/i.test(tag))
      libs.push("FontAwesome（来自设计稿）  用法: <i class=\"fa-solid fa-house\"></i>");
    else if (/material.*symbol/i.test(tag))
      libs.push("Material Symbols（来自设计稿）  用法: <span class=\"material-symbols-outlined\">home</span>");
    else if (/material.*icon/i.test(tag))
      libs.push("Material Icons（来自设计稿）  用法: <span class=\"material-icons\">home</span>");
    else if (/bootstrap-icon/i.test(tag))
      libs.push("Bootstrap Icons（来自设计稿）  用法: <i class=\"bi bi-house\"></i>");
    else if (/lucide/i.test(tag))
      libs.push("Lucide Icons（来自设计稿）");
    else if (/remixicon/i.test(tag))
      libs.push("Remix Icon（来自设计稿）  用法: <i class=\"ri-home-line\"></i>");
  }
  // 设计稿未引入任何图标库时，默认使用 FontAwesome
  if (libs.length === 0) {
    libs.push("FontAwesome（默认）  用法: <i class=\"fa-solid fa-house\"></i>");
  }
  return libs;
}

const tailwindCdn = (() => {
  const m = designHtml.match(/<script[^>]*cdn\.tailwindcss\.com[^>]*><\/script>/i);
  return m ? m[0] : '<script src="https://cdn.tailwindcss.com?plugins=forms"></script>';
})();

const tailwindConfig = extractTailwindConfig(designHtml);
if (!tailwindConfig) {
  console.error("未在 design.html 中找到 tailwind.config，请检查设计稿");
  process.exit(1);
}

const styleBlocks = extractStyleBlocks(designHtml);
const bodyClass   = extractBodyClass(designHtml);

// 图标库默认回退：设计稿无任何图标库时，自动补充 FontAwesome
const hasAnyIconLib = /font-awesome|material.*symbol|material.*icon|bootstrap-icon|lucide|remixicon/i.test(designHtml);
const faFallbackTag = hasAnyIconLib
  ? null
  : '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"/>';

// ─── 生成 API 文档注释 ────────────────────────────────────────────────────

/**
 * 从 extract_prd.js 的 Markdown 输出中解析 API 块，
 * 每个 API 生成一段 <!-- @prd-api: {id} ... --> 注释。
 *
 * 注释内容保留：method / path / Request / Response
 * 去掉：auth / module / impl / page-ref（对 agent 写 HTML 无用）
 */
function buildApiComments(prdMd, pageUrlArg) {
  // 调用 extract_prd.js，拿到 Markdown 输出
  const extractScript = resolve(skillDir, "scripts/extract_prd.js");
  let markdown;
  try {
    markdown = execSync(
      `node "${extractScript}" "${prdMd}" --page "${pageUrlArg}"`,
      { encoding: "utf-8" }
    );
  } catch (e) {
    // 退出码 2 表示有警告但不是致命错误，输出仍有效
    markdown = e.stdout || "";
    if (!markdown) {
      console.warn(`  ⚠️  extract_prd.js 执行失败，跳过 API 注释`);
      return "";
    }
  }

  // 按 ### @api(...) 切分各个 API 块
  const apiBlocks = [];
  const apiRe = /### @api\(([^)]+)\)\s+([^\n]*)\n([\s\S]*?)(?=\n### @api|\n## (?!API)|$)/g;
  let m;
  while ((m = apiRe.exec(markdown)) !== null) {
    const apiId   = m[1].trim();
    const apiName = m[2].trim();
    const body    = m[3];

    // 从 body 提取 method / path
    const methodM = body.match(/^> method:\s*(.+)/m);
    const pathM   = body.match(/^> path:\s*(.+)/m);
    const method  = methodM ? methodM[1].trim().toUpperCase() : "?";
    const path    = pathM   ? pathM[1].trim() : "?";

    // 提取 Request 块（如有）
    const reqM = body.match(/\*\*Request\*\*[^\n]*\n([\s\S]*?)(?=\n\*\*(?:Response|Errors)\*\*|\n###|$)/);
    const reqBlock = reqM ? reqM[1].trimEnd() : null;

    // 提取 Response 块
    const resM = body.match(/\*\*Response\*\*[^\n]*\n([\s\S]*?)(?=\n\*\*Errors\*\*|\n###|$)/);
    const resBlock = resM ? resM[1].trimEnd() : null;

    // 组装注释内容，每行加 2 空格缩进
    const lines = [
      `@prd-api: ${apiId}  ${apiName}`,
      `${method} ${path}`,
    ];
    if (reqBlock && reqBlock.trim() && !reqBlock.includes("无请求体")) {
      lines.push("", "Request:");
      for (const l of reqBlock.split("\n")) lines.push(`  ${l}`);
    }
    if (resBlock && resBlock.trim()) {
      lines.push("", "Response:");
      for (const l of resBlock.split("\n")) lines.push(`  ${l}`);
    }

    // 包裹成 HTML 注释，内容每行加 2 空格
    const inner = lines.map(l => `  ${l}`).join("\n");
    apiBlocks.push(`<!--\n${inner}\n-->`);
  }

  return apiBlocks.join("\n\n");
}

const apiComments = withApi ? buildApiComments(prdPath, pageUrl) : "";

// ─── scaffold-info 注释 ───────────────────────────────────────────────────

const iconLibs = detectIconLibs(linkTags);
const iconInfo = iconLibs.length
  ? iconLibs.map(l => `  可用图标库: ${l}`).join("\n")
  : "  可用图标库: 无（请勿引入外部图标库）";

const scaffoldInfo = [
  `<!-- scaffold-info`,
  `  ⚠️  <head> 由 scaffold_page.js 自动生成，禁止手动修改 <head> 内任何内容`,
  `  ⚠️  禁止新增 <link> 或 <script src>，禁止引入设计稿中没有的外部资源`,
  iconInfo,
  `-->`,
].join("\n");

// ─── 组装页面骨架 ─────────────────────────────────────────────────────────

const metaBlock  = metaTags.join("\n  ");
const allLinks   = faFallbackTag ? [...linkTags, faFallbackTag] : linkTags;
const linkBlock  = allLinks.length ? allLinks.join("\n  ") : "";
const styleBlock = styleBlocks.length
  ? `<style>\n  ${styleBlocks.join("\n  ")}\n  </style>`
  : "";

const headParts = [
  `  ${metaBlock}`,
  `  <title>${pageTitle}</title>`,
  ``,
  linkBlock ? `  ${linkBlock}\n` : null,
  `  ${tailwindCdn}`,
  `  <script>\n    tailwind.config = ${tailwindConfig}\n  <\/script>`,
  ``,
  `  <script src="https://code.jquery.com/jquery-3.7.1.min.js"><\/script>`,
  styleBlock ? `\n  ${styleBlock}` : null,
].filter(p => p !== null).join("\n");

// scaffold-info + API 注释放在 <body> 开头
const bodyHeader = [
  scaffoldInfo,
  apiComments || null,
].filter(Boolean).join("\n\n");

const output = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
${headParts}
</head>
<body class="${bodyClass}">

${bodyHeader}

  <!-- SCAFFOLD_PLACEHOLDER: 用真实页面 HTML 替换此整块注释（header / main / tabbar / footer） -->

  <script>
    function navPush(route)    { window.location.href = route; }
    function navReplace(route) { window.location.replace(route); }
    function navReset(route)   { window.location.href = route; }
    function navBack()         { if (window.history.length > 1) window.history.back(); }

    $(function () {
      // INTERACTIONS: 在此填充 jQuery 事件绑定与交互逻辑
    });
  </script>

</body>
</html>
`;

// ─── 写入文件 ──────────────────────────────────────────────────────────────

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, output, "utf-8");

const apiCount = withApi ? (apiComments.match(/@prd-api:/g) || []).length : 0;
console.log(`✓ 骨架已生成：${outputPath}`);
console.log(`  提取自：${basename(designPath)}   页面标题：${pageTitle}`);
const iconNote = faFallbackTag ? "FontAwesome（默认补充）" : iconLibs.map(l => l.split("  ")[0]).join(", ");
console.log(`  <link> ${allLinks.length} 个  <style> ${styleBlocks.length} 块  tailwind.config ✓  jQuery ✓  nav函数 ✓  图标库: ${iconNote}  @prd-api 注释 ${apiCount} 个`);
