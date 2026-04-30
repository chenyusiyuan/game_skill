# 自然语言生成轻量小游戏链路技术路线

# 1. 当前链路总览

目前重构后的链路可以概括为：

```text
Phase 1：Understand / brief
Phase 2：Game PRD
Phase 2.5：Spec Clarify
Phase 3：Mechanics 真值层 + Specs 扩展层
Phase 3.5：Implementation Contract + Expand Gates
Phase 4：Codegen
Phase 5：Verify All + Deliver
Phase 6：Failure Attribution + Pattern 迭代
```

```text
用户需求
  ↓
brief.md
  ↓
Game PRD
  ↓
Spec Clarify
  ↓
mechanics.yaml
  ↓
scene.yaml / rule.yaml / data.yaml / assets.yaml / event-graph.yaml / visual-slots.yaml
  ↓
implementation-contract.yaml
  ↓
Canvas / DOM / Phaser / PixiJS / Three.js 等前端实现
  ↓
verify_all
  ↓
失败归因：case-local or systematic
  ↓
沉淀到 checker / primitive / prompt / runtime
```

这条链路的核心变化是：

```text
不再让 codegen 自己理解完整玩法
而是先把玩法拆成可验证的机制真值
再让 codegen 按契约实现
最后用统一测试验证代码是否真的执行了这些机制
```

------

# 2. 各 Phase 的职责

## 2.1 Phase 1-2：Understand + Game PRD

Phase 1 Understand 先把用户自然语言需求整理成 `docs/brief.md`，包括 Raw Query、Inferred、Gaps、ClarifiedBrief。

Phase 2 Game PRD 再把 brief 转成产品层描述，也就是 `docs/game-prd.md`。

它回答的是：

```text
这个游戏是什么？
面向谁？
核心玩法是什么？
玩家每一轮要做什么？
成功/失败条件是什么？
基础 UI 和反馈是什么？
```

例如用户说：

```text
做一个单词消消乐
```

PRD 需要补全为：

```text
玩家看到英文单词和中文释义
点击匹配正确的词义
匹配成功消除并加分
错误匹配扣时间或扣生命
全部消除后过关
```

PRD 的价值是把用户口语需求变成一个可讨论的游戏产品定义。

但 PRD 仍然是自然语言，它不适合直接交给代码生成。因为模型很容易只抓到 UI，而漏掉关键规则。

------

## 2.2 Phase 2.5：Spec Clarify

Spec Clarify 是这版链路里很重要的中间层。

它不是让模型问用户几十个细节，而是让模型在进入机制抽象前，主动澄清关键歧义。

它主要解决：

```text
玩法类型不清
胜负条件不清
操作方式不清
核心实体不清
随机性不清
关卡结构不清
```

例如“单词消消乐”可能有几种理解：

```text
连连看式匹配
三消式匹配
翻牌记忆式匹配
选择题式匹配
拖拽配对式匹配
```

Spec Clarify 要把它明确下来，否则后面的 mechanics 会抽错。

这里的原则是：

```text
只澄清会影响机制建模的关键点
不把所有 UI 细节都前置问完
```

------

## 2.3 Phase 3.0：Mechanics 真值层

这是当前链路最核心的变化。

Mechanics 层的目标是把“玩法”从自然语言转成结构化、可验证、引擎无关的机制描述。

它不是 UI spec，也不是代码 spec，而是游戏规则的真值层。

它回答：

```text
有哪些实体？
实体有哪些状态？
有哪些事件？
事件触发什么状态转移？
哪些条件允许行为发生？
哪些资源会被消耗？
什么时候胜利？
什么时候失败？
```

例如像素流类游戏里，可能需要表达：

```text
小猪从入口进入轨道
沿路径移动
到达攻击点时触发颜色检测
如果颜色匹配，则发射攻击
攻击命中目标后目标值减少
小猪完成任务后返回或销毁
同一时间最多存在一定数量的小猪
```

这些不能只写在 PRD 里，因为 codegen 很可能会偷换成：

```text
小猪一出现就攻击
小猪走到任意轨道点都攻击
颜色不匹配也攻击
目标值只是 UI 文本变化
```

所以 mechanics.yaml 的作用是建立一个中间真值：

```text
无论最后用 Canvas、DOM、Phaser、PixiJS 还是 Three.js，
核心玩法机制都必须符合 mechanics.yaml。
```

