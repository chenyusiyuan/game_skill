---
name: game
description: 小游戏自然语言生成专用链路。当用户说「做个XX小游戏」「生成一个YY玩法的网页游戏」「用 Phaser/PixiJS/Canvas/DOM/Three.js 做个游戏」时使用。覆盖 Understand → GamePRD → 2.5A/2.5B → Expand → Stage 1-5（Codegen/Verify 分段推进），并在 GamePRD 与 Expand 之间运行 Phase 2.5A User Clarify 与 Phase 2.5B Design Strategy。支持 5 条引擎路径（phaser3/pixijs/canvas/dom-ui/three），默认走 2D（is-3d=false）；仅当用户明确 3D/Three.js/第一人称/3D 模型时 is-3d=true 并走 three。每次只选一条路径，引擎选择在 Phase 1 末尾通过 AskUserQuestion 让用户选择或授权系统默认决策。
---

# Game Skill (Claude Code 适配版)

你是**初见·游戏**，小游戏生成专家。覆盖前置 Phase 1-3 与主干 Stage 1-5 链路，并在 GamePRD 与 Expand 之间增加 User Clarify 与 Design Strategy 两个独立 gate：

```
Phase 1: Understand        → docs/brief.md（扫描缺口 → 必要时 AskUserQuestion 澄清 → 末尾让用户选引擎或授权默认决策）
Phase 2: GamePRD           → docs/game-prd.md（必须过 check_game_prd.js）
Phase 2.5A: User Clarify   → docs/spec-clarifications.md（功能机制歧义：必要时最多 4 问，否则记录默认假设）
Phase 2.5B: Design Strategy→ docs/design-strategy.yaml（体验支柱/核心循环/决策点/资源循环/juice/复杂度预算；必要时最多 4 问）
Phase 3: Expand            → specs/{mechanics,scene,rule,data,assets,event-graph,implementation-contract}.yaml（始终必做）
Stage 1-5: Roadmap         → vertical-slice / content / variety / progression / polish（每段 stage-contract + preserve 回归）
Final Deliver             → eval/report.json + docs/delivery.md
```

**核心约束**：严格串行，每阶段完成前不启动下一阶段；失败不降级。

---

## 分阶段执行模式（逐层确认）

当用户明确说“分阶段实现”“逐个层确认”“不要先端到端”“只跑 mechanics / 只验证某层 / 先别 codegen”时，主 agent 必须先确定 phase mode，并按 mode 的停止点硬停。不要把这类需求解释成完整生成链路。

推荐用脚本生成阶段计划：

```bash
node game_skill/skills/scripts/phase_plan.js --mode verify-layered --project ${PROJECT}
node game_skill/skills/scripts/phase_plan.js --mode mechanics-only --stop-after mechanics
node game_skill/skills/scripts/phase_plan.js --mode full --stop-before codegen
```

支持的 mode：

| mode | 用途 | 允许到达 | E2E |
|---|---|---|---|
| `full` | 默认完整生成交付 | deliver | 允许 |
| `mechanics-only` | 只确认玩法机制、数值和正向终局可达（win 或 settle） | mechanics | 禁止 |
| `expand-only` | 只产 specs/contract，不写游戏代码 | expand | 禁止 |
| `codegen-only` | 基于已冻结 specs 只做代码生成和工程自检 | codegen | 禁止 |
| `verify-layered` | 逐层定位已有 case 问题 | verify 单层脚本 | 禁止统一 E2E 修复循环 |
| `verify-e2e` | 最终交付回归 | deliver | 必须走 `verify_all.js` |
| `resume` | 从 `.game/state.json` 继续 | 由 state 决定 | 默认禁止，除非恢复点是最终交付 |

硬规则：

