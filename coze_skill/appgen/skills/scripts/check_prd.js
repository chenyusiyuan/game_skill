#!/usr/bin/env node
/**
 * check_prd.js — APRD 格式完整性检查脚本
 *
 * 用法:
 *   node check_prd.js [prd文件路径]
 *   node check_prd.js              # 默认检查 docs/prd.md
 *
 * 退出码:
 *   0 = 通过
 *   1 = 有错误
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ─── 入口 ──────────────────────────────────────────────────────────────────

const prdPath = resolve(process.argv[2] ?? "docs/prd.md");

let content;
try {
  content = readFileSync(prdPath, "utf-8");
} catch {
  console.error(`✗ 文件不存在: ${prdPath}`);
  process.exit(1);
}

const errors   = [];  // { level: 'error'|'warn', code, message, hint }
const warnings = [];

function error(code, message, hint = "") {
  errors.push({ code, message, hint });
}
function warn(code, message, hint = "") {
  warnings.push({ code, message, hint });
}

// ─── 1. 解析 Front-matter ──────────────────────────────────────────────────

const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
if (!fmMatch) {
  error("FM001", "缺少 front-matter（文件开头应有 --- ... --- 块）",
        "在文件第一行加入 --- 开始 front-matter");
  report();
  process.exit(1);
}
const fmText = fmMatch[1];

/** 从 front-matter 提取一级 key 的值（字符串） */
function fmGet(key) {
  const m = fmText.match(new RegExp(`^${key}:\\s*(.+)`, "m"));
  return m ? m[1].trim() : null;
}
/** 检查 front-matter 是否含某字符串 */
function fmHas(str) { return fmText.includes(str); }

// ── 1.1 必填字段 ──────────────────────────────────────────────────────────
const aprdVer  = fmGet("aprd");
const platform = fmGet("platform");
const authMode = fmGet("auth-mode");
const needBE   = fmGet("need-backend");

if (!aprdVer) {
  error("FM002", "front-matter 缺少 aprd 版本号",
        '添加: aprd: "1.0"');
}
if (!platform) {
  error("FM003", "front-matter 缺少 platform 字段",
        "添加: platform: [web]  或  platform: [mobile]  或  platform: [web, mobile]");
}
if (!authMode) {
  error("FM004", "front-matter 缺少 auth-mode 字段",
        "添加: auth-mode: login  /  auth-mode: anonymous  /  auth-mode: none");
}
if (!needBE) {
  warn("FM005", "front-matter 缺少 need-backend 字段",
       "添加: need-backend: true  或  need-backend: false");
}

// ── 1.2 platform 相关字段一致性 ───────────────────────────────────────────
const isWeb    = platform?.includes("web");
const isMobile = platform?.includes("mobile");

if (isWeb) {
  if (!fmHas("web: nextjs-app-router")) {
    error("FM010", "platform 含 web 但 stack 中缺少 web: nextjs-app-router",
          "在 stack: 下添加  web: nextjs-app-router");
  }
  if (!fmHas("web: web/")) {
    warn("FM011", "platform 含 web 但 artifacts 中缺少 web: web/",
         "在 artifacts: 下添加  web: web/");
  }
  if (!fmHas("prototype:\n    web:") && !fmHas("prototype:\n      web:") && !fmHas("web: prototype")) {
    warn("FM012", "platform 含 web 但 artifacts.prototype 中缺少 web 原型目录",
         "在 artifacts.prototype: 下添加  web: prototype/web/");
  }
}

if (isMobile) {
  if (!fmHas("mobile: expo")) {
    error("FM013", "platform 含 mobile 但 stack 中缺少 mobile: expo",
          "在 stack: 下添加  mobile: expo");
  }
  if (!fmHas("mobile: mobile/")) {
    warn("FM014", "platform 含 mobile 但 artifacts 中缺少 mobile: mobile/",
         "在 artifacts: 下添加  mobile: mobile/");
  }
}

if (!isMobile && fmHas("mobile: expo")) {
  warn("FM015", "platform 不含 mobile，但 stack 中有 mobile: expo（多余字段）",
       "若无 mobile 端，删除 stack.mobile 字段");
}
if (!isWeb && /^\s+web:\s+nextjs/m.test(fmText)) {
  warn("FM016", "platform 不含 web，但 stack 中有 web: nextjs-app-router（多余字段）",
       "若无 web 端，删除 stack.web 字段");
}
// design 按端分层：design.web 或 design.mobile
const hasDesignWeb    = fmHas("web: design/web/");
const hasDesignMobile = fmHas("mobile: design/mobile/");
if (isWeb && !hasDesignWeb) {
  warn("FM017", "platform 含 web 但 artifacts.design 中缺少 web: design/web/",
       "在 artifacts.design: 下添加  web: design/web/");
}
if (isMobile && !hasDesignMobile) {
  warn("FM018", "platform 含 mobile 但 artifacts.design 中缺少 mobile: design/mobile/",
       "在 artifacts.design: 下添加  mobile: design/mobile/");
}

// ─── 2. 解析所有 Tag ───────────────────────────────────────────────────────

/**
 * 将文档按 heading 切分，返回 section 数组:
 * { heading, level, tagType, tagId, body, lineNo }
 */
