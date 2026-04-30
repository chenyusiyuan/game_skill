# 1. mechanic 原语要不要取消？

我的建议是：**不要取消，但要降级它的角色。**

你现在的链路核心是从自然语言需求进入 APRD，再进入 mechanics/specs/implementation-contract/codegen/verify 这种可审计流水线。这个方向本身没有错，因为它能防止模型从 PRD 散文直接写代码、再靠测试后验修补。

但你现在感觉 mechanic yaml 原语限制游戏表现，这个判断也对。问题不是“原语不该存在”，而是：

```
现有 mechanic 原语太像执行约束层，
但它被放在了太靠前的位置，
导致玩法设计还没充分展开，就已经被压成低层 primitive DAG。
```

所以我建议把它从：

```
玩法设计的主表达
```

改成：

```
实现可控性的绑定层
```

也就是从：

```
用户需求
  -> mechanics.yaml
  -> specs
  -> code
```

改成：

```
用户需求
  -> 玩法策略展开 / 设计蓝图
  -> mechanics proposal
  -> runtime-backed mechanics binding
  -> specs
  -> code
```

## 强模型自由生成 vs 通用原语组合，哪个更好？

我不建议二选一。三种模式都应该保留，但用途不同。

| 模式                | 优点                   | 风险                                     | 适用场景                           |
| ------------------- | ---------------------- | ---------------------------------------- | ---------------------------------- |
| 强模型自由生成机制  | 创意强，能理解复杂需求 | 容易写出不可验证、不可复用、不可控的机制 | 新奇玩法、低频长尾需求、设计探索   |
| 通用原语 + LLM 组合 | 稳定、可验证、便于回归 | 容易把玩法压扁，生成像 demo              | 高频玩法、确定性规则、可模板化游戏 |
| 混合模式            | 兼顾创意和稳定         | 需要多一层机制归类/绑定                  | 你后续最应该采用                   |

我建议新增一个模式字段：

```
mechanics-mode:
  design-source: model-authored | archetype-assisted | primitive-backed | hybrid
  implementation-binding: runtime-backed | generated-code-with-probes | bespoke
```

然后把机制分成三类：

```
1. runtime-backed primitive
   已有 runtime、reducer、semantic probes。
   适合 ray-cast、resource-consume、grid-step、line-detect、quiz-submit 等。

2. design-only mechanic
   强模型提出的高层机制，比如“连击奖励”“动态压力”“风险换收益”。
   先进入策略层，不直接进代码。

3. bespoke mechanic
   当前 primitive 不支持，但本 case 必须实现。
   允许 LLM 写代码，但必须生成专门 probes，并记录为未来 primitive 候选。
```

这样做的好处是：**你不会因为追求创意而丢掉可控性，也不会因为追求可控性把所有游戏都做成 demo。**

## 我建议做一个 A/B/C 实验

你可以保留三条模式，在同一批真实 query 上跑对比：

```
A. 强模型自由生成 mechanics
B. 当前 primitive catalog + LLM 组合
C. 先策略展开，再把可执行部分绑定到 primitive，剩余 bespoke + probes
```

评估不要只看 checker 是否通过，要看这些指标：

```
稳定性：
- boot pass rate
- verify pass rate
- 修复轮数
- Phase 5 是否改 specs/profile

玩法正确性：
- semantic probe pass rate
- hard-rule violation count
- 是否出现“过测试但不好玩”

游戏性：
- 有多少 meaningful decisions
- 是否有失败路径
- 是否有策略选择
- 是否有进阶目标
- 是否存在 replay motivation

实现质量：
- 代码是否模块化
- 后续加关卡/敌人/道具是否容易
- 是否出现状态耦合和硬编码
```

我预期结果大概率是：

```
强模型自由生成：
  创意最高，但稳定性波动最大。

纯 primitive 组合：
  稳定性最高，但游戏性容易浅。

hybrid：
  综合最好，适合作为正式链路。
```

