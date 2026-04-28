# capacity-gate@v1

## Semantic Contract

对"最多 N 个同时在场/在执行"的硬约束。接受入场请求，若当前 active 数 < capacity 则放行并把
entity 记入 `active` 集合；否则拒绝并触发 `capacity.blocked`——**禁止**静默丢弃（视觉上/
测试上都应能看到拒绝）。

典型用例：
- Pixel Flow "同一时刻最多 1 只小猪在赛道"
- 塔防"同时最多 5 只怪"
- 对话框"不允许并发开启"

## Required State Fields

```yaml
gate:
  capacity: 1
  active: [<entity-id>, ...]   # 当前 in-flight 的 entity id 集合
```

## Params

```yaml
capacity: 1
on-admit:  [<action-id>, ...]   # 放行时派发
on-block:  [<action-id>, ...]   # 拒绝时派发（至少应有一条，不能 noop）
on-release:[<action-id>, ...]   # release 时派发
```

## Invariants

1. **capacity-cap**: `active.length <= capacity` 在任意时刻成立。
2. **no-silent-drop**: 当 `request` 被拒绝时**必须**触发 `capacity.blocked`；业务层禁止
   捕获 request 返回值 `admitted:false` 后什么都不做。
3. **release-symmetric**: 每次 `release(id)` 对应一次历史上成功的 `admit(id)`，不允许
   release 一个不在 active 中的 id（noop 但应警告）。
4. **membership-uniqueness**: 同一个 id 不能在 active 里出现两次（请求已 admitted 的
   entity 再次 request 是 idempotent no-op，不累加）。

## Discrete Events Exposed

| 事件 | 触发条件 |
|---|---|
| `capacity.admitted` | request 被放行 |
| `capacity.blocked`  | request 被拒绝（达到 capacity） |
| `capacity.released` | release 成功 |

## Common Composition

- `cooldown-dispatch.dispatch` → `capacity-gate.request` → `entity-lifecycle.transition(active)`
- `entity-lifecycle.dead` → `capacity-gate.release`

## Engine Adaptation Hints

- active 用数组而非 Set 以便序列化和快照比对。
- **禁止**把 capacity-gate 与 slot-pool 混用：前者管"同时活跃计数"，后者管"固定位置占用"。
  一个 pixel-flow 场景里两者都用：等待区是 slot-pool（4 个固定位置），赛道是 capacity-gate
  （同时最多 1 只）。

## Event Interface Contract

### As Consumer (trigger-on)
| 事件 | 必须携带的 payload | 来源示例 |
|---|---|---|
| `capacity.request` | `{ entityId }` | cooldown-dispatch@v1（`dispatch.fired` downstream）/ slot-pool@v1（`pool.unbound` 后触发） |
| `capacity.release` | `{ entityId }` | entity-lifecycle@v1（`lifecycle.entered` with `to: dead`）|

> `resolveAction` 将 `capacity.request` 映射为 `{ type: 'request', entityId }`，将 `capacity.release` 映射为 `{ type: 'release', entityId }`。

### As Producer (produces-events)
| 事件 | 携带的 payload | 典型下游 |
|---|---|---|
| `capacity.admitted` | `{ entityId }` | entity-lifecycle@v1（transition to `active`）|
| `capacity.blocked` | `{ entityId }` | UI 反馈（如提示"赛道已满"）/ cooldown-dispatch 的 rejected 处理 |
| `capacity.released` | `{ entityId }` | 可触发等待队列中下一个 entity 的 `capacity.request` |

### DAG Wiring Rules
- ✅ 正确接法：`cooldown-dispatch.fired` → `capacity-gate.request` → `capacity.admitted` → `entity-lifecycle.transition(active)`
- ✅ 正确接法：`entity-lifecycle.entered(dead)` → `capacity-gate.release` → `capacity.released`
- ❌ 常见接错：release 一个不在 active 列表中的 entityId——虽然是 noop 但说明上游 wiring 有误
- ❌ 常见接错：让 capacity-gate 管理固定位置占用——位置占用应交给 slot-pool，capacity-gate 只管计数
