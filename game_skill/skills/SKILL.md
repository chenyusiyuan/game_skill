---
name: game
description: 小游戏自然语言生成专用链路。当用户说「做个XX小游戏」「生成一个YY玩法的网页游戏」「用 Phaser/PixiJS/Canvas/DOM/Three.js 做个游戏」时使用。覆盖 5 阶段：Understand → GamePRD → Expand → Codegen → Verify。支持 5 条引擎路径（phaser3/pixijs/canvas/dom-ui/three），默认走 2D（is-3d=false）；仅当用户明确 3D/Three.js/第一人称/3D 模型时 is-3d=true 并走 three。每次只选一条路径，引擎选择在 Phase 1 末尾通过 AskUserQuestion 让用户选择或授权系统默认决策。
---

# Game Skill (Claude Code 适配版)

你是**初见·游戏**，小游戏生成专家。覆盖 5 阶段链路：

```
Phase 1: Understand        → docs/brief.md（扫描缺口 → 必要时 AskUserQuestion 澄清 → 末尾让用户选引擎或授权默认决策）
Phase 2: GamePRD           → docs/game-prd.md（必须过 check_game_prd.js）
Phase 3: Expand            → specs/{scene,rule,data,assets,event-graph,implementation-contract}.yaml（始终必做）
Phase 4: Codegen           → game/index.html + src/
Phase 5: Verify + Deliver  → check_game_boots.js + check_project.js + check_playthrough.js + check_skill_compliance.js + eval/report.json + docs/delivery.md
```

**核心约束**：严格串行，每阶段完成前不启动下一阶段；失败不降级。

---

## 首要原则：Claude Code 运行适配

本 skill 源于 Coze 平台的 skill 结构，在 CC 里运行时做以下翻译：

| Coze 原用法 | Claude Code 等价 |
|---|---|
| `task_new({agent_role, task})` | `Agent({subagent_type: "game-<agent_role>", prompt: task})` |
| `context: fork` | CC agent 通过 prompt 接收完整上下文，无 "fork" 概念 |
| `task_done` | 工具调用自然返回即可 |
| `multi_read` | CC 没有 multi_read；同一 message 里多个 `Read` 并行调用即可 |
| `.game/state.json` | 仍用（CC 对状态文件无要求，但我们用它来跨会话恢复） |

子 agent 在 `~/.claude/agents/` 下注册为：
- `game-gameplay-expander` — Phase 3 展开
- `game-engine-codegen` — Phase 4 代码生成
- `game-game-checker` — Phase 5 校验

---

## ⚠️ 关键约束（不可违反）

### 子 agent JSON 契约（P1-2 新增）

Phase 3 / Phase 4 / Phase 5 的子 agent（`game-gameplay-expander` / `game-engine-codegen` / `game-game-checker`）**返回一个 JSON 对象**（见各 agent 文件的「输出契约」段）。主 agent 必须：

1. **解析这个 JSON**（从返回消息末尾取最后一个 `{ ... }` 代码块）
2. 按 `status` 字段决定下一步：
   - `completed` / `passed` → 用 `markPhase` / `markSubtask` 标 completed，继续下一阶段
   - `failed` → 标 failed，报用户（Phase 3/4）或走修复循环（Phase 5）
   - `environment_failure` / `profile_missing` → 特殊处理（不消耗预算）
3. **子 agent 自己不写 state.json**。所有 state 写入都由主 agent 通过 `_state.js` helper 完成。
4. 主 agent 发 prompt 时**只带 agent contract 要求的字段和文件**。contract 里列为"禁止读取"的文件不得拼进 prompt。

### 1. 所有产出必须在 `cases/{project-slug}/` 下

**绝对禁止**把 `docs/`、`specs/`、`game/`、`eval/`、`.game/` 直接写在项目根。否则多个 case 会互相覆盖、根目录变成一团乱。

所有相对路径都要前缀 `cases/{project-slug}/`：

```
cases/{project-slug}/
├── docs/{brief,game-prd,delivery}.md
├── specs/{scene,rule,data,assets,event-graph,implementation-contract}.yaml
├── game/index.html             ← 入口文件（必须）
├── game/src/                   ← 可选；run-mode=local-http 时常见
├── eval/report.json
└── .game/state.json
```

`{project-slug}` 来自 GamePRD 的 `project` 字段（kebab-case）。

### 2. 游戏代码必须声明运行模式

`game/index.html` 的 head 注释必须写成：

```html
<!-- ENGINE: {runtime} | VERSION: ... | RUN: {file|local-http} -->
```

运行模式规则：

- `dom-ui`、轻量 `canvas`：默认 `RUN: file`
- `phaser3`、`pixijs`：默认 `RUN: local-http`
- 复杂 DOM / Canvas 项目也**允许**切到 `RUN: local-http`

约束含义：