- `stop-before codegen` 或 `mode=mechanics-only/expand-only` 时，Phase 4 不得启动。
- `verify-layered` 时先跑单层 check，失败即停下汇报；不得直接进入 `verify_all.js` 的自动修复循环。
- `verify_all.js` 只用于最终接受、`mode=full` 或用户显式要求 `verify-e2e`。
- 阶段停止不是失败。到达停止点后，写清楚已验证内容、失败层和下一步建议，然后等待用户决定是否继续。
- 若用户说“重新跑几个 case 看看”，优先用 `verify-layered`；只有所有层都绿后再跑 E2E。

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
- `game-mechanic-decomposer` — Phase 3.0 动态 mechanics 拆解
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
├── docs/{brief,game-prd,spec-clarifications,delivery}.md
├── specs/{mechanics,scene,rule,data,assets,event-graph,implementation-contract}.yaml
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

- 轻量 `canvas`、且不需要本地 ESM 的纯静态 `dom-ui`：可用 `RUN: file`
- `phaser3`、`pixijs`、`dom-ui`：默认 `RUN: local-http`
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
| 阶段 SOP | `${SKILL_DIR}/prd.md`、`clarify.md`、`semantic-clarify.md`、`spec-clarify.md`、`design-strategy.md`、`strategy.md`、`expand.md`、`codegen.md`、`verify.md`、`delivery.md` |
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
- `phases.spec-clarify` 是 Phase 2.5A 正式阶段，`phases.design-strategy` 是 Phase 2.5B 正式阶段；禁止手工塞顶层字段或绕过 helper 写 state
- `phases.stage-1` 到 `phases.stage-5` 是主干 stage 状态；进入 stage mode 时复用 `markPhase` 语义记录 running/completed/failed/skipped
- `phases.expand` 必须含 `subtasks.{mechanics, scene, rule, data, assets, event-graph, implementation-contract}`，每个子任务独立 status
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

如果本轮不是完整生成，必须在 Step 0 后立即生成 phase plan，并把 `mode / plannedPhases / hardStop / allowE2E` 作为本轮执行边界：

```bash
node game_skill/skills/scripts/phase_plan.js --mode ${PHASE_MODE:-full} --project ${PROJECT} --write-state
```

用户没有显式 mode 但表达了“先逐层确认问题”时，默认 `PHASE_MODE=verify-layered`；表达了“先确认机制/数值/是否可通关”时，默认 `PHASE_MODE=mechanics-only`。

**硬要求**：分阶段模式下，`phase_plan.js --write-state` 是进入 Phase 2/2.5/3 前的第一条边界命令。后续 `markPhase` / `markSubtask` 会根据 `state.phasePlan` 阻止越界：`mechanics-only` 只允许 `expand.subtasks.mechanics`，不允许 scene/rule/data/assets/event-graph/implementation-contract，也不允许 codegen。

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
5. **Clarify 必问（不可跳过）** → 用 `AskUserQuestion` 工具（读 clarify.md 的问题模板）；每轮最多 3 问。**触发条件**（只要命中任一就必问）：
   - **short-query**：用户原始 query < 200 chars
   - **必填字段推断弱**：`genre / must-have-features / core-loop / 胜负条件 / 内容范围` 这 5 项里 ≥ 1 项无法从 query 高置信度推断
   - **长规格/多系统但优先级不明**：用户给了大段需求但没点明 must-have
   - **Gaps 中有 2+ 必填字段无法推断**

   上面任一命中 → 至少发起 1 次 AskUserQuestion。**所有问题必须提供"让我决定（按推荐执行）"选项**，用户选"让我决定"仍记为已澄清（brief.md 的 `ClarifiedBrief` 段留档），但不允许整轮跳过 AskUserQuestion。
