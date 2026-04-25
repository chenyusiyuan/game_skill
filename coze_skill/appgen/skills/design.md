---
name: appgen-design
description: "应用生成 Phase 2: 视觉设计。基于 PRD 生成 N(默认为3) 套不同视觉风格的设计方案（design.html），每套方案内嵌 tailwind.config Design Token，用户选定一套后复制到 selected/ 目录，原型阶段从中提取 tailwind.config 复用。"
---

# Phase 2: 视觉设计

## 核心流程

```
PRD → 分析需求 → 生成 N(默认为3) 套设计方案 → 用户选择（或系统自选）→ 复制到 selected/
```

## 输出

### 候选方案

Web 端（`platform` 含 `web` 时）：

```
design/web/
    1/design.html   ← 方案 1，内嵌 tailwind.config（token 值体现方案特色）
    2/design.html   ← 方案 2
    3/design.html   ← 方案 3
```

Mobile 端（`platform` 含 `mobile` 时）：

```
design/mobile/
    1/  2/  3/      ← 结构同上
```

**每个方案只有 1 个文件，无 `global.css`。**

### 用户选定后

```
design/web/selected/
    design.html     ← 从选中的 N/ 整目录复制

prototype/web/      ← 原型阶段页面的 tailwind.config 从 selected/design.html 中提取
```

---

## 详细步骤

### Step 1: 解析 PRD

读取 `docs/prd.md`，提取以下信息：

| 提取项 | APRD 来源 | 用途 |
|--------|----------|------|
| 平台 | `front-matter.platform` | 决定走 web / mobile / 双端规范 |
| 认证模式 | `front-matter.auth-mode` | 决定是否有登录态、头像菜单 |
| 导航结构 | `@nav` tags | 决定骨架（topbar/sidebar/tabbar 组合） |
| 页面布局汇总 | `@web-page.layout` 所有值 | 确认用到哪些布局类型 |
| 是否有管理员 | `@role(admin)` 是否存在 | 决定是否需要 sidebar 布局 |
| 推荐视觉风格 | `§1 产品概述` | 作为方案方向提示（如有） |

### Step 2: 确定展示页面与参考图分配

**选定展示页面（所有方案共用同一页面）**：

从 PRD 的 `@web-page` / `@mobile-page` 中选出**一个**最具代表性的页面作为所有方案的展示页面：

**导航选页规则（最高优先级）**：
- Web：如果 PRD 存在 `@nav(web-topbar)` 或 `@nav(web-sidebar)`，**必须**选一个包含该导航的页面（`layout: sidebar-main` 或含 topbar 的页面），禁止选 `layout: auth` 页
- Mobile：**必须**选一个 `entry: true` 且含 TabBar 的页面

满足以上条件后，优先选内容最丰富的页面（有列表、卡片、表格等）。所有方案展示同一页面，让用户在相同内容下对比视觉风格差异

**扫描参考图**：

检查以下来源是否存在参考图或设计文档：
1. PRD 中 `@web-page` / `@feature` / `@server-module` 的 `refdoc` 字段
2. `_extract/` 目录下的图片文件（用户上传文档的解析产物）
3. 用户在本轮对话中直接上传的图片

将所有找到的参考图路径收集为列表，记为 `REF_IMAGES`。

**参考图分配规则**：

| 情况 | 分配策略 |
|------|---------|
| 无参考图 | 3 个方案均自由发挥，按差异化方向各自设计 |
| 有 1 张参考图 | 方案 1 严格还原，方案 2/3 以参考图为风格参考各自演绎 |
| 有 2 张参考图 | 方案 1/2 各严格还原一张，方案 3 综合两张自由演绎 |
| 有 3+ 张参考图 | 每个方案分配 1 张负责严格还原，多余的参考图全部附给方案 3 |

### Step 3: 确定 3 个视觉方向

根据产品定位和参考图（若有），确定 **3 个差异化方案**，每个方案在以下维度有明显区别：

| 维度 | 3 个方案之间必须有差异 |
|------|----------------------|
| 设计调性 | 如：极简专业 / 温暖亲和 / 科技现代 |
| 主色（`primary`） | 冷色 / 暖色 / 深色或渐变 |
| 圆角风格 | 小(4-6px) / 大(12-16px) / 中等(8px) |
| 背景基调（`background`） | 纯白 / 暖白或米色 / 深色或灰色 |
| 阴影强度 | 无或极淡 / 柔和 / 明显 |

**有参考图时**：被分配到"严格还原"的方案，其视觉方向描述必须来自参考图提取的实际值（主色色值、圆角大小等），不得自由发挥。

告知用户时，每个方案需有一句话摘要（注明还原情况）：
> - **方案 1**：极简专业——深蓝主色，白色背景，细边框无阴影 ✦ 严格还原参考图
> - **方案 2**：温暖亲和——暖绿主色，米白背景，大圆角柔和阴影
> - **方案 3**：科技现代——深色背景，紫色渐变，适合 AI / 数据类产品

### Step 4: 并行生成设计稿

通过 `task_new` 并发调用 `design-variant` 子 agent，**3 个调用在同一 turn 内同时发出**：