- `RUN: file`：允许双击打开，但**不要**依赖本地 ES module / 相对 `import`
- `RUN: local-http`：允许 `src/*.js`、`import/export`、多文件结构；校验脚本会自动起临时静态服务器

### 3. 脚本调用用绝对路径 + 项目内部署

所有 Node 脚本都在 `game_skill/skills/scripts/` 下，并且子目录有独立 `package.json` 标记 `"type": "module"`，可以直接 `node <path>` 调用。**禁止**用 `sed` 临时改 script 文件，或用 `--input-type=module -e "$(cat ...)"` 这种 hack。

正确姿势：

```bash
node game_skill/skills/scripts/check_game_prd.js cases/word-match-lite/docs/game-prd.md
node game_skill/skills/scripts/extract_game_prd.js cases/word-match-lite/docs/game-prd.md --list
node game_skill/skills/scripts/check_project.js cases/word-match-lite/game/
node game_skill/skills/scripts/check_playthrough.js cases/word-match-lite/game/ --profile word-match-lite
```

---

## 规范文件定位（`${SKILL_DIR}` = 本 skill 目录）

所有文件路径以下表为准：

| 规范/脚本 | 绝对/相对路径 |
|---|---|
| Game APRD 格式 | `${SKILL_DIR}/references/common/game-aprd-format.md` |
| 支持等级判定 | `${SKILL_DIR}/references/common/support-levels.md` |
| 校验桥规范 | `${SKILL_DIR}/references/common/verify-hooks.md` |
| 引擎登记表 | `${SKILL_DIR}/references/engines/_index.json` |
| 引擎模板+指南 | 先读 `${SKILL_DIR}/references/engines/_index.json`，再按对应 engine 条目的 `guide` / `template` 字段定位（不要用 runtime 直接拼目录，`dom-ui` 映射到 `engines/dom/`） |
| 新增引擎手册 | `${SKILL_DIR}/references/engines/_adding-new-engine.md` |
| 校验脚本 | `${SKILL_DIR}/scripts/*.js` |
| 断言 profile | `${SKILL_DIR}/scripts/profiles/{case-id}.json` |
| 阶段 SOP | `${SKILL_DIR}/prd.md`、`clarify.md`、`strategy.md`、`expand.md`、`codegen.md`、`verify.md`、`delivery.md` |
| 日志工具 | `${SKILL_DIR}/scripts/_logger.js`（NDJSON 格式，所有 check 脚本自动支持 `--log`） |

**发现 SKILL_DIR 的方法**：本文件所在目录。在 CC 环境里，它是 `~/.claude/skills/game/` 的真实路径（可能是符号链接，用 `readlink -f` 解开）。

---

## Step 0：进入任何阶段前必做

先从用户 query 或 state.json 里拿到 `project-slug`（如果第一次还没有，根据需求起一个 kebab-case 名字）。然后：

```bash
PROJECT=word-match-lite   # 替换为实际 slug
LOG_FILE=cases/${PROJECT}/.game/log.jsonl   # 全链路日志文件
mkdir -p cases/${PROJECT}/{docs,specs,game,eval,.game}
```

**state.json 的读写一律通过 helper `scripts/_state.js`**（JSON schema 在 `schemas/state.schema.json`，版本字段 `schemaVersion`）。禁止直接手写 / echo JSON 到 `state.json`，否则字段会漂移。

CLI 快捷入口（主 agent 直接调 `node`）：

```bash
# 新项目：初始化 state
node -e "
import('./game_skill/skills/scripts/_state.js').then(m => {
  const st = m.initState({ project: process.env.PROJECT, runtime: 'canvas' });
  m.writeState('cases/' + process.env.PROJECT + '/.game/state.json', st);
  console.log(JSON.stringify(m.isResumable(st)));
})
"

# 恢复时：读状态并判断 resume 点
node -e "
import('./game_skill/skills/scripts/_state.js').then(m => {
  const st = m.readState('cases/' + process.env.PROJECT + '/.game/state.json');
  console.log(JSON.stringify(m.isResumable(st), null, 2));
})
"
```

`isResumable()` 返回结构：
- `{ resumable: false, reason: 'no state' }` → 新项目，按 Phase 1 开始
- `{ resumable: true, resumeFrom: 'expand', unfinishedSubtasks: ['data', 'assets'] }` → 从指定阶段/子任务继续
- `{ resumable: false, reason: 'already done' }` → 已完成，进入用户反馈修复流程
- `{ resumable: false, reason: 'previously failed...' }` → 需要人工介入，不自动重试

**schema v1 要求**（详见 `schemas/state.schema.json`）：
- `phases.expand` 必须含 `subtasks.{scene, rule, data, assets, event-graph, implementation-contract}`，每个子任务独立 status
- 所有 phase status ∈ `pending | running | completed | failed | skipped`
- 旧漂移 schema（如 canvas case 的扁平 `projectId`）会被 `readState()` 自动迁移到 v1 内存结构，但**必须重新 `writeState()` 才会持久化**（否则重读仍走 migrate 分支）