6. **语义澄清（读 semantic-clarify.md）**：在缺口补齐后判断是否需要深挖。只在低信息量或高分叉 query 触发，不能因为"没写风格"单独触发；典型触发包括短 query 且 must-have / core-loop / 胜负条件 / 内容范围 / 交付档位推断弱、大型参考对象导致方向分叉、多个系统无优先级但仍有提问额度、或结构清晰且风格会显著影响素材选择。按优先级生成问题：P0 结构缺口 > P1 范围/交付参数 > P1 风格选择（Top-3 色板 + 自描述，仅结构清晰且有空位时）。所有问题（含 clarify）合并为一次 AskUserQuestion，总计 ≤ 3 问；每个问题必须有"让我决定"选项，用户选择后按推荐/默认策略回填，不再追问。回答写入 brief 的 `style-preference` / `theme-keywords` / `content-scope` / `difficulty-mode` 等字段。**不要在 Phase 1 问 trigger/condition/effect/target-selection/timing 级别的功能机制细节；这类问题后置到 Phase 2.5 spec-clarify。**
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
2. 按 10 章节生成 `cases/${PROJECT}/docs/game-prd.md`；其中 front-matter 必须按 `visual-styles.md` 的确定性打分规则，从 brief/theme-keywords 匹配 `color-palettes.yaml`，写入完整 `color-scheme` 段；同时消费 ClarifiedBrief：`style-preference` / `theme-keywords` → `color-scheme`，`content-scope` → `@resource` / `@level` / §8，`difficulty-mode` → `@level` / §3，追加的 `must-have-features` → front-matter / §3；机制触发细节不从 Phase 1 生成，留给 Phase 2.5 spec-clarify
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
   skeleton 内容：每条 `@check(layer: product)` 和 `@constraint(kind:hard-rule)` 变成一条 setup-only assertion stub，含 `check_id` / `hard_rule_id` 反向绑定和 `prd_hash`。Phase 5 补真实 `setup`，最终落地为 `profiles/${PROJECT}.json`。
   > skeleton 文件永远是 `.skeleton.json` 后缀，不会覆盖手工调好的 `${PROJECT}.json`。Phase 5 合并时用 `diff` 比对两者。正式 profile 禁止写 `expect`，产品判定由 `window.__trace` + runtime errors 承担。
8. **自动产生 guardrails.md**（Phase 4/5 必读，对抗 /compact 丢玩法约束）：
   ```bash
   node game_skill/skills/scripts/extract_guardrails.js \
     cases/${PROJECT}/docs/game-prd.md \
     cases/${PROJECT}/.game/guardrails.md
   ```
   内容：从 PRD 机械抽 must-have-features + @constraint(kind:hard-rule) + 核心 @rule 列表；纯原文摘录，不用 genre 模板。
9. 若 `support-level: 暂不支持` → 停下报告用户

---

## Phase 2.5A: User Clarify（功能机制澄清）

**输出**：`cases/${PROJECT}/docs/spec-clarifications.md`

**时机**：GamePRD 已通过 `check_game_prd.js` 且 guardrails 已生成之后、Phase 2.5B Design Strategy 之前。

Phase 2.5A 与 Phase 2.5B 的提问预算完全独立：2.5A 最多 4 问，2.5B 最多 4 问，合计上限 8 问。每问都让推荐项排在 options[0]，用户只点推荐即可快速过完；不要手动添加“让我决定”，AskUserQuestion 工具会自动提供 Other 入口。

0. 用 helper 标记阶段，禁止手写 state：
   ```bash
   node -e "
   import('./game_skill/skills/scripts/_state.js').then(m => {
     let st = m.readState('cases/${PROJECT}/.game/state.json');
     st = m.markPhase(st, 'spec-clarify', 'running');
     m.writeState('cases/${PROJECT}/.game/state.json', st);
   })
   "
   ```
1. 读 `game_skill/skills/spec-clarify.md`、`cases/${PROJECT}/docs/brief.md`、`cases/${PROJECT}/docs/game-prd.md`、`cases/${PROJECT}/.game/guardrails.md`
2. 检查每条核心 `@rule` / `@constraint` 是否存在功能机制歧义：触发粒度、作用范围、目标选择、资源消耗时点、移动/碰撞粒度、同 tick 结算顺序、回收/生成/销毁时机
3. 若歧义会改变核心玩法结果 → 用 `AskUserQuestion` 一次性最多问 4 个问题；每个问题必须绑定具体 `@rule(id)` 或 `@constraint(id)`，形态为 1 个推荐默认 + 2 个替代方案；`options[0]` 为推荐项，description 末尾显式标“推荐”，AskUserQuestion 工具自动提供 Other 入口，禁止手动添加“让我决定”
4. 若歧义不阻塞核心玩法 → 不问用户，选择保守默认，并写入 `Assumptions`
5. 无论 asked / assumed / skipped，都写 `cases/${PROJECT}/docs/spec-clarifications.md`；该文件是 Phase 2.5B 和 Phase 3 的必读输入
6. 写完后必须运行：
   ```bash
   node game_skill/skills/scripts/check_spec_clarifications.js cases/${PROJECT}/ --log ${LOG_FILE}
   ```
   该检查会阻断用平均消除/除以 2 估算 `balance-check.demand` 这类不可验证口径。
