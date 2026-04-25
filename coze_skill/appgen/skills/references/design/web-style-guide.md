# Web 视觉设计规范

## 设计理念

**目标：创造世界一流的 Web 用户体验**

参考 Linear、Notion、Stripe、Vercel 等顶级产品的设计精髓，每一个细节——配色、层次、间距、字重、阴影——都要精心推敲。

---

## 处理流程

### 1. 需求分析
- 深入分析 PRD，理解产品的核心价值和目标用户
- 识别所有页面中重复出现的共用结构（顶部导航、侧边栏、页脚等）
- 确定最具代表性的页面作为设计稿目标（优先选 `entry: true` 且布局最复杂的页面）

### 2. 设计风格决策
根据产品定位和目标用户，确定 3 个差异化方案方向：

| 维度 | 3 个方案之间必须有差异 |
|------|----------------------|
| 设计调性 | 如：极简专业 / 温暖亲和 / 科技现代 |
| 主色系（`primary`） | 冷色 / 暖色 / 深色或渐变 |
| 圆角风格 | 小(4-6px) / 大(12-16px) / 中等(8px) |
| 背景基调（`background`） | 纯白 / 暖白或米色 / 浅灰 |
| 阴影强度 | 无或极淡 / 柔和 / 明显 |

### 3. 布局结构决策

根据应用类型选择布局结构：

| 应用类型 | 推荐布局 |
|---------|---------|
| 管理后台 | 侧边栏 + 顶栏 + 主内容区 |
| 营销官网 | 顶部导航 + 全宽内容 + 页脚 |
| SaaS 应用 | 顶栏 + 侧边栏（可折叠）+ 主内容区 |
| 内容平台 | 顶部导航 + 三栏布局 |
| 电商平台 | 顶部导航 + 分类侧栏 + 商品区 |

### 4. 展示页面选择规则（必须遵守）

从 PRD 的 `@web-page` 中选出展示页面时：

1. **如果 PRD 存在 `@nav(web-topbar)` 或 `@nav(web-sidebar)`，必须选一个包含该导航的页面**（`layout: sidebar-main` 或含顶部导航的页面）——确保设计稿包含完整 nav 骨架
2. **禁止选 `layout: auth` 页面**（登录/注册页）作为展示页，这类页面没有全局导航
3. 满足以上条件后，优先选 `entry: true` 且内容最丰富的页面（有列表、卡片、表格等）

---

## 产出物规范

每个方案产出 **1 个文件**：`design.html`，无 `global.css`。

```
design/web/
    1/design.html   ← 内嵌 tailwind.config（方案 1 token）
    2/design.html   ← 内嵌 tailwind.config（方案 2 token）
    3/design.html   ← 内嵌 tailwind.config（方案 3 token）
    selected/
        design.html ← 用户选定后从对应方案复制
```

---

## design.html 结构规范

### Head 模板

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>

  <!-- 1. 字体（尽早加载） -->
  <!-- <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet"/> -->

  <!-- 2. 图标：默认 FontAwesome Free；若产品需 Material Design 风格可换 Material Symbols -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"/>
  <!-- Material Symbols（按需替换）:
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL@20..48,100..700,0..1" rel="stylesheet"/> -->

  <!-- 3. 先引入 Tailwind CDN（tailwind 对象加载后才能赋值 config） -->
  <script src="https://cdn.tailwindcss.com?plugins=forms"></script>

  <!-- 4. CDN 加载后赋值 tailwind.config（❌ 不能放在 CDN script 之前） -->
  <script>
    tailwind.config = {
      darkMode: "class",
      theme: {
        extend: {
          colors: {
            /* === 品牌色 === */
            "primary":              "#XXXXXX",
            "primary-container":    "#XXXXXX",
            "on-primary":           "#ffffff",
            /* === 背景 / 表面 === */
            "background":           "#XXXXXX",
            "surface":              "#ffffff",
            "surface-container":    "#XXXXXX",
            "surface-container-high": "#XXXXXX",
            /* === 文字 === */
            "on-surface":           "#XXXXXX",
            "on-surface-variant":   "#XXXXXX",
            /* === 功能色 === */
            "success":  "#22c55e",
            "error":    "#ef4444",
            "warning":  "#f59e0b",
            /* === 边框 === */
            "outline":          "#XXXXXX",
            "outline-variant":  "#XXXXXX",
          },
          borderRadius: {
            "sm":   "Xrem",
            "md":   "Xrem",
            "lg":   "Xrem",
            "xl":   "Xrem",
            "2xl":  "Xrem",
            "full": "9999px",
          },
          boxShadow: {
            "card":   "0 2px 8px rgba(0,0,0,X)",
            "float":  "0 10px 25px rgba(0,0,0,X)",
            "dialog": "0 25px 50px rgba(0,0,0,X)",
          },
          fontFamily: {
            sans: ["字体名", "system-ui", "sans-serif"],
          },
        }
      }
    }
  </script>

  <!-- 若使用 Material Symbols 需加此 style：
  <style>
    .material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; }
  </style> -->
