# Evolution Docs · Triage Router

本文说明首交付后的自然语言修改需求如何被拆成有序 subtask。它是设计接口说明，不是 JSON schema，也不承诺当前仓库已有对应实现。

## 为什么先有路由器

用户在首个可玩版本之后的反馈通常是混合的。例如一句“boss 关掉帧修一下，顺便加连击，打击感再舒服点”同时包含 bugfix、新机制和体验调校。如果把整句 query 分类成单一 stage，后续 worker 会被迫越界，或者丢掉一部分意图。

因此 triage router 的输出不是一个 stage，而是一个有序 subtask 列表。默认执行顺序是 Stage 2 -> Stage 3 -> Stage 4 -> Stage 5，因为修复现有错误应先于新增机制，新增机制应先于调参与美化。

## 输入

路由器读取的是演进上下文，而不是重新启动首轮生成：

- 用户自然语言 query。
- 当前 `cases/<id>/specs/plan.json`。
- 最近一次 `eval/delivery.json` 和 `eval/runner-result.json` 的摘要、diagnostic、warning。
- 可用 screenshot 路径和元信息；若 vision policy 禁止读图，则只使用文件路径、尺寸、大小、像素统计等文本证据。
- 未来的 `eval/evolution-log.jsonl`，用于避免重复修同一类问题。
- 可选 issue 文本，如用户明确给出复现步骤、期望和实际结果。

v1 只接受自然语言 query。结构化用户输入留作后续设计。

## 输出形状

路由器对一次 query 有三种合法的输出形态，互斥：

| 形态 | 含义 | 何时返回 |
|---|---|---|
| **subtask 列表** | 一组有序的 subtask（结构见下表） | query 已被解析为可执行子意图 |
| **澄清问题集** | 一组用领域语言表达的澄清问题 | query 模糊或检测到冲突需要消解 |
| **拒绝说明** | 一段说明 + 可选的引导 | query 不属于演进范畴（例如要求推倒重做整份 plan）或冲突无法消解 |

具体顶层包装的字段名（例如 `decision` / `subtasks` / `clarifications` / `rejection`）由后续实施时定。N19 只锁定**三种形态合法且互斥**这一点，避免实施时把澄清和拒绝拼接进 subtask 列表。

当返回 subtask 列表时，每个 subtask 固定使用 7 个字段名：

| 字段 | 含义 |
|---|---|
| `stage` | 内部 stage 标签，只用于系统内部和文档，不暴露给普通用户澄清话术 |
| `subIntent` | 领域语言描述的子意图，例如“boss 大招阶段掉帧” |
| `specImpact` | `none`、`spec-correction`、`spec-shape-change` 三选一 |
| `evidenceRequired` | 执行前后需要证明的证据类型或证据指针 |
| `stopIfFails` | 该 subtask 失败后是否停止整轮演进 |
| `dependsOn` | 逻辑依赖的上游 subtask；不是并发调度承诺 |
| `expectedArtifacts` | 执行前 blast radius 声明，不是执行后的 git diff |

`expectedArtifacts` 只说明“预期会碰到哪类产物”，用于提前发现越界风险。N19 不规定它的具体值域；后续实施时再决定使用 path、glob 还是资源类别枚举。

## 路由判据

stage 判定基于用户意图，而不是基于当前 spec 表达形式。

| 内部 stage | 用户意图 | 典型表述 |
|---|---|---|
| Stage 2 | 现有行为与预期不一致 | “这里会卡住”“按了没反应”“boss 关掉帧” |
| Stage 3 | 想加入目前没有的体验 | “加个连击系统”“新增道具栏”“加入二段跳” |
| Stage 4 | 现在玩起来不够好 | “手感不舒服”“节奏太拖”“难度不平滑” |
| Stage 5 | 样子、听感、排布不舒服 | “UI 太挤”“音效太弱”“角色不够醒目” |

同一句 query 可以拆出多个 subtask。同 stage 的多个相近子意图可以合并，但合并后仍要保持单一 stage 边界。

### 为什么判据是用户意图，不是 spec 表达形式

