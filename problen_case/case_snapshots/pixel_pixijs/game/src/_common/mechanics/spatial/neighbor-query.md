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