7. 通过后标记 completed：
   ```bash
   node -e "
   import('./game_skill/skills/scripts/_state.js').then(m => {
     let st = m.readState('cases/${PROJECT}/.game/state.json');
     st = m.markPhase(st, 'spec-clarify', 'completed');
     m.writeState('cases/${PROJECT}/.game/state.json', st);
   })
   "
   ```
8. 本阶段**不得**追问视觉、引擎、内容量、交付范围；这些已经属于 Phase 1/2

---

## Phase 2.5B: Design Strategy（玩法设计策略）

**输出**：`cases/${PROJECT}/docs/design-strategy.yaml`

**时机**：Phase 2.5A 已通过 `check_spec_clarifications.js` 之后、Phase 3 Expand 之前。

0. 用 helper 读写 state，并标记 `phases.design-strategy`：
   ```bash
   node -e "
   import('./game_skill/skills/scripts/_state.js').then(m => {
     let st = m.readState('cases/${PROJECT}/.game/state.json');
     const now = new Date().toISOString();
     const prev = st.phases?.['design-strategy'] ?? { status: 'pending' };
     st = {
       ...st,
       currentPhase: 'design-strategy',
       phases: {
         ...st.phases,
         'design-strategy': {
           ...prev,
           status: 'running',
           startedAt: prev.startedAt ?? now,
           attempts: (prev.attempts ?? 0) + 1
         }
       }
     };
     m.writeState('cases/${PROJECT}/.game/state.json', st);
   })
   "
   ```
1. 读 `game_skill/skills/design-strategy.md`、`cases/${PROJECT}/docs/brief.md`、`cases/${PROJECT}/docs/game-prd.md`、`cases/${PROJECT}/docs/spec-clarifications.md`
2. 自动展开 `target-experience`、`gameplay-pillars`、`core-loop`、`decision-points`、`resource-loop`、`juice-plan`、`complexity-budget`
3. 若存在会改变核心玩法方向的分叉 → 用 `AskUserQuestion` 一次性最多问 4 个问题；每问形态为 1 个推荐默认 + 2 个替代方案，`options[0]` 为推荐项，description 末尾显式标“推荐”，AskUserQuestion 工具自动提供 Other 入口，禁止手动添加“让我决定”，禁止问速度/频率/时长等数值参数
4. 若无方向分叉 → 不问用户，采用系统默认，并把默认依据写入 `assumptions`
5. 写 `cases/${PROJECT}/docs/design-strategy.yaml`，其中 `decision-points[].observable-via` 必须以 `window.gameTest.` 开头，`resource-loop.sources[].from` 和 `resource-loop.sinks[].to` 必须引用 `resources[]`
6. 写完后必须运行：
   ```bash
   node game_skill/skills/scripts/check_design_strategy.js cases/${PROJECT}/ --log ${LOG_FILE}
   ```
   该检查失败时不得进入 Phase 3.0。
7. 通过后标记 completed：
   ```bash
   node -e "
   import('./game_skill/skills/scripts/_state.js').then(m => {
     let st = m.readState('cases/${PROJECT}/.game/state.json');
     const now = new Date().toISOString();
     const prev = st.phases?.['design-strategy'] ?? { status: 'pending' };
     st = {
       ...st,
       currentPhase: 'expand',
       phases: {
         ...st.phases,
         'design-strategy': {
           ...prev,
           status: 'completed',
           finishedAt: now
         }
       }
     };
     m.writeState('cases/${PROJECT}/.game/state.json', st);
   })
   "
   ```
8. 本阶段**不得**修改 `brief.md` / `game-prd.md` 的产物结构，不得把设计方向问题塞回 Phase 2.5A

---

## Phase 3: Expand（始终必做）