举一个具体例子。query "增加一种红色敌人" 在两种 spec 设计下会得到截然不同的 spec 形状解读：

- 若 spec A 把每种敌人写成顶层 entity（`enemies: ["goomba", "koopa", ...]`），新增红色敌人需要新加一个 entity，看上去像 `spec-shape-change`。
- 若 spec B 把所有敌人压成带 `variant` 字段的统一记录（`enemy: { variants: [...] }`），新增红色敌人只是数组里加一行，看上去像 `none` 或 `spec-correction`。

用户的意图完全相同——加一种当前没有的敌人——但若以 spec 形状作为路由判据，**上一次首轮生成时碰巧选择了哪种数据建模会反向污染这一次的路由结果**。这是不可接受的。

所以拆分是分两步的：

- **意图决定 stage**：红色敌人始终归 Stage 3，因为用户在描述"目前没有的体验"。
- **blast radius 决定 stage 内部的执行重量**：具体落到 spec A 还是 spec B、需要改一行还是几十行，由 Stage 3 worker 自己根据当前 spec 形态评估，并写进 `expectedArtifacts`。

`specImpact` 字段只是执行前的权限预警（见下一节），不参与 stage 路由本身。

## `specImpact`

`specImpact` 是权限预警，不是 stage 判定来源。

| 值 | 含义 | 权限 |
|---|---|---|
| `none` | 不改 `plan.json` 契约形状 | Stage 2/4/5 常见 |
| `spec-correction` | 修正现有 acceptance 文本、补 mustNot、修 repro 证据、显式化已隐含约束 | Stage 2 可做 |
| `spec-shape-change` | 新增 entity、action、rule、control、win/lose 条件、mustHave | 仅 Stage 3 |

新增 `acceptance.mustNot` 属于 `spec-correction`，因为它把已隐含的反例约束显式化。新增 `acceptance.mustHave` 属于 `spec-shape-change`，因为它扩大了正向验收契约。

## 拆分规则

先拆显性 bug，再拆新增机制，再拆体验深化，最后拆美化。这样可以避免在一个已知错误状态上继续调手感或改视觉。

当两个子意图都需要同一个机制变更时，优先合并到 Stage 3；当一个子意图只是已有机制的参数调节，保持在 Stage 4。

当 query 同时要求“更慢”和“新增高速敌人”这类方向相反的结果，路由器不应硬阻断。它应先识别冲突，再用领域语言澄清。

## 冲突检测

N19 的冲突判据是解释性规则：两个 subtask 的 `expectedArtifacts` 重叠，且语义方向相反。例子：

- “敌人整体调慢”与“新增高速追击兵”可能都影响敌人速度系统。
- “UI 放大”与“保留更多战场视野”可能都影响布局空间。
- “降低特效遮挡”与“命中特效更夸张”可能都影响反馈层可读性。

检测不准时优先澄清，不要直接失败。

## 澄清话术

澄清问题必须使用游戏领域语言，不把 Stage 编号暴露给用户。

| 不推荐 | 推荐 |
|---|---|
| “这是 Stage 3 还是 Stage 4？” | “你希望连击只显示计数，还是会影响伤害、奖励或关卡节奏？” |
| “这个属于 Stage 5 吗？” | “你说更刺激，主要是想要更明显的命中停顿、屏幕震动，还是音效和视觉特效更强？” |
| “这个 shape change 要不要做？” | “道具栏只是显示已拾取道具，还是需要持久保存、切换和主动使用？” |

如果用户不回答，路由器可以保守选择最小可执行解释，并在 subtask 里记录该假设。

## 路由器自身的失败模式

| 失败模式 | 结果 |
|---|---|
| query 完全模糊 | 返回澄清问题，不启动 subtask |
| 证据缺失导致无法判断是否 bug | 要求补复现或读取最近 delivery 证据 |
| 冲突无法通过文本消解 | 返回冲突说明和澄清问题 |
| worker kick-back | 作为合法 re-entry 输入重新路由 |

worker 不直接横向转交另一个 stage。它只能把 kick-back 信号交回路由器，由路由器重新解释用户意图和上下文。
