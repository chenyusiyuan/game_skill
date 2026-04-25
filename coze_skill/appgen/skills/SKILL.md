---
name: appgen-skills
description: "应用生成技能入口。当用户要求生成网站、Web App、移动 App，或提到'做个应用''帮我开发''生成一个 XX 系统'时使用此技能。覆盖 PRD、设计、原型、代码生成、测试、交付全流程。即使用户只提到其中某个阶段（如'帮我做个原型''生成 API'），也应触发此技能。当用户上传了需求文档（PDF、DOCX 等）并要求生成 PRD、分析需求、或开发应用时，也应使用此技能读取 assets/_extract/ 目录下的 content.md 并生成 APRD 格式的 docs/prd.md。"
---

# AppGen — 执行手册

## 工作方式

### 理解用户意图，做完就停

1. **判断用户要什么** — 是只要 PRD？只要原型？还是要完整的可运行应用？
2. **做完用户要的部分就停下** — 调用 `task_done`，简要告诉用户做了什么、产出物在哪
3. **等用户指示下一步** — 用户说"继续"或"做原型"时，从上次停下的地方接着走

**不要假设用户想要全流程。** 如果用户说"帮我做个 PRD"，就只做 PRD，不要自动往下做视觉设计。

### 典型场景

| 用户说 | 你做 |
|--------|------|
| "帮我做个家庭 TODO 应用" | Step 0 读状态 → 从 Phase 1 PRD 开始，按 Phase 1→6 依次推进 |
| "帮我做个 PRD" | Step 0 读状态 → 只做 Phase 1，完成后 task_done |
| "帮我做原型" | Step 0 读状态 → Phase 1（PRD）**串行完成** → Phase 2（设计）**串行完成，等用户选方案** → Phase 3（原型） |
| "帮我生成代码" | Step 0 读状态 → 确认 Phase 1/2/3 均已完成 → Phase 4 |
| "继续" / "下一步" | Step 0 读状态 → 从 `currentPhase` 的下一阶段继续 |
| "帮我做个完整的应用，全流程" | Step 0 读状态 → 按 Phase 1→6 **串行**推进，Phase 2 完成后暂停等用户选方案 |
| "帮我出 3 套视觉方案" | Step 0 读状态 → 确认 Phase 1 已完成 → 只做 Phase 2，完成后停下 |
| "我选方案 2，继续做原型" | Step 0 读状态 → 固化方案 2 到 selected/ → Phase 3 |

### 中断与恢复

每个阶段完成后更新 `.appgen/state.json`。用户下次对话时，先读取 state.json 了解当前进度，从上次停下的地方继续。

---

## 准备工作（必须是第一步）

**进入任何阶段之前，第一件事永远是执行下面这一条命令。**

### Step 0：一条命令完成「读状态 / 初始化目录」

```bash
cat .appgen/state.json 2>/dev/null || (
  mkdir -p docs design/web/{1,2,3,selected} design/mobile/{1,2,3,selected} \
           prototype/web prototype/mobile \
           assets/_extract server web mobile shared .appgen && \
  find . -not -path './.git/*' -print | sort | awk -F'/' '{
    depth = NF - 1; name = $NF; prefix = ""
    for (i=1; i<depth; i++) prefix = prefix "│   "
    if (depth > 0) prefix = prefix "├── "
    print prefix name
  }'
)
```

逻辑：
- **state.json 存在** → `cat` 成功，直接输出文件内容，`||` 右侧不执行
- **state.json 不存在** → `cat` 失败，`||` 右侧执行目录初始化并打印目录树

根据输出决定下一步：

| 输出形态 | 说明 | 行动 |
|----------|------|------|
| JSON 内容，某阶段 `status: running` | 上次被中断 | **继续该阶段**，不重新初始化 |
| JSON 内容，某阶段 `status: completed` | 上次正常完成 | 进入下一阶段 |
| JSON 内容，某阶段 `status: failed` | 上次执行失败 | **重新执行该阶段**，不跳过不降级 |
| 目录树（无 JSON） | 全新项目，目录已初始化 | 从 Phase 1 开始 |

---

## 开发阶段

全流程分 6 个阶段，每个阶段可独立执行。后一阶段需要前一阶段的产出，若前置产出不存在，先提示用户或自动补齐。

```
Phase 1: PRD        → docs/prd.md（含 API 契约，APRD 格式）
Phase 2: 视觉设计    → design/web/{1,2,3}/design.html（内嵌 tailwind.config）
                       ← 用户选择后整目录 copy 为 design/web/selected/
Phase 3: HTML 原型  → prototype/web/*.html（每页内嵌与设计稿一致的 tailwind.config）
Phase 4: 代码生成    → server/ + web/ + shared/（或 mobile/）
Phase 5: 测试       → tests/ + e2e/
Phase 6: 交付       → docs/delivery.md + README.md
```

