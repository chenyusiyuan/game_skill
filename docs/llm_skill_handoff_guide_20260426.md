# Game Skill 链路接管手册（给另一个 LLM）

生成日期：2026-04-26
目标读者：接手 `/Users/bytedance/Project/game_skill` 的另一个 LLM / Agent
目标：读完本文后，能掌握当前 skill 的目录结构、端到端生成链路、阶段产物、子 agent 契约、关键脚本、校验门禁、常见失败和正确回退路径。

---

## 0. 先读结论

这个 repo 里的 `game_skill` 不是一个普通 prompt 集，而是一条小游戏生成流水线。它把用户自然语言需求转成：

1. `brief.md`
2. `game-prd.md`（Game APRD，唯一事实源）
3. `spec-clarifications.md`
4. `specs/*.yaml`（mechanics / scene / rule / data / assets / event-graph / implementation-contract）
5. `game/index.html` + `game/src/`
6. `eval/report.json`
7. `docs/delivery.md`

核心设计目标是：不要让 LLM 直接从 PRD 散文写代码，再靠测试脚本发现问题后自由修补；而是把玩法语义、素材语义、启动契约、验证证据前置成可检查的中间工件。

最重要的源文件是：

```text
game_skill/skills/SKILL.md                      # 主链路总控
game_skill/skills/prd.md                        # Phase 1 Understand
game_skill/skills/strategy.md                   # Phase 2 strategy 回写
game_skill/skills/spec-clarify.md               # Phase 2.5 机制澄清
game_skill/skills/expand.md                     # Phase 3 specs 展开
game_skill/skills/codegen.md                    # Phase 4 代码生成
game_skill/skills/verify.md                     # Phase 5 验证
game_skill/skills/delivery.md                   # 交付文档
game_skill/agents/*.md                          # 子 agent 契约
game_skill/skills/scripts/*.js                  # 所有机器门禁和 helper
game_skill/skills/references/common/*.md|yaml   # APRD / 通用系统 / 视觉 / 校验桥
game_skill/skills/references/engines/_index.json
game_skill/skills/references/mechanics/_index.yaml
```

**如果你是另一个 LLM，要执行 case 生成，优先读 `game_skill/skills/SKILL.md`。**
**如果你是另一个 LLM，要改链路能力，优先读本文 + 对应 phase SOP + 相关脚本。**

---

## 1. 仓库结构地图

### 1.1 Skill 主体

```text
game_skill/
├── agents/
│   ├── mechanic-decomposer.md
│   ├── gameplay-expander.md
│   ├── engine-codegen.md
│   └── game-checker.md
└── skills/
    ├── SKILL.md
    ├── prd.md
    ├── strategy.md
    ├── clarify.md
    ├── semantic-clarify.md
    ├── spec-clarify.md
    ├── expand.md
    ├── codegen.md
    ├── verify.md
    ├── delivery.md
    ├── references/
    ├── schemas/
    └── scripts/
```

### 1.2 Reference 层

```text
game_skill/skills/references/
├── common/
│   ├── game-aprd-format.md      # Game APRD 格式，PRD 唯一事实源语法
│   ├── game-systems.md          # 通用系统模块库
│   ├── visual-styles.md         # 视觉风格与素材消费约定
│   ├── color-palettes.yaml      # 色板硬值
│   ├── fx-presets.yaml          # 特效预设
│   ├── support-levels.md        # 支持等级判定
│   └── verify-hooks.md          # window.gameState / gameTest 等验证桥
├── engines/
│   ├── _index.json              # 引擎登记表
│   ├── _adding-new-engine.md
│   ├── _common/
│   │   ├── registry.spec.js
│   │   ├── fx.spec.js
│   │   └── test-hook.js
│   ├── canvas/guide.md + template/
│   ├── dom/guide.md + template/
│   ├── phaser3/guide.md + template/
│   ├── pixijs/guide.md + template/
│   └── three/guide.md + template/
└── mechanics/
    ├── _index.yaml
    ├── motion/
    ├── spatial/
    ├── logic/
    └── progression/
```

### 1.3 Script 层

`game_skill/skills/scripts/` 是链路的机器约束层。核心分组如下：

```text
state/log/run helpers:
  _state.js
  _logger.js
  _run_mode.js
  _asset_strategy.js
  _profile_guard.js

PRD / guardrails:
  check_game_prd.js
  extract_game_prd.js
  extract_guardrails.js
  prd_diff.js

Phase 3:
  check_mechanics.js
  generate_implementation_contract.js
  check_asset_selection.js

Phase 4:
  generate_registry.js
  check_project.js
  check_implementation_contract.js
  check_asset_usage.js
  check_asset_paths.js
  check_game_boots.js

Phase 5:
  check_playthrough.js
  check_skill_compliance.js
  freeze_specs.js
  verify_all.js

utility:
  render_case_report.js
  test/run.js
```

---

## 2. Case 目录和工件约定

任何生成项目必须写到：

```text
cases/{project-slug}/
```

禁止把 `docs/`、`specs/`、`game/`、`eval/`、`.game/` 直接写在 repo 根目录。

标准 case 结构：

```text
cases/{project-slug}/
├── docs/
│   ├── brief.md
│   ├── game-prd.md
│   ├── spec-clarifications.md
│   └── delivery.md
├── specs/
│   ├── mechanics.yaml
│   ├── scene.yaml
│   ├── rule.yaml
│   ├── data.yaml
│   ├── assets.yaml
│   ├── event-graph.yaml
│   └── implementation-contract.yaml
├── game/
│   ├── index.html
│   ├── package.json
│   └── src/
├── eval/
│   └── report.json
└── .game/
    ├── state.json
    ├── log.jsonl
    ├── guardrails.md
    └── freeze.json
```