所以我的建议不是取消 mechanic yaml，而是改成：

```
mechanics.yaml 不再负责“设计一个好游戏”，
它只负责“把已经设计好的玩法绑定到可执行、可验证的实现结构”。
```

------

# 2. 增加“策略展开层”是非常必要的

你说现在生成的游戏更接近 demo / MVP，没有真正做到可玩丰富，这个问题不在 codegen，也不在 checker。根因是：

```
当前链路主要在回答：
“这个游戏能不能按规则跑起来？”

但一个好游戏还要回答：
“玩家为什么愿意继续玩？”
“每一步有什么选择？”
“失败后为什么想再来？”
“关卡如何逐步教会玩家？”
“资源、风险、奖励如何形成循环？”
```

所以你准备增加策略展开层，这个方向非常对。

但我不建议把它和“澄清层”完全合并。
原因是两者职责不同：

```
澄清层：
  面向用户，解决需求歧义。
  问题要少，不能把用户拉进设计细节泥潭。

策略展开层：
  面向内部生成，负责像 game designer 一样补全玩法深度。
  大多数内容应该由系统自己决定，而不是都问用户。
```

我建议拆成：

```
Phase 2.5A: User Clarify
  只问会影响核心方向的 1-2 个问题。

Phase 2.5B: Game Design Expansion
  内部策略展开，不打扰用户。
```

## 策略展开层应该产什么？

建议新增：

```
specs/design-strategy.yaml
```

或者：

```
docs/game-design-brief.md
specs/strategy.yaml
```

内容不要散文化，最好结构化。

示例：

```
version: 1

target-experience:
  fantasy: "玩家通过规划派出顺序和颜色匹配，逐步清掉棋盘"
  session-length: "3-6 minutes"
  difficulty: "easy-to-learn, medium mastery"
  emotional-beats:
    - quick-feedback
    - small-combo-satisfaction
    - near-fail-recovery

gameplay-pillars:
  - id: readable-state
    description: "玩家一眼能看出可行动作和目标"
  - id: meaningful-ordering
    description: "行动顺序影响结果"
  - id: escalating-pressure
    description: "后续关卡增加限制或障碍"

core-loop:
  observe: "观察棋盘、单位、资源"
  decide: "选择派出对象或操作方向"
  act: "执行一次操作"
  feedback: "即时反馈命中、失败、奖励"
  progress: "推进关卡目标或资源状态"

player-verbs:
  primary:
    - select
    - move
    - match
    - dispatch
  secondary:
    - retry
    - optimize
    - chain

decision-points:
  - id: action-order
    type: strategic
    frequency: high
    impact: medium
  - id: resource-spend
    type: risk-reward
    frequency: medium
    impact: high

progression:
  stage-1:
    teaches:
      - core-rule
      - win-condition
    content:
      levels: 1
      enemy-types: 0
      item-types: 0
  stage-2:
    teaches:
      - blockers
      - multi-step-planning
    content:
      levels: 5
      enemy-types: 1
      item-types: 1
  stage-3:
    teaches:
      - combo
      - resource-tradeoff
    content:
      levels: 10
      enemy-types: 3
      item-types: 3

level-design:
  principles:
    - introduce-one-new-idea-at-a-time
    - early-levels-should-be-solvable-with-obvious-action
    - later-levels-should-require-planning
  metrics:
    min-meaningful-decisions: 3
    max-session-failures-before-retry: 2
    expected-actions-per-level: [5, 15]

resource-loop:
  resources:
    - id: score
      purpose: feedback
    - id: energy
      purpose: action-budget
    - id: coins
      purpose: upgrade-loop
  sinks:
    - retries
    - hints
    - upgrades
  sources:
    - level-clear
    - combo
    - bonus-objective

content-taxonomy:
  enemies: []
  obstacles: []
  items: []
  powerups: []
  level-modifiers: []

polish-plan:
  feedback:
    - hit-flash
    - combo-float-text
    - fail-shake
    - clear-celebration
  audio:
    - click
    - success
    - failure
  animation:
    - button-press
    - entity-spawn
    - entity-destroy

complexity-budget:
  max-new-systems-current-stage: 2
  max-new-entity-types-current-stage: 3
  max-levels-current-stage: 5
```