function parseSections(text) {
  const lines   = text.split("\n");
  const sections = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line  = lines[i];
    const hm    = line.match(/^(#{1,6})\s+(.*)/);
    if (hm) {
      if (cur) { cur.body = cur.bodyLines.join("\n"); sections.push(cur); }
      const level   = hm[1].length;
      const heading = hm[2].trim();
      const tagMatch = heading.match(/@([\w-]+)\(([^)]+)\)/);
      cur = {
        heading,
        level,
        tagType : tagMatch ? tagMatch[1] : null,
        tagId   : tagMatch ? tagMatch[2].trim() : null,
        bodyLines: [],
        body    : "",
        lineNo  : i + 1,   // 1-indexed
      };
    } else if (cur) {
      cur.bodyLines.push(line);
    }
  }
  if (cur) { cur.body = cur.bodyLines.join("\n"); sections.push(cur); }
  return sections;
}

/**
 * 检查 params 字段的格式是否符合规范
 * 合法格式：
 *   —                              无参数
 *   name:type                      单参数
 *   name:type, name2:type2         多参数
 *   name?:type                     可选参数
 * 类型规范：uuid / string / number / boolean / enum(a|b) / date(2024-01-01) / datetime(2024-01-01T00:00:00)
 */
function checkParamsFormat(params, loc, code) {
  if (!params || isNoneValue(params)) return;   // 合法：明确无参数（支持 - / — / – / none）

  const entries = params.split(",").map(s => s.trim()).filter(Boolean);
  for (const entry of entries) {
    // 格式: name?:type 或 name:type
    const m = entry.match(/^([\w-]+\??):(.+)$/);
    if (!m) {
      warn(code, `${loc}：params 中 "${entry}" 格式不正确`,
           `正确格式: 参数名:类型，如 article_id:uuid 或 status:enum(active|inactive)`);
      continue;
    }
    const typePart = m[2].trim();
    const validSimple = ["uuid","string","number","boolean"];
    const isEnum     = /^enum\(.+\)$/.test(typePart);
    const isDate     = /^date\(.+\)$/.test(typePart);
    const isDatetime = /^datetime\(.+\)$/.test(typePart);
    if (!validSimple.includes(typePart) && !isEnum && !isDate && !isDatetime) {
      warn(code, `${loc}：params 中 "${entry}" 类型 "${typePart}" 不符合规范`,
           `合法类型: uuid / string / number / boolean / enum(a|b|c) / date(2024-01-01) / datetime(2024-01-01T00:00:00)`);
    }
    // 枚举必须有 | 分隔的值
    if (isEnum && !typePart.includes("|")) {
      warn(code, `${loc}：params 中 "${entry}" 枚举类型应包含多个值，用 | 分隔`,
           `如: status:enum(active|inactive|pending)`);
    }
  }
}

/**
 * 从 section.body 中提取属性行（`> key: value`）
 * 返回 { key: value } 对象
 *
 * 兼容说明：
 * - 属性块以第一个非 `>` 的非空行结束（空行跳过，不中断）
 * - 值中可能出现全角破折号 — (U+2014)、en-dash – (U+2013)、半角 -，
 *   解析时统一 trim，不做字符替换，由 normalizeNone() 做语义归一
 */
function parseAttrs(body) {
  const attrs = {};
  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;          // 跳过空行，不中断属性块
    const m = line.match(/^>\s+([\w-]+):\s*(.*)/);
    if (!m) break;                             // 遇到非属性行才结束
    attrs[m[1]] = m[2].trim();
  }
  return attrs;
}

/**
 * 将"无参数"标记归一化为布尔值 true。
 * 兼容写法：
 *   —   全角破折号 U+2014  （旧规范，常见于 LLM 输出）
 *   –   en-dash    U+2013
 *   -   半角连字符（新规范推荐）
 *   none / null / empty / N/A（大小写不限）
 */
function isNoneValue(val) {
  if (!val) return false;
  const v = val.trim();
  return (
    v === "\u2014" ||   // — em-dash
    v === "\u2013" ||   // – en-dash
    v === "-"      ||
    /^(none|null|empty|n\/a)$/i.test(v)
  );
}

const sections = parseSections(content);

/** 按 tagType 分组 */
function tagSections(type) {
  return sections.filter(s => s.tagType === type);
}

// 收集所有已定义页面的 URL（用于跨引用校验）
const webPageUrls = new Set(
  tagSections("web-page").map(s => s.tagId)
);
const mobilePageUrls = new Set(
  tagSections("mobile-page").map(s => s.tagId)
);
const apiIds = new Set(
  tagSections("api").map(s => s.tagId)
);
const navIds = new Set(
  tagSections("nav").map(s => s.tagId)
);
const moduleIds = new Set(
  tagSections("server-module").map(s => s.tagId)
);
const dataModelIds = new Set(
  tagSections("data-model").map(s => s.tagId)
);

// ─── 3. platform vs tag 类型一致性 ────────────────────────────────────────

if (platform) {
  if (!isWeb && webPageUrls.size > 0) {
    error("TAG001",
      `platform 不含 web，但存在 ${webPageUrls.size} 个 @web-page tag`,
      `将所有 @web-page 改为 @mobile-page，platform 改为 [mobile]`
    );
  }
  if (!isMobile && mobilePageUrls.size > 0) {
    error("TAG002",
      `platform 不含 mobile，但存在 ${mobilePageUrls.size} 个 @mobile-page tag`,
      `将所有 @mobile-page 改为 @web-page，或将 platform 改为 [mobile]`
    );
  }
  if (isWeb && webPageUrls.size === 0 && isMobile && mobilePageUrls.size === 0) {
    error("TAG003", "没有任何 @web-page 或 @mobile-page tag，§8.2 页面详情为空",
          "在 ## 8. 页面规格 > ### 8.2 页面详情 下添加至少一个页面");
  }
  if (isWeb && webPageUrls.size === 0 && !isMobile) {
    error("TAG003", "platform: [web] 但没有任何 @web-page tag",
          "在 ## 8. 页面规格 > ### 8.2 页面详情 下添加至少一个 @web-page");
  }
  if (isMobile && mobilePageUrls.size === 0 && !isWeb) {
    error("TAG003", "platform: [mobile] 但没有任何 @mobile-page tag",
          "在 ## 8. 页面规格 > ### 8.2 页面详情 下添加至少一个 @mobile-page");
  }
}

