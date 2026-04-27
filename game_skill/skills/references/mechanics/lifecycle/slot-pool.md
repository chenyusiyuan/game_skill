# slot-pool@v1

## Semantic Contract

对"等待槽 + 入场/离场"场景的抽象：一组固定容量的槽位（`capacity` 个），每个槽位同一时刻最多被
一个 entity 占用。entity 从槽位被 `unbind` 后，它**自身的字段**（如 `ammo` / `color` / `level`）
**必须**保留，不得被池子清零——"回到等待区" 和 "新实体替换" 是两回事。

典型用例：
- Pixel Flow 的四角等待小猪
- 棋盘边缘的"待出发物体"
- 台球母球重置位

## Required State Fields

```yaml
pool:
  capacity: 4                              # 固定上限，不可超
  slots:
    - id: slot-0
      occupantId: null | "<entity-id>"     # 当前占用者；null = 空
    - id: slot-1
      occupantId: null
    ...
```

## Params

```yaml
capacity: 4
slot-ids: [slot-0, slot-1, slot-2, slot-3]  # 固定 ID 顺序（必须等于 capacity 的长度）
retain-fields: [ammo, color]                # unbind 时必须保留的 entity 字段白名单
on-bind:     [<action-id>, ...]             # 入场时派发
on-unbind:   [<action-id>, ...]             # 离场时派发
on-overflow: [<action-id>, ...]             # 没有空槽时派发（默认 reject-bind）
```

## Invariants

1. **capacity-cap**: `slots.filter(s => s.occupantId !== null).length <= capacity` 恒成立。
2. **unique-occupancy**: 同一 `occupantId` 不得出现在两个 slot 中（防止双挂）。
3. **retain-on-unbind**: `unbind` 之后 entity 自身对象在 `retain-fields` 列出的字段保持原值——
   池子**不负责**把 ammo 归零；该归零动作归 `resource-consume` / `entity-lifecycle`。
4. **deterministic-slot-id**: 同一 entity 多次 bind/unbind，池子按 "最先空的 slot" 填入；`slot-ids`
   顺序决定优先级。

## Discrete Events Exposed

| 事件 | 触发条件 |
|---|---|
| `pool.bound` | `bind` 成功（有空槽） |
| `pool.unbound` | `unbind` 成功 |
| `pool.overflow` | `bind` 调用时所有 slot 已占满 |

## Common Composition

- `cooldown-dispatch.dispatch` → `slot-pool.unbind`（点击派发：把等待区的一只送上赛道）
- `entity-lifecycle.returning` → `slot-pool.bind`（返回等待区）
- `pool.overflow` → 通常 noop（视觉上可闪烁，不改状态）

## Engine Adaptation Hints

- 槽位的**视觉坐标**不是 primitive 的事，归 scene.yaml / layout。
- 容器实现建议用数组 + id 查询，不要用 Map，方便序列化和快照复算。
- **禁止**用 pool 保存 entity 的 runtime 数据（ammo/durability）——只保存 `occupantId`
  引用，数据仍存在 entity 自己的 `state.collections.<type>` 中。
