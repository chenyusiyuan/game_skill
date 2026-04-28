---
name: game-phase-2-5-spec-clarify
description: "Phase 2.5: 功能机制澄清。在 GamePRD 完成后、Expand 写 mechanics/rule/event-graph 前，检查核心规则是否存在 trigger/condition/effect 级别的多义解释；必要时向用户最多追问 1-2 个问题。"
---

# Phase 2.5: Spec Clarify（功能机制澄清）

## 职责

在 `docs/game-prd.md` 已生成并通过 `check_game_prd.js` 之后、Phase 3 Expand 之前执行。目标不是补产品字段，而是避免模型把自然语言规则直接猜成方便实现的 spec。

本阶段只处理会影响 `mechanics.yaml` / `rule.yaml` / `event-graph.yaml` 的功能机制歧义：

- `trigger`：规则什么时候触发、触发粒度是什么
- `condition`：哪些状态/实体/资源满足时才生效
- `effect`：一次触发改变哪些状态，是否持续、是否只处理一个目标
- `target-selection`：目标选择范围、优先级、是否可穿透/跳过
- `timing/order`：多个系统同 tick 时的结算顺序
- `resource/lifecycle`：资源消耗、回收、生成、销毁的时点
- `movement/collision`：移动步长、路径投影、碰撞优先级

## 机械目录约束（硬要求）

本阶段会影响 Phase 3.0 mechanic-decomposer，因此不能在 `Expand Notes` 里发明 primitive 名称。

- 若需要写 primitive，必须先读 `references/mechanics/_index.yaml`，只能使用其中精确登记的 `id@version`
- 常见正确写法：`ray-cast@v1`、`parametric-track@v1`、`grid-board@v1`、`predicate-match@v1`、`resource-consume@v1`
- 常见错误写法：`raycast@v1`、`grid-path-follow@v1`、`path-follow@v1`
- 如果你不确定 primitive 名，宁可写“mechanic-decomposer must map this using a catalog primitive”，不要写不存在的 id

写完 `spec-clarifications.md` 后必须通过：

```bash
node game_skill/skills/scripts/check_spec_clarifications.js cases/${PROJECT}/ --log ${LOG_FILE}
```

该检查失败时不得进入 Phase 3.0。

## 与 Phase 1 澄清的分工

Phase 1 只问产品边界：

- 缺失字段
- 功能优先级
- 交付档位/实现范围
- 引擎/运行方式
- 视觉风格（仅在影响素材选择时）

不要在 Phase 1 问功能机制细节。功能机制问题要等 GamePRD 形成后，本阶段基于具体 `@rule` / `@entity` / `@constraint` 提问。

## 触发条件

读取 `docs/game-prd.md` 和 `docs/brief.md`，逐条检查核心 `@rule`。满足任一条时触发：

- 同一句规则可合理映射到 2 个以上不同 primitive 组合
- 自然语言描述缺少必须离散化的触发粒度，例如“经过/接触/靠近/当前位置/持续/自动”
- 目标选择可合理解释成多种范围或优先级，例如“最近/正对/范围内/同色/第一个”
- 规则有多个系统同时改同一状态，结算顺序会改变结果
- PRD 有 hard-rule，但 `@rule.effect` 没写清如何落到 trigger/condition/effect
- mechanic-decomposer 需要在多个事件之间选一个，但 PRD 未明确依据

不触发的情况：

- 只是数值可调，例如速度、分数、动画时长；可默认并记录 assumption
- 只是视觉表现，例如颜色、粒子、字体；由风格/素材链路处理
- PRD 已明确写出触发、条件、目标选择和状态变化

## 提问规则

- 最多 2 个问题，优先 1 个组合问题
- 每个问题必须绑定具体 `@rule(id)` 或 `@constraint(id)`
- 每个问题提供 2-4 个可执行选项，首选项标注“推荐”
- 每个问题必须有“让我决定”选项；用户选后采用推荐项并写入记录
- 如果歧义不阻塞核心玩法，选择保守默认，不问用户，但必须记录 assumption
- 如果歧义会改变核心玩法结果，必须先问，不允许静默自由发挥

## Balance 澄清口径（硬要求）

涉及 `@rule(balance-check)` / 资源余量 / 通关可达性时，澄清必须使用可验证口径：

- `supply` = 玩家实际可消费资源总量，例如 `sum(waiting pigs.ammo)`、可部署次数、可攻击次数
- `demand` = 关卡必须消耗的目标总量，例如 `sum(block.hp|durability)` 或必须清除的目标数乘以单目标消耗
- `margin` = `supply / demand`，必须满足 `>= 1.2`

禁止用“平均每只小猪消除 2 个方块”“demand = blockCount / 2”这类经验估算替代可达性证明。若需求本身没有提供足够数值，记录为 blocking assumption 或回到 PRD/data，而不是在 Phase 2.5 猜。

## 问题模板

### 模板 1：触发粒度

> `@rule(<id>)` 需要确定触发粒度。你希望它怎么触发？
> - A. 每次进入一个可判定位置都触发（推荐）
> - B. 只在进入新的区域/阶段时触发
> - C. 按固定时间/冷却持续判定
> - D. 让我决定（采用 A，并记录为 spec assumption）

### 模板 2：目标选择

> `@rule(<id>)` 需要确定目标选择。一次触发应该选择哪个目标？
> - A. 只处理当前方向/范围内第一个有效目标（推荐）
> - B. 处理范围内最近目标
> - C. 处理所有满足条件的目标
> - D. 让我决定（采用 A，并记录为 spec assumption）

### 模板 3：结算顺序

> 多个规则会在同一时刻改变状态，结算顺序怎么定？
> - A. 先移动/碰撞，再判定效果，最后做胜负/回收（推荐）
> - B. 先判定效果，再移动/回收
> - C. 让我决定（采用 A，并记录为 spec assumption）

## 输出

无论是否提问，都写入 `cases/${PROJECT}/docs/spec-clarifications.md`：

```markdown
# Spec Clarifications: {project}

## Status
asked | assumed | skipped

## Questions
- rule: @rule(attack-check)
  question: "..."
  selected: "A"
  source: user | default

## Assumptions
- rule: @rule(attack-check)
  decision: "每次进入一个可判定位置都触发"
  reason: "PRD 强调当前位置/正对方向；该默认更保守，避免全局自动索敌或过度简化"

## Expand Notes
- mechanic-decomposer must map this decision to mechanics trigger/condition/effect.
- rule/event-graph expander must reuse the same decision.
```

Phase 3.0 的 mechanic-decomposer 和 Phase 3.x 的 rule/event-graph expander 必须读取该文件。若文件缺失，主流程不得进入 Expand。

## 不要做的事

- 不要把本阶段变成第二轮 PRD 需求访谈
- 不要问视觉、引擎、内容量、交付范围
- 不要一次提出超过 2 个机制问题
- 不要用“实现方便”替代用户没有确认的机制语义
- 不要把非阻塞数值调参升级成用户问题；记录默认值即可
- 不要在 Expand Notes 中引用不存在的 primitive
- 不要把资源平衡写成平均估算；必须能被 data.yaml 和 mechanics scenario 复算