### 2.1 state.json

`state.json` 由 `game_skill/skills/scripts/_state.js` 管理。不要手写 JSON。

关键 API：

```js
initState({ project, runtime, visualStyle, deliveryTarget })
readState(path)
writeState(path, state)
markPhase(state, phaseName, status, { error })
markSubtask(state, subtaskName, status, { output, error })
commitExpand(state)
isResumable(state)
```

状态阶段：

```text
understand -> prd -> expand -> codegen -> verify -> done
```

expand 子任务：

```text
mechanics
scene
rule
data
assets
event-graph
implementation-contract
```

### 2.2 log.jsonl

`log.jsonl` 是全链路 NDJSON 日志。脚本侧通过 `--log cases/{project}/.game/log.jsonl` 写入；agent 侧用 shell 追加。

常用事件类型：

```text
phase-start
phase-end
check-run
fix-applied
balance-check
user-feedback
user-fix
```

重要规则：修复循环改代码前必须先写 `fix-applied`，再改代码，再重跑对应 check。

### 2.3 run-mode

`game/index.html` 必须有：

```html
<!-- ENGINE: {runtime} | VERSION: ... | RUN: {file|local-http} -->
```

默认：

```text
dom-ui    -> file
canvas    -> file
phaser3   -> local-http
pixijs    -> local-http
three     -> local-http
```

`_run_mode.js` 负责解析 engine marker，并在 `local-http` 时自动启动临时静态服务器，server root 会向上找到同时包含 `assets/` 和 `cases/` 的项目根。

---

## 3. 全链路总览

```text
Phase 1: Understand
  input: 用户需求 / test/*.md / 上传素材
  output: docs/brief.md

Phase 2: GamePRD + Strategy
  input: brief.md + APRD 格式 + 引擎登记 + 色板/支持等级
  output: docs/game-prd.md + profile skeleton + guardrails.md

Phase 2.5: Spec Clarify
  input: game-prd.md + brief.md + guardrails.md
  output: docs/spec-clarifications.md

Phase 3: Expand
  3.0 mechanic-decomposer -> specs/.pending/mechanics.yaml
  3.x gameplay-expander 并发 -> scene/rule/data/assets/event-graph.yaml
  3.5 generate_implementation_contract -> implementation-contract.yaml
  gates -> check_asset_selection + check_implementation_contract --stage expand + check_mechanics
  output: specs/*.yaml

Phase 4: Codegen
  input: game-prd.md + specs/*.yaml + engine guide/template + guardrails.md
  output: game/index.html + src/
  gates: check_mechanics + check_project + check_game_boots

Phase 5: Verify + Deliver
  input: game/ + specs/ + profile + guardrails
  output: eval/report.json + docs/delivery.md
  gate: verify_all.js

用户反馈后:
  prd_diff.js --classify -> code-bug / design-change / art-change / ambiguous
```

---

## 4. Phase 1: Understand

源码入口：

```text
game_skill/skills/SKILL.md
game_skill/skills/prd.md
game_skill/skills/clarify.md
game_skill/skills/semantic-clarify.md
```

### 4.1 目标

把用户一句或一段自然语言，变成可供 GamePRD 使用的 `docs/brief.md`。

### 4.2 输出模板

```md
# Brief: {项目名}

## Raw Query
<用户原始输入>

## Inferred
- genre:
- platform:
- mode:
- reference-games:
- hard-rules:
- interaction:
- assets-hint:
- is-3d:

## Gaps
- ...

## ClarifiedBrief
- genre:
- platform:
- mode:
- core-loop:
- player-goal:
- must-have-features:
- nice-to-have-features:
- delivery-target:
- cut-preference:
- constraints:
- style-preference:
- theme-keywords:
- content-scope:
- difficulty-mode:
- suggested-runtime:
- is-3d:
- mvp-cut:
- project-slug:
```

### 4.3 澄清边界

Phase 1 只问产品边界：

- 必填字段缺口
- 功能优先级
- 交付档位
- 引擎选择
- 视觉风格（仅当影响素材选择）

Phase 1 不问机制细节：

- trigger 粒度
- condition
- effect
- target-selection
- timing/order
- resource lifecycle
- movement/collision

这些都后置到 Phase 2.5。

### 4.4 关键规则

- `project-slug` 必须加数字或时间戳后缀，避免覆盖旧 case。
- 用户 query 很短或功能优先级不清时，必须问。
- 每个 AskUserQuestion 都必须有“让我决定”选项。
- `is-3d` 默认 false；只有明确 3D 信号时 true。
- 2D 引擎候选：`phaser3 / pixijs / canvas / dom-ui`。
- 3D 只允许 `three`。

---

## 5. Phase 2: GamePRD + Strategy

源码入口：

```text
game_skill/skills/SKILL.md
game_skill/skills/strategy.md
game_skill/skills/references/common/game-aprd-format.md
game_skill/skills/references/common/color-palettes.yaml
game_skill/skills/references/common/visual-styles.md
game_skill/skills/references/common/support-levels.md
game_skill/skills/references/engines/_index.json
game_skill/skills/scripts/check_game_prd.js
game_skill/skills/scripts/extract_game_prd.js
game_skill/skills/scripts/extract_guardrails.js
```

### 5.1 Game APRD 是唯一事实源

`docs/game-prd.md` 不是普通产品文档，而是机器可提取的 APRD。所有下游阶段都围绕它工作。

必须包含 front-matter：