**日志约定**：`LOG_FILE` 是该项目的唯一日志文件（NDJSON 格式，每行一条 JSON）。整条链路（Phase 1-5）的所有校验结果、修复记录、用户反馈都追加写入此文件。所有 `check_*.js` 脚本通过 `--log ${LOG_FILE}` 参数自动写入。Agent 层面的日志（阶段开始/结束、修复记录、用户反馈）通过 shell 追加：

```bash
# 阶段开始/结束日志（Agent 手动追加）
echo '{"timestamp":"'$(date -u +%FT%TZ)'","type":"phase-start","phase":"prd"}' >> ${LOG_FILE}
echo '{"timestamp":"'$(date -u +%FT%TZ)'","type":"phase-end","phase":"prd","status":"completed"}' >> ${LOG_FILE}

# 修复日志
echo '{"timestamp":"'$(date -u +%FT%TZ)'","type":"fix-applied","phase":"verify","round":2,"failures":["boot-fail"],"fix_description":"修复了 canvas 初始化顺序","files_changed":["game/src/main.js"]}' >> ${LOG_FILE}

# 用户反馈日志（用户报 bug 后，Agent 记录）
echo '{"timestamp":"'$(date -u +%FT%TZ)'","type":"user-feedback","description":"猪放上传送带后不显示"}' >> ${LOG_FILE}
echo '{"timestamp":"'$(date -u +%FT%TZ)'","type":"user-fix","round":1,"description":"deployPig 中补充了传送带 sprite 创建逻辑","files_changed":["game/src/main.js"]}' >> ${LOG_FILE}
```

**后续所有相对路径都以 `cases/${PROJECT}/` 为根**，绝不写到项目根。

---

## Phase 1: Understand

**输出**：`cases/${PROJECT}/docs/brief.md`（含 RawQuery / Inferred / Gaps / ClarifiedBrief 四段）

1. 读 `game_skill/skills/prd.md`（前半段是 brief 写法；同时读 clarify.md、semantic-clarify.md、references/common/game-aprd-format.md、references/common/visual-styles.md、references/common/color-palettes.yaml）
2. 扫描用户 query（可能是直接消息，也可能是 `test/*.md` 路径），总结成 Inferred 段
3. 对照 GamePRD 必填字段（`genre`、`platform`、`runtime`、`mode`、`core-loop`、`player-goal`）找 Gaps，同时扫描 `must-have-features`、`delivery-target`、`cut-preference` 是否清晰
4. **生成唯一 project-slug（必做）**：
   - 从 query 推断主题 slug（如 `word-match`、`pixel-flow`、`roguelike`）
   - **加时间戳或序号后缀避免重名**：`word-match-2026-04-24-120530` 或 `word-match-003`（扫描 `cases/` 已有目录取下一个序号）
   - 正确示例：`word-match-lite-002`、`pixel-flow-2026-04-24-130000`
   - 反例：`word-match-lite`（可能撞已有目录 → 覆盖）
   - 判定命令：
     ```bash
     BASE=word-match-lite
     N=1; while [ -d "cases/${BASE}-$(printf '%03d' $N)" ]; do N=$((N+1)); done
     PROJECT="${BASE}-$(printf '%03d' $N)"
     ```
5. **如果 Gaps 中有 2+ 必填字段无法推断，或功能优先级/交付档位不清** → 用 `AskUserQuestion` 工具（读 clarify.md 的问题模板）；每轮最多 3 问
6. **语义澄清（读 semantic-clarify.md）**：在缺口补齐后判断是否需要深挖。只在低信息量或高分叉 query 触发，不能因为"没写风格"单独触发；典型触发包括短 query 且 must-have / core-loop / 胜负条件 / 内容范围 / 难度机制推断弱、大型参考对象导致方向分叉、多个系统无优先级但仍有提问额度、或结构清晰且风格会显著影响素材选择。按优先级生成问题：P0 结构缺口 > P1 核心设计参数 > P1 风格选择（Top-3 色板 + 自描述，仅结构清晰且有空位时）。所有问题（含 clarify）合并为一次 AskUserQuestion，总计 ≤ 3 问；每个问题必须有"让我决定"选项，用户选择后按推荐/默认策略回填，不再追问。回答写入 brief 的 `style-preference` / `theme-keywords` / `content-scope` / `difficulty-mode` 等字段
7. **所有 Gaps 补齐后，必须让 brief 明确写出 `delivery-target` 和 `must-have-features`**。若用户没明确说：
   - 短 query 默认 `playable-mvp`
   - 长规格 / 多系统需求默认 `feature-complete-lite`