```
task_new({
  task_id: "design-variant-1",
  agent_role: "design-variant",
  task: """
    【方案编号】1
    【平台】{web / mobile / web+mobile}
    【输出路径】design/{platform}/1/design.html  ← 精确路径，子 agent 必须原样使用，不得添加额外层级
    【展示页面】{选定页面的 url}——{该页面的功能一句话描述}
    【视觉方向】{调性}——{主色 #hex}，{背景基调}，{圆角 Npx}，{阴影强度}
    【参考图】{分配给本方案的参考图路径，无则填"无"}
    【还原要求】严格还原 / 风格参考 / 无
  """
})

task_new({
  task_id: "design-variant-2",
  agent_role: "design-variant",
  task: "... 同上格式，填方案 2 的内容 ..."
})

task_new({
  task_id: "design-variant-3",
  agent_role: "design-variant",
  task: "... 同上格式，填方案 3 的内容 ..."
})
```

**要点**：
- 3 个 `task_new` 必须在同一 turn 内并发发出，不要等一个完成再发下一个
- 子 agent `context: fork`，继承父 agent 对话历史（含 PRD 内容）仅供参考，task 参数是实际执行指令
- SKILL_DIR 由系统自动注入到子 agent 的 system prompt（`SKILL_PATHS` 注释），无需在 task 里填写
- 3 套方案的 HTML 结构可以完全相同，差异只在 `tailwind.config` 的 token 值

### Step 5: 用户选择

生成完成后告知用户：
> "已生成 3 套视觉方案，请查看后告诉我选择哪套，或者说'你来选'由我决定。"
> - 方案 1：[一句话描述]  →  `design/web/1/design.html`
> - 方案 2：[一句话描述]  →  `design/web/2/design.html`
> - 方案 3：[一句话描述]  →  `design/web/3/design.html`

**系统自选路径**：如果用户表示不指定（"你来选" / "随便" / "你定"）：
1. 根据产品定位选最匹配的 1 套，说明选择理由
2. 向用户展示推荐结果，等待确认（"我推荐方案 N，如无异议请说继续"）
3. 用户确认后再进入 Step 6；如有异议按用户意见更换

### Step 6: 固化选定方案

用户选定方案 N 后（假设选了方案 2）：

**Web 端**：
```bash
cp -r design/web/2/ design/web/selected/
```

**Mobile 端**：
```bash
cp -r design/mobile/2/ design/mobile/selected/
```

完成后更新 `.appgen/state.json` 中的 `phases.design`：
```json
{
  "phases": {
    "design": {
      "status": "completed",
      "selectedDesign": { "web": 2, "mobile": 2 },
      "outputs": ["design/web/selected/design.html"]
    }
  }
}
```

（仅 Web 端时 `selectedDesign` 只含 `web` 字段，仅 Mobile 端时只含 `mobile` 字段。）

**微调说明**：
- 进入原型阶段前需要微调 → 修改 `design/web/selected/design.html` 中的 `tailwind.config` token 值
- 原型页面已生成后需要微调 → 在每个原型页面的 `tailwind.config` 块中修改 token 值，所有页面各自生效；`design/selected/` 作为历史存档

---

## 多端处理

- Web 和 Mobile 各自独立生成 3 套方案
- 两端配色方案共享（主色、辅助色、功能色一致），尺寸 token 各端独立（圆角、阴影可以不同）

**用户选择**：分开提问，用户可为 Web 和 Mobile 选择不同编号。

---

## 原型阶段衔接

原型阶段 agent 在生成每个页面时：
1. 读取 `design/*/selected/design.html`，提取 `<script>` 中的 `tailwind.config = { ... }` 整块
2. 将该块原封不动复制到每个原型页面的 `<head>` 中（在 Tailwind CDN 之前）
3. 页面所有颜色、圆角、阴影均通过 token class 引用（`bg-primary`、`rounded-lg`、`shadow-card` 等）

这样保证所有原型页面的视觉 token 与设计稿**完全一致**。

---

---

## 遵循用户的视觉意图（最高优先级）

在开始生成前，检查以下来源是否有视觉要求，**一旦存在则严格遵循**：

| 来源 | 检查内容 |
|------|---------|
| `docs/prd.md` §1 产品概述 | 是否有明确的视觉风格描述（如"极简"、"深色"、"品牌色 #XX"） |
| `docs/prd.md` 任意位置 | 是否提及参考产品（如"对标 Linear 风格"） |
| 用户上传的图片 | 截图、设计稿、品牌素材——提取其中的配色、圆角、字体、布局风格 |
| 用户对话中的描述 | 启动设计阶段时用户临时提出的风格要求 |

**有明确视觉参考时**：3 套方案在该参考基础上做差异化演绎，而不是无视参考随意生成。

---

## 禁止事项

| 禁止项 | 说明 |
|--------|------|
| **产出 `global.css`** | 不再有此文件，样式通过 `tailwind.config` + utility class 实现 |
| **自定义组件类** | 不在 design.html 中写 `.btn-primary { }` 等类，直接用 utility class |
| **emoji 作为系统图标** | 禁止用 🏠 📝 ✅ 等 emoji 代替导航图标、按钮图标 |
| **手机外壳/边框** | Mobile 设计稿禁止模拟 iPhone/Android 外壳 |
| **设计说明文字混入页面** | design.html 是纯业务页面，说明写在 `tailwind.config` 注释里 |
| **非标准 token 命名** | 禁止 `text-primary`（与 Tailwind 前缀冲突）、`--primary-color`、`bg-app` 等自造名，用 `on-surface`、`primary`、`background` 等语义名 |

## 设计标准

**目标是生成世界一流水准的视觉设计。** 参考 Linear、Notion、Stripe、Vercel、Airbnb 等顶级产品的设计水准，不接受平庸的"能用就行"。