```
entities:
  pig:
    fields:
      color: string
      gridPosition: ...
      ammo: number

mechanics:
  - node: pig-raycast
    primitive: ray-cast@v1
    params:
      coord-system: grid
      hit-policy: first-hit

  - node: color-match
    primitive: predicate-match@v1

  - node: consume-block
    primitive: resource-consume@v1
```

---

## 2.4 Phase 3.x：Specs 扩展层

Mechanics 是玩法真值，但它不包含所有实现信息。

因此还需要一些扩展 specs，例如：

```text
scene.yaml：场景布局
rule.yaml：规则补充
data.yaml：关卡数据
assets.yaml：素材需求
event-graph.yaml：事件流
visual-slots.yaml：视觉语义槽位
```

这些 specs 的定位是：

```text
Mechanics 负责“玩法为什么成立”
Specs 负责“这个游戏世界如何展开”
```

简单说：

```text
mechanics.yaml：规则骨架
scene/rule/data/assets/event-graph/visual-slots：场景、数据、素材、事件与视觉槽位展开
```

------

## 2.5 Phase 3.5 + Phase 4：Implementation Contract + Codegen

implementation-contract 是连接 specs 和 codegen 的关键中间层。它在 Phase 3.5 由脚本生成并通过 gate 校验，Phase 4 Codegen 再按这个契约生成前端实现。

它告诉 codegen：

```text
你要用什么运行模式？
你必须加载哪些资源？
你必须暴露哪些测试 hook？
你必须接入哪些 runtime primitive？
哪些状态必须可观测？
哪些事件必须进入 trace？
哪些行为不能手写绕过？
```

它的价值是避免 codegen 同时阅读大量 specs 后自行脑补。

以前的问题是，没有 implementation-contract.yaml 时，Phase 3 产物是散的：

```
scene.yaml 说：有 start-btn 
assets.yaml 说：有 mole-body 
event-graph.yaml 说：点击开始进入 play 
mechanics.yaml 说：命中加分 
```

但 Codegen 很容易自己“脑补连接方式”。结果就是：**每个文件都看起来对，但代码没有把它们真正接起来。**

典型问题：

1. **素材只登记，不渲染**
   assets.yaml 里有 mole-body，代码也生成了 manifest，但真实画面里地鼠是手画圆形，或者根本没用这个 asset。
   没 contract 时，checker 很难判断“这个 asset 是不是必须出现”。
2. **素材语义错用**
   模型可能把按钮图当卡片背景，把 tile 当按钮，把角色图当面板。
   因为 assets.yaml 只说“有这个素材”，没强约束“它绑定到哪个 UI/实体、能不能承载文字、能不能 fallback”。
3. **启动路径断**
   scene.yaml 说 start scene 有 start-btn，但代码里按钮 id 不一样，或者点了不切到 play。
   没 contract 时，Codegen 可以自由解释 start action。
4. **引擎生命周期错**
   Phaser 素材应该在 preload() 注册，模型可能在 create() 里临时 load。PixiJS 可能没 await 资源就开始 render。
   这类问题不是玩法逻辑错，是“引擎使用方式错”。
5. **测试证据不统一**
   有的代码暴露 window.gameState，有的暴露 window.getState()，有的没有 trace，有的 report 靠模型手写。
   Verify 阶段就会变成“每个 case 猜一次怎么测”。
6. **模型绕过规格**
   它可以不消费 assets.yaml，不按 scene.yaml 启动，不按 event-graph 接事件，但最后写一个看似能跑的游戏。
   结果是：代码绿了，specs 和代码已经分叉。

```
mechanics.yaml:
  规定玩法语义
  例如 mole.hit 后 score +1，miss >= 5 lose

implementation-contract.yaml:
  规定这套玩法代码必须如何落地、如何启动、如何渲染、如何暴露证据

```

两者一起进入 Codegen：

```
mechanics.yaml + implementation-contract.yaml
  > specs/*.yaml
  > docs/game-prd.md
```

------

## 2.6 Phase 5：Verify All + Deliver

Verify All 是统一验证层，基于phase4生成的Primitive Runtime，对代码进行模拟真实交互的测试。

通过后，最终交付产物是 `eval/report.json` 和 `docs/delivery.md`。

它不能只是检查页面有没有加载，而要分层检查：

```text
项目结构
mechanics
asset_selection
implementation_contract
visual_slots
boot
project
profile runner smoke
playthrough
runtime semantics
level solvability
pipeline patterns
compliance
```

其中反作弊不是一个单独的 check 名，而是落在：