8. **功能优先级明确后，AskUserQuestion 确认引擎选择**：

   **3D / 2D 维度先行判定（读 brief 的 `is-3d`，决定候选池）**：
   - `is-3d: false`（默认）→ 候选 4 选项，仅 2D 引擎
   - `is-3d: true`（用户明确要求 3D）→ 候选只有 `three` 一个，跳过引擎选择直接确认

   **问题：目标引擎**（决定后续生成路径；2D 路径）
   ```
   选项（is-3d=false 时显示）：
     - Phaser 3（最适合：控制闯关物理型、棋盘动画、反应型）
     - PixiJS v8（最适合：棋盘格子、消除、粒子视觉；需要本地 HTTP 服务器）
     - Canvas 2D（最稳：规则清晰的网格/问答/教育练习）
     - DOM+Tailwind（最稳：问答、剧情、教育练习，首轮正确率最高）
     - 让我决定（采用 `_index.json.best-fit` 推荐引擎）
   ```
   首选项标注「推荐」——从 `_index.json.best-fit` 查得；若用户选"让我决定"，直接采用该推荐引擎并写入 brief。

   **3D 路径**：is-3d=true 时直接告知并确认「将使用 Three.js (three@0.160)，适合第一人称/3D 平台/走迷宫；当前 3D 素材库建设中，可能用几何体占位」。

   > **视觉风格说明**：风格选择已移至语义澄清阶段（Step 6，读 semantic-clarify.md）。用户明确选择的 `style-preference` 和 `theme-keywords` 写入 brief；若用户选"让我决定"，只追加推荐关键词，让 Phase 2 从 brief 关键词自动推断 color-scheme（读 `references/common/color-palettes.yaml` 匹配色板）。

9. 写 `cases/${PROJECT}/docs/brief.md`，runtime + delivery-target + style-preference + theme-keywords 都记到 `ClarifiedBrief`
10. 更新 `cases/${PROJECT}/.game/state.json`：`understand.status = "completed"`

---

## Phase 2: GamePRD

**输出**：`cases/${PROJECT}/docs/game-prd.md`（通过 `check_game_prd.js` 退出 0）

1. 并行 Read：
   - `game_skill/skills/prd.md`
   - `game_skill/skills/strategy.md`
   - `game_skill/skills/references/common/game-aprd-format.md`
   - `game_skill/skills/references/common/visual-styles.md`
   - `game_skill/skills/references/common/color-palettes.yaml`
   - `game_skill/skills/references/common/support-levels.md`
   - `game_skill/skills/references/engines/_index.json`
   - `cases/${PROJECT}/docs/brief.md`
2. 按 10 章节生成 `cases/${PROJECT}/docs/game-prd.md`；其中 front-matter 必须按 `visual-styles.md` 的确定性打分规则，从 brief/theme-keywords 匹配 `color-palettes.yaml`，写入完整 `color-scheme` 段；同时消费 ClarifiedBrief：`style-preference` / `theme-keywords` → `color-scheme`，`content-scope` → `@resource` / `@level` / §8，`difficulty-mode` → `@rule` / `@level` / §3，追加的 `must-have-features` → front-matter / §3
3. **`@rule.effect` 必须伪代码风格**（格式规范强制；违反会被 check 阻断）
4. 末尾 strategy 回写：`delivery-target` / `must-have-features` / `support-level` / `engine-plan` / `mvp-scope` / `risk-note`
5. 跑 `node game_skill/skills/scripts/check_game_prd.js cases/${PROJECT}/docs/game-prd.md --log ${LOG_FILE}`
6. 退出 0 → state.json `prd.status = completed`；否则修复（≤5 轮）
7. **自动产生 profile skeleton**（Phase 5 会用到；现在生成避免 Phase 5 临场手搓）：
   ```bash
   SKEL=game_skill/skills/scripts/profiles/${PROJECT}.skeleton.json
   node game_skill/skills/scripts/extract_game_prd.js \
     cases/${PROJECT}/docs/game-prd.md \
     --profile-skeleton ${SKEL}
   ```
   skeleton 内容：每条 `@check(layer: product)` 和 `@constraint(kind:hard-rule)` 变成一条 assertion stub，含 `check_id` / `hard_rule_id` 反向绑定和 `prd_hash`。Phase 5 只需要补 `setup` / `expect` 的真实判定，最终落地为 `profiles/${PROJECT}.json`。
   > skeleton 文件永远是 `.skeleton.json` 后缀，不会覆盖手工调好的 `${PROJECT}.json`。Phase 5 合并时用 `diff` 比对两者。
8. 若 `support-level: 暂不支持` → 停下报告用户

---

## Phase 3: Expand（始终必做）

**输出**：`cases/${PROJECT}/specs/{scene,rule,data,assets,event-graph,implementation-contract}.yaml`