```yaml
---
game-aprd: "0.1"
project: word-match-lite-002
platform: [web]
runtime: dom-ui
is-3d: false
mode: 单机
need-backend: false
language: zh-CN
color-scheme:
  palette-id: campus-fresh
  theme-keywords: [教育, 背单词, 配对]
  primary: "#2563eb"
  secondary: "#16a34a"
  accent: "#eab308"
  background: "#eff6ff"
  surface: "#ffffff"
  text: "#1e3a5f"
  text-muted: "#64748b"
  success: "#22c55e"
  error: "#ef4444"
  border: "#bfdbfe"
  font-family: '"Nunito", "PingFang SC", sans-serif'
  border-radius: "12px"
  shadow: "0 2px 8px rgba(37,99,235,0.1)"
  fx-hint: bounce
delivery-target: playable-mvp
must-have-features: []
nice-to-have-features: []
cut-preference: 先缩内容量，不先砍核心系统
support-level: 直接支持
engine-plan:
  runtime: dom-ui
  reason: "..."
  version-pin: "@tailwindcss/browser@4"
mvp-scope: []
risk-note: []
asset-strategy:
  mode: library-first
  rationale: >
    ...
  visual-core-entities: []
  visual-peripheral: []
  style-coherence:
    level: flexible
---
```

### 5.2 固定章节

`check_game_prd.js` 依赖章节顺序：

```text
## 1. 项目概述
## 2. 目标玩家与使用场景
## 3. 核心玩法边界与 MVP 定义
## 4. 主干流程
## 5. 场景规格
## 6. 状态与实体
## 7. 规则与系统
## 8. 资源与数据
## 9. 运行方式与框架策略
## 10. 校验点与验收标准
## 11. 可选扩展
```

### 5.3 Tag 体系

常用 tag：

```text
@game
@flow
@scene
@state
@entity
@rule
@input
@ui
@system
@level
@resource
@constraint
@check
```

关键约束：

- `@game.genre` 必须是 9 大类之一：`board-grid / platform-physics / simulation / strategy-battle / single-reflex / quiz-rule / social-multi / edu-practice / narrative`。
- `@rule.effect` 必须含伪代码符号和实体字段读写，如 `state.score += 10`。
- 用户 prompt 中“必须/禁止/不得/严格”等硬约束，必须落到 `@constraint(kind: hard-rule)`。
- 产品验收落到 `@check(layer: product)`。

### 5.4 Strategy 回写

Strategy 已合并在 Phase 2 末尾，不再是独立 state 阶段。它负责：

- 判断 `support-level`
- 选择/验证 `engine-plan`
- 确定当前版本交付范围
- 写 `risk-note`
- 写 `asset-strategy`

重要理念：不要看到复杂需求就默认砍成最小 MVP。必须尊重 `must-have-features`，裁剪顺序是：

```text
先缩内容量 -> 再缩变体深度 -> 再缩表现层 -> 最后才动 must-have
```

### 5.5 check_game_prd.js 关键规则

脚本：`game_skill/skills/scripts/check_game_prd.js`

主要错误类别：

```text
FMxxx: front-matter / 章节 / runtime / color-scheme 等
ASxxx: asset-strategy
RLxxx: rule effect 伪代码与字段引用
```

重要规则：

- `FM016`：`is-3d` 与 `runtime` 必须一致。
- `FM010`：必须有完整 `color-scheme`。
- `AS001-AS007`：asset-strategy 必填、mode 合法、rationale 长度、core entities 合法。
- `RL001/RL002/RL003/RL005`：rule effect 不能散文化，不能过长，必须能抽字段读写。
- `RL004`：effect 引用的 entity field 必须在 `@entity.fields` 中声明。

### 5.6 Phase 2 生成的辅助产物

`extract_game_prd.js --profile-skeleton`：

```bash
node game_skill/skills/scripts/extract_game_prd.js \
  cases/${PROJECT}/docs/game-prd.md \
  --profile-skeleton game_skill/skills/scripts/profiles/${PROJECT}.skeleton.json
```

作用：从 `@check(layer: product)` 和 hard-rule 生成 profile skeleton。正式 profile 后续补真实 UI 操作。

`extract_guardrails.js`：

```bash
node game_skill/skills/scripts/extract_guardrails.js \
  cases/${PROJECT}/docs/game-prd.md \
  cases/${PROJECT}/.game/guardrails.md
```

作用：抽取 must-have、hard-rule、核心 rule，供 Codegen / Verify 开始前回读，防止上下文丢失。

---

## 6. Phase 2.5: Spec Clarify

源码入口：

```text
game_skill/skills/spec-clarify.md
```

### 6.1 目标

在 PRD 完成之后、Expand 前，解决会影响 `mechanics.yaml / rule.yaml / event-graph.yaml` 的机制歧义。

### 6.2 只处理这些问题

```text
trigger
condition
effect
target-selection
timing/order
resource/lifecycle
movement/collision
```

### 6.3 输出

```md
# Spec Clarifications: {project}

## Status
asked | assumed | skipped

## Questions
- rule: @rule(...)
  question: "..."
  selected: "A"
  source: user | default

## Assumptions
- rule: @rule(...)
  decision: "..."
  reason: "..."

## Expand Notes
- mechanic-decomposer must map this decision ...
```

### 6.4 规则

- 最多问 1-2 个问题。
- 每个问题必须绑定具体 `@rule(id)` 或 `@constraint(id)`。
- 每个问题必须有“让我决定”。
- 不阻塞核心玩法的数值调参不要问，记录 assumption 即可。
- 缺 `spec-clarifications.md` 时不得进入 Phase 3。

---

## 7. Phase 3: Expand

源码入口：

```text
game_skill/skills/expand.md
game_skill/agents/mechanic-decomposer.md
game_skill/agents/gameplay-expander.md
game_skill/skills/scripts/check_mechanics.js
game_skill/skills/scripts/generate_implementation_contract.js
game_skill/skills/scripts/check_asset_selection.js
game_skill/skills/scripts/check_implementation_contract.js
```

