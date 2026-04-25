# Mobile 视觉设计规范

## 设计理念

**目标：创造世界一流的移动端用户体验**

参考 Apple Human Interface Guidelines、Material Design 3、Airbnb、Stripe 等顶级产品的设计精髓。

---

## 处理流程

### 1. 需求分析
- 深入分析 PRD，理解产品的核心价值和目标用户
- 识别所有页面中重复出现的共用结构（顶部 Header、底部 TabBar、卡片样式等）
- 确定最具代表性的页面作为设计稿目标：**必须选 `entry: true` 且含 TabBar 的页面**，确保设计稿包含完整 TabBar 骨架

### 2. 设计风格决策
根据产品定位和目标用户，确定 3 个差异化方案方向：

| 维度 | 3 个方案之间必须有差异 |
|------|----------------------|
| 设计调性 | 如：极简清爽 / 温暖活泼 / 科技深色 |
| 主色系（`primary`） | 冷色 / 暖色 / 深色渐变 |
| 圆角风格 | 小(8px) / 大(20px) / 中等(12px) |
| 背景基调（`background`） | 纯白 / 暖米 / 浅灰 |
| Header 风格 | 白色/透明沉浸 / 主色渐变 |

---

## 产出物规范

每个方案产出 **1 个文件**：`design.html`，无 `global.css`。

```
design/mobile/
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
  <!-- <link href="https://fonts.googleapis.com/css2?family=..." rel="stylesheet"/> -->

  <!-- 2. 图标：默认 FontAwesome Free；若产品需 Material Design 风格可换 Material Symbols -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"/>
  <!-- Material Symbols（按需替换）:
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL@20..48,100..700,0..1" rel="stylesheet"/> -->

  <!-- 3. 先引入 Tailwind CDN（tailwind 对象加载后才能赋值 config） -->
  <script src="https://cdn.tailwindcss.com?plugins=forms"></script>

  <!-- 4. CDN 加载后赋值 tailwind.config（❌ 不能放在 CDN script 之前） -->
  <script>
    tailwind.config = {
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
            "sm":   "Xrem",   /* 小标签 */
            "md":   "Xrem",   /* 按钮/输入框 */
            "lg":   "Xrem",   /* 卡片 */
            "xl":   "Xrem",   /* 大卡片 */
            "2xl":  "Xrem",   /* 底部弹窗 */
            "full": "9999px",
          },
          boxShadow: {
            "card":   "0 4px 12px rgba(0,0,0,X)",
            "float":  "0 10px 25px rgba(0,0,0,X)",
            "dialog": "0 25px 50px rgba(0,0,0,X)",
          },
          fontFamily: {
            sans: ["字体名", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
          },
        }
      }
    }
  </script>

  <style>
    body { min-height: max(812px, 100dvh); font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    /* 若使用 Material Symbols 需加：
    .material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; } */
  </style>
</head>
```

### 页面骨架

```html
<body class="bg-background text-on-surface">

  <!-- 顶部 Header -->
  <header class="bg-surface border-b border-outline-variant sticky top-0 z-40
                 h-14 flex items-center justify-between px-4">
    <!-- 返回按钮（二级页用）或 Logo/标题 -->
    <button class="w-10 h-10 flex items-center justify-center
                   text-on-surface-variant rounded-full
                   hover:bg-surface-container active:bg-surface-container-high
                   transition-colors">
      <i class="fas fa-arrow-left"></i>
    </button>
    <h1 class="text-base font-semibold text-on-surface">页面标题</h1>
    <!-- 右侧操作 -->
    <button class="w-10 h-10 flex items-center justify-center
                   text-on-surface-variant rounded-full
                   hover:bg-surface-container transition-colors">
      <i class="fas fa-ellipsis-vertical"></i>
    </button>
  </header>

  <!-- 主内容区（有 TabBar 时加底部 padding） -->
  <main class="overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
    <!-- 页面内容 -->
  </main>

  <!-- 底部 TabBar（一级页专用） -->
  <nav class="fixed bottom-0 left-0 right-0 z-40 bg-surface
              border-t border-outline-variant
              flex justify-around items-center
              h-14 pb-[env(safe-area-inset-bottom)]">

    <!-- 激活项 -->
    <a href="#" class="flex flex-col items-center justify-center gap-0.5
                       px-5 py-1.5 text-primary">
      <i class="fas fa-home text-xl"></i>
      <span class="text-[10px] font-bold tracking-wide">首页</span>
    </a>

    <!-- 普通项 -->
    <a href="#" class="flex flex-col items-center justify-center gap-0.5
                       px-5 py-1.5 text-on-surface-variant
                       hover:text-on-surface transition-colors">
      <i class="fas fa-search text-xl"></i>
      <span class="text-[10px] font-bold tracking-wide">发现</span>
    </a>

    <a href="#" class="flex flex-col items-center justify-center gap-0.5
                       px-5 py-1.5 text-on-surface-variant
                       hover:text-on-surface transition-colors">
      <i class="far fa-user text-xl"></i>
      <span class="text-[10px] font-bold tracking-wide">我的</span>
    </a>

  </nav>

</body>
```

