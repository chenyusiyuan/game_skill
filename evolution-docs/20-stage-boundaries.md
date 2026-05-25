# Evolution Docs · Stage Boundaries

本文说明 Stage 2-5 的边界。它不是执行 SOP，而是给后续 worker、reviewer 和实现者看的边界说明。

## 总览

| Stage | 用户意图 | 默认权限 | 主要验证思想 |
|---|---|---|---|
| Stage 2 | 现有行为与预期不一致 | 最小修复，可做 spec correction | 复现 -> 修复 -> 原问题 fail to pass |
| Stage 3 | 想加入目前没有的体验 | 唯一允许 spec shape change | 新机制证据 + 旧机制回归 |
| Stage 4 | 现在玩起来不够好 | 不改契约形状，改数值/时序/反馈 | 对比改前改后，不破坏不变量 |
| Stage 5 | 样子、听感、排布不舒服 | 不改 gameplay 契约，改资源/布局/渲染 | 视觉/听感对比 + 全量回归 |

## Stage 2: 修复

触发意图：用户指出已有行为和预期不一致。典型例子是输入失效、碰撞错误、卡死、掉帧、结算不触发、某个 acceptance 对应行为没有发生。

Stage 2 的核心是复现优先。没有可复现问题，就无法判断修复是否成功。复现可以来自用户步骤、runner diagnostic、delivery warning、mustNot 反例，或未来的 issue 文件。

允许变更：

- 修复现有机制实现。
- 调整现有 smoke 或 repro 证据，使它更稳定地表达原意。
- 做 `spec-correction`，包括补充 `acceptance.mustNot`。
- 最小化修改代码，不借修复之名新增玩法。

禁止变更：

- 新增 `acceptance.mustHave`。
- 新增 control、entity、rule、win/lose 条件。
- 把问题转成新机制实现。
- 为了让 smoke 通过而删除真实失败条件。

退出条件：

- 原问题能从 fail 变成 pass。
- 相关旧验收不退化。
- 如果复现失败，默认停止本轮演进，而不是继续猜修。

Kick-back 信号：

- 发现用户真正想要的是新体验，而不是修现有错误。
- 发现修复需要新增 plan 契约形状。
- 发现所谓 bug 来自用户从未表达过的新期待。

## Stage 3: 新增

触发意图：用户想加入目前没有的体验。典型例子是新增连击系统、道具栏、二段跳、商店、Boss 阶段、关卡目标。

Stage 3 是唯一允许 `spec-shape-change` 的 stage。它使用当前 `plan.json` 做增量，不引入 GDD 子链路，不从头生成一份新设计。

允许变更：

- 新增 `requiredMechanics`、`acceptance.mustHave`、control、rule、entity、win/lose 条件。
- 增量更新 smoke 证据，使新增机制有可观察证明。
- 增加代码和资源来实现新增机制。
- 在新增机制完成后建议后续 Stage 4 light pass，但不强制自动触发。

禁止变更：

- 借新增机制重写无关旧系统。
- 将旧机制回归失败写成非阻塞 todo。
- 为新增机制引入未说明的外部资产或新运行时依赖。
- 把 Stage 1 的首轮大链路作为新增机制实现方式。

退出条件：

- 新机制有正向证据。
- 旧机制全量回归通过。
- 如果基础能力缺失，例如没有持久状态层却要求背包系统，默认停止并报告缺口。

Kick-back 信号：

- 发现 query 实际是现有行为错误。
- 发现用户只想调整数值、节奏或反馈。
- 发现新增机制的需求含糊到无法设计最小契约。

## Stage 4: 深化

触发意图：用户觉得现有玩法“不够好”，但不是要求加入新机制。典型例子是手感不舒服、节奏拖、打击反馈弱、难度曲线不顺、敌人生成太密。

Stage 4 的边界以契约形状为准，不以文件名或“逻辑代码”硬切。Phaser 项目里输入窗、碰撞反馈、命中停顿和速度曲线经常写在同一 scene 中；关键不是碰了哪个文件，而是有没有改变玩家承诺的机制形状。

允许变更：

- 数值：速度、冷却、伤害、血量、分数倍率、生成频率。
- 时序：输入窗口、反馈窗口、关卡节奏、等待时间。
- 反馈层：屏幕震动、命中停帧、粒子密度、短暂 flash。
- 内容数据：关卡数据、敌人波次、掉落概率，前提是不新增契约形状。

