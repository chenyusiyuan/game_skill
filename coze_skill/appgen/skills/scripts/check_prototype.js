#!/usr/bin/env node
/**
 * check_prototype.js — 原型阶段产出物检查脚本
 *
 * 用法：
 *   # 检查单个文件（子 agent 并发场景，推荐）：
 *   node check_prototype.js prototype/web/home.html web
 *
 *   # 检查整个目录（主 agent 汇总校验）：
 *   node check_prototype.js prototype/web   web
 *   node check_prototype.js prototype/mobile mobile
 *
 * 退出码：
 *   0 = 通过（无错误）
 *   1 = 有错误（必须修复）
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, join, basename } from "path";
import {
  extractInlineScripts,
  checkJSSyntax,
  extractTailwindConfig,
  hasToken,
  checkTagBalance,
} from "./html_utils.js";

// ─── 参数解析 ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("用法: node check_prototype.js <prototype目录或单个.html文件> <platform: web|mobile>");
  process.exit(1);
}

const targetPath = resolve(args[0]);
const platform = args[1]; // "web" | "mobile"

if (!["web", "mobile"].includes(platform)) {
  console.error(`platform 必须是 web 或 mobile，当前值：${platform}`);
  process.exit(1);
}

// 判断是单文件模式还是目录模式
const isSingleFile = targetPath.endsWith(".html");
// 目录路径：单文件模式取其所在目录，目录模式直接用
const protoDir = isSingleFile ? resolve(targetPath, "..") : targetPath;

// ─── 错误收集 ──────────────────────────────────────────────────────────────

const allErrors   = [];
const allWarnings = [];

function error(code, file, message, hint = "") {
  allErrors.push({ code, file, message, hint });
}
function warn(code, file, message, hint = "") {
  allWarnings.push({ code, file, message, hint });
}

// ─── 设计稿 tailwind.config 读取（用于 token 一致性检查）────────────────

let designConfigStr = null;

function loadDesignConfig() {
  const designPath = resolve(`design/${platform}/selected/design.html`);
  if (!existsSync(designPath)) return;
  try {
    const html = readFileSync(designPath, "utf-8");
    designConfigStr = extractTailwindConfig(html);
  } catch (_) { /* 读取失败时跳过一致性检查 */ }
}

// ─── 单文件检查 ────────────────────────────────────────────────────────────

const REQUIRED_TOKENS = [
  "primary", "background", "surface",
  "on-surface", "on-surface-variant", "outline", "outline-variant",
];

