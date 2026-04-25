# Skill Cloud 架构解析 + 新 Skill 开发复用指南

## 一、整体项目结构（顶层视角）

这个项目是一个 **AgentBox 工作台的 Skill 仓库**，用 Markdown + 脚本组织 AI Agent 的能力。顶层目录如下：

```
skill_cloud-master/
├── AGENTS.md              ← 顶层 Agent 定义（通用助手"初见"）
├── appgen/                ← Skill 模块 1：应用生成（最复杂）
├── ppt/                   ← Skill 模块 2：PPT 生成（中等复杂度）
└── skills/
    └── image-gen/         ← Skill 模块 3：AI 图片生成（最简单）
```

每个 Skill 模块都是一个**独立的能力单元**，有统一的组织模式。

---

## 二、三层架构：Agent → Skill → References/Scripts

这个项目最核心的架构思想是 **三层分离**：

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: AGENTS.md (Agent 定义层)                    │
│  ─ 定义角色身份、语气、安全规则、工具列表              │
│  ─ 定义什么关键词触发什么 Skill                        │
│  ─ 相当于"这个 Agent 是谁 + 什么时候做什么"            │
├─────────────────────────────────────────────────────┤
│  Layer 2: skills/SKILL.md + 阶段文件 (Skill 执行层)   │
│  ─ SKILL.md 是入口，定义全流程、阶段依赖、状态管理      │
│  ─ 每个阶段一个 .md 文件，详细描述"怎么做"             │
│  ─ 相当于"标准操作手册 (SOP)"                         │
├─────────────────────────────────────────────────────┤
│  Layer 3: references/ + scripts/ (支撑层)             │
│  ─ references/ = 规范文档（风格指南、格式标准等）       │
│  ─ scripts/ = 可执行工具脚本（校验器、提取器等）        │
│  ─ 相当于"参考手册 + 工具箱"                          │
└─────────────────────────────────────────────────────┘
```

用 appgen 模块举例，三层对应的文件：

| 层级 | 文件 | 作用 |
|------|------|------|
| **Agent 层** | `appgen/AGENTS.md` | 定义"应用生成专家"角色，关键词→Skill 映射 |
| **Skill 层** | `skills/SKILL.md` | 全流程入口（6 阶段、状态管理、目录结构） |
| **阶段文件** | `prd.md`, `design.md`, `prototype.md`, `codegen.md`, `testing.md`, `delivery.md` | 每个阶段的详细执行指南 |
| **References** | `references/common/`, `references/design/`, `references/prd/`, `references/prototype/` | 规范文档（Tailwind 规范、APRD 格式、样式指南等） |
| **Scripts** | `scripts/check_prd.js`, `scripts/check_design.js`, `scripts/extract_prd.js` 等 | 校验/提取脚本 |

---

## 三、关键设计模式详解

### 1. AGENTS.md 的 Front-matter 元数据

每个 `AGENTS.md` 都用 YAML front-matter 声明 Agent 的元信息：

```yaml
---
name: appgen                    # Agent 名称
description: 应用生成专家...      # Agent 描述（也是触发条件）
tools:                          # 可用工具列表
  - multi_read
  - read
  - write
  - edit
  - bash
  - ls
