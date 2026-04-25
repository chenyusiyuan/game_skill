---
name: appgen-prototype
description: "应用生成 Phase 3: HTML 原型。基于 PRD + 选定视觉设计，为每个页面并行启动一个子 agent，生成可在浏览器直接打开的原型 HTML 文件。"
---

# Phase 3: HTML 原型

## 职责

将 PRD 需求和选定视觉设计转化为可交互的 HTML 原型页面。每个页面独立成一个 HTML 文件，页面间通过链接跳转。原型专注于视觉还原和交互行为，不含业务逻辑。

**最高原则：严格遵守 PRD，不创造 PRD 中没有的内容。**

---

## 前置条件

进入本阶段前必须确认：

1. `docs/prd.md` 存在（Phase 1 产出）
2. 选定的设计稿已就位：
   - Web 端：`design/web/selected/design.html`
   - Mobile 端：`design/mobile/selected/design.html`

若设计稿不存在，先执行 Phase 2，等用户选定方案后再回来。

---

## 输出

```
prototype/
├── web/                  ← Web 端原型（每个 @web-page 对应一个文件）
│   ├── home.html
│   └── ...
└── mobile/               ← Mobile 端原型（每个 @mobile-page 对应一个文件）
    ├── home.html
    └── ...
```

文件命名：PRD 中页面的 `url` 去掉开头 `/`，加 `.html`。
- `/` → `home.html`
- `/note-detail` → `note-detail.html`

---

## 主 Agent 执行步骤

### Step 1：用 extract_prd.js 获取所有页面列表

从 SKILL_PATHS 注释找到 SKILL_DIR，执行：

```bash
node {SKILL_DIR}/scripts/extract_prd.js docs/prd.md --list
```
注意，运行这个命令不需要再grep或是head，因为输出的全部信息都是用的，截断会导致消息的丢失。

从输出中收集：
- Web 页面列表（`@web-page`）
- Mobile 页面列表（`@mobile-page`）
- 全量 url 列表（`ALL_PAGE_URLS`）：用于子 agent 的跳转链接校验

**文件命名规则**（主 agent 构建输出路径时使用）：
- url 去掉开头 `/`，加 `.html`
- **特殊：`/` → `home.html`**（空字符串对应 home）
- 示例：`/note-detail` → `note-detail.html`，`/` → `home.html`

### Step 2：并行派发子 agent

**为每个页面**调用一次 `task_new`，**所有调用在同一 turn 内全部发出**：

- Web 页面 → agent role: `prototype-page-web`
- Mobile 页面 → agent role: `prototype-page-mobile`

子 agent 是 `context: fork`，继承父 agent 完整上下文。task 参数只传**本次任务独有的两项信息**，其余（设计稿、PRD、页面列表等）由子 agent 自行读取。

**task_id 命名规则**：`prototype-{pagename}`，其中 pagename 为输出文件名去掉 `.html`。

#### task 参数格式（Web）

```
【页面URL】{url}
【输出路径】prototype/web/{filename}.html
```

#### task 参数格式（Mobile）

```
【页面URL】{url}
【输出路径】prototype/mobile/{filename}.html
```

#### 调用示例（Web，以 home / homestay-list / roommate-detail 三页为例）

```
task_new({ task_id: "prototype-home",             agent_role: "prototype-page-web",    task: "【页面URL】/\n【输出路径】prototype/web/home.html" })
task_new({ task_id: "prototype-homestay-list",    agent_role: "prototype-page-web",    task: "【页面URL】/homestay-list\n【输出路径】prototype/web/homestay-list.html" })
task_new({ task_id: "prototype-roommate-detail",  agent_role: "prototype-page-web",    task: "【页面URL】/roommate-detail\n【输出路径】prototype/web/roommate-detail.html" })
```

#### 调用示例（Mobile，以 home / profile 两页为例）

```
task_new({ task_id: "prototype-home",     agent_role: "prototype-page-mobile",  task: "【页面URL】/\n【输出路径】prototype/mobile/home.html" })
task_new({ task_id: "prototype-profile",  agent_role: "prototype-page-mobile",  task: "【页面URL】/profile\n【输出路径】prototype/mobile/profile.html" })
```

> 以上仅为格式示例，实际 task_id / url / 输出路径以 Step 1 的 extract_prd.js 输出为准。

### Step 3：等待所有子 agent 完成

所有子 agent 完成（每个子 agent 内部已自行运行 check_prototype.js 并通过）后，继续下一步。

### Step 4：更新状态 & task_done

更新 `.appgen/state.json`：

```json
{
  "phases": {
    "prototype": {
      "status": "completed",
      "outputs": [
        "prototype/web/*.html",
        "prototype/mobile/*.html"
      ]
    }
  }
}
```

调用 `task_done`，告知用户：
- 生成了哪些页面（列表）
- 文件路径
- 建议下一步（Phase 4 代码生成）

---

## 规范文件与脚本

子 agent 在 Step 1 通过 multi_read 自行读取，主 agent 无需关心：

| 平台 | 规范文件（合并版） | 通用规范 |
|------|----------|---------|
| Web | `references/prototype/web-spec.md` | `references/common/image-spec.md`、`references/common/url-spec.md` |
| Mobile | `references/prototype/mobile-spec.md` | `references/common/image-spec.md`、`references/common/url-spec.md` |

子 agent 在 Step 4 使用以下脚本生成页面骨架：

| 脚本 | 用途 |
|------|------|
| `scripts/scaffold_page.js <design.html> <输出路径> <页面标题> --prd <prd.md> --page <url> --skill-dir <SKILL_DIR>` | 从 design.html 提取 head + 从 PRD 提取 API 文档写入 `@prd-api` 注释 + nav 函数，生成页面骨架 |
| `scripts/extract_prd.js docs/prd.md --page <url>` | 提取页面说明 + 关联 API |
| `scripts/check_prototype.js <单个.html文件> <platform>` | 检查单个原型文件质量 |
