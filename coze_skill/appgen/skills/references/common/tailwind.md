# Tailwind CSS 规范

## 版本与引入方式

使用 Tailwind CSS v3 CDN，通过 `tailwind.config` 注入 Design Token。

**正确顺序：CDN script 先加载，再赋值 `tailwind.config`。**
Tailwind CDN 加载后 `tailwind` 对象才存在，在此之前赋值会报 `ReferenceError: tailwind is not defined`。

```html
<head>
  <!-- 1. 字体 / 图标（与设计稿保持一致，放最前以尽早加载） -->
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL@20..48,100..700,0..1" rel="stylesheet"/>

  <!-- 2. 先引入 Tailwind CDN -->
  <script src="https://cdn.tailwindcss.com?plugins=forms"></script>

  <!-- 3. CDN 加载后再赋值 tailwind.config（❌ 不能放在 CDN 之前） -->
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            /* 从设计稿 design.html 中的 tailwind.config 复制 */
          },
          borderRadius: { /* 同上 */ },
          boxShadow:    { /* 同上 */ },
          fontFamily:   { /* 同上 */ },
        }
      }
    }
  </script>
</head>
```

---

## Design Token 定义规范

### 颜色 token

颜色直接写 hex/rgb 值，**不用 CSS 变量桥接**，透明度用 Tailwind 内置 opacity modifier（`bg-primary/20`）。

```js
tailwind.config = {
  theme: {
    extend: {
      colors: {
        /* === 品牌色 === */
        "primary":              "#785a00",   // 主操作色
        "primary-container":    "#eab308",   // 主色容器（浅色版）
        "on-primary":           "#ffffff",   // 主色上的文字/图标

        /* === 背景 / 表面 === */
        "background":           "#fbf9f3",   // 页面底色
        "surface":              "#ffffff",   // 卡片、弹窗表面
        "surface-container":    "#f0eee8",   // 次级容器
        "surface-container-high": "#eae8e2", // 强调容器

        /* === 文字 === */
        "on-surface":           "#1b1c19",   // 主要文字
        "on-surface-variant":   "#4f4633",   // 次要文字

        /* === 功能色 === */
        "success":  "#22c55e",
        "error":    "#ef4444",
        "warning":  "#f59e0b",
        "on-error": "#ffffff",

        /* === 边框 === */
        "outline":          "#817660",   // 主要边框
        "outline-variant":  "#d3c5ac",   // 轻量边框

        /* === 辅助品牌色（按需） === */
        // "secondary":           "#636036",
        // "secondary-container": "#e9e5b0",
        // "tertiary":            "#00658e",
      },
    }
  }
}
```

### 圆角 token

```js
borderRadius: {
  "sm":   "0.375rem",   // 6px  — 小标签、小按钮
  "md":   "0.5rem",     // 8px  — 输入框、默认按钮
  "lg":   "0.75rem",    // 12px — 卡片
  "xl":   "1rem",       // 16px — 大卡片
  "2xl":  "1.5rem",     // 24px — 底部弹窗、模态框
  "full": "9999px",     // 圆形胶囊
},
```

### 阴影 token

```js
boxShadow: {
  "card":   "0 2px 8px rgba(0,0,0,0.08)",
  "float":  "0 10px 25px rgba(0,0,0,0.10)",
  "dialog": "0 25px 50px rgba(0,0,0,0.20)",
},
```

### 字体 token

```js
fontFamily: {
  sans: ["Manrope", "system-ui", "sans-serif"],
  // 或保持系统字体：
  // sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "PingFang SC", "sans-serif"],
},
```

---

## Token 命名规范

命名遵循**语义优先**，不用颜色名（禁止 `blue-main`、`gray-bg` 等）。

