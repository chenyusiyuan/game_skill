# grid-step@v1

## Semantic Contract

Agent 以离散格为单位移动，每次移动一个单位步长。可选四向/八向/自定义步集。
移动不是连续位置，而是离散跳变（渲染层负责插值）。

## Required State Fields

| 字段 | 类型 | 含义 |
|---|---|---|
| `row` | number | 所在行 |
| `col` | number | 所在列 |
| `lastMoveTick` | number | 上次移动的时钟（用于限速） |

## Params

```yaml
step-set: four-dir | eight-dir | custom
# four-dir:  [{dr:-1,dc:0},{dr:1,dc:0},{dr:0,dc:-1},{dr:0,dc:1}]
# eight-dir: 加四斜
# custom: 自定义 step 数组
bounds:
  rows: number
  cols: number
move-cooldown: number    # 两次移动最小间隔 (ms)
blockers:                # 可选：障碍物集合 ref
  from: "<collection-ref>"
```

## Invariants

1. **bounds**: 移动后 (row, col) 必须仍在 [0, rows) × [0, cols) 内
2. **step-validity**: 每次移动 delta 必须在 step-set 中
3. **cooldown**: 两次移动间隔必须 ≥ move-cooldown
4. **no-overlap-blockers**: 若 blockers 存在，目的格不能含 alive blocker

## Discrete Events Exposed

| 事件 | 触发条件 |
|---|---|
| `grid.moved` | 移动成功 |
| `grid.blocked` | 目的格被阻挡 |

## Common Composition

- 配 neighbor-query 检测拾取
- 配 win-lose-check 检测到达终点

## Event Interface Contract

### As Consumer (trigger-on)
| 事件 | 必须携带的 payload | 来源示例 |
|---|---|---|
| `move` | `{ dr, dc, nowMs, blockers? }` — `dr`/`dc` 为方向增量，`nowMs` 为当前时间戳，`blockers` 为可选障碍物数组 | 用户输入 / AI 控制器 |

### As Producer (produces-events)
| 事件 | 携带的 payload | 典型下游 |
|---|---|---|
| `grid.moved` | `{ row, col }` — 移动后的新坐标 | neighbor-query@v1、win-lose-check@v1 |
| `grid.blocked` | `{ reason }` — 值为 `'cooldown'` / `'invalid-step'` / `'bounds'` / `'blocker'` | UI 反馈（播放抖动动画等） |

### DAG Wiring Rules
- ✅ 正确接法：`grid.moved` → `neighbor-query`，后者 `resolveAction` 从 `ev.agent || ev.source || ev.center` 中取 `row`/`col`；因此上游 `grid.moved` 事件应被包装为带 `agent: { row, col }` 的事件，或 orchestrator 自动注入移动后的 agent 状态
- ✅ 正确接法：`move` action 的 `blockers` 数组应来自 `grid-board.cells.filter(c => c.alive)`，确保障碍信息实时
- ❌ 常见接错：省略 `nowMs` 字段——`step` 用 `nowMs - lastMoveTick` 做冷却判断，缺失会导致冷却永远通过（`NaN < cd` = false）
- ❌ 常见接错：把 `grid.blocked` 事件当作"可重试"——它只是通知，不会自动重试移动
