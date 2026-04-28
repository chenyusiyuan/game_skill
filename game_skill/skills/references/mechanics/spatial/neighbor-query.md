# neighbor-query@v1

## Semantic Contract

以某格为中心，按四向/八向/hex 取邻居 cell，或按半径取 K 环邻居。纯查询原语。

## Params

```yaml
center: "<entity-ref>"    # 中心 entity（取其 row/col）
shape: four | eight | hex
radius: 1                 # K-ring 半径
targets:
  from: "<collection-ref>"
filter: "<optional predicate-ref>"   # 可选：仅返回满足 predicate 的邻居
```

## Invariants

1. **symmetry**: center 不在返回结果中
2. **alive-only**: 仅返回 alive=true 的 target
3. **radius-correctness**: 返回结果中每个的 chebyshev/曼哈顿距离 ≤ radius

## Events

| 事件 | 触发条件 |
|---|---|
| `neighbor.found` | payload: `{center, neighbors: [...]}` |
| `neighbor.empty` | 无邻居 |

## Composition

- 配 predicate-match 做"同色邻居消除"
- 配 resource-consume 做"范围伤害"

## Event Interface Contract

### As Consumer (trigger-on)
| 事件 | 必须携带的 payload | 来源示例 |
|---|---|---|
| `query` (action) | `{ center, targets }` — 由 `resolveAction` 自动组装 | orchestrator |
| 任意触发事件 | `ev.agent` 或 `ev.source` 或 `ev.center` — 必须携带 `row`, `col` 字段，`resolveAction` 从中取查询中心 | grid-step@v1 的 `grid.moved`（需 orchestrator 注入 agent 状态） |

### As Producer (produces-events)
| 事件 | 携带的 payload | 典型下游 |
|---|---|---|
| `neighbor.found` | `{ center, neighbors: [...] }` — `neighbors` 为满足半径条件的 alive target 数组 | predicate-match@v1（同色消除）、resource-consume@v1（范围伤害） |
| `neighbor.empty` | `{ center }` | UI 反馈 / 无操作 |

### DAG Wiring Rules
- ✅ 正确接法：上游 `grid.moved` → `neighbor-query`；`resolveAction(node, ev, state)` 从 `ev.agent || ev.source || ev.center` 取中心点，要求该对象含 `row`/`col`；`node.params.targets.from` 引用 `grid-board` 的 cells 集合
- ✅ 正确接法：配合 `predicate-match`，先由 `neighbor-query` 取邻居，再由 `predicate-match` 过滤满足条件的 cell
- ❌ 常见接错：上游事件缺少 `ev.agent`、`ev.source`、`ev.center` 三个字段——`resolveAction` 返回 `null`，orchestrator 跳过此节点
- ❌ 常见接错：传入的 center 对象没有 `row`/`col` 字段（如只有 `x`/`y` 像素坐标）——`neighbors()` 会用 `undefined` 计算，结果全部偏移到 `NaN`，永远查不到邻居