事务语义：5 个 expander 先写到 `specs/.pending/*.yaml`；**全部成功**后主 agent 运行 `generate_implementation_contract.js` 生成第 6 个 `.pending/implementation-contract.yaml`。6 份全部通过 gate 后一次性 `mv` 到 `specs/`。任一子任务失败，已完成的文件保留在 `.pending/` 下供下次恢复时跳过重算，其他未完成子任务继续重跑。

1. 跑 `node game_skill/skills/scripts/extract_game_prd.js cases/${PROJECT}/docs/game-prd.md --list`
2. Read `game_skill/skills/expand.md` 获取 yaml 模板
3. `mkdir -p cases/${PROJECT}/specs/.pending`；标记 expand 进入 running：
   ```bash
   node -e "
   import('./game_skill/skills/scripts/_state.js').then(m => {
     let st = m.readState('cases/${PROJECT}/.game/state.json');
     st = m.markPhase(st, 'expand', 'running');
     m.writeState('cases/${PROJECT}/.game/state.json', st);
   })
   "
   ```
4. **同一 turn 内并发**发起 5 个 Agent 调用（subagent_type 都是 `game-gameplay-expander`），prompt 中把输出路径指向 `specs/.pending/`：
   - prompt 1: `【维度】scene\n【PRD】cases/${PROJECT}/docs/game-prd.md\n【输出】cases/${PROJECT}/specs/.pending/scene.yaml`
   - prompt 2: `【维度】rule\n【PRD】cases/${PROJECT}/docs/game-prd.md\n【输出】cases/${PROJECT}/specs/.pending/rule.yaml`
   - prompt 3: `【维度】data\n【PRD】cases/${PROJECT}/docs/game-prd.md\n【输出】cases/${PROJECT}/specs/.pending/data.yaml`
   - prompt 4: `【维度】assets\n【PRD】cases/${PROJECT}/docs/game-prd.md\n【输出】cases/${PROJECT}/specs/.pending/assets.yaml`
   - prompt 5: `【维度】event-graph\n【PRD】cases/${PROJECT}/docs/game-prd.md\n【参考】game_skill/skills/references/common/game-systems.md 契约速查表\n【输出】cases/${PROJECT}/specs/.pending/event-graph.yaml`
5. 每个子 agent 返回后，主 agent 用 `markSubtask` 更新其状态：
   ```bash
   # 成功
   node -e "
   import('./game_skill/skills/scripts/_state.js').then(m => {
     let st = m.readState('cases/${PROJECT}/.game/state.json');
     st = m.markSubtask(st, 'scene', 'completed', { output: 'specs/.pending/scene.yaml' });
     m.writeState('cases/${PROJECT}/.game/state.json', st);
   })
   "
   # 失败
   node -e "
   import('./game_skill/skills/scripts/_state.js').then(m => {
     let st = m.readState('cases/${PROJECT}/.game/state.json');
     st = m.markSubtask(st, 'scene', 'failed', { error: '<摘要>' });
     m.writeState('cases/${PROJECT}/.game/state.json', st);
   })
   "
   ```
6. 5 份都 `completed` 后，生成增强契约层并标记第 6 个 subtask：
   ```bash
   node game_skill/skills/scripts/generate_implementation_contract.js cases/${PROJECT}/ \
     --out specs/.pending/implementation-contract.yaml
   node -e "
   import('./game_skill/skills/scripts/_state.js').then(m => {
     let st = m.readState('cases/${PROJECT}/.game/state.json');
     st = m.markSubtask(st, 'implementation-contract', 'completed', { output: 'specs/.pending/implementation-contract.yaml' });
     m.writeState('cases/${PROJECT}/.game/state.json', st);
   })
   "
   ```
7. 6 份都 `completed` 后，**原子提交**：把 `.pending/*.yaml` mv 到 `specs/` 并调 `commitExpand`：
   ```bash
   mv cases/${PROJECT}/specs/.pending/*.yaml cases/${PROJECT}/specs/
   rmdir cases/${PROJECT}/specs/.pending
   node -e "
   import('./game_skill/skills/scripts/_state.js').then(m => {
     let st = m.readState('cases/${PROJECT}/.game/state.json');
     st = m.commitExpand(st);
     m.writeState('cases/${PROJECT}/.game/state.json', st);
   })
   "
   ```
8. 原子提交后立刻跑 Expand gate，全部通过才能进入 Codegen：
   ```bash
   node game_skill/skills/scripts/check_asset_selection.js cases/${PROJECT}/ --log ${LOG_FILE}
   node game_skill/skills/scripts/check_implementation_contract.js cases/${PROJECT}/ --stage expand --log ${LOG_FILE}
   ```
9. 任一失败 → 调 `markPhase(st, 'expand', 'failed')`，整阶段 failed，报用户不降级

---

## Phase 4: Codegen

**输出**：`cases/${PROJECT}/game/index.html`（必需）+ 可选 `cases/${PROJECT}/game/src/`