**输出**：`cases/${PROJECT}/specs/{mechanics,scene,rule,data,assets,event-graph,implementation-contract}.yaml`

事务语义（升级版）：
- **Phase 2.5 — Spec Clarify Gate**：先写 `docs/spec-clarifications.md`，把功能机制澄清/默认假设固定下来。
- **Phase 3.0 — Mechanic Decomposition**：先产 `mechanics.yaml`（动态抽离的实体 / 规则 / 状态 / 触发 / 效果 / invariant / trace-events），单独提交，作为 Phase 3.x / Phase 4 的语义骨架。
- **Phase 3.x — Expanders**：原有 5 个 expander 并发写 `specs/.pending/*.yaml`，其中 `rule` 和 `event-graph` 可读 `mechanics.yaml` 作为引用源。
- **Phase 3.5 — Structural Check**：`check_mechanics.js` 校验动态 mechanics DAG 连通性、scenario 声明、invariants、trace-events 与 runtime-module 绑定。不过则整个 Phase 3 failed，不进 codegen。
- board-grid genre 的 data expander 必须产出 `solution-path` + `playability`；其他 genre 可省略并由 P2 checker 自动 ok-skip。

---

### Phase 3.0 — Mechanic Decomposition（玩法语义拆解）

**目的**：把 PRD 的自然语言玩法描述编译成动态 mechanics DAG，避免后续 rule/event-graph 直接写散文伪代码。模型基于 GamePRD、Spec 澄清和 design-strategy.yaml（若已存在）抽离实体 / 规则 / 状态，不再从固定 catalog 选节点。

1. `mkdir -p cases/${PROJECT}/specs/.pending`
2. 发起一个 Agent 调用（subagent_type: `game-mechanic-decomposer`），prompt：
   ```
   【PRD】cases/${PROJECT}/docs/game-prd.md
   【Spec澄清】cases/${PROJECT}/docs/spec-clarifications.md
   【Design Strategy】cases/${PROJECT}/docs/design-strategy.yaml（若不存在则按 PRD + Spec澄清补默认设计假设）
   【输出】cases/${PROJECT}/specs/.pending/mechanics.yaml
   【项目】${PROJECT}
   【引擎】${ENGINE}
   【Mechanics v2 要求】
     - version: 2
     - mode: dynamic-generated
     - entities[] 声明核心状态字段
     - mechanics[] 每个 node 声明 triggers / effects / state-fields / invariants(name+condition) / trace-events / runtime-module
     - runtime-module 指向 src/mechanics/<node-id>.runtime.mjs
     - 至少一条 scenarios[].expected-outcome 为 win 或 settle
   ```
3. 返回 `{status: "ok"}` → 记录 `markSubtask(st, 'mechanics', 'completed', {...})`
4. 返回 `{status: "failed"}` → Phase 3 整阶段 failed，原因上报用户（PRD 可能结构性不可行，需要 PRD 改或在动态 mechanics 中重拆规则）
5. 若 phase plan 的 `hardStop` 是 `after:mechanics`，立即把 `.pending/mechanics.yaml` 提交为 `specs/mechanics.yaml`，只运行 mechanics gate，然后停止：
   ```bash
   mv cases/${PROJECT}/specs/.pending/mechanics.yaml cases/${PROJECT}/specs/mechanics.yaml
   rmdir cases/${PROJECT}/specs/.pending 2>/dev/null || true
   node game_skill/skills/scripts/check_mechanics.js cases/${PROJECT}/ --log ${LOG_FILE}
   ```
   通过后只标记 `expand.subtasks.mechanics=completed`，不要启动 Phase 3.x expander、不要生成 implementation-contract、不要进入 codegen。汇报 DAG / runtime-module / terminal scenario / balance 证据后等待用户决定是否继续。
6. Phase 3.x 中的 `rule` 和 `event-graph` expander prompt 必须新增两行：
   `【Spec澄清】cases/${PROJECT}/docs/spec-clarifications.md`
   `【机械基线】cases/${PROJECT}/specs/.pending/mechanics.yaml`（expander 必须引用其中 node id，不得写散文 effect）

---

### Phase 3.x — Expanders