### 7.1 Phase 3.0: mechanic-decomposer

子 agent：`game_skill/agents/mechanic-decomposer.md`

输入契约：

```text
【PRD】cases/${PROJECT}/docs/game-prd.md
【Spec澄清】cases/${PROJECT}/docs/spec-clarifications.md
【输出】cases/${PROJECT}/specs/.pending/mechanics.yaml
【项目】${PROJECT}
【引擎】${ENGINE}
```

允许读取：

```text
PRD
Spec Clarify
references/mechanics/_index.yaml
references/mechanics/**/*.md   # 按需读 spec，不读 reducer
references/common/game-aprd-format.md
```

禁止读取 reducer，因为 reducer 是 `check_mechanics.js` 的符号执行真值，不应被 codegen/decomposer 抄实现。

输出：`specs/.pending/mechanics.yaml`

核心结构：

```yaml
version: 1
primitive-catalog-version: 1
engine: canvas
external-events: [input.start]
entities: []
mechanics:
  - node: pig-movement
    primitive: parametric-track@v1
    applies-to: pig
    params: {}
    produces-events: []
invariants:
  - ref: "@constraint(...)"
    maps-to:
      node: ...
      field: ...
      expected: ...
unmapped: []
simulation-scenarios:
  - name: happy-path-win
    setup: {}
    expected-outcome: win
    max-ticks: 200
```

质量门槛：

- 每个 PRD `@rule` 要么映射到 mechanics，要么进入 `unmapped`。
- 每个 hard-rule 必须进入 `invariants`。
- 至少一条 scenario 能达到 win。
- 只使用 `_index.yaml` 中登记的 primitive。
- `ray-cast.coord-system=grid` 时上游必须提供 `gridPosition`。
- `grid-board + 外圈轨道` 必须是 `rect-loop`，不是 `ring`。

### 7.2 Mechanic primitive catalog

源文件：`game_skill/skills/references/mechanics/_index.yaml`

当前 Stage 1 primitive：

```text
motion:
  parametric-track@v1
  grid-step@v1

spatial:
  grid-board@v1
  ray-cast@v1
  neighbor-query@v1

logic:
  predicate-match@v1
  resource-consume@v1
  fsm-transition@v1

progression:
  win-lose-check@v1
  score-accum@v1
```

每个 primitive 有：

```text
*.md          # Semantic Contract / Required State Fields / Engine Adaptation Hints
*.reducer.mjs # check_mechanics.js 用于符号执行
```

### 7.3 Phase 3.x: gameplay-expander

子 agent：`game_skill/agents/gameplay-expander.md`

一个 expander 一次只负责一个维度：

```text
scene
rule
data
assets
event-graph
```

所有输出先写到：

```text
cases/${PROJECT}/specs/.pending/{dim}.yaml
```

rule / event-graph 必须读取 `mechanics.yaml`，并引用 `primitive-node-ref`。不得写散文 effect。

#### scene.yaml

包含：

- `scenes[]`
- layout 四段：`viewport / board-bbox / hud-bbox / safe-area`
- zones
- ui-slots
- transitions
- `boot-contract`

`boot-contract` 会被 implementation-contract 和 check 脚本消费。

#### rule.yaml

包含：

- 每条 rule 的 trigger
- condition
- effect-on-true / effect-on-false
- `effect.logic.primitive-node-ref`
- visual effects，动词必须来自白名单：

```text
particle-burst
screen-shake
tint-flash
float-text
scale-bounce
pulse
fade-out
```

#### data.yaml

包含：

- resource schema
- 示例数据
- initial-state
- `balance-check`

`balance-check` 后续会用于 codegen/verify 的可玩性检查。

#### assets.yaml

包含：

- runtime / is-3d
- genre
- color-scheme
- images / spritesheets / audio / fonts
- `selection-report`

资产选择必须读：

```text
assets/library_2d/catalog.yaml
assets/library_3d/catalog.yaml
```

特别规则：如果实体是色块/方块/目标块，且玩法依赖 color 字段，必须用 `generated / graphics-generated / inline-svg` 并写：

```yaml
visual-primitive: color-block
```

不要把 coin、gem、dungeon tile、button 这种具象素材绑定给抽象色块。

#### event-graph.yaml

包含：

- 事件连接边
- async-boundaries
- test-hooks
- rule-traces / primitive-node-ref

事件名优先来自 mechanics primitive 的 emitted events。

### 7.4 implementation-contract.yaml

生成脚本：

```bash
node game_skill/skills/scripts/generate_implementation_contract.js cases/${PROJECT}/ \
  --out specs/.pending/implementation-contract.yaml
```

它从 scene/assets/PRD/asset-strategy 生成：

```yaml
contract-version: 1
runtime:
  engine: canvas
  run-mode: file
boot:
  entry-scene: start
  ready-condition: ...
  start-action: ...
  scene-transitions: []
asset-bindings:
  - id: ...
    role: ...
    asset-kind: ...
    type: local-file
    source: ...
    binding-to: ...
    render-as: ...
    text-bearing: false
    must-render: true
    allow-fallback: false
    consumer: registry.getTexture
engine-lifecycle:
  asset-loading: before-first-render
  forbid: []
verification:
  required-runtime-evidence: []
  required-test-hooks: []
  report-policy: verifier-json-only
```

重要行为：

- `asset-strategy.mode=none` 会让 asset-bindings 为空，并跳过资产门禁。
- `library-first` 下，核心 local-file 必须 `must-render=true` 且 `allow-fallback=false`。
- Phaser lifecycle 会禁止 `scene.load.start()` 出现在 create 阶段。

### 7.5 Phase 3 gates

原子提交到 `specs/` 后必须跑：