### 阶段依赖关系（严格串行，禁止跳步）

```
Phase 1 (PRD)          ← 必须先完成，state.json phases.prd.status = "completed"
  ↓ [等待完成]
Phase 2 (视觉设计)      ← 依赖 Phase 1 产出：docs/prd.md
  ↓ [等待用户选方案 → design/*/selected/ 就位]
Phase 3 (原型)          ← 依赖 Phase 1 + Phase 2 产出：prd.md + selected/design.html
  ↓ [等待完成]
Phase 4 (代码生成)      ← 依赖 Phase 1 + Phase 3
  ↓ [等待完成]
Phase 5 (测试)          ← 依赖 Phase 4
  ↓ [等待完成]
Phase 6 (交付)          ← 依赖 Phase 4 + Phase 5
```

**关键约束**：

- **Phase 1 完成（task_done 返回）→ 才能启动 Phase 2**。两者绝对不能并发。
- **Phase 2 完成且用户选定方案 → 才能启动 Phase 3**。
- 用户说"帮我做原型"但 Phase 1 未完成：先串行完成 Phase 1，再串行完成 Phase 2（含等用户选方案），最后做 Phase 3。
- 用户说"帮我做原型"但 Phase 2 未完成：先串行完成 Phase 2，等用户选方案后再做 Phase 3。
- **任何阶段失败（maxTurns 或 task 未正常 task_done）：在 state.json 中标记 `status: "failed"`，task_done 报告失败原因，等待用户指令，禁止用降级产出物继续执行后续阶段。**

### 每个阶段的核心职责

**Phase 1: PRD** — 将用户想法转化为结构化需求文档
- 读取 `skills/prd.md` 了解规范
- 输出：`docs/prd.md`（含 API 契约）

**Phase 2: 视觉设计** — 生成 N 套（默认 3）差异化视觉方案供选择
- 读取 `skills/design.md` 了解规范
- 输出：`design/web/{1,2,3}/design.html`（每个文件内嵌 `tailwind.config` Design Token）
- ⚠️ **必须等用户选择后才能继续**——选定方案整目录复制为 `design/web/selected/`

**Phase 3: HTML 原型** — 基于 PRD + 设计稿 tailwind.config 生成可交互原型
- 读取 `skills/prototype.md` 了解规范
- **前置条件**：`design/*/selected/design.html` 必须存在
- 从设计稿提取 `tailwind.config` 块，原封不动复制到每个原型页面 `<head>` 中
- 输出：`prototype/web/*.html`

**Phase 4: 代码生成** — 将原型转化为工程代码
- 读取 `skills/codegen.md` 了解规范
- 输出：`server/` + `web/` + `mobile/` + `shared/`（结构取决于是否多端）

**Phase 5: 测试** — 编写并运行测试
- 读取 `skills/testing.md` 了解规范
- 输出：测试代码 + 运行结果

**Phase 6: 交付** — 构建验证 + 交付文档
- 读取 `skills/delivery.md` 了解规范
- 输出：`docs/delivery.md` + `README.md`

---

## 多端架构

核心原则：**一套服务端 API，多个客户端独立部署。**

| 目标 | 服务端 | Web 客户端 | Mobile 客户端 |
|------|--------|-----------|-------------|
| 纯 Web（默认） | Next.js 全栈 | （合并在 server 中） | — |
| Web + Mobile | Next.js API | Next.js 前端 | Expo |

用户没有指定时，默认纯 Web。共享层 `shared/`（类型 + API client）供多端复用。

---

## 工作目录

```
（cwd = workspace 本身，直接写相对路径，不要创建 workspace/ 子目录）
├── docs/
│   ├── prd.md                   ← APRD 格式，含 API 契约
│   └── delivery.md
├── design/
│   ├── web/
│   │   ├── 1/design.html        ← 方案 1（内嵌 tailwind.config）
│   │   ├── 2/design.html
│   │   ├── 3/design.html
│   │   └── selected/design.html ← 用户选定后整目录 copy，原型阶段从此提取 tailwind.config
│   └── mobile/                  ← Mobile 方案（如有，结构同上）
├── prototype/
│   ├── web/
│   │   └── *.html               ← 原型页面（每页内嵌 tailwind.config）
│   └── mobile/
├── assets/                      ← 用户上传的原始文件 + 解析产物
│   ├── _____abc123.docx         ← 上传的原始文件
│   └── _extract/                ← doc2md 解析产物（PDF/DOCX/HTML）
│       └── _____abc123.docx/
│           ├── content.md       ← 正文 Markdown（refdoc 引用此文件）
│           └── assets/          ← 文档内嵌图片
├── server/                      ← Phase 4 服务端
├── web/                         ← Phase 4 Web 客户端（多端时）
├── mobile/                      ← Phase 4 Mobile（如需）
├── shared/                      ← 多端共享（类型 + API client）
├── .appgen/state.json           ← 进度状态
└── README.md
```

