# Evolution Docs · Evidence And Checkpoints

本文说明演进层如何理解证据、checkpoint、baseline pointer、evolution log 和 `acceptance.mustNot`。当前仓库已有最小 runtime 实现；本文仍记录边界与证据语义，不替代 Stage 1 SOP。

## Baseline Pointer

baseline pointer 指向“最近一次可接受交付或可试玩版本”的证据集合。它不是 Stage 1 的输入，也不是重新生成的依据，而是演进前后的对照锚点。

N19 建议未来最小记录：

- 当前 `plan.json` 的 hash。
- 最近 `delivery.json` 的快照或指针。
- 关键 runner 结果指针，例如 summary、diagnostic、warnings。
- 关键 artifact 指针，例如截图路径、构建产物位置、可回滚文件快照位置。

完整归档 `game/` 可以作为后续实现候选，但 N19 不锁死该存储方案。原因是完整归档可能在资源增加后成本变高，应该由实现阶段根据实际文件体量决定。

当前生命周期：每次 passing delivery 会写入 `cases/<id>/eval/baseline.json`，并轮转 `baseline-prev1.json` / `baseline-prev2.json`。如果 delivery evidence 未通过但 `check_preview.js` 判定 `preview-ready`，且当前没有 delivery baseline，则写入 `baselineKind=preview` 的 preview baseline。baseline 保留旧字段，同时可选保存 `previewSummary`、`qualityHintsSummary`、`designSummary`、`decisionSummary`，让后续演进能对照 v1.1 backlog 与 design guard。

`baselineKind` 语义：

- `delivery`：自动 delivery evidence 已通过或带 warnings 通过；旧 baseline 缺字段时按 delivery 兼容。
- `preview`：游戏可启动试玩，但 delivery evidence 可能是 `generation-blocked`；Stage 2-5 可以把 failed expects 当作修复/验收错位证据。

## Checkpoint

checkpoint 是 subtask 后的可回滚交付点。它不等于 git commit，也不要求每个 subtask 都创建 git commit。

一个 checkpoint 至少应能回答：

- 这个 subtask 从哪个 baseline 出发。
- 它改变了哪些预期 artifact 类别。
- 它跑过哪些验证。
- 如果后续失败，如何回到这个点。

当前 checkpoint 由 worker 运行时写入 `eval/evolution-log.jsonl`，至少包含 baselineId、deliveryStatus、runnerSummary、warningKinds、changedFiles；v1.1 收尾后还会附带 `qualityHintsSummary`、`designSummary`、`beforeDeliverySummary`、`afterDeliverySummary` 等可选摘要。

## Evolution Log

`eval/evolution-log.jsonl` 是 append-only 历史记录。它让 triage router 能知道：

- 用户本轮 query 是什么。
- 被拆成了哪些 subtask。
- 每个 subtask 的 stage、specImpact、expectedArtifacts。
- 每个 subtask 的 verdict、checkpoint 指针和失败原因。
- 是否发生 kick-back。

当前实现不把 JSONL schema 固化进 `schemas/`，只规定它是历史感知的来源之一。

## `acceptance.mustNot`

Stage 1 当前只把 `acceptance.mustNot` 当作后续人工复核或演进参考。演进层从 Stage 2 起把它视为可机械化验证的设计点。

重要边界：

- 新增 `mustNot` 是 `spec-correction`，不是新增机制。理由是"把已隐含的反例约束显式化不引入新机制"，详见 [`10-triage-router.md`](./10-triage-router.md#specimpact) 中 `specImpact` 一节的论证。
- `mustNot` 应表达反例约束，例如“球不能穿过挡板后仍继续得分”。
- `mustNot` 失败时，演进 subtask 应回滚并报告。
- Stage 1 行为不变；不要为了 mustNot 修改 Stage 1 delivery 语义。

当前 Stage 2-5 worker 会在回归后执行 `acceptance.mustNot` 检查；失败时回滚该 subtask 并报告。`check_delivery.js` 仍不执行 mustNot，保持 Stage 1 语义不变。

## 证据类型复用

演进层不先发明新 evidence type。先复用 Stage 1 已经能解释的三类证据语义：

- `canvas-change`：画面确实发生变化。
- `milestone`：业务路径发出可观察事件。
- `state`：`window.__state` 中的数值或状态满足断言。

Stage 4 和 Stage 5 可能需要对比证据，但 N19 先把它描述为“同一证据类型的改前/改后对照”，不新增 schema。

## Screenshot 生命周期

Stage 1 的截图是 delivery 物证，不是视觉裁判。演进层可以引用截图路径作为证据，但要遵守 vision policy。

建议规则：

- 当前 `eval/screenshots/` 仍表示最近一次 delivery。
- baseline pointer 保存历史截图路径或归档指针。
- 如果 vision policy 禁止读图，worker 只能使用文件大小、尺寸、像素统计等文本证据。

## 回滚与证据

回滚不是“什么都没发生”。回滚后仍应在 evolution log 中记录：

- 哪个 subtask 被回滚。
- 回滚前触发了什么失败或 kick-back。
- 回滚后恢复到哪个 checkpoint。
- 是否保留了诊断证据供下轮 triage 使用。

这样可以防止同一轮演进反复踩同一个边界。