// ─── 4. 导航检查 ──────────────────────────────────────────────────────────

const navSections = tagSections("nav");

// 4.1 platform vs nav 类型
const navTypes = navSections.map(s => parseAttrs(s.body).type ?? "");
if (isWeb) {
  if (!navTypes.includes("topbar")) {
    error("NAV001", "platform 含 web，但缺少 type: topbar 的 @nav",
          "添加 @nav(web-topbar) 并设置 > type: topbar  > platform: web");
  }
  if (authMode === "login" && !navTypes.includes("avatar-menu")) {
    warn("NAV002", "auth-mode: login 但缺少 type: avatar-menu 的 @nav（用于退出登录/个人设置）",
         "添加 @nav(web-avatar-menu)");
  }
}
if (isMobile) {
  if (!navTypes.includes("tabbar")) {
    error("NAV003", "platform 含 mobile，但缺少 type: tabbar 的 @nav",
          "添加 @nav(mobile-tabbar) 并设置 > type: tabbar  > platform: mobile");
  }
}
if (!isMobile) {
  const mobileNavs = navSections.filter(s => (parseAttrs(s.body).type ?? "") === "tabbar");
  if (mobileNavs.length > 0) {
    warn("NAV004", `platform 不含 mobile，但存在 tabbar 类型的 @nav（${mobileNavs.map(s=>s.tagId).join(", ")}）`,
         "删除 tabbar nav 或将 platform 改为 [mobile]");
  }
}
if (!isWeb) {
  const webNavs = navSections.filter(s => {
    const t = parseAttrs(s.body).type ?? "";
    return ["topbar","sidebar","avatar-menu"].includes(t);
  });
  if (webNavs.length > 0) {
    warn("NAV005", `platform 不含 web，但存在 web nav（${webNavs.map(s=>s.tagId).join(", ")}）`,
         "删除这些 nav 或将 platform 改为 [web]");
  }
}

// 4.2 导航项指向的页面必须已定义，且不含详情页参数
const pageUrlSetForNav = isWeb ? webPageUrls : mobilePageUrls;
for (const nav of navSections) {
  const navLines = nav.body.split("\n").filter(l => l.startsWith("- @"));
  for (const line of navLines) {
    const m = line.match(/@(?:web|app)-page\(([^)]+)\)/);
    if (!m) continue;
    const ref = m[1].trim();
    // 详情页（含 ?xxx_id）不能出现在导航
    if (ref.includes("?")) {
      error("NAV010",
        `@nav(${nav.tagId}) 第 ${nav.lineNo} 行附近：导航项指向详情页 URL "${ref}"`,
        "导航只能指向无必需参数的页面（列表页/概览页），详情页只能从列表页交互进入"
      );
    } else {
      // URL 可能含 base path（如 /login），在已定义页面里查
      const allPages = new Set([...webPageUrls, ...mobilePageUrls]);
      if (!allPages.has(ref)) {
        error("NAV011",
          `@nav(${nav.tagId}) 第 ${nav.lineNo} 行附近：导航项引用了未定义的页面 "${ref}"`,
          `在 §8.2 页面详情中添加对应的 @web-page(${ref}) 或 @mobile-page(${ref}) section`
        );
      }
    }
  }
}

// ─── 5. @web-page 检查 ────────────────────────────────────────────────────

const WEB_PAGE_REQUIRED = ["url", "entry", "params", "impl", "prototype", "layout"];
const AUTH_LAYOUTS = ["auth"];