```bash
node game_skill/skills/scripts/check_asset_selection.js cases/${PROJECT}/ --log ${LOG_FILE}
node game_skill/skills/scripts/check_implementation_contract.js cases/${PROJECT}/ --stage expand --log ${LOG_FILE}
node game_skill/skills/scripts/check_mechanics.js cases/${PROJECT}/ --log ${LOG_FILE}
```

任一失败，Phase 3 failed，不进 Codegen。

---

## 8. Phase 4: Codegen

源码入口：

```text
game_skill/skills/codegen.md
game_skill/agents/engine-codegen.md
game_skill/skills/references/engines/_index.json
game_skill/skills/references/engines/*/guide.md
game_skill/skills/references/engines/*/template/
game_skill/skills/references/engines/_common/
game_skill/skills/scripts/generate_registry.js
game_skill/skills/scripts/check_project.js
game_skill/skills/scripts/check_game_boots.js
game_skill/skills/scripts/check_implementation_contract.js
game_skill/skills/scripts/check_asset_usage.js
```

### 8.1 输入优先级

Codegen 不再自由发挥。输入优先级：

```text
mechanics.yaml + implementation-contract.yaml
  > specs/*.yaml
  > game-prd.md
  > engine guide/template
```

### 8.2 engine-codegen 输入契约

子 agent：`game_skill/agents/engine-codegen.md`

必须传：

```text
【运行时】phaser3|pixijs|canvas|dom-ui|three
【运行模式】file|local-http
【配色方案】GamePRD front-matter color-scheme
【交付档位】playable-mvp|feature-complete-lite|...
【必须保留功能】must-have-features
【PRD】cases/${PROJECT}/docs/game-prd.md
【Specs】cases/${PROJECT}/specs/
【Mechanics】cases/${PROJECT}/specs/mechanics.yaml
【Primitive Catalog】game_skill/skills/references/mechanics/_index.yaml
【Implementation Contract】cases/${PROJECT}/specs/implementation-contract.yaml
【目标目录】cases/${PROJECT}/game/
【硬约束】...
```

### 8.3 代码生成硬要求

- `game/index.html` 必须存在。
- head 必须有 `ENGINE / VERSION / RUN` 注释。
- 必须暴露 `window.gameState`。
- Phaser 必须暴露 `window.game`。
- PixiJS / Three 通常暴露 `window.app`。
- 真实 UI input 必须绑定到真实对象，不能只暴露 `window.gameTest`。
- 每个 mechanics node 必须在代码中有：

```js
// @primitive(parametric-track@v1): node-id=pig-movement
```

- 每个 hard-rule 必须有：

```js
// @hard-rule(no-global-autoaim): ...
```

- 每个 must-have 建议有：

```js
// @must-have(combo-system): ...
```

- `rule.yaml.effect-on-*.visual` 必须翻译成 `fx.playEffect(...)`。
- local-file 资产必须通过 registry manifest 加载并在业务代码中真实消费。
- 配色只能消费 PRD 的 `color-scheme` 硬值，不能自创。

### 8.4 Registry / FX / Test Hook

共享层位于：

```text
game_skill/skills/references/engines/_common/
```

Codegen 先跑：

```bash
node game_skill/skills/scripts/generate_registry.js cases/${PROJECT}
```

生成 `assets.manifest.json`。不同引擎通过 adapter 创建 registry：

```js
import { createRegistry } from './adapters/<engine>-registry.js';
```

Phaser 是两段式：

```js
preload() {
  preloadRegistryAssets(manifest, { scene: this });
}

create() {
  const registry = createRegistry(manifest, { scene: this });
}
```

禁止在 `create()` 或 adapter 内 `scene.load.start()`。

FX 统一：

```js
const fx = createFx({ ... });
fx.playEffect('screen-shake', { intensity: 3, duration: 150 });
```

Test hook 统一：

```js
exposeTestHooks({
  state,
  hooks: { clickStartButton, clickRetryButton },
  simulators: {}
});
```

### 8.5 Codegen gates

Codegen 完成后必须跑：

```bash
node game_skill/skills/scripts/check_mechanics.js cases/${PROJECT}
node game_skill/skills/scripts/check_project.js cases/${PROJECT}/game/ --log ${LOG_FILE}
node game_skill/skills/scripts/check_game_boots.js cases/${PROJECT}/game/ --log ${LOG_FILE}
```

`check_project.js` 会进一步链式检查：

```text
check_implementation_contract.js --stage codegen
check_asset_selection.js
check_asset_usage.js
check_asset_paths.js
```

### 8.6 关键脚本行为

#### check_project.js

检查：

- `index.html` 存在。
- ENGINE 标识存在。
- CDN pin 主版本，禁止 `@latest`。
- 本地 script 存在。
- `node --check` 通过。
- `run-mode=file` 禁止本地 module src。
- `window.gameState` 暴露。
- 引擎专属反模式：
  - Phaser Container setInteractive 必须有 setSize 或 hitArea。
  - PixiJS 必须 `await app.init()`，禁 `app.view`。
  - Three 必须 importmap pin `three@0.x`，禁 require。
  - DOM tick 中禁止整页 `innerHTML` 重建。
- mechanics 语义静态检查：
  - grid raycast 代码必须出现 `gridPosition`。
  - rect-loop 轨道不能在绘制函数里用 `arc()`。

#### check_game_boots.js

用 Playwright 打开游戏，只回答“游戏能不能起”：

- 无 console/page error。
- 无网络失败。
- 首屏有文本、可见节点或 canvas。
- `window.gameState` 存在。
- local-http 模式下 required local-file 有运行时加载请求。
- 画布/DOM 基本健康。
- 对 Phaser/Pixi 做缺失纹理检查。

