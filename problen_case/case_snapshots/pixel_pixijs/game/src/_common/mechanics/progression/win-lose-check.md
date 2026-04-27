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