这层的核心作用是：**让后面的 specs/codegen 不再只是“实现功能”，而是围绕一套游戏性目标展开。**

------

# 3. 分阶段生成是最关键的方向

你准备从“一次生成完整游戏”改成“自动分阶段生成”，这是我最支持的一点。

因为完整小游戏的复杂度不是线性的。你一次性要求：

```
核心玩法
多关卡
多敌人
多道具
成长系统
难度曲线
资源循环
动画音效
UI polish
```

模型大概率会出现：

```
1. 每个都有一点，但都很浅。
2. 状态管理爆炸。
3. 关卡不可解。
4. 新增系统互相打架。
5. 测试只覆盖 happy path。
6. 最终像 demo 合集，不像完整游戏。
```

分阶段生成能把复杂度拆开，而且每一阶段都能验证。

## 我建议的阶段不是“先 MVP，再加功能”，而是“vertical slice → content → variety → progression → polish”

更推荐这样的阶段：

### Stage 0：设计蓝图，不写代码

输出：

```
game-prd.md
design-strategy.yaml
stage-roadmap.yaml
```

目标是先确定：

```
这个游戏到底靠什么好玩？
核心循环是什么？
长期扩展路线是什么？
第一阶段只做什么？
哪些系统暂不实现但要预留接口？
```

### Stage 1：Playable Vertical Slice

不是传统意义的“最低可运行 MVP”，而是**一个小但完整、反馈足够好的核心体验切片**。

应该包含：

```
核心玩法
1 个关卡或 1 个完整回合
明确胜负
失败/重试
基础反馈
基础 UI
基础素材
少量 polish
```

Stage 1 的目标不是功能多，而是：

```
玩家能理解、能操作、能赢、能输、能感到一点爽感。
```

这比“裸 MVP”强很多。

### Stage 2：Content Expansion

增加：

```
多关卡
关卡选择
基础难度递进
更多初始布局/题目/地图
关卡完成记录
```

这个阶段不要急着加新系统，重点是：

```
用同一个核心玩法产生更多内容。
```

### Stage 3：Variety Expansion

增加：

```
敌人类型
障碍类型
道具类型
特殊格子
目标变体
```

这个阶段开始增加“玩法横向变化”。

### Stage 4：Progression / Economy / Resource Loop

增加：

```
金币/星星/经验
升级
解锁
提示/消耗品
连续奖励
成就
```

这个阶段解决“为什么继续玩”。

### Stage 5：Balance and Polish

增加：

```
难度曲线调参
关卡重排
动画节奏
音效
新手引导
失败反馈
性能优化
视觉统一
```

这一步很重要。很多生成游戏不好玩，不是规则错，而是：

```
反馈太弱
节奏太平
失败太突然
奖励不明显
操作没有手感
```

所以 polish 不能只是最后“美化一下”，而应该有专门阶段。

------

# 4. 分阶段生成要有“stage contract”，否则会失控

分阶段生成最大的风险是：每一阶段都往代码里加东西，最后变成一团状态泥。

所以每个阶段必须有一个结构化契约：

```
stage:
  id: 2
  name: content-expansion
  goal: "从 1 个核心关卡扩展为 5 个递进关卡"

scope:
  add:
    - level-select
    - 5-level-data
    - level-clear-record
  preserve:
    - core-mechanic
    - win-condition
    - input-model
    - render-style
  forbid:
    - new-enemy-system
    - economy
    - upgrade-system

new-systems:
  - level-manager
  - level-select-ui

data-changes:
  add:
    - levels[]
    - level-stars
  migration:
    from: stage-1-single-level
    to: stage-2-level-array

acceptance:
  product:
    - user-can-select-level
    - every-level-can-be-cleared
    - level-1-is-easier-than-level-5
  semantic:
    - all-levels-solvable
    - no-softlock-after-valid-action
  visual:
    - level-select-visible
    - clear-feedback-visible

complexity-budget:
  max-new-rules: 4
  max-new-entities: 2
  max-new-ui-panels: 2
```