---
```

### 2. SKILL.md 的 Front-matter

每个 Skill 入口也有 front-matter：

```yaml
---
name: appgen-skills
description: "应用生成技能入口。当用户要求生成网站..."  # 描述兼做触发规则
---
```

**`description` 字段极其重要** —— 它不仅是描述，更是 Agent 判断"是否调用此 Skill"的触发条件。

### 3. 子 Agent (agents/ 目录)

复杂的 Skill 可以将任务分拆给**子 Agent** 并行执行。定义在 `agents/` 目录下：

```yaml
---
name: design-variant
description: "视觉方案生成子 agent"
tools: [multi_read, read, write, edit, bash, ls]
context: fork          # ← fork = 继承父 agent 上下文；new = 独立上下文
---
```

- `context: fork` — 子 Agent 能看到父 Agent 之前读的所有内容
- `context: new` — 子 Agent 从零开始，需要自己读取所需文件

### 4. 状态管理模式（.appgen/state.json）

appgen 使用了一个 JSON 文件跟踪执行进度：

```bash
# 每次进入时先读取状态
cat .appgen/state.json 2>/dev/null || (初始化目录...)
```

这让 Agent 支持**中断恢复** —— 用户可以在任何阶段停下，下次对话继续。

### 5. AGENTS.UI.json（可选的 UI 配置）

`AGENTS.UI.json` 定义了 AgentBox 工作台的 UI 行为：文件浏览器、预览路由、编辑器映射等。这是可选的但能提升用户体验。

---

## 四、三个模块的复杂度对比

| 特性 | image-gen (简单) | ppt (中等) | appgen (复杂) |
|------|-----------------|-----------|--------------|
| 阶段数 | 单阶段 | 单阶段(含QA循环) | 6 个串行阶段 |
| 子 Agent | 无 | 有（QA子agent） | 有（design-variant, prototype-page 等） |
| 状态管理 | 无 | 无 | .appgen/state.json |
| scripts/ | 1 个 (generate_image.js) | 多个 (Python 脚本) | 多个 (JS 脚本) |
| references/ | 无 | 无（内嵌在 SKILL.md） | 丰富（4 个子目录） |
| AGENTS.UI.json | 无 | 无 | 有 |

---

## 五、如何复用这套结构开发一个新 Skill

假设你要开发一个叫 `my-skill` 的新 Skill，以下是**从简到繁的复用路径**：

### 方案 A：最简单的 Skill（参照 image-gen）

如果你的 Skill 只有一个简单功能（比如调用某个 API），只需要：

```
skills/
└── my-skill/
    ├── SKILL.md              ← Skill 入口 + 完整执行手册
    └── scripts/
        └── do_something.js   ← 可执行脚本
```

**SKILL.md 模板**：

```yaml
---
name: my-skill
description: >
  描述你的 Skill 做什么。这段话同时是触发条件 ——
  写清楚什么关键词/场景应该调用此 Skill。
---

# My Skill — 执行手册

## 概述
一句话说明做什么。

## 环境要求
- Node.js v18+
- 环境变量：XXX_API_KEY

## 使用脚本
脚本位于 `scripts/do_something.js`

```bash
node <SKILL_DIR>/scripts/do_something.js "<参数1>" [参数2]
```

## 执行步骤
1. 理解用户意图
2. 构造参数
3. 运行脚本
4. 反馈结果

## 注意事项
- ...
```

### 方案 B：独立模块 + Agent 定义（参照 ppt）

如果你的 Skill 需要独立 Agent 身份和多个子技能文件：

```
my-skill/
├── AGENTS.md                  ← Agent 定义（角色 + 关键词映射）
├── agents/
│   └── sub-agent.md           ← 子 Agent（如果需要并行任务）
└── skills/
    ├── SKILL.md               ← Skill 入口
    ├── sub-skill-1.md         ← 子技能 1 的详细 SOP
    ├── sub-skill-2.md         ← 子技能 2 的详细 SOP
    └── scripts/
        ├── tool_1.py          ← 工具脚本
        └── tool_2.js
```

**AGENTS.md 模板**：

```yaml
---
name: my-skill
description: 你的 Skill 描述，说明什么场景触发
tools:
  - read
  - write
  - edit
  - bash
  - ls
---

你是**初见**（XX模式），专职做 XXX。

## 工作目录结构

```
workspace/
├── output/     ← 产出物
└── temp/       ← 临时文件
```

## 生成流程
1. 读取 skill：先 read 加载 skills/SKILL.md
2. ...

## 技能调用

