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

## Event Interface Contract

### As Consumer (trigger-on)
| 事件 | 必须携带的 payload | 来源示例 |
|---|---|---|
| 任意匹配 `rules[].on` 的事件 | `{ type }` — 事件 type 须与 `rules[].on` 精确匹配 | resource-consume@v1 产出的 `resource.target-zero`；grid-board 产出的 `neighbor.found` |

> `resolveAction` 将外部事件映射为 `{ type: 'event', event: ev.type }`，`step` 再按 `rules` 查找匹配的 `on` 字段。

### As Producer (produces-events)
| 事件 | 携带的 payload | 典型下游 |
|---|---|---|
| `score.updated` | `{ score: number, delta: number }` | win-lose-check@v1（`score-reaches` 条件）/ UI 分数显示 |

### DAG Wiring Rules
- ✅ 正确接法：`resource-consume.target-zero` → score-accum（`on: resource.target-zero`）→ `score.updated` → win-lose-check（evaluate ctx.fields）
- ✅ 正确接法：`applyEffects` 会将 `result.score` 写入 `state.fields[score-field]`，供 win-lose-check 的 `score-reaches` 条件读取
- ❌ 常见接错：`rules[].on` 中声明了一个不存在的事件名——形成死代码，score 永远不变（违反 event-coverage 不变式）
- ❌ 常见接错：让 cooldown-dispatch 直接 downstream 为 `state.score-set`——被 forbidden-blacklist 拦截