for (const sec of tagSections("web-page")) {
  const url   = sec.tagId;
  const attrs = parseAttrs(sec.body);
  const loc   = `@web-page(${url}) 第 ${sec.lineNo} 行`;

  // 5.1 必填属性
  for (const attr of WEB_PAGE_REQUIRED) {
    if (!attrs[attr]) {
      const hint = attr === "entry"
        ? `添加: > entry: true  （一级页，可从导航直接访问）或  > entry: false  （需上级页传参）`
        : attr === "params"
        ? `添加: > params: —  （无参数）或  > params: id:uuid  （有参数，枚举/日期需给示例）`
        : `在标题下方添加: > ${attr}: <值>`;
      error("PAGE001", `${loc}：缺少必填属性 "${attr}"`, hint);
    }
  }

  // 5.1b 登录保护检查（auth-mode: login 时）
  // need-login 已废弃，改用 auth-mode（全局）+ public（页面级例外）
  // 登录页和注册页必须声明 public: true
  if (authMode === "login") {
    const isAuthPage = ["/login", "/register"].includes(url);
    if (isAuthPage && attrs["public"] !== "true") {
      warn("PAGE006", `${loc}：auth-mode: login 时登录/注册页应声明 > public: true`,
           `添加: > public: true`);
    }
  }

  // 5.2 entry/params 一致性
  // PAGE003 已移除：entry:false + params:— 是合法设计（无参数的二级页，如后台管理子页）
  if (attrs.entry === "true" && attrs.params && !isNoneValue(attrs.params)) {
    // 只有存在必填参数（无 ? 后缀）时才告警；全部可选参数对一级页完全合法
    const hasRequired = attrs.params.split(",").map(s => s.trim()).some(p => {
      const m = p.match(/^([\w-]+\??):(.+)$/);
      return m && !m[1].endsWith("?");   // name 不以 ? 结尾 → 必填
    });
    if (hasRequired) {
      warn("PAGE004", `${loc}：entry:true 但 params 中含必填参数（"${attrs.params}"）`,
           `一级页不应有必填参数，导航无法传入；将参数改为可选（加 ?）或将页面改为 entry:false`);
    }
  }

  // 5.3 params 类型格式检查
  checkParamsFormat(attrs.params, loc, "PAGE005");

  // 5.2b nav-active（auth 布局页除外）
  if (attrs.layout && !AUTH_LAYOUTS.includes(attrs.layout) && !attrs["nav-active"]) {
    warn("PAGE002", `${loc}：建议添加 nav-active 属性以标明当前激活的导航项`,
         `entry:false 的页面写 > nav-active: —`);
  }

  // 5.3 URL 单级路径
  const urlPath = (attrs.url ?? url).split("?")[0];
  if (urlPath.split("/").filter(Boolean).length > 1) {
    error("PAGE010", `${loc}：URL 不是单级路径 "${attrs.url ?? url}"`,
          `改为单级路径，如 /admin-articles 而非 /admin/articles`);
  }

  // 5.4 详情页必须用查询参数而非路径参数
  if ((attrs.url ?? url).includes("/:")) {
    error("PAGE011", `${loc}：URL 使用了路径参数 "${attrs.url}"，Web 页面应使用查询参数`,
          `改为 /note-detail?note_id=uuid 形式`);
  }

  // 5.5 交互说明表格
  if (!sec.body.includes("| 元素") && !sec.body.includes("|元素")) {
    error("PAGE020", `${loc}：缺少交互说明表格（| 元素 | 动作 | 响应 | 传参 |）`,
          "在页面正文末尾添加交互说明表格，覆盖所有可交互元素");
  }

  // 5.6 交互表格中的 @web-page 引用必须指向已定义页面
  const inlineRefs = [...sec.body.matchAll(/@web-page\(([^)?]+)/g)];
  for (const m of inlineRefs) {
    const ref = m[1].trim();
    if (!webPageUrls.has(ref)) {
      error("PAGE021",
        `${loc}：交互引用了未定义的页面 @web-page(${ref})`,
        `在 §8.2 中补充 @web-page(${ref}) 的完整 section，或修正引用`
      );
    }
  }

  // 5.7 交互引用 @api 必须在已定义的 api 中
  const apiRefs = [...sec.body.matchAll(/@api\(([^)]+)\)/g)];
  for (const m of apiRefs) {
    const ref = m[1].trim();
    if (!apiIds.has(ref)) {
      warn("PAGE022",
        `${loc}：引用了未定义的 @api(${ref})`,
        `在 §7 API 接口中添加 @api(${ref}) section，或修正引用`
      );
    }
  }

  // 5.8 apis 属性格式检查（应为 @api(id) 引用格式）
  if (attrs.apis) {
    const apisApiRefs = [...attrs.apis.matchAll(/@api\(([^)]+)\)/g)].map(m => m[1].trim());
    // isNoneValue 兼容 - / — / – / none 等无 API 写法；[] 空数组也合法，均跳过
    const apisStripped = attrs.apis.replace(/[\[\]\s]/g, "");
    if (apisApiRefs.length === 0 && apisStripped.length > 0 && !isNoneValue(attrs.apis)) {
      warn("PAGE023", `${loc}：apis 属性使用了旧格式 "${attrs.apis}"`,
           `改为 @api(id) 引用格式，如: > apis: [@api(list-notes), @api(create-note)]`);
    }
    for (const ref of apisApiRefs) {
      if (!apiIds.has(ref)) {
        warn("PAGE024", `${loc}：apis 引用了未定义的 @api(${ref})`,
             `在 §7 中添加 @api(${ref}) section，或从 apis 中删除`);
      }
    }
  }
}

// ─── 6. @mobile-page 检查 ────────────────────────────────────────────────────

const APP_PAGE_REQUIRED = ["url", "entry", "params", "impl", "prototype", "nav-bar", "tab"];

