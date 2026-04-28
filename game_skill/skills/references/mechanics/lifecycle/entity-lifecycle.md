# entity-lifecycle@v1

## Semantic Contract

单个 entity 的标准生命周期状态机：`waiting → active → returning → waiting | dead`。
把散落的"pig 派发"/"pig 回程"/"pig 死亡"三套 ad-hoc 状态统一为一个 primitive，避免业务代码
手写 `if (phase === "return") ...`。

`waiting`：在"休息/等待入场"的位置（通常绑 slot-pool）。
`active`：在赛道/战场上执行主任务。
`returning`：任务完成，正在返回 waiting 位；视觉上仍在动画中。
`dead`：退场，不再复用。

## Required State Fields

```yaml
entity:
  id: pig-0
  lifecycle: waiting | active | returning | dead
  # 其它字段（color/ammo/position）由业务自行维护，lifecycle 不碰
```

## Params

```yaml
# 允许的转移，每条 { from, event, to }；枚举外的 (from,event) 对触发 invalid-transition
transitions:
  - { from: waiting,   event: dispatched, to: active }
  - { from: active,    event: exhausted,  to: returning }
  - { from: active,    event: killed,     to: dead }
  - { from: returning, event: arrived,    to: waiting }
on-enter-active:    [...]
on-enter-returning: [...]
on-enter-waiting:   [...]
on-enter-dead:      [...]
```

## Invariants

1. **enum-state**: `entity.lifecycle` 必须始终 ∈ `{waiting, active, returning, dead}`。
2. **transition-whitelist**: 只允许 `params.transitions` 中列出的 (from,event) 转移；
   其它 event 对当前 state 是 no-op（不 throw，但应 emit `lifecycle.invalid-transition`）。
3. **dead-is-terminal**: 一旦进入 `dead`，后续任何 event 不得让它回到其它状态。
4. **mutex-states**: 不允许同一 entity 在同一 tick 里同时处于多个 state（由 single-value
   的 `lifecycle` 字段天然保证；reducer 不允许并发更新）。

## Discrete Events Exposed

| 事件 | 触发条件 |
|---|---|
| `lifecycle.entered.<state>` | 成功转入新 state |
| `lifecycle.invalid-transition` | event 对当前 state 没有白名单 |

## Common Composition

- `capacity-gate.admit` → `lifecycle.enter(active)`
- `resource-consume.agent-zero` → `lifecycle.enter(returning | dead)`（看 params）
- `lifecycle.enter(waiting)` → `slot-pool.bind`

## Engine Adaptation Hints

- **禁止**业务代码直写 `entity.lifecycle = "active"`——必须通过 `transition` 走
  （否则 check_runtime_semantics 会报 before/after 不匹配 reducer）。
- `dead` 状态不清除 entity（回收归 grid-board / collection 的事）；只是标记该实例不再
  参与后续转移。

## Event Interface Contract

### As Consumer (trigger-on)
| 事件 | 必须携带的 payload | 来源示例 |
|---|---|---|
| `lifecycle.event` | `{ entityId, event }` — `event` 对应 `transitions[].event`（如 `dispatched`、`exhausted`、`killed`、`arrived`） | capacity-gate@v1（`capacity.admitted` → event=`dispatched`）；resource-consume@v1（`resource.agent-zero` → event=`exhausted`/`killed`）；路径动画完成 → event=`arrived` |

> `resolveAction` 将 `lifecycle.event` 映射为 `{ type: 'transition', entityId, event }`。

### As Producer (produces-events)
| 事件 | 携带的 payload | 典型下游 |
|---|---|---|
| `lifecycle.entered` | `{ entityId, from, to }` | slot-pool@v1（当 `to: waiting` → `pool.request-bind`）；capacity-gate@v1（当 `to: dead` → `capacity.release`）；UI 动画切换 |
| `lifecycle.invalid-transition` | `{ entityId, from, event, reason? }` | 调试/日志；通常不接下游业务逻辑 |

### DAG Wiring Rules
- ✅ 正确接法：`capacity.admitted` → `lifecycle.event(dispatched)` → `lifecycle.entered(active)` → 开始主任务
- ✅ 正确接法：`lifecycle.entered(returning)` + 动画完成 → `lifecycle.event(arrived)` → `lifecycle.entered(waiting)` → `pool.request-bind`
- ✅ 正确接法：`lifecycle.entered(dead)` → `capacity.release`
- ❌ 常见接错：业务代码直写 `entity.lifecycle = "active"` 绕过 transition——check_runtime_semantics 会报 before/after 不匹配
- ❌ 常见接错：向已 dead 的 entity 发送 transition event——会产出 `lifecycle.invalid-transition(dead-is-terminal)` 且状态不变
