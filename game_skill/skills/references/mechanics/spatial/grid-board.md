# grid-board@v1

## Semantic Contract

离散二维网格容器。每格可包含一个 cell entity（或为空）。
提供按 (row, col) 的增查删，不关心渲染。

## Required State Fields

`board` state 对象：

| 字段 | 类型 | 含义 |
|---|---|---|
| `rows` | number | 行数 |
| `cols` | number | 列数 |
| `cells` | array<cell> | 所有 alive cell 列表（而非二维数组，便于序列化） |

每个 cell 至少：

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | string | 唯一标识 |
| `row` | number ∈ [0, rows) | 行 |
| `col` | number ∈ [0, cols) | 列 |
| `alive` | boolean | 是否还在棋盘上 |

## Params

```yaml
rows: number
cols: number
cell-fields:                  # cell 除 id/row/col/alive 外的自定义字段（供 predicate-match 引用）
  - name: color
    type: enum
    values: [red, blue, yellow, green]
  - name: durability
    type: number
```

## Invariants

1. **bounds**: 每个 cell 的 `row ∈ [0, rows)` 且 `col ∈ [0, cols)`
2. **unique-position**: 同一 (row, col) 至多一个 alive cell
3. **id-unique**: 所有 cell.id 互不相同
4. **field-conformance**: 每个 cell 的 cell-fields 中枚举字段值必须在枚举里

## Discrete Events Exposed

| 事件 | 触发条件 |
|---|---|
| `board.cell-added` | 新 cell 加入 |
| `board.cell-removed` | 存在 cell 被置 alive=false |
| `board.empty` | 所有 cell.alive 均为 false |

## Common Composition

- `ray-cast` 的 targets = board.cells
- `win-lose-check`: `board.empty` 事件 → 胜利
- `predicate-match`: 命中的 cell 与 agent 的字段匹配

## Engine Adaptation Hints

| 引擎 | 建议 |
|---|---|
| canvas | 渲染层遍历 cells 按 cellSize 绘制 |
| pixijs | 每个 cell 一个 Sprite，初始化时批量放入 Container |
| phaser | 同上，可以 `scene.add.group` 管理 |
| dom | 一个 `<div class="board">` + 子 div 按 grid-template |

## Event Interface Contract

### As Consumer (trigger-on)
| 事件 | 必须携带的 payload | 来源示例 |
|---|---|---|
| `add-cell` | `{ cell }` — cell 对象需包含 `id`, `row`, `col` 及自定义字段 | 关卡初始化 / 生成器 |
| `remove-cell` | `{ cellId }` — 要移除的 cell 的 id | predicate-match@v1（匹配成功后消除） |

### As Producer (produces-events)
| 事件 | 携带的 payload | 典型下游 |
|---|---|---|
| `board.cell-added` | `{ cell }` — 新加入的 cell 对象 | UI 渲染层（创建 sprite） |
| `board.cell-removed` | `{ cellId }` — 被移除的 cell id | UI 渲染层（播放消除动画）、resource-consume@v1 |
| `board.empty` | 无 | win-lose-check@v1（胜利条件） |

### DAG Wiring Rules
- ✅ 正确接法：`ray-cast` 的 `targets.from` 引用 `board.cells` 集合；`ray-cast.resolveAction` 从 `state.collections[targetsRef]` 取 alive cells 作为命中候选
- ✅ 正确接法：`board.cell-removed` → UI 层做消除动画；`board.empty` → `win-lose-check` 判定胜利
- ❌ 常见接错：直接修改 `cells` 数组引用——`step` 内部做了浅拷贝 `[...(state.cells || [])]`，外部应通过 `add-cell` / `remove-cell` action 操作
- ❌ 常见接错：`remove-cell` 传入不存在的 `cellId`——reducer 静默忽略，不会产生 `board.cell-removed` 事件，下游不会收到通知