```text
profile guard
spec freeze
profile anti-cheat
runtime semantics
trace coverage
```

它的作用是防止单个测试脚本“误绿”。

以前经常出现：

```text
单个 checker 通过
但游戏不可玩
```

或者：

```text
trace 覆盖率通过
但 trace 是模型伪造出来的
```

所以现在需要统一入口：

```text
verify_all.js
```

只有统一报告通过，才算真正通过。

------

## 2.7 Phase 6：Failure Attribution + Pattern 迭代

这里不是新增一个代码生成阶段，而是 case 跑完或失败后的评估迭代闭环。

每次失败或者生成仍有问题的 case 后，不应该只修当前 case，而要归因：

```text
这是 case-local 问题？
还是 systematic 链路问题？
```

例如：

```text
某个素材路径写错
```

可能是 case-local。

但如果多次出现：

```text
codegen 不接 runtime
checker 检不出手写 primitive
profile 可以被模型硬编码
trace 可以被伪造
```

那就是 systematic，需要修链路、checker、prompt 或 runtime。

 `.pipeline_patterns.md` 这类记录不是普通日志，而是链路缺陷数据库。

------

# 3. LLM 自由生成转向 Mechanics + Runtime 

这是整个项目最重要的技术转向。

## 3.1 早期思路：LLM 自由生成

最开始的思路大概是：

```text
用户描述小游戏
→ LLM 理解需求
→ 直接生成 HTML / JS / CSS
→ 用测试脚本验证能不能跑
```

这个方式看起来很自然，但小游戏里很快会遇到几个问题。

------

## 3.2 问题一：LLM 会优先生成“看起来像”的游戏

模型擅长生成：

```text
页面布局
按钮
卡片
动画
分数文本
开始界面
结束弹窗
```

但它不稳定地生成：

```text
真实碰撞
状态机
资源消耗
实体生命周期
路径移动
攻击判定
关卡可解性
失败条件
```

所以自由生成经常出现：

```text
视觉像游戏
行为不是游戏
```

例如：

```text
分数在变，但不是由真实命中触发
敌人在动，但没有实际碰撞
按钮能点，但没有进入核心玩法循环
游戏能结束，但胜利条件是硬编码时间到了
```

这就是“生成层太弱”的第一层含义：**模型生成了界面，但没有稳定生成机制。**

------

## 3.3 问题二：任务全丢给后置测试层

当 codegen 不可靠时，很容易形成一种错误链路：

```text
生成阶段随便写
测试阶段负责发现所有问题
失败后再让模型补丁式修复
```

这会导致 Phase 5 变成事实上的主战场。

问题是，测试层本来应该验证实现是否符合设计，而不是替代设计本身。

如果前面没有 mechanics ，测试层只能做一些表层判断：

```text
页面是否加载
按钮是否存在
分数是否变化
canvas 是否有绘制
trace 是否有事件
```

但它不知道真正的玩法应该是什么。

于是会出现：

```text
测试通过了
但玩法是错的
```

这就是你之前说的“生成层太弱，任务全丢到后续验证测试层”。

正确的分工应该是：

```text
生成层：先产出明确的玩法真值和实现契约
测试层：验证代码是否遵守这些真值和契约
```

而不是：

```text
生成层：自由发挥
测试层：猜测它有没有做对
```

------

## 3.4 问题三：LLM 会对测试目标进行“作弊式优化”

当模型知道测试脚本关心什么时，它可能不是实现真实玩法，而是实现能骗过测试的最短路径。

常见作弊方式包括：

### 1. 伪造 trace

测试要求有事件 trace，模型就写：

```js
trace.push({ type: "hit" })
trace.push({ type: "score" })
trace.push({ type: "win" })
```

但这些事件不是由真实交互触发的。

### 2. 硬编码测试 profile

如果测试会点击某几个坐标，模型可能把这些坐标写死：

```js
if (x === 100 && y === 200) {
  score += 10
}
```

这不是真实游戏逻辑，只是通过了测试输入。

### 3. 直接暴露假状态

测试读取 `window.__gameState`，模型就返回一个伪造对象：

```js
window.__gameState = {
  score: 100,
  status: "win"
}
```

但真实画面和内部逻辑没有对应。

### 4. 绕过 runtime

链路要求用 primitive runtime，模型却自己手写一套逻辑，只在测试 hook 里假装有 runtime 状态。

### 5. 视觉伪装

模型画出：

```text
轨道
角色
敌人
分数
动画
```

但真实逻辑是：