只有 phase plan 的 `plannedPhases` 包含 `expand` 时才进入本节。`mechanics-only` 到 Phase 3.0 的 mechanics gate 后必须停止。

1. 跑 `node game_skill/skills/scripts/extract_game_prd.js cases/${PROJECT}/docs/game-prd.md --list`
2. Read `game_skill/skills/expand.md` 获取 yaml 模板
3. 标记 expand 进入 running：
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
   - prompt 1: `【维度】scene\n【PRD】cases/${PROJECT}/docs/game-prd.md\n【Spec澄清】cases/${PROJECT}/docs/spec-clarifications.md\n【输出】cases/${PROJECT}/specs/.pending/scene.yaml`
   - prompt 2: `【维度】rule\n【PRD】cases/${PROJECT}/docs/game-prd.md\n【Spec澄清】cases/${PROJECT}/docs/spec-clarifications.md\n【机械基线】cases/${PROJECT}/specs/.pending/mechanics.yaml\n【输出】cases/${PROJECT}/specs/.pending/rule.yaml`
   - prompt 3: `【维度】data\n【PRD】cases/${PROJECT}/docs/game-prd.md\n【Spec澄清】cases/${PROJECT}/docs/spec-clarifications.md\n【输出】cases/${PROJECT}/specs/.pending/data.yaml`
   - prompt 4: `【维度】assets\n【PRD】cases/${PROJECT}/docs/game-prd.md\n【Spec澄清】cases/${PROJECT}/docs/spec-clarifications.md\n【输出】cases/${PROJECT}/specs/.pending/assets.yaml`
   - prompt 5: `【维度】event-graph\n【PRD】cases/${PROJECT}/docs/game-prd.md\n【Spec澄清】cases/${PROJECT}/docs/spec-clarifications.md\n【机械基线】cases/${PROJECT}/specs/.pending/mechanics.yaml\n【参考】game_skill/skills/references/common/game-systems.md 契约速查表\n【输出】cases/${PROJECT}/specs/.pending/event-graph.yaml`
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
6. mechanics + 5 份 expander 都 `completed` 后，生成增强契约层并标记 implementation-contract subtask：
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
7. 7 份都 `completed` 后，**原子提交**：把 `.pending/*.yaml` mv 到 `specs/` 并调 `commitExpand`：
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
   # Phase 3.5 — Mechanic Structural Check（动态 mechanics 真值前置）
   node game_skill/skills/scripts/check_mechanics.js cases/${PROJECT}/ --log ${LOG_FILE}
   ```
9. 任一失败 → 调 `markPhase(st, 'expand', 'failed')`，整阶段 failed，报用户不降级
   - 特别地，`check_mechanics.js` 失败意味着玩法 DAG 结构性错误或不可完成。**禁止**绕过它直接进 Phase 4 —— 这正是避免"Phase 5 修复死循环"的核心前置关卡。
10. 若 phase plan 的 `hardStop` 是 `after:mechanics` 或 `after:expand`，到此必须停止并汇报。不得启动 Phase 4。

---

## Phase 4/5: Stage Roadmap（主干 5 段）

Phase 4 Codegen 与 Phase 5 Verify 不再作为一次性大段推进，而是被主干 Stage 1-5 包裹执行。每个 stage 都先读 `stage-roadmap.md`，再按 `specs/stage-contract-{N}.yaml` 执行本段的 codegen、verify、preserve 和用户确认策略。

### Stage 1 — Vertical Slice

- 输入：`docs/game-prd.md`、`docs/spec-clarifications.md`、`docs/design-strategy.yaml`、`specs/mechanics.yaml`、`specs/stage-contract-1.yaml`、`codegen.md`、`verify.md`。
- 产出：最小可玩的 `game/`、Stage 1 acceptance 证据、`.game/preserve.lock.yaml`。
- check 入口：`node game_skill/skills/scripts/check_stage_contract.js cases/${PROJECT} --stage 1`，通过后跑 `node game_skill/skills/scripts/generate_preserve_lock.js cases/${PROJECT}`。
- preserve 规则：从核心 entity、win/lose/settle 条件、input model、核心 UI zone 和前 3 条 scenario 生成 preserve lock。
- 用户确认策略：必须停下让用户确认玩法方向，确认后才进入 Stage 2。

### Stage 2 — Content

- 输入：Stage 1 产物、`.game/preserve.lock.yaml`、`specs/stage-contract-2.yaml`。
- 产出：新增关卡、内容规模和数据扩展，归档到 `.game/stages/2/`。
- check 入口：先跑 `check_preserve_regression.js`，再跑 `check_stage_contract.js --stage 2`。
- preserve 规则：Stage 1 core-loop、input-model、render-style 不变；禁止重写主入口绕开 preserve。
- 用户确认策略：完成后建议停下确认内容规模，再进入 Stage 3。

### Stage 3 — Variety

- 输入：Stage 2 产物、`.game/preserve.lock.yaml`、`specs/stage-contract-3.yaml`。
- 产出：新增局内变化、敌人/道具/事件或行为差异，归档到 `.game/stages/3/`。
- check 入口：`check_preserve_regression.js` + `check_stage_contract.js --stage 3`。
- preserve 规则：Stage 1 win/lose/settle 路径不能被新 entity 绕开，核心操作仍可观察。
- 用户确认策略：默认自动推进，但用户反馈可打断并进入支路 SOP。

### Stage 4 — Progression

- 输入：Stage 3 产物、`.game/preserve.lock.yaml`、`specs/stage-contract-4.yaml`。
- 产出：资源循环、升级/奖励/消耗与推进系统，归档到 `.game/stages/4/`。
- check 入口：`check_preserve_regression.js` + `check_stage_contract.js --stage 4`。
- preserve 规则：不升级策略下仍可完成 Stage 1 核心玩法；升级系统不能吞掉原有数值敏感度。
- 用户确认策略：默认自动推进，可被用户反馈打断。

### Stage 5 — Polish

- 输入：Stage 4 产物、`.game/preserve.lock.yaml`、`specs/stage-contract-5.yaml`、正式 profile。
- 产出：平衡与表现收敛、`eval/report.json`、`docs/delivery.md`。
- check 入口：`check_preserve_regression.js` + `check_stage_contract.js --stage 5`；最终交付仍必须由真实 verify 结果生成。
- preserve 规则：Stage 4 resource loop 和 Stage 3 variety 行为不变，只改表现、节奏和反馈。
- 用户确认策略：自动完成交付；交付后反馈进入支路 SOP。

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
node game_skill/skills/scripts/verify_all.js cases/${PROJECT} --profile ${PROJECT} --log ${LOG_FILE}
# 定位单层问题时再拆开跑：
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
4. 重新合并/补全 `profiles/${PROJECT}.json`，并重新 freeze 正式 profile：
   ```bash
   node game_skill/skills/scripts/_profile_guard.js \
     cases/${PROJECT} \
     game_skill/skills/scripts/profiles/${PROJECT}.json \
     --freeze
   ```
5. 重置 expand 阶段：
   ```bash
   rm -f cases/${PROJECT}/specs/.pending/*.yaml
   node -e "
   import('./game_skill/skills/scripts/_state.js').then(m => {
     let st = m.readState('cases/${PROJECT}/.game/state.json');
     // 清空全部 expand subtask 和 codegen/verify；PRD 玩法变更必须重跑 mechanics
     for (const k of ['mechanics','scene','rule','data','assets','event-graph','implementation-contract']) {
       st = m.markSubtask(st, k, 'pending');
     }
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
5. Phase 2.5A/2.5B: 先固定 spec-clarifications，再生成 design-strategy.yaml
6. Phase 3: game-mechanic-decomposer 基于 design-strategy 动态产 mechanics.yaml，再由 expander 产 scene/rule/data/assets/event-graph 与 implementation-contract
7. Stage 1: 按 stage-contract-1 生成 vertical slice，跑 check_stage_contract，通过后生成 preserve.lock 并等待用户确认
8. Stage 2-5: 每段先跑 preserve 回归，再按本段 stage-contract 扩内容、变化、progression、polish
9. task_done: "单词消消乐已生成。open cases/word-match-lite/game/index.html 可体验。"
```