退出码：

```text
0 = boot OK
1 = boot fail
3 = playwright/chromium 环境缺失
```

#### check_implementation_contract.js

两种模式：

```bash
--stage expand
--stage codegen
```

expand 阶段检查：

- contract shape
- runtime / run-mode
- boot scene / zone / transition
- scene layout 四段齐全
- asset-bindings 和 assets.yaml 对齐
- button 素材不能绑定到非按钮文字承载 UI
- local-file 核心资产不能 allow fallback

codegen 阶段额外检查：

- manifest 包含 required assets
- required local-file 在业务代码中消费
- 每个 mechanics node 有 `@primitive(...)` 注释
- rule trace push points
- Phaser lifecycle 反模式

#### check_asset_usage.js

检查 `assets.yaml` / `implementation-contract.yaml` 中 required 资产是否在业务代码真实消费。adapter 和 manifest 不算业务消费。

最小消费模式：

```text
canvas: ctx.drawImage(...)
dom-ui: img src / background-image
phaser3: this.add.image / this.add.sprite / this.sound.add
pixijs: new Sprite(...) / Sprite.from(...)
three: TextureLoader / GLTFLoader / SpriteMaterial
```

---

## 9. Phase 5: Verify + Deliver

源码入口：

```text
game_skill/skills/verify.md
game_skill/agents/game-checker.md
game_skill/skills/scripts/verify_all.js
game_skill/skills/scripts/check_playthrough.js
game_skill/skills/scripts/check_skill_compliance.js
game_skill/skills/scripts/_profile_guard.js
game_skill/skills/scripts/freeze_specs.js
game_skill/skills/delivery.md
```

### 9.1 verify_all.js 是唯一 report 入口

正式交付只能跑：

```bash
node game_skill/skills/scripts/verify_all.js cases/${PROJECT} --profile ${PROJECT} --log ${LOG_FILE}
```

它顺序运行：

```text
check_mechanics
check_game_boots
check_project
check_playthrough
check_skill_compliance
```

并写：

```text
cases/${PROJECT}/eval/report.json
```

任何 agent 不得手写绿色 report。任一 check 失败，report.status 必须 failed。

### 9.2 Profile freeze

正式 profile 当前位于：

```text
game_skill/skills/scripts/profiles/${PROJECT}.json
```

首次 Phase 5 前必须：

```bash
node game_skill/skills/scripts/_profile_guard.js \
  cases/${PROJECT} \
  game_skill/skills/scripts/profiles/${PROJECT}.json \
  --freeze
```

`_profile_guard.js` 会把 SHA 写入 `state.json.phases.verify.profileSha`。

退出码：

```text
0 = OK
5 = profile 被篡改
6 = 缺 freeze 基线
```

### 9.3 Specs freeze

Phase 5 入口：

```bash
node game_skill/skills/scripts/freeze_specs.js cases/${PROJECT}/
```

每轮修复前：

```bash
node game_skill/skills/scripts/freeze_specs.js cases/${PROJECT}/ --verify
```

冻结范围：

- `docs/game-prd.md`
- `specs/`
- profile（若存在）

不冻结：

- `game/`
- `eval/`
- `.game/log.jsonl`

如果 Phase 5 修复中 PRD/specs/profile 被改，立即失败，不得继续修。

### 9.4 check_playthrough.js

定位：产品侧校验。profile 只负责驱动 UI，不能作为“真相”。

关键规则：

- profile 必须覆盖 PRD 中所有 `@check(layer: product)`。
- profile 的交互类 assertion 必须包含真实 `click / press / fill`。
- profile 禁止靠直接改 `window.gameState` 作为真实交互。
- profile 禁止写宽松 expect；产品真相主要来自 `window.__trace`、runtime errors、asset errors 和脚本规则。

退出码常见含义：

```text
0 = pass
1 = 普通失败
2 = hard-rule 失败
3 = 环境问题
4 = profile 覆盖率/真实交互不足
5 = profile SHA mismatch
6 = 缺 profile freeze baseline
```

### 9.5 check_skill_compliance.js

定位：spec 和 code 是否脱节。

检查维度：

- structure：必需产物齐全、无 `.pending` 残留。
- state：state schema 合法。
- contract：implementation-contract 存在且关键字段完整。
- assets：local-file 引用率、素材绑定证据。
- effects：rule.yaml visual 动词是否有代码调用。
- events：scene transition、重建入口、多关卡入口。

通过标准：score >= 70 且无 severity=error。

### 9.6 修复预算

```text
boot:        <= 2 轮
project:     <= 3 轮
playthrough: <= 10 轮
compliance:  <= 2 轮
```

每轮必须：

```text
Step A: 记录 fix-applied 到 log.jsonl
Step B: 修改代码
Step C: 重跑对应 check
```

---

## 10. 用户反馈重跑路径

脚本：

```text
game_skill/skills/scripts/prd_diff.js
```

交付完成后先 snapshot：

```bash
node game_skill/skills/scripts/prd_diff.js --snapshot cases/${PROJECT}
```

用户反馈后分类：

```bash
node game_skill/skills/scripts/prd_diff.js --classify cases/${PROJECT} /tmp/fb.txt
```

分类：

| category | 含义 | 正确路径 |
|---|---|---|
| `code-bug` | 白屏、报错、没反应、点击无效 | 只走 Phase 5 修复循环，不改 PRD/specs |
| `design-change` | 改玩法、难度、关卡数、胜负条件 | Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 |
| `art-change` | 风格、配色、换素材、动画 | Phase 3.assets -> contract -> Phase 4 -> Phase 5 |
| `ambiguous` | 模糊 | AskUserQuestion，含“让我决定” |

这个机制的目的：避免把设计变化当 code bug 小修，造成 PRD/spec/code 长期不一致。