这个 contract 的价值是：

```
它告诉 codegen 当前阶段只能加什么，不能乱加。
```

否则 Stage 2 可能顺手加敌人，Stage 3 又改资源，Stage 4 又重写核心循环，最后每阶段都在破坏前一阶段。

------

# 5. 你还需要一个 `stage-roadmap.yaml`

在 Stage 0 就应该生成总路线：

```
version: 1

current-stage: 1
target-final-stage: 4

stages:
  - id: 1
    name: vertical-slice
    goal: "核心玩法闭环"
    user-confirmation: required
    deliverables:
      - core-loop
      - one-level
      - win-lose
      - retry
      - basic-feedback

  - id: 2
    name: multi-level
    goal: "内容扩展与难度递进"
    user-confirmation: required
    deliverables:
      - level-select
      - 5-levels
      - level-clear-record

  - id: 3
    name: variety
    goal: "增加策略变化"
    user-confirmation: optional
    deliverables:
      - enemy-types
      - obstacles
      - items

  - id: 4
    name: progression
    goal: "增加长期目标"
    user-confirmation: optional
    deliverables:
      - currency
      - upgrades
      - rewards

  - id: 5
    name: polish-balance
    goal: "优化手感、反馈、难度曲线"
    user-confirmation: optional
    deliverables:
      - tutorial
      - animations
      - sound
      - balance-pass
```

这样用户确认时不是一句：

```
要不要继续？
```

而是：

```
当前 Stage 1 已完成核心体验。
下一阶段将扩展 5 个关卡和关卡选择，不新增敌人/经济系统。
```

这会显著减少用户反馈里的歧义。

------

# 6. 用户确认应该确认“体验”，不是确认代码

你说：

> 第一阶段生成 mvp 让用户确认效果后，第二阶段展开多关卡……

这个很好，但确认点要设计好。

用户不应该确认：

```
代码有没有问题
```

而应该确认：

```
核心玩法是否符合预期
操作是否舒服
反馈是否清楚
是否愿意在这个基础上加内容
下一阶段优先加什么
```

建议每个阶段交付时给用户一个简短确认面板：

```
本阶段完成：
- 核心玩法：已完成
- 胜负循环：已完成
- 重试：已完成
- 基础反馈：已完成

请确认下一阶段方向：
A. 增加更多关卡
B. 增加敌人/障碍
C. 增加道具/资源
D. 先优化手感和视觉
E. 让我决定
```

但系统内部仍然要有默认路线，不能每次都把设计选择全部抛给用户。

------

# 7. 你没有充分覆盖的几个点

下面这些是你当前思路里还需要补的。

## 7.1 复杂度预算

加深游戏性会天然增加复杂度，所以每个阶段必须有限制：

```
complexity-budget:
  max-new-systems: 2
  max-new-entities: 3
  max-new-rules: 5
  max-new-scenes: 1
  max-new-resources: 2
  max-new-asset-slots: 5
```

否则模型很容易在 Stage 2 就把：

```
多关卡 + 敌人 + 道具 + 经济 + 成就 + 商店
```

全加进去，稳定性立刻崩。

## 7.2 架构预留

Stage 1 虽然只做一个关卡，但代码结构必须为后续扩展预留：

```
不要把 level 写死在 render 函数里。
不要把 enemy 行为写死在 click handler 里。
不要把胜负条件散落在多个 UI 函数里。
不要让 stage 2 为了多关卡重写 stage 1。
```

所以 Stage 1 就应该要求：

```
LevelManager
GameState
RuleSystem
RenderSystem
AssetRegistry
FxSystem
InputSystem
```