---

## 工具脚本

| 脚本 | 用途 | 调用方式 |
|------|------|---------|
| `skills/scripts/check_prd.js` | PRD 格式完整性检查 | `node ${SKILL_DIR}/scripts/check_prd.js docs/prd.md` |
| `skills/scripts/check_design.js` | 视觉设计产出物检查 | `node ${SKILL_DIR}/scripts/check_design.js design/web web` |

`${SKILL_DIR}` = 本文件所在目录的绝对路径（即 `skills/` 的绝对路径）。

- Phase 1 完成后必须运行 `check_prd.js`，退出码 1 表示有错误，需修正后重新检查
- Phase 2 完成后必须运行 `check_design.js`，退出码 1 表示有错误，需修正后重新检查

---

## 命名规范

| 类别 | 规范 | 示例 |
|------|------|------|
| 目录名 | 小写 kebab-case | `user-profile/` |
| 文件名 | 小写 kebab-case（React 组件可用 PascalCase） | `auth-service.ts` / `UserCard.tsx` |
| React/Vue 组件 | PascalCase（单数） | `UserCard` |
| 变量/函数 | camelCase | `getUserById` |
| 常量 | UPPER_SNAKE（仅全局常量） | `MAX_RETRY_COUNT` |
| API 路由 | kebab-case + REST（资源化，无动词） | `/api/user-profiles` |
| API JSON 字段 | camelCase | `userId` |
| 数据库表 | snake_case（复数） | `user_profiles` |
| 数据库字段 | snake_case | `created_at` |
| ORM 模型 | PascalCase（单数） | `UserProfile` |
| ORM 字段 | camelCase | `createdAt` |
| **Enum 类型名** | PascalCase（单数） | `SessionType`、`OrderStatus` |
| **Enum 成员值** | camelCase（PRD 中写法 = 代码层写法，Drizzle 不做映射） | PRD: `enum(focus\|shortBreak\|longBreak)`；代码: `'focus' / 'shortBreak' / 'longBreak'` |

---

## 状态追踪

`.appgen/state.json` 格式：

```json
{
  "project": "todo-app",
  "currentPhase": "prototype",
  "phases": {
    "prd":       { "status": "completed", "outputs": ["docs/prd.md"] },
    "design":    { "status": "completed", "selectedDesign": { "web": 2 }, "outputs": ["design/web/selected/design.html"] },
    "prototype": { "status": "running" },
    "codegen":   { "status": "pending" },
    "testing":   { "status": "pending" },
    "delivery":  { "status": "pending" }
  },
  "config": {
    "serverStack": "nextjs",
    "clientStack": "nextjs",
    "language": "zh-CN"
  }
}
```

- `status`: `pending` | `running` | `completed` | `skipped` | `failed`
- `skipped`: 用户明确跳过该阶段（如"不需要测试，直接交付"）
- `failed`: 阶段执行失败（子 task 未正常完成、check 脚本重试超限等）；**后续阶段不得在 failed 状态上继续推进**
- 每次开始新阶段前将该阶段置为 `running`，完成后置为 `completed`，失败时置为 `failed`
- **进入任何阶段前先确认前置阶段的 status 为 `completed`**，否则先处理前置阶段

---

## 执行策略

### 阶段间：严格串行，等待后再推进

每个阶段的 `task_new`（或阶段内操作）必须**完成并确认成功后**，才能启动下一阶段：

```
启动 Phase N 的 task_new
  → 等待 task_new 返回结果
  → 检查返回结果是否包含正常 task_done 信号
  → 更新 state.json phases[N].status = "completed"
  → 才能启动 Phase N+1
```

**绝对禁止**：在同一 turn 内同时发出跨阶段的多个 `task_new`（如同时发 prd_generation + design_generation）。

### 阶段内：允许并行

- **Phase 2**：3 套视觉方案的 `task_new` 可在同一 turn 内并发发出（同一阶段内部）
- **Phase 3**：所有页面的 `task_new` 可在同一 turn 内并发发出（同一阶段内部）
- **Phase 4**：各模块的代码生成 `task_new` 可在同一 turn 内并发发出

### 必须暂停的节点
- **Phase 2 完成后** — 等用户选择视觉方案（或告知系统自选），不自动进入 Phase 3
- **任何阶段完成后**（如果用户只要求了该阶段）— task_done 停下