for (const sec of tagSections("mobile-page")) {
  const url   = sec.tagId;
  const attrs = parseAttrs(sec.body);
  const loc   = `@mobile-page(${url}) 第 ${sec.lineNo} 行`;

  // 6.1 必填属性
  for (const attr of APP_PAGE_REQUIRED) {
    if (!attrs[attr]) {
      const hint = attr === "entry"
        ? `添加: > entry: true  （tabbar 一级页）或  > entry: false  （需上级传参的页面）`
        : attr === "params"
        ? `添加: > params: —  （无参数）或  > params: id:uuid  （有参数，枚举/日期需给示例）`
        : attr === "tab"
        ? `tabbar 页写 > tab: /（对应的 tabbar url）；非 tabbar 页写 > tab: —`
        : `在标题下方添加: > ${attr}: <值>`;
      error("PAGE101", `${loc}：缺少必填属性 "${attr}"`, hint);
    }
  }

  // 6.1b 登录保护检查（auth-mode: login 时）
  if (authMode === "login") {
    const isAuthPage = ["/login", "/register"].includes(url);
    if (isAuthPage && attrs["public"] !== "true") {
      warn("PAGE106", `${loc}：auth-mode: login 时登录/注册页应声明 > public: true`,
           `添加: > public: true`);
    }
  }

  // 6.1c entry/params 一致性
  // PAGE103 已移除：entry:false + params:— 是合法设计（无参数的二级页）
  if (attrs.entry === "true" && attrs.params && !isNoneValue(attrs.params)) {
    // 只有存在必填参数（无 ? 后缀）时才告警；全部可选参数对一级页完全合法
    const hasRequired = attrs.params.split(",").map(s => s.trim()).some(p => {
      const m = p.match(/^([\w-]+\??):(.+)$/);
      return m && !m[1].endsWith("?");   // name 不以 ? 结尾 → 必填
    });
    if (hasRequired) {
      warn("PAGE104", `${loc}：entry:true 但 params 中含必填参数（"${attrs.params}"）`,
           `一级页（tabbar）不应有必填参数，tabbar 无法传入；将参数改为可选（加 ?）或将页面改为 entry:false`);
    }
  }

  // 6.1d entry:true 的页面 tab 不应为 —
  // 登录/注册页例外：它们是 App 级拦截入口，无需参数可直达但不在 tabbar 中，entry 设 false 更准确
  // 此处只对非登录注册页告警
  const isAuthPage105 = ["/login", "/register"].includes(url);
  if (attrs.entry === "true" && isNoneValue(attrs.tab) && !isAuthPage105) {
    warn("PAGE105", `${loc}：entry:true 但 tab 为 —`,
         `一级页通常对应 tabbar 的一个 tab，请设置 > tab: <tabbar url>；若此页是登录/注册页，建议改为 entry:false`);
  }

  // 6.1e params 类型格式检查
  checkParamsFormat(attrs.params, loc, "PAGE107");

  // 6.2 URL 单级路径
  const urlPath = (attrs.url ?? url).split("?")[0];
  if (urlPath.split("/").filter(Boolean).length > 1) {
    error("PAGE110", `${loc}：URL 不是单级路径 "${attrs.url ?? url}"`,
          `改为单级路径，如 /note-detail 而非 /notes/detail`);
  }

  // 6.3 交互说明表格
  if (!sec.body.includes("| 元素") && !sec.body.includes("|元素")) {
    error("PAGE120", `${loc}：缺少交互说明表格（| 元素 | 动作 | 响应 | 传参 |）`,
          "在页面正文末尾添加交互说明表格，覆盖所有可交互元素");
  }

  // 6.4 交互引用的 @mobile-page 必须已定义
  const inlineRefs = [...sec.body.matchAll(/@mobile-page\(([^)?]+)/g)];
  for (const m of inlineRefs) {
    const ref = m[1].trim();
    if (!mobilePageUrls.has(ref)) {
      error("PAGE121",
        `${loc}：交互引用了未定义的页面 @mobile-page(${ref})`,
        `在 §8.2 中补充 @mobile-page(${ref}) 的完整 section，或修正引用`
      );
    }
  }

  // 6.5 交互引用 @api 必须在已定义的 api 中
  const apiRefs = [...sec.body.matchAll(/@api\(([^)]+)\)/g)];
  for (const m of apiRefs) {
    const ref = m[1].trim();
    if (!apiIds.has(ref)) {
      warn("PAGE122",
        `${loc}：引用了未定义的 @api(${ref})`,
        `在 §7 API 接口中添加 @api(${ref}) section，或修正引用`
      );
    }
  }

  // 6.6 apis 属性格式检查（应为 @api(id) 引用格式）
  if (attrs.apis) {
    const apisApiRefs = [...attrs.apis.matchAll(/@api\(([^)]+)\)/g)].map(m => m[1].trim());
    // isNoneValue 兼容 - / — / – / none 等无 API 写法；[] 空数组也合法，均跳过
    const apisStripped = attrs.apis.replace(/[\[\]\s]/g, "");
    if (apisApiRefs.length === 0 && apisStripped.length > 0 && !isNoneValue(attrs.apis)) {
      warn("PAGE123", `${loc}：apis 属性使用了旧格式 "${attrs.apis}"`,
           `改为 @api(id) 引用格式，如: > apis: [@api(list-records)]`);
    }
    for (const ref of apisApiRefs) {
      if (!apiIds.has(ref)) {
        warn("PAGE124", `${loc}：apis 引用了未定义的 @api(${ref})`,
             `在 §7 中添加 @api(${ref}) section，或从 apis 中删除`);
      }
    }
  }
}

// ─── 7. @api 检查 ─────────────────────────────────────────────────────────

const API_REQUIRED = ["method", "path", "auth", "module", "impl", "page-ref"];
const VALID_METHODS = ["GET","POST","PUT","PATCH","DELETE"];
const VALID_AUTH    = ["required","optional","none"];

