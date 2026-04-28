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

## Event Interface Contract

### As Consumer (trigger-on)
| 事件 | 必须携带的 payload | 来源示例 |
|---|---|---|
| `ray.hit-candidate` | `ev.source`（agent entity）, `ev.targets`（target entity 数组） | ray-cast@v1 |
| `neighbor.found` | `ev.agent`（agent entity）, `ev.neighbors`（neighbor entity 数组） | neighbor-query@v1 |
| 任意自定义事件 | `ev.source \|\| ev.agent`（→ left）, `ev.targets[0] \|\| ev.neighbors[0] \|\| ev.right`（→ right） | — |

> **resolveAction 取值逻辑**：`left = ev.source || ev.agent`；`right = ev.targets?.[0] || ev.neighbors?.[0] || ev.right`。两者任一缺失则返回 null（不触发 step）。

### As Producer (produces-events)
| 事件 | 携带的 payload | 典型下游 |
|---|---|---|
| `match.hit` | `{ left, right }`（完整 entity 对象） | resource-consume@v1, fsm-transition@v1 |
| `match.miss` | `{ left, right }` 或 `{ reason: 'field-missing', field }` | 日志 / UI 反馈 |

### DAG Wiring Rules
- ✅ 正确接法：上游事件（如 `ray.hit-candidate`）携带 `source` + `targets` 数组，predicate-match 自动取 `targets[0]` 作为 right
- ✅ 正确接法：上游携带 `agent` + `neighbors` 数组（如邻域查询），同样可自动解析
- ❌ 常见接错：上游事件只携带 `targetId`（字符串 ID）而非完整 entity 对象 —— resolveAction 需要的是带字段的实体，不是 ID 引用
- ❌ 常见接错：上游事件把目标放在 `ev.target`（单数）而非 `ev.targets`（数组）或 `ev.right` —— `ev.target` 不会被识别，需改用 `ev.right` 或包装为 `ev.targets = [target]`
