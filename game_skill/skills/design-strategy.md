---
name: game-phase-2-5-design-strategy
description: "Phase 2.5B: Design Strategy。在 User Clarify 完成后、Expand 前，自动展开玩法体验、核心循环、决策点、资源循环、juice 与复杂度预算；仅在核心方向分叉时向用户追问。"
---

# Phase 2.5B: Design Strategy（玩法设计策略）

## 职责

在 `docs/spec-clarifications.md` 已生成并通过 `check_spec_clarifications.js` 之后、Phase 3 Expand 之前执行。本阶段不改写 PRD，也不替代功能机制澄清；它把已确定的玩法语义展开成可供 dynamic mechanics 和 codegen 使用的设计策略。

必须内部补齐以下设计层信息：

- `target-experience`：玩家幻想、单局长度、难度感、情绪节奏
- `gameplay-pillars`：本玩法必须保住的 2-4 个体验支柱
- `core-loop`：observe / decide / act / feedback / progress
- `decision-points`：玩家可观察、可选择、可验证的关键决策点
- `resource-loop`：资源、来源、消耗、目标余量
- `juice-plan`：输入、成功、失败、进度反馈
- `complexity-budget`：每个后续 stage 可新增的系统、实体、规则上限

产物写入 `cases/${PROJECT}/docs/design-strategy.yaml`，后续 Phase 3.0 mechanic-decomposer 必须读取。Phase 4 的 per-case runtime wrapper 只实现 mechanics.yaml 中的节点，但 wrapper 的体验重点、trace 可观察点和反馈强度应参考本文件。

## archetype 种子规则

- 若 Phase 2.5B 识别到 query 含 reference-game（如“做个俄罗斯方块”），优先用对应 archetype 的 design-strategy 字段作为种子；允许覆盖但必须写明 `archetype-ref` 字段。
- `archetype-ref` 缺失时 codegen 走完全自由模式；存在时必须在 Stage 1 通过 `check_archetype_identity.js`。

## 触发条件

默认总是执行本阶段并产出 `design-strategy.yaml`。是否提问取决于是否存在会改变核心玩法方向的分叉。

需要提问的情况：

- 竞技向 vs 休闲向会改变胜负压力、反馈节奏或失败代价
- 局式玩法 vs 无尽玩法会改变资源循环、终局和 progression
- 策略博弈 vs 快节奏反应会改变 decision-points 与 observable hooks
- 单人体验 vs 多人/对抗表达会改变目标、反馈和数据结构
- 决策深度偏好会改变每阶段新增系统的复杂度预算

不提问的情况：

- 只是速度、频率、时长、数值倍率等参数差异
- 只是视觉风格、素材表现、音效强度
- PRD 和 spec-clarifications 已经明确方向，且默认策略不会改变核心玩法结果

若无方向分叉，全程不问用户，采用系统默认并写入 `assumptions`。

## 提问规则

- 本阶段提问预算 `<= 4`，独立于 Phase 2.5A，不共享、不挤占。
- 所有问题一次性提出；每问必须是会改变核心玩法方向的分叉，不问数值参数。
- 每问 options 必须是 `1 个推荐默认 + 2 个替代方案`。`options[0]` 是首选推荐项，description 末尾带“推荐”标识；其余 1-2 条是可执行替代。
- 禁止手动添加“让我决定”选项；AskUserQuestion 工具会自动提供 Other 入口，用户需要自由输入时走 Other。
- 如果问题不阻塞核心玩法，选择默认策略，不追问，但必须记录 assumption。

示例问题形态：

```yaml
question: "这个玩法更适合哪种体验节奏？"
options:
  - label: "短局爽感"
    description: "3-6 分钟内完成一轮，强调快速反馈和轻量进步。推荐"
  - label: "长线成长"
    description: "单局内有更明显的资源积累和阶段升级。"
  - label: "高压挑战"
    description: "强调失败代价、极限操作和反复冲刺。"
```

## 默认假设

当用户没有给出更多方向，采用以下默认：

- `target-experience.session-length` 默认 `3-6 minutes`
- `target-experience.difficulty` 默认 `easy-to-learn, medium-to-master`
- `gameplay-pillars` 默认 2-4 条，围绕原 query 的主要动词、目标和反馈建立
- `decision-points` 至少 2 条，每条 `observable-via` 必须是 `window.gameTest.*`
- `resource-loop.balance-target` 默认 `1.2`
- `complexity-budget` 默认每 stage 最多新增 2 个 systems、3 个 entities、5 个 rules
- 数值细节不问用户，写入 `assumptions`，交给后续 data/rule/spec 校验收敛

## 产出格式

写入 `cases/${PROJECT}/docs/design-strategy.yaml`：

```yaml
version: 1
archetype-ref: "tetris" # optional; only when seeded from a known reference-game archetype

target-experience:
  fantasy: "..."
  session-length: "3-6 minutes"
  difficulty: "easy-to-learn, medium-to-master"
  emotional-beats:
    - quick-feedback
    - near-fail-recovery

gameplay-pillars:
  - id: readable-risk
    description: "..."

core-loop:
  observe: "..."
  decide: "..."
  act: "..."
  feedback: "..."
  progress: "..."

decision-points:
  - id: action-order
    type: strategic
    options: 3
    observable-via: "window.gameTest.getAvailableActions()"
    frequency: high

resource-loop:
  resources:
    - energy
  sources:
    - from: energy
      via: "successful action"
  sinks:
    - to: energy
      via: "special move"
  balance-target: 1.2

juice-plan:
  input-feedback:
    - "..."
  success-feedback:
    - "..."
  failure-feedback:
    - "..."
  progression-feedback:
    - "..."

complexity-budget:
  max-new-systems-per-stage: 2
  max-new-entities-per-stage: 3
  max-new-rules-per-stage: 5

assumptions:
  - "No direction fork was blocking; default short-session loop selected."
```

写完后必须运行：

```bash
node game_skill/skills/scripts/check_design_strategy.js cases/${PROJECT}/ --log ${LOG_FILE}
```

该检查失败时不得进入 Phase 3.0。