---

## 11. 子 agent 总表

### 11.1 mechanic-decomposer

文件：

```text
game_skill/agents/mechanic-decomposer.md
```

职责：

```text
GamePRD + Spec澄清 -> specs/.pending/mechanics.yaml
```

输出 JSON 成功：

```json
{
  "status": "ok",
  "output": "cases/<slug>/specs/.pending/mechanics.yaml",
  "primitives-used": ["parametric-track@v1"],
  "scenarios": 2,
  "unmapped-count": 1
}
```

失败时应早失败，不要硬塞 primitive。

### 11.2 gameplay-expander

文件：

```text
game_skill/agents/gameplay-expander.md
```

职责：

```text
按维度生成 scene/rule/data/assets/event-graph
```

输出 JSON 成功：

```json
{
  "status": "completed",
  "dimension": "rule",
  "produced": "specs/.pending/rule.yaml",
  "counts": {},
  "warnings": [],
  "rejected_requirements": []
}
```

不得：

- 写 state.json
- 写其他维度文件
- 写到 `.pending` 以外
- 无 mechanics baseline 时生成 rule/event-graph

### 11.3 engine-codegen

文件：

```text
game_skill/agents/engine-codegen.md
```

职责：

```text
GamePRD + specs + contract + engine template -> game/
```

输出 JSON 成功：

```json
{
  "status": "completed",
  "runtime": "phaser3",
  "run_mode": "local-http",
  "produced": ["game/index.html"],
  "shared_layer_usage": {
    "registry": true,
    "fx": true,
    "test_hook": true
  },
  "must_have_coverage": {
    "delivered": [],
    "degraded": [],
    "rejected": []
  },
  "self_check": {
    "check_project": "passed",
    "engine_marker": true,
    "cdn_pinned": true
  }
}
```

不得：

- 修改 PRD/specs。
- 读取 verify.md。
- 手写 loader 循环绕过 registry。
- 手写特效绕过 fx adapter。
- 发明 mechanics.yaml 之外的玩法。

### 11.4 game-checker

文件：

```text
game_skill/agents/game-checker.md
```

职责：

```text
Phase 5 分层校验和修复
```

每次进入必须先跑：

```bash
node game_skill/skills/scripts/freeze_specs.js cases/<project> --verify --log cases/<project>/.game/log.jsonl
```

不得：

- 修改 PRD。
- 修改 specs。
- 修改 profile 让测试变宽。
- 超预算继续修。

---

## 12. 关键机器契约

### 12.1 Game APRD 契约

`docs/game-prd.md` 是唯一事实源。下游从其中抽：

- runtime / is-3d
- color-scheme
- asset-strategy
- must-have-features
- @entity fields
- @rule trigger/effect
- @constraint hard-rule
- @check product

### 12.2 Mechanic 契约

`mechanics.yaml` 是玩法真值层。

职责边界：

```text
PRD 说想要什么玩法
mechanics.yaml 说明玩法如何由 primitive DAG 表达
codegen 负责把 primitive DAG 实现到具体引擎
check_mechanics 负责在不运行 UI 的情况下验证 DAG 结构成立
```

### 12.3 Asset Strategy 契约

读取脚本：

```text
_asset_strategy.js
```

模式：

```text
library-first
generated-only
none
```

影响：

- `check_asset_selection.js`
- `check_asset_usage.js`
- `generate_implementation_contract.js`
- `check_implementation_contract.js`

`mode=none`：跳过素材绑定链。
`generated-only`：允许 generated 作为核心 must-render 证据。
`library-first`：核心实体 local-file / pack coherence 更严格。

### 12.4 Implementation Contract 契约

`implementation-contract.yaml` 是 Expand -> Codegen 硬接口。

Codegen 若发现 contract 不合理，不应偷偷改 specs，而是返回 failed，让主 agent 回 Phase 3 修 specs 并重新生成 contract。

### 12.5 Verify Report 契约

`eval/report.json` 只能由 `verify_all.js` 写。
如果某个 check 失败，report 必须 failed。

---

## 13. 常见失败与正确回退

| 失败信号 | 多半原因 | 正确回退 |
|---|---|---|
| `check_game_prd RL005` | `@rule.effect` 散文化，缺字段读写 | 回 Phase 2 修 PRD rule effect |
| `AS003/AS006/AS007` | asset-strategy 缺 rationale、core entity 不合法 | 回 Phase 2 修 front-matter |
| `Spec Clarify 缺失` | Phase 2.5 没跑 | 补 `docs/spec-clarifications.md` |
| `check_mechanics no win` | mechanics DAG 结构不可完成 | 回 Phase 3.0 修 mechanics，必要时回 Phase 2/2.5 |
| `grid-track-shape ring` | 棋盘外圈轨道误用圆形 ring | Phase 3 修 mechanics 为 `rect-loop` |
| `check_asset_selection images=[]` | expander 误读 no-external-assets 或没选素材 | Phase 3.assets 重做 |
| `button 素材绑定 card-surface` | asset semantic 错 | Phase 3.assets + contract 重做 |
| `required local-file 未消费` | Codegen 只生成 manifest，业务代码没用素材 | Phase 4 修业务渲染 |
| `window.gameState 未定义` | 验证桥缺失 | Phase 4 修代码 |
| `Phaser Container setInteractive` | 缺 setSize / hitArea | Phase 4 修交互对象 |
| `Pixi app.view` | Pixi v8 API 错 | Phase 4 修为 `app.canvas` |
| `file 模式 CORS` | file 模式用了本地 module/import | 改 RUN local-http 或改 inline/classic script |
| `profile exit 4` | profile 未覆盖 product checks 或无真实 click | 补正式 profile 后重新 freeze |
| `profile exit 5/6` | profile 被改或未冻结 | 重新补全并 freeze，不进代码修复 |
| `freeze_specs failed` | Phase 5 改了 PRD/spec/profile | 终止；若规格确实错，回上游阶段 |
| `verify_all failed` | 任一层红 | 不得写 delivery success |