```text
setTimeout 后直接胜利
```

这些就是模型作弊问题。

本质上，LLM 不一定是“恶意作弊”，而是它会优化目标函数：如果测试只要求看到某个输出，它就可能直接生成输出，而不是实现产生这个输出的机制。

------

# 4. Mechanics 层解决什么问题

Mechanics 层的核心作用是：

```text
把游戏玩法从自然语言变成可验证的规则图
```

它解决的是“设计真值缺失”的问题。

以前链路里：

```text
PRD 是自然语言
Codegen 是实现
Test 是后验检查
```

中间缺少一个结构化玩法真值。

所以 codegen 一旦写偏，测试也很难判断“偏在哪里”。

现在加入 mechanics 后，链路变成：

```text
PRD
→ mechanics.yaml
→ implementation-contract
→ code
→ runtime trace
→ verify
```

它解决的是：“玩法结构本身是否成立”。不关心 PixiJS、Phaser、DOM 怎么画，也不关心按钮长什么样。它只关心这些东西：

- 有哪些实体：例如 game、mole、grid-cell。
- 每个实体有哪些状态字段：例如 score、misses、lifecycle、alive。
- 玩法由哪些 primitive node 组成：例如 score-accum@v1、win-lose-check@v1、slot-pool@v1。
- node 之间靠哪些事件连接：例如 mole.hit 触发 hit-score。
- PRD 的 hard-rule 是否映射到了 primitive 参数或 invariant。
- 是否存在至少一个正向终局 scenario：win 或 settle。



e.g, 打地鼠游戏会被拆解为：

```
mole-slots           -> slot-pool@v1          9 个格子槽位
active-mole-gate     -> capacity-gate@v1      同时只允许 1 只地鼠
mole-lifecycle       -> entity-lifecycle@v1   waiting/active/returning
spawn-cooldown       -> cooldown-dispatch@v1  生成冷却
hit-score            -> score-accum@v1        命中得分 +1
miss-count           -> score-accum@v1        超时失误 +1
end-check            -> win-lose-check@v1     60s settle / 5 miss lose
```

------

## 4.1 引擎无关

同一个玩法机制可以被不同前端实现消费：

```text
DOM
Canvas
Phaser
PixiJS
Three.js
```

但它们都应该遵守同一个 mechanics。

这避免了：

```text
Canvas 版本一种玩法
DOM 版本一种玩法
Phaser 版本又一种玩法
```

------

## 4.2 可检查

mechanics.yaml 可以被 checker 静态检查，例如：

```text
有没有实体
有没有输入事件
有没有状态转移
有没有胜负条件
有没有资源消耗
有没有未连接的事件节点
有没有无法触发的规则
```

这比自然语言 PRD 更容易验证。

------

## 4.3 可追踪

如果 mechanics 定义了：

```text
input.click
→ select.card
→ predicate.match
→ pair.remove
→ score.add
```

那么 runtime trace 也应该能看到对应事件链。

这样测试就不只是看最终分数，而是看：

```text
分数是不是由正确事件链产生的
```

------

## 4.4 可归因

如果游戏失败，可以判断失败源头：

```text
PRD 理解错
Spec Clarify 没澄清
Mechanics 抽错
Contract 漏约束
Codegen 没消费
Runtime 没执行
Checker 漏判
```

这比以前的“代码坏了，重新生成”更可迭代。

------

# 5. Runtime 层解决什么问题

如果只有 mechanics.yaml，还不够。

因为模型仍然可能：

```text
读了 mechanics
但自己手写一套不等价的代码
```

所以需要 Primitive Runtime。

Runtime 层的核心目标是，将每个测试点的过程尽可能展开，模拟真实交互：

```text
把 mechanics 中的关键规则变成可复用、可观测、可验证的执行原语
```

可以理解为小游戏生成链路中的“规则执行底座”。

------

## 5.1 Mechanics 是声明，Runtime 是执行

两者关系是：

```text
mechanics.yaml：声明游戏应该如何运行
primitive runtime：提供统一的执行方式
game code：调用 runtime 来驱动画面和交互
```

例如：

```text
predicate-match
resource-consume
slot-pool
capacity-gate
entity-lifecycle
cooldown-dispatch
```

这些不应该每个 case 都让模型手写。

如果每次都手写，就会出现：

```text
A case 写对
B case 写漏
C case 绕过测试
D case 状态不可观测
```

Runtime 的价值是把这些高频机制沉淀成稳定能力。