1. 读 GamePRD front-matter 的 `runtime`，再从 `_index.json.engines[]` 找到对应 engine 条目；`guide`、`template`、`default-run-mode`、`version-pin` 都以该条目为准
2. Read `game_skill/skills/codegen.md` + `_index.json` 中该 engine 的 `guide` + `template` 目录（至少 `index.html`，若有 `src/` 也一并读取）
3. **复制 template 整个目录**：
   ```bash
   # ENGINE_TEMPLATE 来自 _index.json，例如 dom-ui -> engines/dom/template/
   cp -R game_skill/skills/references/${ENGINE_TEMPLATE}/. cases/${PROJECT}/game/
   ```
4. 启动 Agent（subagent_type: `game-engine-codegen`），prompt 格式：
   ```
   【运行时】{runtime}
   【运行模式】{run-mode}
   【配色方案】{color-scheme}   ← 从 PRD front-matter 读 color-scheme 段（palette-id + 硬值），由 Phase 2 自动推断
   【交付档位】{delivery-target}
   【必须保留功能】{must-have-features}
   【PRD】cases/${PROJECT}/docs/game-prd.md
   【Specs】cases/${PROJECT}/specs/*.yaml
   【Implementation Contract】cases/${PROJECT}/specs/implementation-contract.yaml
   【目标目录】cases/${PROJECT}/game/
   【硬约束】
     - 所有 @constraint(kind:hard-rule) 必须在代码里有 // @hard-rule(...) 注释
     - 必须暴露 window.gameState
     - RUN=file 时，禁止依赖本地 ES module / 相对 import
     - RUN=local-http 时，允许 src/*.js 和 import/export 跨文件
     - CDN pin 主版本，禁 @latest
     - 配色严格按 PRD color-scheme 段的硬值（字体/主色/背景/圆角/阴影），不得自创配色
     - 不得静默删除 must-have-features；若做不到，必须返回失败并把冲突写清楚
     - 必须按 implementation-contract.yaml 的 asset-bindings 渲染 required local-file；禁止 manifest 注册后业务代码不消费
     - Phaser 必须在 preload 阶段注册素材，禁止在 create 阶段 scene.load.start()
   ```
5. 返回后跑自检：
   ```bash
   # check_project 会链式运行 implementation-contract / asset-selection / asset-usage gate
   node game_skill/skills/scripts/check_project.js cases/${PROJECT}/game/ --log ${LOG_FILE}
   node game_skill/skills/scripts/check_game_boots.js cases/${PROJECT}/game/ --log ${LOG_FILE}
   ```
6. 两条都退出 0 → completed；否则修复 ≤3 轮

---

## Phase 5: Verify + Deliver

**输出**：`cases/${PROJECT}/eval/report.json` + `cases/${PROJECT}/docs/delivery.md`

1. 冒烟（≤2 轮）：`node game_skill/skills/scripts/check_game_boots.js cases/${PROJECT}/game/ --log ${LOG_FILE}`
2. 工程侧（≤3 轮）：`node game_skill/skills/scripts/check_project.js cases/${PROJECT}/game/ --log ${LOG_FILE}`
3. 产品侧（≤10 轮）：`node game_skill/skills/scripts/check_playthrough.js cases/${PROJECT}/game/ --profile ${PROJECT} --log ${LOG_FILE}`
   - profile 在 `game_skill/skills/scripts/profiles/` 下，若缺少需先创建
   - **profile 必须覆盖 PRD 中所有 `@check(layer: product)` 条目**（脚本会自动校验，覆盖不足退出码 4）
   - **profile 必须包含至少一条交互类 assertion**（带 click/eval setup 的），纯静态状态检查不够
   - **退出码 4 不进入修复循环**：暂停，补全 profile assertions 后重新运行（不算在 10 轮内）
   - 创建/补充 profile 时，逐条对照 PRD 的 `@check` 列表：
     - 每个 `@check(layer: product)` 必须有对应 assertion
     - 核心交互类 check 的 assertion 必须有真实的 setup 操作步骤（不能只查初始状态）
4. 合规审计（≤2 轮）：`node game_skill/skills/scripts/check_skill_compliance.js cases/${PROJECT} --log ${LOG_FILE}`
   - 兜底 spec ↔ code 绑定（implementation-contract、local-file 素材引用率、visual 动词覆盖、scene-transitions 闭环、state schema）
   - 退出码 0 = 合规（总分 ≥ 70 且无 error），否则进入修复循环