禁止变更：

- 新增 control、required mechanic、mustHave、win/lose 条件。
- 把“手感更好”解释成新玩法系统。
- 破坏旧机制的可观察证据。
- 用视觉资源替换来掩盖玩法反馈问题。

退出条件：

- 改前/改后有可比较证据。
- 核心不变量保持，例如控制方式、目标、胜负条件不变。
- 全量回归通过。

Kick-back 信号：

- 发现体验问题来自机制缺失，需要 `spec-shape-change`。
- 发现用户实际在描述 bug。
- 发现想要的是视觉、音效或布局层变化。

Stage 4 kick-back 前必须回滚该 subtask 已写改动，不留下半调参状态。

## Stage 5: 美化

触发意图：用户不满意样子、听感或排布。典型例子是 UI 太挤、颜色不清楚、角色不醒目、音效弱、特效不好看。

Stage 5 关注感官表达，不改变 gameplay 契约。N19 v1 按逻辑串行理解；物理异步美化只作为未来议题，合并前仍必须通过逻辑回归门。

允许变更：

- 资源清单和资源文件。
- 布局参数、字号、对比度、HUD 层级。
- 渲染层代码、动画、粒子、音效触发。
- 截图或多模态评审所需的视觉证据说明。

禁止变更：

- 修改 gameplay 规则、输入语义、胜负条件。
- 新增机制或新增 mustHave。
- 为了画面效果遮挡玩家必须看见的信息。
- 跳过全量回归。

退出条件：

- 视觉或听感问题有对比证据。
- 程序化一致性不退化，例如可读性、对比度、布局不遮挡。
- 全量回归通过。

Kick-back 信号：

- 发现用户真正想要的是手感反馈，而不是资源或布局。
- 发现美化要求需要 gameplay 行为变化。
- 发现资源管线缺失，当前无法安全替换。

## 跨 stage 禁止表

| 操作 | Stage 2 | Stage 3 | Stage 4 | Stage 5 |
|---|---|---|---|---|
| 修复现有行为错误 | yes | no | no | no |
| 新增 mustNot | yes | no | no | no |
| 新增 mustHave | no | yes | no | no |
| 新增 control/rule/entity | no | yes | no | no |
| 调整数值/节奏/反馈 | only if bug | after new feature | yes | no |
| 改资源/布局/渲染 | only if bug | if needed for feature | feedback only | yes |

## Kick-back 协议

worker 发现”这不是我的活”时，只能 kick-back 给 triage router。它不能直接横向交给另一个 stage worker。

**强制回滚是跨 stage 的硬约束**：任何 stage 在 kick-back 之前都必须回滚本 subtask 已写的改动。Stage 4 节单独提到过这一点（参见前文”Stage 4 kick-back 前必须回滚该 subtask 已写改动”），但它并非 Stage 4 专属——Stage 2、3、5 同样适用。worker 不允许留下半截 patch 后再 kick-back，否则 triage 重新路由的输入就不再是干净的当前状态。

kick-back 必须携带三类信息：

- 已回滚该 subtask 的本地改动。
- 为什么当前 stage 不适合继续。
- 推断出的真实用户意图，例如”需要新增机制”或”其实是视觉布局问题”。

**循环 kick-back 上限**：同一 subtask 累计 kick-back 超过 N 次后（N 由后续实施时定，建议默认 3），triage router 必须主动 reject 该 query 并在 evolution log 中记录路由路径，避免 worker A → router → worker B → router → worker A 的死循环。这一条是协议层面的安全阀，不是 LLM 行为预期。

## 失败与回滚矩阵

| 场景 | 默认行为 |
|---|---|
| Stage 2 复现失败 | 停止本轮，要求更多复现或证据 |
| Stage 2 修复后旧验收退化 | 回滚该 subtask，报告误伤 |
| Stage 3 基础能力缺失 | 停止本轮，报告缺口 |
| Stage 3 新机制失败 | 回滚该 subtask，保留前序 checkpoint |
| Stage 4 发现需要契约形状变化 | 回滚该 subtask，kick-back |
| Stage 5 发现需要 gameplay 变化 | 回滚该 subtask，kick-back |
| 后序 subtask 失败 | 默认不撤前序 checkpoint |

`dependsOn` 表示逻辑依赖，不是并发调度协议。N19 v1 不设计 subtask 并发。
