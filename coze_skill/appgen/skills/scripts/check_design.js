#!/usr/bin/env node
/**
 * check_design.js — 视觉设计阶段产出物检查脚本
 *
 * 两种调用模式自动判断：
 *
 *   单方案模式（子 agent 调用）：
 *     node check_design.js design/web/3 web
 *     → 传入目录下直接有 design.html，只检查这一个文件
 *
 *   全量模式（主 agent 调用）：
 *     node check_design.js design/web web
 *     → 传入目录下有 1/ 2/ 3/ 子目录，检查全部三套方案
 *
 *   自动检测模式（不传参数）：
 *     node check_design.js
 *     → 自动检测 design/web 和 design/mobile（全量模式）
 *
 * 退出码:
 *   0 = 通过（无错误）
 *   1 = 有错误（必须修复）
 */

import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import {
  extractInlineScripts,
  checkJSSyntax,
  extractTailwindConfig,
  hasToken,
  checkTagBalance,
} from "./html_utils.js";

// ─── 参数解析 ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

const targets = [];

if (args.length === 0) {
  const pairs = [
    ["design/web",    "web"],
    ["design/mobile", "mobile"],
  ];
  for (const [dir, platform] of pairs) {
    if (existsSync(resolve(dir))) targets.push({ dir: resolve(dir), platform });
  }
  if (targets.length === 0) {
    console.error("✗ 未找到 design/web 或 design/mobile 目录");
    console.error("  用法: node check_design.js [design目录] [platform]");
    process.exit(1);
  }
} else {
  const dir      = resolve(args[0] ?? "design/web");
  const platform = args[1] ?? (dir.includes("mobile") ? "mobile" : "web");

  // 自动判断模式：
  //   传入目录下直接存在 design.html → 单方案模式，只检查这一个文件
  //   否则 → 全量模式，期望含 1/ 2/ 3/ 子目录
  if (existsSync(join(dir, "design.html"))) {
    targets.push({ dir, platform, single: true });
  } else {
    targets.push({ dir, platform, single: false });
  }
}

// ─── 错误收集 ──────────────────────────────────────────────────────────────

const allErrors   = [];
const allWarnings = [];

