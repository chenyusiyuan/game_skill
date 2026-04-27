# score-accum@v1

## Semantic Contract

在指定事件发生时对 score 字段累加 delta。简单原语，但是 PRD 几乎必用。

## Params

```yaml
score-field: "game.score"
rules:
  - on: resource.target-zero
    delta: 10
  - on: neighbor.found
    delta: 5
```

## Invariants

1. **monotone-nondecreasing**: delta ≥ 0 时，score 不减
2. **event-coverage**: rules 中声明的 `on` 事件都必须被玩法其他原语产生（否则死代码）

## Events

| 事件 | 触发条件 |
|---|---|
| `score.updated` | 每次累加 |
