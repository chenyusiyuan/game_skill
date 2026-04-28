# win-lose-check@v1

## Semantic Contract

周期性/事件驱动地检查胜负条件。可表达"全消除为胜"、"资源归零为败"、"时间到为败"等。

## Params

```yaml
win:
  - kind: all-cleared | count-reaches | time-up | score-reaches | custom
    collection: "<ref>"        # 仅 all-cleared/count-reaches 需要
    threshold: number          # 仅 count-reaches/score-reaches 需要
    field: "<ref>"             # 仅 score-reaches 需要
lose:
  - kind: out-of-resource | time-up | count-falls-below
    collection: "<ref>"
    field: "<ref>"
    threshold: number
evaluate-on:                   # 什么事件/周期触发检查
  - board.cell-removed
  - tick@1s
  - resource.agent-zero
```

## Invariants

1. **mutually-exclusive**: 同一 tick 中 win 和 lose 不得同时成立
2. **terminal**: 一旦 win/lose 触发，FSM 应转入终态（win/lose）不再改变
3. **reachable**: 通过 profile 的 setup 模拟，至少有一条路径可达 win（否则 PRD 结构性不可完成）

## Events

| 事件 | 触发条件 |
|---|---|
| `win` | 任一 win 子句成立 |
| `lose` | 任一 lose 子句成立 |

## Event Interface Contract

### As Consumer (trigger-on)
| 事件 | 必须携带的 payload | 来源示例 |
|---|---|---|
| `evaluate` (action) | `{ ctx: { collections?, fields?, elapsedMs? } }` | 引擎 tick / 事件驱动调度器（由 `evaluate-on` 配置决定，如 `board.cell-removed`、`tick@1s`、`resource.agent-zero`） |

> **注意**：win-lose-check 没有 `resolveAction`，不监听外部事件自动映射为 action。它由引擎/调度器直接发送 `{ type: 'evaluate', ctx }` action 驱动，属于 **tick-driven / orchestrator-driven** 模式。

### As Producer (produces-events)
| 事件 | 携带的 payload | 典型下游 |
|---|---|---|
| `win` | `{}` (无额外 payload) | 引擎终局处理 / UI 胜利弹窗 |
| `lose` | `{}` (无额外 payload) | 引擎终局处理 / UI 失败弹窗 |

### DAG Wiring Rules
- ✅ 正确接法：由引擎在 `evaluate-on` 所列事件触发后，汇总 `ctx`（collections、fields、elapsedMs）并发送 `evaluate` action
- ✅ 正确接法：`win` / `lose` 事件被引擎捕获后转入终态 FSM，停止后续 tick
- ❌ 常见接错：让 score-accum 直接改 `state.resolved`——胜负判定只能由 win-lose-check 统一裁决
- ❌ 常见接错：同一 tick 内同时触发 `win` 和 `lose`——违反 mutually-exclusive 不变式

### Win/Lose Kind 语义与限制

| kind | 语义 | 推荐 |
|---|---|---|
| `all-cleared` | `collection` 中所有实体的 `alive === false` | ✅ 用于 win 条件 |
| `count-falls-below` | `collection` 中 `alive === true` 的数量 < `threshold` | ✅ 用于 lose 条件 |
| `out-of-resource` | 从 `ctx.fields[field]` 读取值，检查 `val <= threshold` | ⚠️ **慎用**：`ctx.fields` 是 `state.fields` 全局字典，不是实体级别字段。如果 `field` 没有被手动写入 `state.fields`，默认值为 `undefined ?? 0 = 0`，`0 <= 0` 始终为 true，**导致 lose 从 tick=0 就成立**。建议改用 `count-falls-below`。 |
| `custom` | 不支持 | ❌ reducer 不识别此 kind |