</head>
```

### 页面骨架

所有结构、颜色、间距**全部用 Tailwind utility class**，不写自定义组件类：

```html
<body class="bg-background text-on-surface min-h-screen">

  <!-- 顶部导航栏 -->
  <header class="bg-surface border-b border-outline-variant sticky top-0 z-40
                 h-16 flex items-center justify-between px-6">
    <!-- Logo -->
    <div class="flex items-center gap-2">
      <span class="material-symbols-outlined text-primary">rocket_launch</span>
      <span class="font-bold text-lg text-on-surface">产品名</span>
    </div>
    <!-- 导航链接 -->
    <nav class="flex items-center gap-1">
      <a href="#" class="px-3 py-1.5 text-sm font-medium text-primary
                         bg-primary/10 rounded-md">当前页</a>
      <a href="#" class="px-3 py-1.5 text-sm font-medium text-on-surface-variant
                         hover:text-on-surface hover:bg-surface-container rounded-md
                         transition-colors">其他页</a>
    </nav>
    <!-- 用户区 -->
    <div class="flex items-center gap-2">
      <button class="bg-primary text-on-primary px-4 py-2 rounded-md text-sm font-medium
                     hover:opacity-90 active:scale-[0.98] transition-all">
        操作
      </button>
    </div>
  </header>

  <!-- 带侧边栏的布局 -->
  <div class="flex" style="height: calc(100vh - 4rem)">

    <!-- 侧边栏 -->
    <aside class="w-60 shrink-0 bg-surface border-r border-outline-variant
                  overflow-y-auto flex flex-col">
      <div class="p-3 space-y-0.5">
        <!-- 导航项（激活态） -->
        <a href="#" class="flex items-center gap-3 px-3 py-2.5 rounded-md
                           bg-primary/10 text-primary font-medium text-sm">
          <i class="fas fa-gauge-high w-4 text-center"></i>
          仪表盘
        </a>
        <!-- 导航项（普通态） -->
        <a href="#" class="flex items-center gap-3 px-3 py-2.5 rounded-md
                           text-on-surface-variant hover:bg-surface-container
                           hover:text-on-surface font-medium text-sm transition-colors">
          <i class="fas fa-file-lines w-4 text-center"></i>
          文章
        </a>
      </div>
    </aside>

    <!-- 主内容区 -->
    <main class="flex-1 min-w-0 overflow-y-auto bg-background p-6">
      <!-- 页面内容 -->
    </main>

  </div>

</body>
```

### 通用组件写法参考

```html
<!-- 主按钮 -->
<button class="bg-primary text-on-primary px-4 py-2 rounded-md text-sm font-medium
               hover:opacity-90 active:scale-[0.98] transition-all inline-flex items-center gap-2">
  <i class="fas fa-plus text-sm"></i>
  新建
</button>