for (const sec of tagSections("api")) {
  const id    = sec.tagId;
  const attrs = parseAttrs(sec.body);
  const loc   = `@api(${id}) 第 ${sec.lineNo} 行`;

  // 7.1 必填属性
  for (const attr of API_REQUIRED) {
    if (!attrs[attr]) {
      error("API001", `${loc}：缺少必填属性 "${attr}"`,
            `添加: > ${attr}: <值>`);
    }
  }

  // 7.2 method 合法值（只取第一个单词，防止旧格式污染）
  const methodVal = (attrs.method ?? "").split(/[\s|]/)[0].toUpperCase();
  if (attrs.method && !VALID_METHODS.includes(methodVal)) {
    error("API002", `${loc}：method 值 "${attrs.method}" 不合法`,
          `合法值: ${VALID_METHODS.join(" / ")}，每个属性应单独一行（> method: POST）`);
  }

  // 7.3 auth 合法值
  if (attrs.auth && !VALID_AUTH.includes(attrs.auth)) {
    error("API003", `${loc}：auth 值 "${attrs.auth}" 不合法`,
          `合法值: required / optional / none`);
  }

  // 7.4 impl 路径格式（路由层，非 service 层）
  if (attrs.impl && !attrs.impl.startsWith("server/app/api/")) {
    warn("API004", `${loc}：impl 路径 "${attrs.impl}" 不符合规范`,
         `正确格式: server/app/api/{module}/route.ts  （路由层，不是 service 层）`);
  }

  // 7.5 page-ref 引用必须指向已定义页面
  if (attrs["page-ref"]) {
    const refs = [...attrs["page-ref"].matchAll(/@(?:web|app)-page\(([^)?]+)/g)];
    for (const m of refs) {
      const ref = m[1].trim();
      if (!webPageUrls.has(ref) && !mobilePageUrls.has(ref)) {
        error("API010",
          `${loc}：page-ref 引用了未定义的页面 "${ref}"`,
          `在 §8.2 中补充对应页面 section，或修正 page-ref`
        );
      }
    }
  }

  // 7.6 anonymous 模式下 auth 必须为 none
  if (authMode === "anonymous" && attrs.auth && attrs.auth !== "none") {
    error("API011",
      `${loc}：auth-mode: anonymous 时所有 API 的 auth 必须为 none，但此处为 "${attrs.auth}"`,
      `将 > auth: ${attrs.auth} 改为 > auth: none`
    );
  }

  // 7.7 Response 段必须存在
  if (!sec.body.includes("**Response**") && !sec.body.includes("**response**")) {
    error("API020", `${loc}：缺少 Response 字段说明`,
          "添加 **Response** `200` 段，包含 success、message 字段");
  }

  // 7.7b Response 必须包含 success 字段
  if (sec.body.includes("**Response**") || sec.body.includes("**response**")) {
    // 提取 Response 段内容（从 **Response** 开始到下一个 ** 段或结尾）
    const responseMatch = sec.body.match(/\*\*[Rr]esponse\*\*[\s\S]*?(?=\n\*\*[A-Z]|\n###|\n####|$)/);
    const responseBody  = responseMatch ? responseMatch[0] : "";

    if (!responseBody.includes("success")) {
      error("API022", `${loc}：Response 缺少 success 字段`,
            "所有 API 的 Response 必须包含 - success: boolean");
    }
    if (!responseBody.includes("message")) {
      error("API023", `${loc}：Response 缺少 message 字段`,
            "所有 API 的 Response 必须包含 - message: string（供前端 Toast 展示）");
    }

    // 7.7d 禁止返回 204
    if (responseBody.includes("`204`") || responseBody.includes("` 204`")) {
      error("API025", `${loc}：Response 禁止使用 204 No Content`,
            "统一使用 200 + 信封格式（success + message），DELETE 接口也不例外");
    }

    // 7.7e 禁止 id: string（ID 字段必须用 uuid 类型）
    // 正则说明：只匹配字段名为 "id" 或以 "Id" 结尾（如 userId、actionId）的字段
    // 修复前的写法 \w*[Ii]d\w* 会误匹配含 "id" 子串的普通字段，如 videoUrl / validity / invalid
    if (/^\s*-\s+(?:id|\w+Id)\s*:\s*string\b/m.test(responseBody)) {
      error("API026", `${loc}：Response 中 ID 字段类型必须为 uuid，禁止写 string`,
            "将 - id: string 改为 - id: uuid（包括 userId、articleId 等所有 ID 字段）");
    }

    // 7.7f list- / search- 开头的接口必须有 datas 字段
    const isListApi = /^(list|search)-/.test(id);
    if (isListApi && !responseBody.includes("datas")) {
      warn("API027", `${loc}：list-/search- 接口的 Response 应使用 datas: object[] 字段`,
           "将列表字段命名为 datas，并在 datas 下缩进展开子字段");
    }
  }

  // 7.8 所有接口都必须有 Request 段；无请求体时写 **Request** 无
  {
    const hasRequest = sec.body.includes("**Request**") || sec.body.includes("**request**")
                    || sec.body.includes("**Query**")   || sec.body.includes("**query**");
    if (!hasRequest) {
      error("API021", `${loc}：缺少 Request 段`,
            "有请求体时写 **Request** `Content-Type` + 字段；无请求体（GET/DELETE 等）时写 **Request** 无");
    }
  }
}

// ─── 8. @server-module 检查 ───────────────────────────────────────────────

const MODULE_REQUIRED = ["impl", "models", "apis"];

for (const sec of tagSections("server-module")) {
  const id    = sec.tagId;
  const attrs = parseAttrs(sec.body);
  const loc   = `@server-module(${id}) 第 ${sec.lineNo} 行`;

  // 8.1 必填属性
  for (const attr of MODULE_REQUIRED) {
    if (!attrs[attr] && attr !== "depends") {   // depends 可选
      warn("MOD001", `${loc}：缺少属性 "${attr}"`,
           attr === "impl"
             ? `添加: > impl: server/src/services/${id}.service.ts`
             : `添加: > ${attr}: <值>`);
    }
  }

  // 8.1b impl 路径格式
  if (attrs.impl && !attrs.impl.startsWith("server/src/services/")) {
    warn("MOD002", `${loc}：impl 路径格式不符合规范，当前为 "${attrs.impl}"`,
         `建议格式: server/src/services/${id}.service.ts`);
  }

  // 8.2 apis 列表中每个 api 必须有对应 @api section
  if (attrs.apis) {
    // 支持两种格式：[@api(id1), @api(id2)] 或旧格式 [id1, id2]
    const apiList = [...attrs.apis.matchAll(/@api\(([^)]+)\)/g)].map(m => m[1].trim());
    // 如果没有匹配到 @api(xxx) 格式，说明还在用旧格式，给出提示
    if (apiList.length === 0 && attrs.apis.replace(/[\[\]\s]/g, "").length > 0) {
      warn("MOD011",
        `${loc}：apis 属性使用了旧格式 "${attrs.apis}"`,
        `请改为 @api(id) 引用格式，如: > apis: [@api(list-medicines), @api(create-medicine)]`
      );
    }
    for (const apiId of apiList) {
      if (!apiIds.has(apiId)) {
        error("MOD010",
          `${loc}：apis 中声明了 "@api(${apiId})"，但在 §7 中找不到对应的 @api(${apiId}) section`,
          `在 §7 API 接口中添加 @api(${apiId}) 的完整定义，或从 apis 列表中删除`
        );
      }
    }
  }

  // 8.3 depends：应使用 @server-module(id) 引用格式，并校验引用是否已定义
  if (attrs.depends) {
    const depRefs = [...attrs.depends.matchAll(/@server-module\(([^)]+)\)/g)].map(m => m[1].trim());
    const depsStripped = attrs.depends.replace(/[\[\]\s]/g, "");
    if (depRefs.length === 0 && depsStripped.length > 0 && !isNoneValue(attrs.depends)) {
      warn("MOD012",
        `${loc}：depends 属性使用了旧格式 "${attrs.depends}"`,
        `请改为 @server-module(id) 引用格式，如: > depends: [@server-module(auth)]；无依赖写 > depends: []`
      );
    }
    // 收集所有已定义 server-module id（延迟求值，使用全局集合）
    for (const depId of depRefs) {
      if (!moduleIds.has(depId)) {
        warn("MOD012E",
          `${loc}：depends 引用了未定义的 @server-module(${depId})`,
          `在文档中添加 @server-module(${depId}) section，或从 depends 中删除`
        );
      }
    }
  }

  // 8.4 models：应使用 @data-model(Name) 引用格式，并校验引用是否已定义
  if (attrs.models) {
    const modelRefs = [...attrs.models.matchAll(/@data-model\(([^)]+)\)/g)].map(m => m[1].trim());
    const modelsStripped = attrs.models.replace(/[\[\]\s]/g, "");
    if (modelRefs.length === 0 && modelsStripped.length > 0 && !isNoneValue(attrs.models)) {
      warn("MOD013",
        `${loc}：models 属性使用了旧格式 "${attrs.models}"`,
        `请改为 @data-model(Name) 引用格式，如: > models: [@data-model(Note), @data-model(Tag)]；无模型写 > models: []`
      );
    }
    for (const modelName of modelRefs) {
      if (!dataModelIds.has(modelName)) {
        warn("MOD013E",
          `${loc}：models 引用了未定义的 @data-model(${modelName})`,
          `在 §5 数据模型中添加 @data-model(${modelName}) section，或从 models 中删除`
        );
      }
    }
  }
}