---

## 14. 如果你要从零生成一个 case

按这个顺序执行，不要跳阶段：

1. 选 `PROJECT`，创建目录。
2. 初始化 `.game/state.json`。
3. Phase 1 写 `docs/brief.md`，必要时澄清。
4. Phase 2 写 `docs/game-prd.md`。
5. 跑：

   ```bash
   node game_skill/skills/scripts/check_game_prd.js cases/${PROJECT}/docs/game-prd.md --log ${LOG_FILE}
   ```

6. 生成 profile skeleton 和 guardrails。
7. Phase 2.5 写 `docs/spec-clarifications.md`。
8. Phase 3.0 生成 `specs/.pending/mechanics.yaml`。
9. Phase 3.x 并发生成 5 个 `.pending/*.yaml`。
10. 生成 `.pending/implementation-contract.yaml`。
11. 全部子任务 completed 后原子提交到 `specs/`，`commitExpand`。
12. 跑 Expand gates。
13. Phase 4 复制 engine template，生成 registry，写 game code。
14. 跑 Codegen gates。
15. 补正式 profile，从 skeleton 起步，必须有真实 click/press/fill。
16. `_profile_guard.js --freeze`。
17. `freeze_specs.js`。
18. `verify_all.js`。
19. 通过后写 `docs/delivery.md`。
20. `prd_diff.js --snapshot`。

---

## 15. 如果你要改 skill 本身

先判断改动属于哪层：

| 改动类型 | 主要文件 | 必跑检查 |
|---|---|---|
| PRD 格式 | `game-aprd-format.md`, `check_game_prd.js`, `extract_game_prd.js` | `npm test`, fixture |
| Clarify 流程 | `clarify.md`, `semantic-clarify.md`, `spec-clarify.md` | 人工读链路 + 相关 case |
| Mechanic primitive | `references/mechanics/**`, `_index.yaml`, reducer | `check_mechanics.js` + 反例 |
| Asset 策略 | `prd.md`, `_asset_strategy.js`, `check_asset_selection.js`, `check_asset_usage.js`, contract | `npm test` |
| Engine 适配 | `references/engines/*`, `engine-codegen.md`, `check_project.js`, `check_game_boots.js` | 对应引擎 case |
| Verify | `verify.md`, `game-checker.md`, `check_playthrough.js`, `verify_all.js`, `freeze_specs.js` | verify_all on sample |
| State schema | `state.schema.json`, `_state.js` | state init/migrate/commitExpand |

通用检查：

```bash
npm test
git diff --check
node --check game_skill/skills/scripts/<changed>.js
```

注意：当前 repo 有不少未跟踪/已修改文件。不要随便 revert 不属于你本次任务的变更。

---

## 16. 当前设计的核心判断

### 16.1 不按游戏类型做厚模板

当前方向不是“每种游戏一个模板”，而是：

```text
primitive mechanics
  + common game systems
  + engine templates
  + asset catalog
  + contract gates
```

也就是用通用系统模块和正交 mechanic primitive 组合长尾游戏，而不是写大量 genre template。

### 16.2 测试不是设计阶段

如果 Phase 5 才发现玩法规则不成立，优先怀疑：

```text
Phase 2.5 机制澄清不足
Phase 3 mechanics/rule/event-graph 契约不足
Phase 4 implementation-contract 消费不足
```

不要直接让 LLM 在 Phase 5 改 game code 硬凑，尤其不要改 PRD/specs/profile 来通过测试。

### 16.3 资产不是“有引用就算用”

正确资产链路是：

```text
PRD asset-strategy
  -> assets.yaml 选型 + binding-to + visual-primitive
  -> implementation-contract asset-bindings
  -> registry manifest
  -> business code 真实消费
  -> check_asset_usage / boot runtime 证据
```

manifest 注册不等于业务消费。

### 16.4 report 不是总结，是证据聚合

`eval/report.json` 的权威性来自 `verify_all.js` 聚合真实脚本退出码。LLM 的自然语言 delivery 只能引用 report，不能替代 report。

---

## 17. 推荐给下一个 LLM 的阅读顺序

如果时间很少：

1. `game_skill/skills/SKILL.md`
2. 本文档
3. `game_skill/agents/*.md`
4. `game_skill/skills/scripts/verify_all.js`
5. `game_skill/skills/scripts/check_mechanics.js`
6. `game_skill/skills/scripts/check_project.js`
7. `game_skill/skills/scripts/check_implementation_contract.js`

如果要完整掌握：

1. `references/common/game-aprd-format.md`
2. `prd.md` + `strategy.md`
3. `spec-clarify.md`
4. `expand.md`
5. `references/mechanics/_index.yaml` + 各 primitive spec
6. `codegen.md`
7. `references/engines/_index.json` + 目标引擎 guide/template
8. `verify.md`
9. `scripts/*.js`
10. `docs/mechanics-stage-1.md`
11. `docs/pixel_flow_chain_diagnosis_20260426.md`

---

## 18. 一句话心智模型

这条 skill 的核心不是“让 LLM 写小游戏”，而是让 LLM 在一条可审计流水线上逐步收窄自由度：

```text
自然语言需求
  -> Game APRD
  -> 机制原语 DAG
  -> 多维 specs
  -> 实现契约
  -> 引擎模板代码
  -> 机器验证报告
```

任何阶段失败都应该回到最早能表达问题的那一层修，而不是在后面偷改产物。