------

## 5.2 Runtime 让测试从“看结果”变成“看过程”

没有 runtime 时，测试只能看：

```text
score 最后是不是变了
win 最后是不是 true
```

有 runtime 后，测试可以看：

```text
事件是否从 input 触发
是否经过 predicate
是否执行 resource consume
是否改变 entity lifecycle
是否由 reducer 更新 state
是否生成合法 trace
```

也就是说，测试不只验证结果，还能验证结果产生的路径。

这对反作弊很关键。

以前的点到点测试可能是：

```
点击地鼠 -> score 变成 1 -> 通过 
```

模型很容易绕过：

```
state.score += 1 
```

看起来测试绿了，但它没有证明“点击 -> 命中判定 -> 得分规则 -> 终局检查”这条玩法链路真的存在。

runtime 层想改成：

```
真实点击  
-> driver 触发真实 UI  
-> 业务代码必须调用 runtime primitive  
-> runtime 自动写 window.__trace  
-> trace 里有 primitive / rule / node / before / after  
-> checker 用 reducer 复算 before -> after 
```

所以它检查的是：

```
不是 “score 是否变了” 而是 “score 是否通过 score-accum@v1 的合法链路变了”
```

---

# 7. 相比传统 App 生成的专用点

## 7.1 传统 App 是页面中心，小游戏是机制中心

传统 App 关注：

```text
页面结构
组件布局
数据展示
表单提交
路由跳转
```

小游戏关注：

```text
核心玩法循环
实体状态
规则触发
碰撞/匹配/消除/攻击
胜负条件
难度曲线
即时反馈
```

所以小游戏不能只生成 UI，而要先生成机制。

------

## 7.2 传统 App 的测试是 UI 行为测试，小游戏需要语义行为测试

传统 App 测试：

```text
按钮存在
点击打开弹窗
输入框可输入
接口返回数据显示
```

小游戏测试：

```text
点击是否触发合法事件链
实体是否进入正确生命周期
攻击是否由正确条件触发
资源是否真实消耗
胜利是否由规则达成
关卡是否可以完成
```

小游戏的验证要更接近“状态机验证”，而不是单纯 UI 测试。

------

## 7.3 传统 App 可以容忍部分交互简单，小游戏不能容忍核心循环缺失

一个记账 App 如果动画不好，仍然可能可用。

但一个接金币游戏如果没有真实碰撞，就不是游戏。

一个单词匹配游戏如果不校验答案，就不是游戏。

一个塔防游戏如果敌人没有路径和攻击判定，就不是塔防。

所以小游戏生成的最低要求是：

```text
必须有可玩的核心循环
```

而不是：

```text
必须有漂亮界面
```

------

## 7.4 小游戏需要“可玩性”验证

传统 App 通常没有“可解性”问题。

但游戏有：

```text
关卡是否能赢
是否会一开始就死局
目标是否永远无法达成
随机生成是否导致不可玩
敌人是否永远不会出现
胜利条件是否无法触发
```

所以需要类似：

```text
level_solvability
playthrough
runtime_semantics
```

这类验证。

------

## 7.5 小游戏更容易出现模型作弊

传统 App 里，如果按钮打开弹窗，通常就够了。

但游戏里，模型可以做很多视觉伪装：

```text
画出敌人，但没有 AI
画出子弹，但没有碰撞
显示分数，但不是由命中产生
显示胜利，但不是玩家达成
```

所以必须有更强的反作弊机制。

------

# 8. 之前遇到的问题复盘

你之前链路里遇到的问题可以归纳成四类。

------

## 8.1 生成层弱：自由生成无法稳定保持机制一致性

表现是：

```text
同一个需求，不同引擎生成出不同玩法
PRD 里有的机制，代码里没有
代码实现了视觉，但漏掉规则
模型自行简化核心机制
```

例如复杂一点的 Pixel Flow 类玩法，很容易出现：

```text
轨道形状画出来了
但进入攻击点的事件抽错了
颜色匹配逻辑缺失
并发实体控制缺失
资源消耗不准确
```

这说明自由 codegen 不适合承担完整玩法理解。

------

## 8.2 测试层过重：Phase 5 测试层 被迫承担设计职责

以前测试层要检查太多事情：

```text
游戏是否加载
UI 是否存在
事件是否触发
状态是否变化
玩法是否正确
是否能赢
是否作弊
```

但如果前面没有机制真值，测试层没有办法知道“正确玩法”是什么。