// ─── 9. @data-model 检查 ──────────────────────────────────────────────────

for (const sec of tagSections("data-model")) {
  const name  = sec.tagId;
  const attrs = parseAttrs(sec.body);
  const loc   = `@data-model(${name}) 第 ${sec.lineNo} 行`;

  if (!attrs.impl) {
    warn("DM001", `${loc}：缺少 impl 属性`,
         `添加: > impl: server/src/db/schema/{module}.ts（{module} 与所属 @server-module id 对齐）`);
  } else if (!attrs.impl.startsWith("server/src/db/schema/")) {
    warn("DM003", `${loc}：impl 路径不符合规范，当前为 "${attrs.impl}"`,
         `格式: server/src/db/schema/{module}.ts，{module} 与所属 @server-module id 对齐`);
  }
  if (!attrs.module) {
    warn("DM002", `${loc}：缺少 module 属性`,
         "添加: > module: <模块名>");
  }
}

// ─── 10. @flow 检查 ───────────────────────────────────────────────────────

for (const sec of tagSections("flow")) {
  const id    = sec.tagId;
  const attrs = parseAttrs(sec.body);
  const loc   = `@flow(${id}) 第 ${sec.lineNo} 行`;

  if (!attrs.involves) {
    warn("FLOW001", `${loc}：缺少 involves 属性`,
         "添加: > involves: [@web-page(/), @api(xxx), @server-module(yyy)]");
  }
}

// ─── 10b. @role 检查 ──────────────────────────────────────────────────────

// 疑似用户群体而非权限角色的词（常见误用）
const USER_GROUP_WORDS = [
  "woman","man","mother","father","student","teacher","doctor","patient",
  "owner","buyer","seller","driver","passenger","employee","manager",
  "pregnant","senior","child","parent","customer",
  // 中文常见误用（转为小写检查 id）
  "妈妈","爸爸","学生","老师","医生","患者","宠物","准妈妈","孕妇",
];

for (const sec of tagSections("role")) {
  const id  = sec.tagId.toLowerCase();
  const loc = `@role(${sec.tagId}) 第 ${sec.lineNo} 行`;

  // 检查 id 中是否含有用户群体词
  const matched = USER_GROUP_WORDS.find(w => id.includes(w.toLowerCase()));
  if (matched) {
    warn("ROLE001",
      `${loc}：role id "${sec.tagId}" 疑似用户群体描述而非权限角色`,
      `@role 应描述系统权限角色（如 user/admin/editor），不应描述用户画像（如 pregnant-woman/pet-owner）。` +
      `若该角色无特殊权限差异，改用 @role(user) 即可`
    );
  }

  // 检查正文是否只描述用户特征而没有权限说明
  const body = sec.body.trim();
  const hasPermissionKeyword = /权限|可访问|仅|管理|后台|admin|只有|不能|禁止|角色/.test(body);
  if (body.length > 0 && !hasPermissionKeyword && !matched) {
    // 只有正文很长但完全没有权限词时才警告
    if (body.length > 50) {
      warn("ROLE002",
        `${loc}：@role 正文似乎只描述了用户特征，未说明权限差异`,
        `@role 正文应说明该角色相比其他角色有什么特殊权限或限制，如"可访问管理后台""仅能查看自己的数据"等`
      );
    }
  }
}