| 类别 | 规范命名 | 禁止写法 |
|------|---------|---------|
| 品牌主色 | `primary` | `brand-color`、`blue-main` |
| 品牌容器色 | `primary-container` | `primary-light`、`btn-bg` |
| 主色上的内容 | `on-primary` | `primary-text`、`text-on-btn` |
| 页面背景 | `background` | `bg-app`、`page-bg` |
| 卡片表面 | `surface` | `card-bg`、`white-bg` |
| 主要文字 | `on-surface` | `text-primary`（与 Tailwind 前缀冲突） |
| 次要文字 | `on-surface-variant` | `text-secondary`（同上） |
| 主要边框 | `outline` | `border-color`、`border-main` |
| 轻量边框 | `outline-variant` | `border-light` |

> ⚠️ 禁止命名为 `text-primary`、`text-secondary`——会与 Tailwind 内置 `text-*` 前缀产生歧义，造成 `text-text-primary` 这类丑陋写法。

---

## 在 HTML 中使用 Token

Token 注册后，直接用 `bg-*`、`text-*`、`border-*` 等 utility class 引用：

```html
<!-- 颜色 -->
<div class="bg-background">页面底色</div>
<div class="bg-surface shadow-card rounded-lg p-4">卡片</div>
<p class="text-on-surface">主要文字</p>
<p class="text-on-surface-variant">次要文字</p>
<div class="border border-outline-variant rounded-md">有边框容器</div>

<!-- 透明度 modifier（替代 color-mix） -->
<div class="bg-primary/10">10% 主色背景</div>
<div class="bg-error/15">15% 错误色背景</div>
<button class="bg-primary text-on-primary">主按钮</button>

<!-- 圆角 / 阴影 -->
<div class="rounded-lg shadow-card">卡片</div>
<div class="rounded-2xl shadow-dialog">模态框</div>
```

---

## 自定义样式规范

如需补充 Tailwind utility 无法覆盖的样式，在 `<style>` 中写完整 CSS 规则：

```html
<style>
  /* ✅ 正确：直接写完整 CSS */
  .input-custom:focus {
    outline: none;
    border-color: #785a00;   /* 或直接引用 token hex */
    box-shadow: 0 0 0 2px rgba(120,90,0,0.2);
  }

  /* ❌ 错误：CDN 模式下 @apply 不会生效 */
  .my-btn { @apply bg-primary text-on-primary rounded-md; }

  /* ❌ 错误：CDN 模式下 theme() 函数不会生效 */
  .my-btn { background: theme('colors.primary'); }
</style>
```

---

## 图标规范

统一使用 **Material Symbols Outlined**（可变字体，支持 fill/weight/size 调节）：

```html
<!-- 引入 -->
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL@20..48,100..700,0..1" rel="stylesheet"/>
<style>
  .material-symbols-outlined {
    font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
  }
</style>

<!-- 线条图标（默认） -->
<span class="material-symbols-outlined text-on-surface-variant">home</span>

<!-- 实心图标（激活态） -->
<span class="material-symbols-outlined text-primary"
      style="font-variation-settings:'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24">
  home
</span>
```

备选图标库（与设计稿保持一致，不混用）：
- FontAwesome 6：`<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"/>`
- Lucide Icons（SVG sprite 方式）

**严禁用 emoji 作为系统图标**（导航、按钮、状态标记等）。

---

## 3 套方案差异化

3 套 design.html 的 `tailwind.config` 在以下维度必须有明显差异：

| 维度 | 举例差异 |
|------|---------|
| `primary` 主色 | 深蓝 `#1d4ed8` / 暖绿 `#16a34a` / 深琥珀 `#92400e` |
| `background` 底色 | 纯白 `#ffffff` / 暖米 `#fafaf7` / 浅灰 `#f8fafc` |
| `borderRadius` | sm:4px/md:6px（锐利）vs lg:12px/xl:16px（圆润） |
| `boxShadow` | 无阴影 / 柔和 / 明显 |
| 字体 | 系统字体 / Manrope / Inter |

3 套方案的 HTML 结构保持**完全一致**，只替换 `tailwind.config` 块即可切换主题。