哪怕这些系统一开始很小，也要有边界。

## 7.3 数据迁移

分阶段生成会遇到：

```
Stage 1: initialLevel 是 object
Stage 2: levels 是 array
Stage 3: levels 里多 enemySpawns
Stage 4: levels 里多 rewards
```

所以要有：

```
data-version: 1
migration:
  from: 1
  to: 2
```

哪怕只是简单迁移，也要让链路知道：

```
这是一次数据 schema 变化，不是随便改 data.yaml。
```

## 7.4 关卡可解性和难度验证

一旦你加多关卡，不能只靠“能启动”和“有胜利路径”。

需要新增：

```
check_level_solvability
check_difficulty_curve
check_content_uniqueness
```

最基本的难度曲线指标：

```
difficulty-metrics:
  level-1:
    expected-actions: 3
    failure-risk: low
    new-concepts: [core-rule]
  level-5:
    expected-actions: 8
    failure-risk: medium
    new-concepts: [blocker, combo]
```

检查项可以是：

```
1. 每关至少一条 solution path。
2. 后一关不能比前一关明显更简单，除非是教学缓冲关。
3. 每关至少引入一个差异点，避免换皮重复。
4. 不允许所有关卡同构。
```

## 7.5 游戏性指标不要只靠 LLM 主观评价

可以引入“玩法指标”：

```
playability-metrics:
  meaningful-decisions-min: 3
  failure-path-required: true
  retry-loop-max-seconds: 5
  feedback-latency-ms-max: 200
  level-duration-target-seconds: [30, 90]
  distinct-challenges-min: 3
```

这些不是绝对真理，但能防止生成游戏只是：

```
点一下 -> 赢了
点错 -> 没反馈
关卡 1-5 只是数值变大
```

## 7.6 Polish 需要独立系统，不是最后补 CSS

你说“拔高游戏表现”，这里不要只理解成玩法深度。游戏表现至少包括：

```
视觉反馈
动画节奏
音效
打击感
状态可读性
失败反馈
胜利庆祝
操作手感
```

建议新增一个 `juice-plan.yaml` 或放到 strategy 里：

```
juice-plan:
  input-feedback:
    - button-press-scale
    - hover-highlight
  success-feedback:
    - float-score
    - particle-burst
    - sound-success
  failure-feedback:
    - screen-shake
    - red-flash
    - sound-error
  progression-feedback:
    - level-complete-panel
    - star-animation
```

而且每个核心动作都应该绑定反馈：

```
玩家操作 -> 立即反馈
规则命中 -> 视觉反馈
资源变化 -> 数字/动画反馈
失败 -> 原因反馈
胜利 -> 奖励反馈
```

## 7.7 用户反馈分类要升级为 staged feedback

你现在已有反馈后回 PRD/spec/code 的机制。但分阶段后，需要区分：

```
bug:
  当前阶段修复，不推进下一阶段。

tuning:
  当前阶段调参，不新增系统。

stage-scope-change:
  改当前阶段目标。

next-stage-preference:
  写入下一阶段 plan。

design-pivot:
  回 Stage 0/PRD。
```

否则用户说“感觉太简单了”，系统可能错误地在当前代码里乱加敌人，而不是进入下一阶段的难度/关卡扩展。

------

# 8. 我建议的新链路形态

你可以把后续链路改成这样：

```
Phase 1: Understand
  -> brief.md

Phase 2: Game APRD
  -> game-prd.md

Phase 2.5A: User Clarify
  -> spec-clarifications.md

Phase 2.5B: Game Design Expansion
  -> design-strategy.yaml
  -> stage-roadmap.yaml

Phase 3A: Current Stage Planning
  -> stage-contract.yaml
  -> stage-acceptance.yaml

Phase 3B: Mechanics Binding
  -> mechanics.yaml
  -> rule/data/scene/assets/event-graph
  -> implementation-contract.yaml

Phase 4: Codegen Current Stage
  -> game/

Phase 5: Verify Current Stage
  -> report.json
  -> playability report
  -> stage summary

Phase 6: User Confirmation / Auto Advance
  -> next-stage-request.yaml

Next Stage:
  -> diff-based expansion
  -> preserve previous invariants
```