| 关键词 | 必读 skill |
|-------|-----------|
| xxx   | my-skills |
```

### 方案 C：完整多阶段流水线（参照 appgen）

如果你的 Skill 有多个串行阶段、需要状态管理、子 Agent 并行、质量校验：

```
my-skill/
├── AGENTS.md
├── AGENTS.UI.json             ← UI 配置（可选）
├── agents/
│   ├── sub-agent-1.md
│   └── sub-agent-2.md
└── skills/
    ├── SKILL.md               ← 全流程入口 + 状态管理
    ├── phase-1.md             ← 阶段 1 详细 SOP
    ├── phase-2.md             ← 阶段 2 详细 SOP
    ├── phase-3.md
    ├── references/
    │   ├── common/
    │   │   └── shared-spec.md
    │   └── phase-1/
    │       └── format-spec.md
    └── scripts/
        ├── check_phase_1.js   ← 阶段 1 校验脚本
        └── extract_data.js    ← 数据提取脚本
```

---

## 六、开发新 Skill 的核心检查清单

不管选哪种方案，以下是必须遵循的**约定**：

| # | 要点 | 说明 |
|---|------|------|
| 1 | **front-matter 必须有 `name` 和 `description`** | `description` 是触发条件，写得越精确越不容易误触发 |
| 2 | **Agent 的 `tools` 列表要按需声明** | 不是所有 Agent 都需要 `bash`，子 Agent 特别注意 |
| 3 | **脚本用 `${SKILL_DIR}` 引用路径** | 不要硬编码绝对路径，SKILL_DIR 是技能目录的绝对路径 |
| 4 | **子 Agent 的 `context` 必须选对** | `fork`（继承上下文，适合需要父 Agent 已读信息的场景）vs `new`（独立，适合完全并行的场景） |
| 5 | **多阶段 Skill 需要状态管理** | 参照 `.appgen/state.json` 模式，每阶段完成后更新状态 |
| 6 | **脚本退出码约定：0 = 成功，1 = 失败** | Agent 通过退出码判断是否需要修复 |
| 7 | **references/ 放只读规范文档** | 被 Agent 在执行时 `read`/`multi_read` 加载 |
| 8 | **scripts/ 放可执行脚本** | 被 Agent 通过 `bash node xxx` 调用 |
| 9 | **SKILL.md 里写明"什么时候读什么文件"** | Agent 不会自动读所有文件，必须在 SOP 中指明 |
| 10 | **校验脚本非常重要** | 像 `check_prd.js`、`check_design.js` 这样的校验器确保产出质量 |

---

## 七、最小可用的新 Skill 示例

假设你要做一个 **"数据分析报告生成"** 的 Skill，最小化结构如下：

```
data-report/
├── AGENTS.md
└── skills/
    ├── SKILL.md
    ├── analysis.md           ← 数据分析阶段 SOP
    ├── visualization.md      ← 图表生成阶段 SOP
    ├── report.md             ← 报告撰写阶段 SOP
    ├── references/
    │   └── report-format.md  ← 报告格式规范
    └── scripts/
        └── check_report.js   ← 报告格式校验脚本
```

AGENTS.md 定义"数据分析专家"角色 → SKILL.md 定义三阶段流程（分析→可视化→报告）→ 每个阶段有独立的 .md 写详细步骤 → references 放格式规范 → scripts 放校验工具。

---

## 八、总结

这个项目的精髓在于：

1. **Markdown 即配置** —— Agent/Skill 的定义、SOP、规范全部用 Markdown，AI 可以直接读取理解
2. **三层分离清晰** —— Agent（谁/何时）→ Skill（怎么做）→ References+Scripts（标准+工具）
3. **约定优于配置** —— front-matter 格式、目录命名、SKILL_DIR 变量、退出码等都是固定约定
4. **可渐进增强** —— 从单文件 Skill 到多阶段流水线，按需增加复杂度

开始时建议先参照 **image-gen** 做一个最简单的，跑通后再逐步加上子 Agent、状态管理、校验脚本等进阶功能。