function error(code, message, hint = "") {
  allErrors.push({ code, message, hint });
}
function warn(code, message, hint = "") {
  allWarnings.push({ code, message, hint });
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

/** 提取所有 class 属性值（扁平化为字符串集合） */
function extractClasses(html) {
  const classes = new Set();
  for (const m of html.matchAll(/class=["']([^"']+)["']/g)) {
    for (const cls of m[1].split(/\s+/)) {
      if (cls) classes.add(cls);
    }
  }
  return classes;
}

/** 从 tailwind.config 中提取 primary token 的值 */
function extractPrimaryColor(configStr) {
  const m = configStr.match(/["']primary["']\s*:\s*["']([^"']+)["']/);
  return m ? m[1].trim() : null;
}

/** 检测 emoji 图标用法 */
const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
const ICON_CONTAINER_RE = /<(button|a|span|i|em|label|li|td|th|div|header|nav|footer)[^>]*>([\s\S]{0,200}?)<\/\1>/gi;

function detectEmojiIcons(html) {
  const found = [];
  let m;
  const re = new RegExp(ICON_CONTAINER_RE.source, "gi");
  while ((m = re.exec(html)) !== null) {
    const inner = m[2].replace(/<[^>]+>/g, "").trim();
    if (inner.length <= 6 && EMOJI_REGEX.test(inner)) {
      found.push({ tag: m[1], content: inner.slice(0, 20) });
    }
  }
  return found;
}

// ─── 必需 token ────────────────────────────────────────────────────────────

const REQUIRED_TOKENS = [
  "primary",
  "background",
  "surface",
  "on-surface",
  "on-surface-variant",
  "outline",
  "outline-variant",
];

// ─── 单个 design.html 检查（被两种模式共用）──────────────────────────────

function checkOneHtml(schemeDir, label) {
  const htmlPath = join(schemeDir, "design.html");

  if (!existsSync(schemeDir)) {
    error("D010", `${label}: 目录不存在 ${schemeDir}`, `生成该方案的 design.html 文件`);
    return;
  }
  if (!existsSync(htmlPath)) {
    error("D011", `${label}: 缺少 design.html`, "");
    return;
  }
  if (existsSync(join(schemeDir, "global.css"))) {
    error("D012", `${label}: 发现 global.css（已废弃）`,
          "样式应全部通过 tailwind.config token + utility class 实现");
  }

  const html = readFileSync(htmlPath, "utf-8");

  if (html.trim().length < 200) {
    error("D013", `${label}: design.html 内容过少（${html.trim().length} 字节）`,
          "HTML 应是完整的业务页面，不能是空壳");
  }

  if (!html.includes("<!DOCTYPE") && !html.includes("<!doctype"))
    error("D020", `${label}: design.html 缺少 <!DOCTYPE html> 声明`, "");
  if (!/<html[^>]*>/.test(html))
    error("D021", `${label}: design.html 缺少 <html> 标签`, "");
  if (!/<head[^>]*>/.test(html))
    error("D022", `${label}: design.html 缺少 <head> 标签`, "");
  if (!/<body[^>]*>/.test(html))
    error("D023", `${label}: design.html 缺少 <body> 标签`, "");

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyInner = bodyMatch
    ? bodyMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
  if (bodyInner.length < 20)
    error("D024", `${label}: design.html body 内容近乎为空`,
          "页面应展示真实的业务内容（菜单、卡片、表单等）");

  const hasStructure = ["header","nav","main","section","article","aside","footer"]
    .some(t => new RegExp(`<${t}[\\s>]`).test(html));
  if (!hasStructure)
    error("D025", `${label}: design.html 缺少语义化结构标签（header/nav/main/section 等）`,
          "页面需要有完整的布局骨架");

  // ── D26. 转义闭合标签检查（<\/tag>）────────────────────────────────────
  // LLM 有时在 HTML 中输出 <\/div> <\/span> 等反斜杠转义形式，
  // 这在 HTML 文件中是非法的（\ 不是 HTML 转义字符），
  // 浏览器会把 <\/div> 当成文本节点，导致 DOM 结构损坏。
  {
    let escCount = 0;
    const samples = [];
    let idx = 0;
    while ((idx = html.indexOf("<\\/", idx)) !== -1) {
      escCount++;
      if (samples.length < 3) samples.push(html.slice(idx, idx + 12).replace(/\n/g, ""));
      idx++;
    }
    if (escCount > 0)
      error("D026", `${label}: HTML 中存在 ${escCount} 处转义闭合标签（如 ${samples.join("、")}）`,
            "HTML 文件中不能使用反斜杠转义，将 <\\/tag> 全部替换为 </tag>");
  }

  // ── D27. 关键标签开/闭平衡检查 ────────────────────────────────────────
  checkTagBalance(html, label, (code, message, hint) => error(code, message, hint));

  if (!html.includes("cdn.tailwindcss.com"))
    error("D030", `${label}: design.html 未引入 Tailwind CDN`,
          '在 <head> 中添加: <script src="https://cdn.tailwindcss.com"></script>');

  if (!html.includes("tailwind.config")) {
    error("D040", `${label}: design.html 未包含 tailwind.config`,
          "必须内嵌 tailwind.config = { theme: { extend: { colors: {...} } } }");
    return; // 后续 token 检查无意义
  }

  const configPos = html.indexOf("tailwind.config");
  const cdnPos    = html.indexOf("cdn.tailwindcss.com");
  if (cdnPos !== -1 && configPos !== -1 && configPos < cdnPos)
    error("D041", `${label}: tailwind.config 赋值放在了 Tailwind CDN <script> 之前`,
          "必须先加载 CDN，再在后续 <script> 中赋值 tailwind.config");

  const configStr = extractTailwindConfig(html);
  for (const token of REQUIRED_TOKENS) {
    if (!configStr || !hasToken(configStr, token))
      error("D042", `${label}: tailwind.config 缺少必需 token "${token}"`,
            `在 colors 中添加 "${token}": "#XXXXXX"`);
  }
  if (configStr && configStr.includes("rgb(var(--"))
    warn("D043", `${label}: tailwind.config 使用了 CSS 变量桥接写法（rgb(var(--...))）`,
         "直接写 hex 色值即可，透明度用 Tailwind opacity modifier（bg-primary/20）");
  if (html.includes('href="global.css"') || html.includes("href='global.css'"))
    error("D044", `${label}: design.html 引用了 global.css（已废弃）`,
          "移除 <link href=\"global.css\">，样式全部通过 tailwind.config + utility class 实现");

  // ── D6b. HTML 语法检查 ──────────────────────────────────────────────────

  const inlineScripts = extractInlineScripts(html);
  for (const { content, closed } of inlineScripts) {
    // 6b-1: script 标签未闭合（</script> 缺失）
    if (!closed) {
      error("D045", `${label}: <script> 标签未闭合（缺少 </script>）`,
            "检查 tailwind.config 所在的 <script> 块，确保末尾有 </script>");
      continue;
    }
    // 6b-2: script 内容包含 HTML 闭合标签（说明 </script> 提前丢失，HTML 内容被吞入）
    // 只针对含 tailwind.config 的 script 块：普通 JS 里模板字符串含 HTML tag 是合法的
    if (content.includes("tailwind.config") &&
        /<\/(?:head|body|html|div|main|section|nav|header|footer)\b/i.test(content)) {
      error("D046", `${label}: <script> 内容中包含 HTML 标签，疑似 </script> 丢失导致后续 HTML 被吞入`,
            "检查 tailwind.config 的 <script> 块是否正确闭合，确保 } 之后紧跟 </script>");
      continue;
    }
    // 6b-3: 包含 tailwind.config 的 script 块做 JS 语法检查
    if (content.includes("tailwind.config")) {
      const jsErr = checkJSSyntax(content);
      if (jsErr) {
        error("D047", `${label}: tailwind.config JS 语法错误：${jsErr}`,
              "检查 tailwind.config 对象的括号、引号、逗号是否匹配，常见问题：缺少 } 或 )");
      }
    }
  }

  // ── D6c. SVG 属性未加引号检查 ───────────────────────────────────────────
  // viewBox、d、stroke-width 等值含空格或特殊字符，不加引号会被浏览器截断
  // 匹配 <svg 或 <path 等标签中出现的无引号多词属性
  const svgUnquotedAttrs = [
    { re: /\bviewBox=(?!["'])(\S+\s+\S)/g,      name: "viewBox" },
    { re: /\bd=(?!["'])[A-Za-z][\d\s.,\-A-Za-z]/g, name: "d (path data)" },
    { re: /\bstroke-width=(?!["'])\S+\s/g,       name: "stroke-width" },
  ];
  for (const { re, name } of svgUnquotedAttrs) {
    if (re.test(html)) {
      error("D048", `${label}: SVG 属性 ${name} 的值未加引号`,
            `含空格或特殊字符的 SVG 属性值必须用双引号包裹，例如 viewBox="0 0 24 24"、d="M21 21l-6-6..."`);
    }
  }

  const emojiIcons = detectEmojiIcons(html);
  if (emojiIcons.length > 0)
    error("D050", `${label}: design.html 使用了 emoji 作为图标（${emojiIcons.map(e => `<${e.tag}>${e.content}`).join(", ")}）`,
          "系统图标必须使用 SVG 或图标库");

  const classes = extractClasses(html);
  const deprecatedClasses = [...classes].filter(cls =>
    /^(btn-primary|btn-secondary|btn-error|btn-success|btn-text|btn-icon|page-container|sidebar-item|nav-item|input-field|card-float|modal-overlay|modal-content|table-container|table-header|table-row|badge-primary|badge-success|badge-error|badge-warning)$/.test(cls)
  );
  if (deprecatedClasses.length > 0)
    warn("D051", `${label}: design.html 使用了已废弃的 global.css 组件类（${deprecatedClasses.slice(0,5).join(", ")}）`,
         "请改用 Tailwind utility class 直接组合样式");
}

// ─── 主检查函数 ────────────────────────────────────────────────────────────

function checkDesignDir(designDir, platform, single = false) {
  const ctx = `[${platform}]`;

  if (!existsSync(designDir)) {
    error("D001", `${ctx} 设计目录不存在: ${designDir}`,
          `先完成 Phase 2 视觉设计阶段，生成 design/${platform}/{1,2,3}/ 目录`);
    return;
  }

  // ── 单方案模式：只检查 designDir/design.html ──────────────────────────

  if (single) {
    checkOneHtml(designDir, ctx);
    return;
  }

  // ── 全量模式：检查 1/ 2/ 3/ 三套方案 ────────────────────────────────

  for (const n of [1, 2, 3]) {
    checkOneHtml(join(designDir, String(n)), `${ctx} 方案${n}`);
  }

  // ── D8/D9: 仅全量模式执行（单方案检查跳过）───────────────────
  if (single) return;

  // ── D8. 3 套方案差异性检查 ───────────────────────────────────────────

  const primaryColors = [];
  for (const n of [1, 2, 3]) {
    const htmlPath = join(designDir, String(n), "design.html");
    if (!existsSync(htmlPath)) continue;
    const configStr = extractTailwindConfig(readFileSync(htmlPath, "utf-8"));
    if (configStr) {
      const color = extractPrimaryColor(configStr);
      if (color) primaryColors.push({ n, value: color });
    }
  }
  if (primaryColors.length === 3) {
    const uniqueColors = new Set(primaryColors.map(c => c.value));
    if (uniqueColors.size === 1)
      error("D060", `${ctx} 3 套方案的主色 "primary" 完全相同（${[...uniqueColors][0]}）`,
            "3 套方案应在主色调、设计调性等维度有明显差异，否则选择无意义");
    else if (uniqueColors.size === 2)
      warn("D061", `${ctx} 3 套方案中只有 2 种不同主色`,
           "建议 3 套方案使用 3 种差异化主色");
  }

  // ── D9. selected/ 目录检查（如已选定）──────────────────────────────

  const selectedDir  = join(designDir, "selected");
  if (existsSync(selectedDir)) {
    if (!existsSync(join(selectedDir, "design.html")))
      error("D070", `${ctx} selected/ 目录存在但缺少 design.html`,
            `执行: cp -r design/${platform}/{N}/ design/${platform}/selected/`);
    if (existsSync(join(selectedDir, "global.css")))
      error("D071", `${ctx} selected/ 目录中存在 global.css（已废弃）`,
            "删除该文件，原型阶段从 selected/design.html 的 tailwind.config 中提取 token");
  }
}

// ─── 执行检查 ──────────────────────────────────────────────────────────────

for (const { dir, platform, single } of targets) {
  checkDesignDir(dir, platform, single ?? false);
}

// ─── 输出报告 ──────────────────────────────────────────────────────────────

const totalErrors   = allErrors.length;
const totalWarnings = allWarnings.length;

console.log(`\n${"─".repeat(60)}`);
console.log(`  Design 检查报告`);
for (const { dir } of targets) {
  console.log(`  目录: ${dir}`);
}
console.log(`${"─".repeat(60)}\n`);

if (totalErrors === 0 && totalWarnings === 0) {
  console.log("  ✓ 通过，无问题\n");
} else {
  if (totalErrors > 0) {
    console.log(`  错误 ${totalErrors} 个（必须修复）\n`);
    for (const e of allErrors) {
      console.log(`  ❌ [${e.code}] ${e.message}`);
      if (e.hint) console.log(`        -> ${e.hint}`);
      console.log();
    }
  }
  if (totalWarnings > 0) {
    console.log(`  警告 ${totalWarnings} 个（建议修复）\n`);
    for (const w of allWarnings) {
      console.log(`  ⚠️  [${w.code}] ${w.message}`);
      if (w.hint) console.log(`        -> ${w.hint}`);
      console.log();
    }
  }
}

console.log(`${"─".repeat(60)}`);
console.log(`  错误: ${totalErrors}  警告: ${totalWarnings}`);
console.log(`${"─".repeat(60)}\n`);

process.exit(totalErrors > 0 ? 1 : 0);
