/**
 * html_utils.js — HTML 检查公共工具函数
 *
 * 供 check_design.js / check_prototype.js（以及未来的 check_*.js）import 使用。
 *
 * 导出列表：
 *   extractInlineScripts(html)        → { content, closed, startIdx }[]
 *   checkJSSyntax(code)               → string | null
 *   extractTailwindConfig(html)       → string | null
 *   hasToken(configStr, tokenKey)     → boolean
 *   checkTagBalance(html, label, errorFn) → void
 */

import { Script } from "vm";

// ─── extractInlineScripts ──────────────────────────────────────────────────

/**
 * 提取 HTML 中所有内联 <script> 块（排除带 src= 的外链）。
 * 返回数组，每项 { content, closed, startIdx }。
 */
export function extractInlineScripts(html) {
  const results = [];
  const openRe = /<script(?![^>]*\bsrc\b)[^>]*>/gi;
  let m;
  while ((m = openRe.exec(html)) !== null) {
    const start    = m.index + m[0].length;
    const closeIdx = html.toLowerCase().indexOf("</script>", start);
    if (closeIdx === -1) {
      results.push({ content: html.slice(start), closed: false, startIdx: start });
    } else {
      results.push({ content: html.slice(start, closeIdx), closed: true, startIdx: start });
    }
  }
  return results;
}

// ─── checkJSSyntax ─────────────────────────────────────────────────────────

/**
 * 用 Node.js vm.Script 检查 JS 语法。
 * 返回错误信息字符串，或 null（语法合法）。
 */
export function checkJSSyntax(code) {
  try {
    new Script(code);
    return null;
  } catch (e) {
    return e.message ?? String(e);
  }
}

// ─── extractTailwindConfig ─────────────────────────────────────────────────

/**
 * 从 HTML 中提取 tailwind.config = { ... } 的完整对象字符串。
 *
 * 使用括号计数法而非正则，正确处理嵌套 {}。
 * 返回对象字符串（含最外层 {}），未找到返回 null。
 */
export function extractTailwindConfig(html) {
  const assignIdx = html.search(/tailwind\.config\s*=/);
  if (assignIdx === -1) return null;

  const braceStart = html.indexOf("{", assignIdx);
  if (braceStart === -1) return null;

  let depth      = 0;
  let inString   = false;
  let stringChar = "";
  let escaped    = false;

  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];

    if (escaped)                        { escaped = false; continue; }
    if (ch === "\\" && inString)        { escaped = true;  continue; }
    if (!inString && (ch === '"' || ch === "'")) {
      inString = true; stringChar = ch; continue;
    }
    if (inString && ch === stringChar)  { inString = false; continue; }
    if (inString)                        continue;

    if (ch === "{") { depth++;                                    continue; }
    if (ch === "}") { depth--; if (depth === 0) return html.slice(braceStart, i + 1); }
  }
  return null;
}

// ─── hasToken ──────────────────────────────────────────────────────────────

/**
 * 检测 tailwind.config 字符串中是否包含指定 token key。
 * 匹配 "tokenKey": 或 'tokenKey': 两种写法。
 */
export function hasToken(configStr, tokenKey) {
  return new RegExp(`["']${tokenKey}["']\\s*:`).test(configStr);
}

// ─── checkTagBalance ───────────────────────────────────────────────────────

/**
 * 对 HTML 中的关键标签做开/闭平衡检查，检测两类问题：
 *   1. 标签名不匹配（如 <style> 用 </script> 闭合）
 *   2. 开标签未闭合 / 多余的闭标签
 *
 * 只检查 CRITICAL_TAGS 中列出的标签（导致白屏的高危 tag），
 * 避免对 <div>/<span> 等大量出现的 tag 产生误报。
 *
 * @param {string}   html     完整 HTML 字符串
 * @param {string}   label    用于错误信息的文件/方案标识
 * @param {Function} errorFn  签名 (code, message, hint?) => void，由调用方提供
 */
export function checkTagBalance(html, label, errorFn) {
  // ── 1. 预处理：把 HTML 注释和 <script> 内容替换为等长空格 ──────────────
  // 避免注释里的 tag、script 里的模板字符串被误扫描。
  let clean = html
    // 替换 <!-- ... -->
    .replace(/<!--[\s\S]*?-->/g, m => " ".repeat(m.length))
    // 替换 <script ...>...</script> 内容（外链 + 内联都处理）
    .replace(/(<script[^>]*>)([\s\S]*?)(<\/script>)/gi,
      (_, open, body, close) => open + " ".repeat(body.length) + close)
    // 替换 <style ...>...</style> 内容（避免 CSS 选择器里的 > 干扰）
    .replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
      (_, open, body, close) => open + " ".repeat(body.length) + close)
    // 替换 <title>...</title> 内容（避免标题文字里的 tag 被误扫）
    .replace(/(<title[^>]*>)([\s\S]*?)(<\/title>)/gi,
      (_, open, body, close) => open + " ".repeat(body.length) + close);

  // ── 2. 需要检查的关键标签集合 ──────────────────────────────────────────
  const CRITICAL_TAGS = new Set([
    "html", "head", "body",
    "style", "script",
    "main", "nav", "header", "footer",
    "section", "article", "aside",
  ]);

  // ── 3. 栈扫描 ──────────────────────────────────────────────────────────
  const stack  = [];  // { name, line }
  // 匹配开标签 <tagname ...> 和闭标签 </tagname>
  // 注意：自闭合 <br/> 等通过 CRITICAL_TAGS 过滤掉，无需单独处理
  const tagRe  = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*?>/g;
  let   m;

  while ((m = tagRe.exec(clean)) !== null) {
    const isClose = m[1] === "/";
    const name    = m[2].toLowerCase();

    if (!CRITICAL_TAGS.has(name)) continue;

    const line = lineOf(html, m.index);

    if (!isClose) {
      // ── 开标签：入栈
      stack.push({ name, line });
    } else {
      // ── 闭标签
      if (stack.length === 0) {
        // 没有对应开标签
        errorFn(
          "H001",
          `${label}: 多余的闭标签 </${name}>（第 ${line} 行，无对应开标签）`,
          `检查是否多写了 </${name}>`
        );
        continue;
      }

      const top = stack[stack.length - 1];

      if (top.name !== name) {
        // ★ 标签名不匹配 —— 这里能抓住 <style>...</script> 这类错误
        errorFn(
          "H002",
          `${label}: 标签不匹配 —— <${top.name}>（第 ${top.line} 行）的闭合标签写成了 </${name}>（第 ${line} 行）`,
          `将 </${name}> 改为 </${top.name}>`
        );
        stack.pop(); // 容错：继续扫描后续 tag
      } else {
        stack.pop();
      }
    }
  }

  // ── 4. 栈中剩余 = 未闭合的开标签 ───────────────────────────────────────
  for (const { name, line } of stack) {
    errorFn(
      "H003",
      `${label}: <${name}>（第 ${line} 行）未闭合，缺少对应的 </${name}>`,
      `在对应位置补上 </${name}>`
    );
  }
}

// ─── 内部工具 ──────────────────────────────────────────────────────────────

/** 根据字符索引返回行号（1-indexed） */
function lineOf(html, idx) {
  return html.slice(0, idx).split("\n").length;
}