<!-- 次按钮 -->
<button class="bg-surface text-on-surface border border-outline-variant px-4 py-2
               rounded-md text-sm font-medium hover:bg-surface-container
               active:scale-[0.98] transition-all">
  取消
</button>

<!-- 卡片 -->
<div class="bg-surface rounded-lg shadow-card p-6">
  内容
</div>

<!-- 输入框 -->
<input class="w-full bg-surface border border-outline-variant rounded-md px-3 py-2
              text-sm text-on-surface placeholder:text-on-surface-variant/50
              focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
              transition-colors"/>

<!-- Badge -->
<span class="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium
             bg-success/15 text-success">
  进行中
</span>
<span class="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium
             bg-error/15 text-error">
  已停止
</span>

<!-- 表格行 -->
<div class="bg-surface rounded-lg shadow-card overflow-hidden">
  <div class="grid grid-cols-4 px-4 py-3 bg-surface-container
              text-xs font-semibold text-on-surface-variant uppercase tracking-wide">
    <span>名称</span><span>状态</span><span>日期</span><span>操作</span>
  </div>
  <div class="divide-y divide-outline-variant/50">
    <div class="grid grid-cols-4 px-4 py-3 hover:bg-surface-container/50 transition-colors">
      <span class="text-sm text-on-surface font-medium">项目 A</span>
      <span class="inline-flex items-center px-2 py-0.5 rounded-sm text-xs
                   bg-success/15 text-success w-fit">进行中</span>
      <span class="text-sm text-on-surface-variant">2024-01-15</span>
      <button class="text-primary text-sm font-medium hover:underline w-fit">编辑</button>
    </div>
  </div>
</div>
```

---

## 设计要求

### 1. 追求世界一流的设计品质
- 参考 Linear、Notion、Stripe、Vercel 等顶级产品
- 注重视觉层次：合理使用 `on-surface` / `on-surface-variant` 区分信息权重
- 适度使用阴影和圆角，不要过度装饰

### 2. 图标使用
- **默认使用 FontAwesome Free**（`fas`/`far`/`fab`），覆盖面广，风格中性，适合 Web 和 iOS
- 若产品定位 Material Design 风格，可改用 Material Symbols Outlined
- 图标颜色跟随父元素文字色（`text-on-surface-variant`），激活态用 `text-primary`
- **严禁使用 emoji 作为系统图标**

FontAwesome 示例：
```html
<i class="fas fa-home text-primary"></i>
<i class="fas fa-edit text-on-surface-variant"></i>
<i class="fas fa-chevron-right text-on-surface-variant/50 text-sm"></i>
<i class="fas fa-plus text-on-primary"></i>
```

### 3. 真实感内容
- 使用真实感的模拟数据，不用"示例文字"、"XXXXXX" 占位
- 展示尽量多的组件变体：按钮全系列、卡片、输入框、badge、表格等

---

## UI 要素规范

1. 如果系统需要展示当前用户，用户名统一为 **"小初"**
2. 默认头像不用图片，使用圆圈内一个 **"初"** 字

---

## nav 规范

**展示页面必须包含完整 nav 骨架**：设计稿展示的页面必须包含 topbar/sidebar 导航，供原型阶段作为视觉参考基准。

**全量展示，不按权限过滤**：`@nav` 中所有菜单项（包括 `roles: [admin]` 限定的管理员菜单）在设计稿中必须完整展示。设计/原型阶段不实现权限过滤逻辑。

---

## 禁止事项

1. **禁止产出 `global.css` 文件**——样式全部通过 `tailwind.config` token + utility class 实现
2. **禁止在 design.html 中写自定义组件类**（`.btn-primary { }` 等）——直接用 utility class 组合
3. **禁止用 emoji 作为系统图标**
4. **禁止在页面中混入设计说明文字**——设计说明写在 `tailwind.config` 的注释里
5. **禁止添加「半透明渐变弧形装饰」**（被裁剪的背景圆）
6. **禁止生成 PRD 未提到的功能要素**