这里的关键是：

```
每一阶段只生成当前 stage 的代码，
但保留后续 stage 的路线和扩展点。
```

------

# 9. 不同游戏类型的阶段策略应该不同

不要所有游戏都套同一套 Stage 2/3/4。

## 答题类

```
Stage 1:
  单题/少量题，答题闭环，正确/错误反馈。

Stage 2:
  题库、分类、关卡、计分。

Stage 3:
  连击、限时、提示、错题本。

Stage 4:
  成就、等级、解锁、复习机制。
```

## 网格棋盘类

```
Stage 1:
  一个棋盘，一个核心规则，一个胜负目标。

Stage 2:
  多关卡、关卡选择、不同布局。

Stage 3:
  新障碍、新目标、新特殊格子。

Stage 4:
  星级评价、道具、挑战模式。
```

## 单屏反应类

```
Stage 1:
  单目标类型，计分/倒计时/失败反馈。

Stage 2:
  难度曲线、目标出现节奏。

Stage 3:
  多目标、陷阱、连击、道具。

Stage 4:
  成就、排行榜、本地记录。
```

## 横版/动作类

```
Stage 1:
  移动、跳跃/射击、碰撞、一个短关卡。

Stage 2:
  关卡段落、检查点、基础敌人。

Stage 3:
  敌人类型、道具、机关。

Stage 4:
  难度曲线、手感 polish、动画音效。
```

这说明你的 staged generation 不应该只是时间顺序，而应该由 archetype 决定。

------

# 10. 最终评价

你的三点方案里：

## 方案 1：取消 mechanic 原语做对比

**可以做实验，但不建议正式取消。**

更好的方式是：

```
强模型先做设计和机制提案；
已有原语负责稳定实现；
无法覆盖的机制进入 bespoke + probes；
重复出现的 bespoke 再沉淀为新原语。
```

也就是说：

```
不要从 primitive-first 变成 fully-free。
要变成 design-first, primitive-bound when possible。
```

## 方案 2：增加策略展开层

**非常正确，而且这是拔高游戏性的关键。**

但不要和澄清层完全合并。建议拆成：

```
用户澄清：少问、只问方向。
策略展开：内部自动补全游戏设计深度。
```

它应该输出：

```
设计支柱
核心循环
策略深度
资源循环
关卡设计原则
难度曲线
内容类型
polish 计划
stage roadmap
complexity budget
```

## 方案 3：一次生成改成分阶段生成

**这是最重要的一步。**

真正高质量小游戏不应该一次生成完，而应该：

```
vertical slice
  -> content expansion
  -> variety expansion
  -> progression/economy
  -> balance/polish
```

每阶段都要有：

```
stage-contract
preserve invariants
complexity budget
acceptance checks
user confirmation
failure attribution
```

------

# 11. 我建议你下一步优先做的三件事

第一，新增 `design-strategy.yaml` 和 `stage-roadmap.yaml`，先不要动 codegen。
这一步先让链路能“设计一个更好玩的游戏”。

第二，新增 `stage-contract.yaml`，让每次生成只实现当前阶段，不要一次性塞完整游戏。

第三，保留 mechanic yaml，但把它后移到“机制绑定层”，不要再让它过早压缩玩法设计。

最终目标应该是：

```
APRD 负责需求真实；
Design Strategy 负责游戏性；
Stage Contract 负责复杂度控制；
Mechanics Binding 负责实现可控；
Codegen 负责当前阶段交付；
Verify 负责当前阶段质量；
User Confirmation 负责下一阶段方向。
```

这比继续硬扣生成层更接近你真正想要的东西：**不是生成一个能跑的 demo，而是逐步生成一个真的有玩法、有反馈、有内容、有成长空间的小游戏。**