### 通用组件写法参考

```html
<!-- 主按钮（全宽） -->
<button class="w-full bg-primary text-on-primary py-3.5 rounded-xl text-base font-semibold
               hover:opacity-90 active:scale-[0.98] transition-all
               inline-flex items-center justify-center gap-2">
  <i class="fas fa-check"></i>
  确认
</button>

<!-- 次按钮 -->
<button class="w-full bg-surface-container text-on-surface-variant border border-outline-variant
               py-3.5 rounded-xl text-base font-semibold
               hover:bg-surface-container-high active:scale-[0.98] transition-all">
  跳过
</button>

<!-- 卡片 -->
<div class="bg-surface rounded-xl shadow-card mx-4 p-4">
  内容
</div>

<!-- 输入框 -->
<input class="w-full bg-surface-container border border-outline-variant rounded-xl
              px-4 py-3 text-base text-on-surface placeholder:text-on-surface-variant/50
              focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
              transition-colors"/>

<!-- 列表项 -->
<div class="flex items-center px-4 py-3 bg-surface
            border-b border-outline-variant/50
            active:bg-surface-container transition-colors">
  <div class="flex-1 min-w-0">
    <p class="text-sm font-medium text-on-surface truncate">标题</p>
    <p class="text-xs text-on-surface-variant mt-0.5">副标题</p>
  </div>
  <i class="fas fa-chevron-right text-on-surface-variant/50 text-sm"></i>
</div>

<!-- Badge -->
<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold
             bg-primary/15 text-primary">
  新
</span>
```

---

## 设计要求

### 1. 追求世界一流的设计品质
- 遵循 Apple HIG 和 Material Design 3 规范
- 最小点击区域 44×44px
- 注意对比度和可读性

### 2. TabBar 视觉对称性

| Tab 数量 | 规则 |
|---------|------|
| 偶数（2/4） | 必须对称，所有项样式一致 |
| 奇数（3/5） | 中间项**可以**有特殊样式（如突出圆形按钮） |

### 3. 图标使用
- **默认使用 FontAwesome Free**（`fas`/`far`/`fab`），风格中性，iOS/Android 均适用
- 若产品定位 Material Design 风格，可改用 Material Symbols Outlined
- **严禁使用 emoji 作为系统图标**

FontAwesome TabBar 示例：
```html
<!-- 激活态：加 text-primary -->
<a href="#" class="flex flex-col items-center gap-0.5 px-5 py-1.5 text-primary">
  <i class="fas fa-home text-xl"></i>
  <span class="text-[10px] font-bold">首页</span>
</a>
<!-- 未激活态 -->
<a href="#" class="flex flex-col items-center gap-0.5 px-5 py-1.5 text-on-surface-variant">
  <i class="far fa-user text-xl"></i>
  <span class="text-[10px] font-bold">我的</span>
</a>
```

### 4. 真实感内容
- 使用真实感的模拟数据，不用"示例文字"占位

---

## UI 要素规范

1. 如果系统需要展示当前用户，用户名统一为 **"小初"**
2. 默认头像不用图片，使用圆圈内一个 **"初"** 字

---

## nav 规范

**展示页面必须包含完整 TabBar 骨架**：设计稿展示的页面必须是含 TabBar 的一级页，供原型阶段作为视觉参考基准。

**全量展示，不按权限过滤**：TabBar 中所有 tab 项在设计稿中必须完整展示。设计/原型阶段不实现权限过滤逻辑。

---

## 禁止事项

1. **禁止产出 `global.css` 文件**——样式全部通过 `tailwind.config` token + utility class 实现
2. **禁止在 design.html 中写自定义组件类**——直接用 utility class 组合
3. **禁止生成模拟 iPhone/Android 手机外壳**——design.html 是真实页面内容
4. **禁止生成手机顶部状态栏**（电量、信号等）
5. **禁止用 emoji 作为系统图标**
6. **禁止在页面中混入设计说明文字**
7. **禁止添加「半透明渐变弧形装饰」**
8. **禁止生成 PRD 未提到的功能要素**