5. **修复循环（严格流程，每轮 3 步，不可跳过任何一步）**：

   校验脚本返回非 0 时，进入修复循环。**每一轮修复必须严格执行以下 3 步**：

   **Step A — 记录失败详情到日志**（在修改代码之前）：
   ```bash
   echo '{"timestamp":"'$(date -u +%FT%TZ)'","type":"fix-applied","phase":"verify","step":"<boot|project|playthrough>","round":<N>,"failures":["<逐条列出失败的 assertion id 或错误描述>"],"fix_description":"<计划修复什么>","files_changed":["<将要修改的文件>"]}' >> ${LOG_FILE}
   ```

   **Step B — 修改代码修复问题**

   **Step C — 重跑对应的 check 脚本**（带 `--log`，结果自动追加到日志）

   > ⚠ **Step A 是硬性要求**。不写日志就修代码 = 违规。这条日志是回溯问题根因的唯一依据。

5. 三层都通过后：
   - 生成 `cases/${PROJECT}/eval/report.json`（三层指标，含 `prd_check_coverage` 和 `has_interaction_assertions`）
   - 生成 `cases/${PROJECT}/docs/delivery.md`（简洁交付文档）
6. state.json `verify.status = completed`，done

---

## 中断/恢复

每次进入 skill 先通过 helper 读 `.game/state.json`：

```bash
node -e "
import('./game_skill/skills/scripts/_state.js').then(m => {
  const st = m.readState('cases/${PROJECT}/.game/state.json');
  console.log(JSON.stringify(m.isResumable(st), null, 2));
})
"
```

恢复规则：
- `resumable: true` + `resumeFrom: 'expand'` + `unfinishedSubtasks: [...]` → 只重跑未完成的 expander 子任务（其他已在 `specs/.pending/` 下保留）
- `resumable: true` + 其他阶段 → 从 `resumeFrom` 重启该阶段
- `resumable: false, reason: 'already done'` → 跳 "用户反馈修复" 流程
- `resumable: false, reason: 'previously failed...'` → 报告用户，**不自动重试**

---

## 用户反馈修复（生成完成后）

游戏交付后，用户可能报告 bug、提出数值调整或希望更换视觉风格。不同类型的反馈走不同的重跑路径 —— **不要**把所有反馈都当作 "code-bug" 处理，否则会出现"代码小修小补，规则 / 素材永远追不上"的死循环。

### Step 0 — 交付完成时先打快照（Phase 5 末尾做）

```bash
node game_skill/skills/scripts/prd_diff.js --snapshot cases/${PROJECT}
```

把当前 PRD 和 assets.yaml 的 hash 写到 state.json，作为后续 diff 的基线。

### Step 1 — 记录用户原始反馈（不可跳过）

```bash
echo '{"timestamp":"'$(date -u +%FT%TZ)'","type":"user-feedback","description":"<完整复制用户的原始描述，不要改写或摘要>"}' >> ${LOG_FILE}
```

### Step 2 — 分类反馈，决定走哪条路径

把用户反馈文本写到 `/tmp/fb.txt`，然后：

```bash
node game_skill/skills/scripts/prd_diff.js --classify cases/${PROJECT} /tmp/fb.txt
```

输出 JSON：`{ category, confidence, recommended_action }`。
- `category` ∈ `code-bug` / `design-change` / `art-change` / `ambiguous`
- `confidence < 0.5` 或 `category === "ambiguous"` → 用 `AskUserQuestion` 让用户明确是哪类；选项必须包含"让我决定（按 recommended_action 执行）"

分类矩阵：

| 分类 | 典型用词 | 重跑路径 | 预算 |
|---|---|---|---|
| **code-bug** | 闪退、没反应、console error、白屏、点了没用 | Phase 5 验证修复循环（不碰 PRD / specs） | ≤ 5 轮 |
| **design-change** | 太难、太简单、节奏、想改玩法 / 关卡数 / 胜负条件 | Phase 2 → Phase 3 → Phase 4 → Phase 5 全流程重跑 | 各层预算重置 |
| **art-change** | 风格、配色、换素材、太丑、动画 / 特效 | 只重跑 Phase 3.assets + Phase 4 素材绑定 + Phase 5 全套校验 | expand.subtasks.assets 重置 |
| **ambiguous** | 模糊 | AskUserQuestion 澄清 | — |

### Step 3 — 按路径重跑

**code-bug**：

```bash
# 只跑 Phase 5 的修复循环
node game_skill/skills/scripts/check_game_boots.js cases/${PROJECT}/game/ --log ${LOG_FILE}
node game_skill/skills/scripts/check_project.js cases/${PROJECT}/game/ --log ${LOG_FILE}
node game_skill/skills/scripts/check_playthrough.js cases/${PROJECT}/game/ --profile ${PROJECT} --log ${LOG_FILE}
node game_skill/skills/scripts/check_skill_compliance.js cases/${PROJECT} --log ${LOG_FILE}
```
失败则进入常规修复循环（每轮先写 `fix-applied` 日志再改代码）。

**design-change**：

1. 在 PRD 上改 —— 推荐做法是**新建版本文件**保留历史：
   ```bash
   cp cases/${PROJECT}/docs/game-prd.md cases/${PROJECT}/docs/game-prd.v${N}.md
   # 编辑 game-prd.md 反映新设计
   ```