// ─── 11. 全局跨引用：交互表格中 @web-page / @mobile-page 引用 ────────────────

// 收集所有 body 中的内联引用（不在属性行里的）
// 已在各 page section 检查，这里补充检查 @api / @server-module / @flow body 里的跨引用
for (const sec of [...tagSections("api"), ...tagSections("server-module"), ...tagSections("flow")]) {
  const allPageRefs = [
    ...[...sec.body.matchAll(/@web-page\(([^)?]+)/g)].map(m => ({ type:"web-page", ref: m[1].trim(), sec })),
    ...[...sec.body.matchAll(/@mobile-page\(([^)?]+)/g)].map(m => ({ type:"mobile-page", ref: m[1].trim(), sec })),
  ];
  for (const { type, ref, sec: s } of allPageRefs) {
    const pageSet = type === "web-page" ? webPageUrls : mobilePageUrls;
    if (!pageSet.has(ref)) {
      warn("XREF001",
        `@${s.tagType}(${s.tagId}) 第 ${s.lineNo} 行：引用了未定义的 @${type}(${ref})`,
        `确认页面已在 §8.2 定义，或修正引用`
      );
    }
  }
}

// ─── 12. 章节完整性检查 ────────────────────────────────────────────────────

// 检查核心章节是否存在
const bodyText = content.replace(/^---[\s\S]*?---/, "");  // 去掉 front-matter

function hasSection(pattern) {
  return pattern.test(bodyText);
}

if (!hasSection(/#{1,2}\s+[^#]*(产品概述|Product Overview)/i)) {
  warn("STRUCT001", "缺少产品概述章节（## 1. 产品概述 或类似）",
       "添加 ## 1. 产品概述 章节");
}
if (authMode === "login" && !hasSection(/@role\(/)) {
  warn("STRUCT002", "auth-mode: login 但文档中没有任何 @role tag",
       "添加 ## 2. 用户角色 章节，并为每种角色定义 @role(id)");
}
if (authMode === "anonymous" && hasSection(/@role\(/)) {
  warn("STRUCT003", "auth-mode: anonymous（无用户区分）但文档中定义了 @role tag",
       "匿名应用不需要角色定义，删除 @role 相关内容");
}
if (needBE === "true") {
  if (!hasSection(/@data-model\(/)) {
    warn("STRUCT010", "need-backend: true 但没有任何 @data-model tag",
         "在 §5 数据模型 中添加数据模型定义");
  }
  if (!hasSection(/@server-module\(/)) {
    warn("STRUCT011", "need-backend: true 但没有任何 @server-module tag",
         "在 §6 服务端模块 中添加模块定义");
  }
  if (!hasSection(/@api\(/)) {
    warn("STRUCT012", "need-backend: true 但没有任何 @api tag",
         "在 §7 API 接口 中添加 API 定义");
  }
}
if (!hasSection(/#{1,2}\s+[^#]*(页面规格|Pages?)/i)) {
  error("STRUCT020", "缺少页面规格章节（## 8. 页面规格 或类似）",
        "添加 ## 8. 页面规格 章节");
}

// ─── 13. 首页检查 ─────────────────────────────────────────────────────────

if (isWeb && !webPageUrls.has("/")) {
  error("PAGE030", "Web 项目缺少根路径首页 @web-page(/)",
        "添加 #### @web-page(/) 首页 的完整 section");
}
// PAGE130 已移除：Mobile App 的 tabbar 首项可以是任意业务页（如 /invoices），不强制要求根路径 /

// 登录页
if (authMode === "login") {
  if (isWeb && !webPageUrls.has("/login")) {
    warn("PAGE031", "auth-mode: login 但缺少 @web-page(/login)",
         "添加登录页 @web-page(/login)，所有角色共用");
  }
}

// ─── 输出报告 ──────────────────────────────────────────────────────────────

function report() {
  const totalErrors   = errors.length;
  const totalWarnings = warnings.length;

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  APRD 检查报告  ${prdPath}`);
  console.log(`${"─".repeat(60)}\n`);

  if (totalErrors === 0 && totalWarnings === 0) {
    console.log("  ✅  全部通过，无问题\n");
    return;
  }

  if (totalErrors > 0) {
    console.log(`  ❌  错误 ${totalErrors} 个（必须修复才能通过）\n`);
    for (const e of errors) {
      console.log(`  [${e.code}] ${e.message}`);
      if (e.hint) console.log(`         → ${e.hint}`);
      console.log();
    }
  }

  if (totalWarnings > 0) {
    console.log(`  ⚠️   警告 ${totalWarnings} 个（建议修复）\n`);
    for (const w of warnings) {
      console.log(`  [${w.code}] ${w.message}`);
      if (w.hint) console.log(`         → ${w.hint}`);
      console.log();
    }
  }

  console.log(`${"─".repeat(60)}`);
  console.log(`  错误: ${totalErrors}  警告: ${totalWarnings}`);
  console.log(`${"─".repeat(60)}\n`);
}

report();
process.exit(errors.length > 0 ? 1 : 0);