function checkHtmlFile(filePath) {
  const label = basename(filePath);

  if (!existsSync(filePath)) {
    error("P001", label, `文件不存在：${filePath}`);
    return;
  }

  const html = readFileSync(filePath, "utf-8");

  // ── P1. 基础 HTML 结构 ────────────────────────────────────────────────

  if (!html.includes("<!DOCTYPE") && !html.includes("<!doctype"))
    error("P010", label, "缺少 <!DOCTYPE html> 声明");
  if (!/<html[^>]*>/.test(html))
    error("P011", label, "缺少 <html> 标签");
  if (!/<head[^>]*>/.test(html))
    error("P012", label, "缺少 <head> 标签");
  if (!/<body[^>]*>/.test(html))
    error("P013", label, "缺少 <body> 标签");

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyText  = bodyMatch
    ? bodyMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
    : "";
  if (bodyText.length < 50)
    error("P014", label, "body 内容过少，页面疑似空壳",
          "应包含 PRD 对应页面的完整 UI 内容和 mock 数据");

  // ── P15. 转义闭合标签检查（<\/tag>）────────────────────────────────────
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
      error("P015", label, `HTML 中存在 ${escCount} 处转义闭合标签（如 ${samples.join("、")}）`,
            "HTML 文件中不能使用反斜杠转义，将 <\\/tag> 全部替换为 </tag>");
  }

  // ── P16. 关键标签开/闭平衡检查 ──────────────────────────────────────────
  checkTagBalance(html, label, (code, message, hint) => error(code, label, message, hint));

  // ── P2. Tailwind CDN + tailwind.config ────────────────────────────────

  if (!html.includes("cdn.tailwindcss.com"))
    error("P020", label, "未引入 Tailwind CDN",
          '在 <head> 添加 <script src="https://cdn.tailwindcss.com"></script>');

  if (!html.includes("tailwind.config")) {
    error("P021", label, "未包含 tailwind.config",
          "必须从 design/*/selected/design.html 原封不动复制 tailwind.config 块");
  } else {
    // CDN 必须在 tailwind.config 之前
    const cdnPos    = html.indexOf("cdn.tailwindcss.com");
    const configPos = html.indexOf("tailwind.config");
    if (cdnPos !== -1 && configPos < cdnPos)
      error("P022", label, "tailwind.config 赋值在 Tailwind CDN 之前",
            "先加载 CDN，再在后续 <script> 中赋值 tailwind.config");

    // token 完整性
    const configStr = extractTailwindConfig(html);
    for (const token of REQUIRED_TOKENS) {
      if (!configStr || !hasToken(configStr, token))
        error("P023", label, `tailwind.config 缺少必需 token "${token}"`,
              "从 design/*/selected/design.html 重新提取 tailwind.config 块");
    }

    // token 与设计稿一致性
    if (designConfigStr && configStr) {
      // 提取 primary 色值对比
      const getColor = (str, key) => {
        const m = str.match(new RegExp(`["']${key}["']\\s*:\\s*["']([^"']+)["']`));
        return m ? m[1].trim() : null;
      };
      const designPrimary  = getColor(designConfigStr, "primary");
      const pagePrimary    = getColor(configStr, "primary");
      if (designPrimary && pagePrimary && designPrimary !== pagePrimary)
        error("P024", label,
              `tailwind.config primary 色 "${pagePrimary}" 与设计稿 "${designPrimary}" 不一致`,
              "原型页面的 tailwind.config 必须与 design/*/selected/design.html 完全一致");
    }
  }

  // ── P3. 样式规范 ────────────────────────────────────────────────────────

  if (html.includes('href="global.css"') || html.includes("href='global.css'"))
    error("P030", label, "引用了已废弃的 global.css",
          "移除 <link href=\"global.css\">，样式通过 tailwind.config token + utility class 实现");

  // 检测内联 style 中的硬编码色值（排除 font-variation-settings 等合法用法）
  const inlineStyleColorRe = /style="[^"]*(?:background(?:-color)?|color)\s*:\s*#[0-9a-fA-F]{3,8}/g;
  if (inlineStyleColorRe.test(html))
    warn("P031", label, "style 属性中存在硬编码色值（#xxxxxx）",
         "颜色应通过 Tailwind token class（bg-primary / text-on-surface 等）使用");

  // @apply 误用
  if (html.includes("@apply"))
    error("P032", label, "使用了 @apply（CDN 模式下不生效）",
          "在 CDN 加载 Tailwind 时 @apply 指令无效，请改用 utility class 直接组合");

  // ── P4. jQuery ─────────────────────────────────────────────────────────

  if (!html.includes("jquery"))
    error("P040", label, "未引入 jQuery",
          '在 <head> 中添加 <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>');

  // 检测 getElementById / querySelector 的使用（应统一用 jQuery）
  const nativeDomRe = /\bdocument\.(?:getElementById|querySelector(?:All)?)\s*\(/g;
  if (nativeDomRe.test(html))
    warn("P041", label, "使用了原生 DOM 选择器（getElementById / querySelector）",
         "统一改为 jQuery 选择器 $()");

  // ── P5. 导航函数（仅 mobile 要求封装；web 端直接用 window.location.href）──

  if (platform === "mobile") {
    const requiredNavFns = ["navPush", "navReplace", "navReset", "navBack"];
    for (const fn of requiredNavFns) {
      if (!html.includes(`function ${fn}`))
        error("P050", label, `缺少导航函数定义 \`function ${fn}(...)\``,
              "Mobile 每个页面的 <script> 中必须定义 navPush / navReplace / navReset / navBack 四个函数");
    }
  }

  // ── P6. SVG 属性引号检查 ────────────────────────────────────────────────

  const svgAttrs = [
    { re: /\bviewBox=(?!["'])(\S+\s+\S)/g,          name: "viewBox" },
    { re: /\bd=(?!["'])[A-Za-z][\d\s.,\-A-Za-z]/g, name: "d (path data)" },
    { re: /\bstroke-width=(?!["'])\S+\s/g,          name: "stroke-width" },
  ];
  for (const { re, name } of svgAttrs) {
    if (re.test(html))
      error("P060", label, `SVG 属性 ${name} 的值未加引号`,
            `含空格或特殊字符的属性值必须加双引号，如 viewBox="0 0 24 24"、d="M21 21l-6-6..."`);
  }

  // ── P7. JS 语法检查（内联 script 块）──────────────────────────────────

  const scripts = extractInlineScripts(html);
  for (const { content, closed } of scripts) {
    if (!closed) {
      error("P070", label, "<script> 标签未闭合（缺少 </script>）");
      continue;
    }
    const jsErr = checkJSSyntax(content);
    if (jsErr)
      error("P072", label, `JS 语法错误：${jsErr}`,
            "检查 tailwind.config 或交互脚本的括号、引号、逗号是否正确");
  }

  // ── P8. 图片规范 ────────────────────────────────────────────────────────

  // 检测缺少 data-category 的 <img>
  const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  for (const tag of imgTags) {
    if (!tag.includes("data-category"))
      warn("P080", label, `图片缺少 data-category 属性：${tag.slice(0, 80)}...`,
           "所有 <img> 必须有 data-category 属性（人物 / 自然风景 / ...）");
    if (!tag.includes("alt=") || /alt=["']\s*["']/.test(tag))
      warn("P081", label, `图片缺少或为空的 alt 属性：${tag.slice(0, 80)}...`,
           "alt 必须是中文详细描述（10-20字）");
    if (/src=["']data:/i.test(tag))
      error("P082", label, "图片使用了 Base64 内嵌（src=\"data:...\"）",
            "图片必须使用 http/https URL，禁止 Base64");
  }

  // ── P9. 平台特定检查 ────────────────────────────────────────────────────

  if (platform === "mobile") {
    // 禁止手机外壳/状态条关键词
    if (/status.?bar|statusbar|iphone.*frame|phone.*shell/i.test(html))
      warn("P090", label, "疑似包含手机状态条或外壳模拟",
           "Mobile 原型应直接生成全屏内容，不模拟手机外壳");

    // 一级页（有 tabbar）禁止出现返回按钮
    const hasTabbar    = /id=["']bottom-nav|id=["']tab-bar|id=["']tabbar/.test(html);
    const hasBackBtn   = /id=["']btn-back/.test(html);
    if (hasTabbar && hasBackBtn)
      warn("P091", label, "页面同时有 TabBar 和返回按钮（id=btn-back）",
           "一级页（TabBar 直达页）不应有返回按钮；二级页不应有 TabBar");

    // 检查 viewport meta
    if (!html.includes("user-scalable=no") && !html.includes("minimum-scale"))
      warn("P092", label, "viewport 未禁用缩放",
           '移动端建议添加 user-scalable=no 或 minimum-scale=1');
  }

  if (platform === "web") {
    // Web 端应有语义化结构
    const hasStructure = ["header", "nav", "main", "aside", "section", "article", "footer"]
      .some(t => new RegExp(`<${t}[\\s>]`).test(html));
    if (!hasStructure)
      warn("P093", label, "缺少语义化结构标签（header/nav/main/section 等）",
           "Web 页面需要有完整的布局骨架");
  }

  // ── P10. 硬编码登录判断检查 ──────────────────────────────────────────────

  if (/username\s*===\s*["'][^"']+["']|password\s*===\s*["'][^"']+["']/.test(html))
    error("P100", label, "登录页包含硬编码账号或密码判断",
          "Demo 项目登录页禁止预设账密，用户可使用任意符合格式的账密登录");

  // ── P11. 占位交互检查 ──────────────────────────────────────────────────

  if (/暂不支持|TODO|FIXME|placeholder.*interaction/i.test(html))
    warn("P110", label, "代码中存在 '暂不支持' / TODO / FIXME 等占位标记",
         "所有交互元素必须有真实实现，不能是占位符；若功能未完成则移除对应元素");

  // ── P12. scaffold 占位符未替换检查 ────────────────────────────────────
  // scaffold_page.js 在 <body> 主内容区注入 SCAFFOLD_PLACEHOLDER 标志。
  // 子 agent 必须用 edit 将该占位注释整块替换为真实页面 HTML。
  // 若标志仍存在，说明 agent 未修改模板主体内容。

  if (html.includes("SCAFFOLD_PLACEHOLDER")) {
    error("P120", label,
      "页面主体内容未填充：scaffold 骨架的占位注释（SCAFFOLD_PLACEHOLDER）仍存在",
      "必须用 edit 将 '<!-- SCAFFOLD_PLACEHOLDER: ... -->' 整块注释替换为真实页面 HTML（header / main / tabbar / footer）");
  }
}

// ─── 目录扫描 ──────────────────────────────────────────────────────────────

function run() {
  // 加载设计稿 tailwind.config 用于 token 一致性对比
  loadDesignConfig();

  if (isSingleFile) {
    // ── 单文件模式 ──────────────────────────────────────────────────────
    if (!existsSync(targetPath)) {
      error("P000", basename(targetPath), `文件不存在：${targetPath}`,
            "确认文件路径正确，或先完成 Step 5 生成文件");
      printReport(1);
      return;
    }
    checkHtmlFile(targetPath);
    printReport(1);
  } else {
    // ── 目录模式 ────────────────────────────────────────────────────────
    if (!existsSync(protoDir)) {
      error("P000", "-", `原型目录不存在：${protoDir}`,
            `先完成 Phase 3，生成 prototype/${platform}/ 目录`);
      printReport(0);
      return;
    }

    const htmlFiles = readdirSync(protoDir)
      .filter(f => f.endsWith(".html"))
      .sort();

    if (htmlFiles.length === 0) {
      error("P000", "-", `prototype/${platform}/ 目录下没有 HTML 文件`,
            "Phase 3 子 agent 应已生成至少一个页面");
      printReport(0);
      return;
    }

    for (const file of htmlFiles) {
      checkHtmlFile(join(protoDir, file));
    }
    printReport(htmlFiles.length);
  }
}

// ─── 输出报告 ──────────────────────────────────────────────────────────────

function printReport(fileCount) {
  const total = allErrors.length + allWarnings.length;
  const scopeLabel = isSingleFile ? `文件: ${basename(targetPath)}` : `目录: ${protoDir}`;
  console.log(`\n${"─".repeat(64)}`);
  console.log(`  Prototype 检查报告  [${platform}]`);
  console.log(`  ${scopeLabel}`);
  console.log(`${"─".repeat(64)}\n`);

  if (total === 0) {
    console.log("  ✓ 通过，无问题\n");
  } else {
    if (allErrors.length > 0) {
      console.log(`  错误 ${allErrors.length} 个（必须修复）\n`);
      for (const e of allErrors) {
        console.log(`  ❌ [${e.code}] ${e.file}: ${e.message}`);
        if (e.hint) console.log(`        -> ${e.hint}`);
        console.log();
      }
    }
    if (allWarnings.length > 0) {
      console.log(`  警告 ${allWarnings.length} 个（建议修复）\n`);
      for (const w of allWarnings) {
        console.log(`  ⚠️  [${w.code}] ${w.file}: ${w.message}`);
        if (w.hint) console.log(`        -> ${w.hint}`);
        console.log();
      }
    }
  }

  console.log(`${"─".repeat(64)}`);
  console.log(`  错误: ${allErrors.length}  警告: ${allWarnings.length}  文件数: ${fileCount}`);
  console.log(`${"─".repeat(64)}\n`);

  process.exit(allErrors.length > 0 ? 1 : 0);
}

run();