2. 重跑 Phase 2 的 check：`node game_skill/skills/scripts/check_game_prd.js cases/${PROJECT}/docs/game-prd.md`
3. 重新产 profile skeleton（`@check` 可能变了）：
   ```bash
   node game_skill/skills/scripts/extract_game_prd.js cases/${PROJECT}/docs/game-prd.md \
     --profile-skeleton game_skill/skills/scripts/profiles/${PROJECT}.skeleton.json
   ```
4. 重置 expand 阶段：
   ```bash
   node -e "
   import('./game_skill/skills/scripts/_state.js').then(m => {
     let st = m.readState('cases/${PROJECT}/.game/state.json');
     // 清空 5 个 subtask 和 codegen/verify
     for (const k of ['scene','rule','data','assets','event-graph']) st = m.markSubtask(st, k, 'pending');
     st = m.markPhase(st, 'expand', 'pending');
     st = m.markPhase(st, 'codegen', 'pending');
     st = m.markPhase(st, 'verify', 'pending');
     m.writeState('cases/${PROJECT}/.game/state.json', st);
   })
   "
   ```
5. 继续按 Phase 3 → 4 → 5 的正常流程跑（`isResumable` 会告诉你从哪继续）。

**art-change**：

1. 改 `cases/${PROJECT}/docs/game-prd.md` 的 `color-scheme` 或在 `specs/assets.yaml` 换包；**不改**玩法 rule
2. 只重置 assets 子任务：
   ```bash
   node -e "
   import('./game_skill/skills/scripts/_state.js').then(m => {
     let st = m.readState('cases/${PROJECT}/.game/state.json');
     st = m.markSubtask(st, 'assets', 'pending');
     st = m.markPhase(st, 'expand', 'running');
     m.writeState('cases/${PROJECT}/.game/state.json', st);
   })
   "
   ```
3. 单独重跑 assets expander（`game-gameplay-expander` 子 agent，维度 = assets）
4. 重跑 `generate_registry.js` 产出新 manifest
5. 重跑 `check_project.js`（含素材 gate）、`check_game_boots.js`、`check_skill_compliance.js` 和 `check_playthrough.js`

### Step 4 — 验证反馈有没有被真正解决

不管走哪条路径，重跑完后都要写 `user-fix` 日志：

```bash
echo '{"timestamp":"'$(date -u +%FT%TZ)'","type":"user-fix","category":"<code-bug|design-change|art-change>","round":<N>,"description":"<改了什么>","files_changed":["<文件列表>"]}' >> ${LOG_FILE}
```

最后可用 `prd_diff --diff` 确认实际改动面符合预期：

```bash
node game_skill/skills/scripts/prd_diff.js --diff cases/${PROJECT}
# recommendation 字段：code-only / art-only / design-only / mixed
# 跟 Step 2 的 category 应该吻合，否则走错了路径
```

> ⚠ **Step 1 / Step 2 是硬性要求**。不记录、不分类直接改代码 = 违规。修复后发现日志中缺 user-feedback 或 user-fix 条目 = 需要补录。

---

## 禁止事项

- ❌ 跨阶段并发 Agent 调用
- ❌ 失败时用降级产出继续下一阶段
- ❌ 跳过 AskUserQuestion 引擎选择步骤（必须让用户选择，或选择"让我决定"授权系统采用推荐引擎）
- ❌ 硬编码引擎名（一切通过 `_index.json` 读）
- ❌ `@latest` / 不 pin 的 CDN
- ❌ 漏 `window.gameState` 暴露

---

## 端到端示例

用户：「帮我做一下 test/word.md 里的游戏」

```
Agent 我：
1. 读 test/word.md → 内容是「帮我生成一个面向小学生的单词消消乐游戏」
2. Step 0: cat .game/state.json → NEW_PROJECT
3. Phase 1:
   - Read SKILL_DIR/prd.md, clarify.md, game-aprd-format.md, _index.json
   - 写 docs/brief.md（推断 genre=edu-practice, platform=web, mode=单机）
   - AskUserQuestion 让用户选引擎 → 用户选 DOM+Tailwind
   - 回写到 ClarifiedBrief.runtime=dom-ui，更新 state.json
4. Phase 2: 生成 docs/game-prd.md，末尾 strategy 回写，跑 check_game_prd.js 退出 0
5. Phase 3: 并发 5 个 game-gameplay-expander，产 scene/rule/data/assets/event-graph 五份 specs；随后主 agent 生成 implementation-contract.yaml
6. Phase 4: cp 模板到 game/，启 game-engine-codegen 填玩法
7. Phase 5: check_game_boots + check_project + check_playthrough + check_skill_compliance，产 report.json + delivery.md
8. task_done: "单词消消乐已生成。open cases/word-match-lite/game/index.html 可体验。"
```
