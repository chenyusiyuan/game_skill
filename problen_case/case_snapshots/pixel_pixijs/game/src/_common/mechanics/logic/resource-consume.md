# resource-consume@v1

## Semantic Contract

对两个 entity 的指定数值字段各减 `amount`；任一归零触发对应事件。
用于"攻击扣血+弹药扣除"、"消耗能量"、"共同消耗"等对偶场景。

## Required State Fields

| 字段 | 类型 | 含义 |
|---|---|---|
| `<agent-field>` | number ≥ 0 | agent 侧数值（如 pig.value） |
| `<target-field>` | number ≥ 0 | target 侧数值（如 block.durability） |

## Params

```yaml
agent-field: "pig.value"
target-field: "block.durability"
amount: 1
on-agent-zero:  [<action-id>, ...]   # 如 remove-pig
on-target-zero: [<action-id>, ...]   # 如 remove-block, score+10
```

## Invariants

1. **non-negative**: 消耗后 field ≥ 0（即 min(field - amount, 0) 不允许负值，强制 clamp）
2. **deterministic-events**: field 值从 > 0 变为 == 0 时**必须**触发一次 zero 事件；后续保持 0 不重复触发
3. **single-decrement**: 每次 evaluate 对 agent 和 target 各减 exactly `amount`，不允许倍增

## Discrete Events Exposed

| 事件 | 触发条件 |
|---|---|
| `resource.consumed` | 每次 step |
| `resource.agent-zero` | agent-field 首次归零 |
| `resource.target-zero` | target-field 首次归零 |

## Common Composition

- predicate-match.on-true → resource-consume
- resource.target-zero → grid-board.remove-cell
- resource.agent-zero → 移除 agent

## Engine Adaptation Hints

通用；注意写成 `field = Math.max(0, field - amount)` 而不是 `field -= amount`，防止负值。