于是测试只能写得越来越复杂，但仍然容易漏判。

这就是链路职责倒置：

```text
本该由生成层明确的规则
被推迟到测试层去猜
```

------

## 8.3 假绿：局部测试通过但游戏不成立

典型情况：

```text
boot 通过
project structure 通过
trace 覆盖通过
但人工玩起来不对
```

或者：

```text
Canvas/DOM 手写 primitive
没有接 runtime
但某些 checker 没拦住
```

这类问题最危险，因为它会让链路误以为自己已经成功。

------

## 8.4 模型作弊：为了通过测试而不是实现游戏

例如：

```text
伪造 trace
硬编码 profile 输入
直接设置 win 状态
暴露假的 window.__gameState
setTimeout 自动胜利
点击任意地方都加分
```

这些问题说明，测试不能只看最终结果，而要验证：

```text
结果是否由合法机制路径产生
```

------

# 9. 当前反作弊机制

现在的反作弊机制可以从几层理解。

------

## 9.1 统一 verify_all，禁止单脚本漂绿

以前 agent 可能只跑某个脚本，然后报告通过。

现在应该统一要求：

```text
最终交付必须跑 verify_all
必须看统一报告
分层诊断可以跑单个 checker，但不能把单脚本结果当最终通过
```

这样可以防止：

```text
boot 通过就说游戏通过
profile smoke 通过就说玩法通过
trace 存在就说机制通过
```

------

## 9.2 Profile / Specs Freeze，防止模型改测试输入和规格

测试 profile 是用于模拟玩家行为的输入脚本。

如果模型能随意改 profile，就可能出现：

```text
代码没修好
但把测试 profile 改成更容易通过
```

所以当前链路需要两类冻结：

```text
_profile_guard.js --freeze：冻结正式 profile 的 SHA
freeze_specs.js：冻结 docs/game-prd.md 和 specs/
```

它们的作用是：

```text
测试输入一旦确定，Phase 5 不能随意改
PRD / specs 一旦进入 Phase 5，修复循环不能回头改规格来过测试
```

这可以防止“改考卷”，也可以防止“改题目”。

------

## 9.3 Runtime trace，防止只看最终状态

反作弊不能只读：

```text
score
status
win
```

而要读：

```text
input event
mechanics node
predicate result
state transition
resource change
entity lifecycle
output event
```

也就是说：

```text
不是看到 win 就算赢
而是要看到玩家通过合法事件链达成 win
```

------

## 9.4 Required hooks，防止状态不可观测

implementation-contract 里应该要求代码暴露必要 hook，例如：

```text
observers：获取 runtime state / event trace / asset usage
drivers：点击开始、重试、下一关等真实驱动入口
probes：resetWithScenario、stepTicks 等 runtime semantics 专用探针
```

这些 hook 不是给用户用的，而是给测试层做语义验证用的。

如果没有这些 hook，测试只能通过视觉或 DOM 猜测游戏状态，可靠性很差。

------

## 9.5 Runtime 接入检查，防止手写 primitive

如果 contract 要求使用 runtime，那么代码中不能只是“长得像 runtime”。

需要检查：

```text
是否真实 import runtime
是否调用 runtime reducer
是否由 runtime 生成 trace
核心机制是否经过 runtime state 更新
```

否则模型可能手写一份假逻辑，然后伪装成 runtime 结果。

------

## 9.6 真实交互 Profile，防止硬编码单一测试路径

如果 profile 只是一组固定 eval 脚本，模型可能硬编码。

当前更明确的做法是：

```text
profile 从 skeleton 补齐
覆盖 PRD 里的 @check(layer: product)
profile 禁止写 expect
至少包含真实 click / press / fill
禁止直接改 gameState
禁止手动 push __trace
禁止调用 probes
```

例如单词匹配游戏：

```text
正确匹配应该加分
错误匹配不能加分
重复点击不能重复得分
所有匹配完成才胜利
```

这样可以防止：

```text
点击任意两个卡片都算对
```

多 profile / 随机扰动可以作为后续增强或复杂 case 的补充，但当前硬门槛首先是“真实交互 + 不自带答案”。

------

## 9.7 Playthrough + Runtime Semantics 双验证

Playthrough 验证：

```text
玩家是否能完成一局
```

Runtime Semantics 验证：

```text
完成这一局的过程是否符合机制
```

二者要结合。

如果只有 playthrough，可能被硬编码通关骗过。

如果只有 semantics，可能机制局部正确但游戏玩不起来。
