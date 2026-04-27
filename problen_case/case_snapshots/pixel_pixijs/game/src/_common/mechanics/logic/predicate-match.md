# predicate-match@v1

## Semantic Contract

把两个 entity 的指定字段用 op 比较，布尔结果触发后继动作。
纯逻辑原语，不改状态。

## Required State Fields

依赖 left/right 两个 entity 各具备 params.fields 中列出的字段。

## Params

```yaml
left:   "<entity-ref>"      # 如 pig
right:  "<entity-ref>"      # 如 hit-candidate
fields: [color]             # 多字段时要求全部相等
op: eq | neq | gt | lt | in
on-true:  [<action-id>, ...]   # 由 mechanic-decomposer 填，Phase 4 codegen 翻译成函数调用
on-false: [<action-id>, ...]
```

## Invariants

1. **pure**: 本原语不直接修改 left/right/state
2. **total**: left 和 right 都存在且 alive（alive 字段若存在）时，结果必为 true/false，不得返回 undefined
3. **fields-exist**: params.fields 里的每个字段必须在 left 和 right 上都存在

## Discrete Events Exposed

| 事件 | 触发条件 |
|---|---|
| `match.hit` | op 结果为 true |
| `match.miss` | op 结果为 false |

## Common Composition

- ray-cast → predicate-match → resource-consume（攻击判定核心三连）
- 两个玩家状态比较 → 决定胜负

## Engine Adaptation Hints

全引擎通用；就是 if 语句或 `===` 比较。禁止用 `==`（宽松比较）。
