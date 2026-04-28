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

## Event Interface Contract

### As Consumer (trigger-on)
| 事件 | 必须携带的 payload | 来源示例 |
|---|---|---|
| `match.hit` | `ev.left`（agent entity）, `ev.right`（target entity） | predicate-match@v1 |
| 任意自定义事件 | `ev.agent`（agent entity）, `ev.target`（target entity） | 自定义逻辑 |

> **resolveAction 取值逻辑**：`agent = ev.left || ev.agent`；`target = ev.right || ev.target`。两者任一缺失则返回 null（不触发 step）。
>
> **关键**：上游必须传递**完整 entity 对象**（含 `id` 及 params 中 `agent-field` / `target-field` 指定的数值字段），而非仅传 ID 字符串。最常见的上游是 `predicate-match@v1` 的 `match.hit` 事件，它携带 `{ left, right }` 完整实体。

### As Producer (produces-events)
| 事件 | 携带的 payload | 典型下游 |
|---|---|---|
| `resource.consumed` | `{ agent: agentId, target: targetId, amount }` | 日志 / 计分器 / UI 反馈 |
| `resource.agent-zero` | `{ agentId }` | fsm-transition@v1（触发 `out-of-pigs` 等）、移除 agent |
| `resource.target-zero` | `{ targetId }` | fsm-transition@v1（触发 `all-blocks-clear` 等）、grid-board.remove-cell、计分 |

> **applyEffects 副作用**：收到 `resource.target-zero` 时将 `target.alive = false`；收到 `resource.agent-zero` 时将 `agent.alive = false`。

### DAG Wiring Rules
- ✅ 正确接法：`predicate-match@v1` → `match.hit` → `resource-consume@v1`，因为 `match.hit` 携带 `{ left, right }` 完整实体，恰好映射到 `agent / target`
- ✅ 正确接法：自定义事件携带 `ev.agent`（完整实体）+ `ev.target`（完整实体）
- ❌ 常见接错：上游只传 `{ agentId, targetId }`（ID 字符串）而非完整实体对象 —— resolveAction 拿到的是 string，step 中 `getField(agent, ...)` 会取不到数值字段，导致默认为 0 并立即触发 zero 事件
- ❌ 常见接错：上游事件用 `ev.source` 而非 `ev.left` 或 `ev.agent` —— resolveAction 不识别 `ev.source`，agent 会是 null 导致跳过
- ❌ 常见接错：未在 params 中正确配置 `agent-field` / `target-field` 路径，导致 `getField` 返回 undefined → 默认 0 → 立即触发 zero 事件