### 子任务失败处理

子 agent `task_new` 返回结果后，检查是否包含正常完成信号：
- **正常**：返回内容包含明确的完成描述（检查脚本通过、文件已写入等）
- **异常**：返回内容包含"无法完成"、"缺少"、"错误"等，或根本未调用 task_done

**异常时的处理（禁止静默降级）**：
1. 在 `state.json` 中将该阶段标记为 `"status": "failed"`
2. 立即调用 `task_done` 报告失败原因和具体错误
3. 等待用户指令，**不得自行写入简化版产出物来"救场"后继续执行下一阶段**

### check 脚本循环上限

执行 check_prd.js / check_design.js / check_prototype.js 期间：
- **最多尝试修复 5 次**。每次修复后重跑检查脚本。
- 第 5 次仍不通过：停止修复循环，在 state.json 中标记 `"status": "failed"`，task_done 报告具体错误信息（包含检查脚本的完整输出），等待用户处理。

### 质量检查
- Phase 1 → prd.md 有页面清单和数据模型，check_prd.js 通过
- Phase 2 → 3 个方案 `primary` 配色各不相同，check_design.js 通过
- Phase 2→3 → `design/*/selected/design.html` 已就位，tailwind.config 可提取
- Phase 3 → 所有页面内嵌与设计稿完全一致的 `tailwind.config` 块
- Phase 4 → `npm run build` 通过
- Phase 5 → 测试通过率报告

---

## 核心原则

1. **第一步永远是读 state.json** — `cat .appgen/state.json 2>/dev/null || echo "NEW_PROJECT"`，根据状态决定行动
2. **阶段间严格串行** — 上一阶段 task_done 返回且确认成功后，才能启动下一阶段；禁止跨阶段并发
3. **做完用户要的就停** — 不过度交付，不自作主张往下走
4. **每个阶段前先读对应 skill 文件** — 若同时需要读多个文件，用 `multi_read` 一次性读完；单个文件用 `read`
5. **Phase 2 必须出 3 套方案** — 等用户选择后才固化到 selected/
6. **原型严格复用设计稿 tailwind.config** — 从 selected/design.html 提取后原封不动内嵌
7. **cwd 就是 workspace** — 直接写相对路径，不创建 `workspace/` 子目录
8. **完成后调用 task_done** — 说明做了什么、产出物路径、下一步建议
9. **子任务失败不降级** — 任何阶段失败时标记 failed 并报告，禁止自行写简化产出继续执行
10. **check 脚本最多重试 5 次** — 超出上限则标记 failed，task_done 报告错误等待用户处理

---

## 阶段 Skill 文件

| 阶段 | Skill 文件 | 何时读取 |
|------|-----------|---------|
| Phase 1: PRD 需求分析 | [prd.md](prd.md) | 项目启动时 |
| Phase 2: 视觉设计 | [design.md](design.md) | PRD 完成后 |
| Phase 3: HTML 原型 | [prototype.md](prototype.md) | 设计系统完成后 |
| Phase 4: 代码生成 | [codegen.md](codegen.md) | 原型确认后 |
| Phase 5: 测试 | [testing.md](testing.md) | 代码生成后 |
| Phase 6: 交付 | [delivery.md](delivery.md) | 测试通过后 |

## 通用规范（按需读取）

| 规范 | 文件 | 何时读取 |
|------|------|---------|
| APRD 格式 | [references/prd/aprd-format.md](references/prd/aprd-format.md) | 生成或阅读 prd.md 时 |
| Tailwind CSS | [references/common/tailwind.md](references/common/tailwind.md) | 编写 HTML 时 |
| 图片规范 | [references/common/image-spec.md](references/common/image-spec.md) | 原型中使用图片时 |
| URL 规范 | [references/common/url-spec.md](references/common/url-spec.md) | 设计页面路由时 |
| 匿名应用 | [references/common/anonymous-app.md](references/common/anonymous-app.md) | auth-mode: anonymous 时 |
| 多主体应用 | [references/common/multi-entity.md](references/common/multi-entity.md) | 有"切换当前 X"概念时 |

## References 目录结构

```
references/
├── common/
│   ├── tailwind.md
│   ├── image-spec.md
│   ├── url-spec.md
│   ├── anonymous-app.md
│   └── multi-entity.md
├── prd/
│   ├── aprd-format.md
│   ├── web-page-spec.md
│   └── mobile-page-spec.md
├── design/
│   ├── web-style-guide.md
│   └── mobile-style-guide.md
└── prototype/
    ├── web-html-spec.md
    ├── web-interaction.md
    ├── mobile-html-spec.md
    ├── mobile-interaction.md
    └── mobile-navigation.md
```
