# parametric-track@v1

## Semantic Contract

给定参数化路径 `P: [0,1) -> R²`，agent 在 `t ∈ [0,1)` 处的世界坐标为 `P(t)`。
`t` 随时间单调增长（mod 1）：`t' = (t + speed * dt) mod 1`。

## Required State Fields

每个受此原语控制的 agent：

| 字段 | 类型 | 含义 |
|---|---|---|
| `t` | number ∈ [0, 1) | 当前路径参数 |
| `speed` | number > 0 | 每秒 t 增量 (1/s)；speed=0.1 = 10 秒一圈 |
| `segmentId` | string \| null | 当前所处分段（由 params.segments 切分，见下） |

## Params

```yaml
shape: ring | rect-loop | line | u-shape | custom  # 路径类型
# ring:      真正的圆形轨道，半径 r 的圆, 圆心 (cx, cy)
# rect-loop: 棋盘/矩形区域四周的直角闭环；board-grid 外圈传送带必须用它
# line:      从 p0 到 p1 的直线，t=0 在起点，t=1 回到起点（折返）
# u-shape:   legacy alias；新 case 优先使用 rect-loop
# custom:  LLM 自定义 f(t)，必须满足 periodicity
segments:               # 可选：把 [0,1) 划成多段，用于事件发布
  - id: top
    range: [0.0, 0.25]
  - id: right
    range: [0.25, 0.5]
  - id: bottom
    range: [0.5, 0.75]
  - id: left
    range: [0.75, 1.0]
geometry:
  # shape=ring 时需要
  cx: number
  cy: number
  r: number
  # shape=rect-loop 时需要
  x: number
  y: number
  width: number
  height: number
grid-projection:        # 可选；当下游 ray-cast 使用 coord-system:grid 时必须提供
  rows: number
  cols: number
  outside-offset: number  # 默认 1；top 段映射到 row=-outside-offset，right 映射到 col=cols-1+outside-offset
                          # ⚠️ 当 outside-offset=0 时，pig 站在棋盘边缘行/列上（row=0 或 col=0 等），
                          # 与该行/列的 block 同格。ray-cast 从 step=1 开始不检查 source 同格，
                          # 会导致同行/列的 block 在 pig 背后而不在射线路径上。
                          # 通常应设为 1（pig 在棋盘外圈），除非游戏设计允许 pig 站在棋盘内。
```

## Invariants

1. **monotonicity**: 对任意 `dt > 0`，`t' != t` 且 `t'` 沿定义方向推进（mod 1）
2. **periodicity**: `P(0) == P(1)`（闭合路径）
3. **coverage**: 若 speed > 0 且运行时长 ≥ 1/speed，agent 必须经过每个 segment 至少一次
4. **segment-exclusive**: 任意 t 只属于一个 segment（range 不重叠且并集 = [0,1)）

## Discrete Events Exposed

| 事件 | 触发条件 |
|---|---|
| `track.enter-segment` | `t` 从段 A 跨入段 B（payload: `{agent, fromSegment, toSegment}`） |
| `track.attack-position` | agent 的 `gridPosition` 映射到新的棋盘边缘格点（payload: `{agent, gridPosition, segmentId}`）。需要 `grid-projection` 参数。攻击类下游（如 `ray-cast`）应监听此事件而非 `enter-segment`，因为它的粒度是每格一次而非每段一次 |
| `track.loop-complete` | `t` 从 [~1, 1) 回卷到 [0, ~0)（payload: `{agent, lapCount}`） |

## Common Composition

- **基于位置攻击** → 组合 `ray-cast`，`source = P(t)`，`direction` 依赖 segment（如 top 段向下）。攻击触发应监听 `track.attack-position`（每格一次），而非 `track.enter-segment`（每段一次）
- **网格边缘攻击** → 若 `ray-cast.coord-system=grid`，必须设置 `grid-projection`，让 agent 同时带有 `gridPosition`
- **棋盘外圈传送带** → 若 PRD 同时出现 board-grid / 棋盘 / 格子 和 四周 / 外圈 / 传送带，必须使用 `shape: rect-loop`。`shape: ring` 只表示视觉上真实圆形轨道，不能用于包围正方形棋盘的外圈。
- **到站触发** → 在 segments 中设一个零长点段，产生 `enter-segment` 事件
- **回收机制** → 监听 `track.loop-complete`，从本原语中移除 agent

## Engine Adaptation Hints

| 引擎 | 建议 |
|---|---|
| canvas | `update(dt)` 内累加 `t += speed*dt/1000`；draw 时按 shape 查表算 `(x,y)`；`rect-loop` 画四条直线，禁止用 `ctx.arc()` 画成圆 |
| pixijs | 用 `Ticker.shared.add` 做 t 累加；Sprite.position 由 t 算 |
| phaser | 可用 `scene.tweens.add({ ease:'Linear', loop:-1, duration: 1000/speed })`；每 tick 回调更新 segment |
| dom | `requestAnimationFrame` 更新 t；`transform: translate(...)`；不要每帧重建 DOM 节点 |
| three | Curve + object.position.copy(curve.getPoint(t)) |

**禁止**：
- 用 `setInterval` 驱动（精度差）
- 直接用 `pixelX += vx` 做非参数化累加（拐角处会抖动，违反 periodicity）
- 把 segment 判定写成 if-else 魔法数（必须来自 params.segments）
- board-grid 外圈轨道使用 `shape: ring` 或圆形绘制

## Event Interface Contract

### As Consumer (trigger-on)
| 事件 | 必须携带的 payload | 来源示例 |
|---|---|---|
| `tick` | `{ dt }` （时钟驱动，dt 为帧间隔秒数） | 引擎 |

### As Producer (produces-events)
| 事件 | 携带的 payload | 典型下游 |
|---|---|---|
| `track.enter-segment` | `{ agent, fromSegment, toSegment }` | entity-lifecycle@v1、win-lose-check@v1 |
| `track.attack-position` | `{ agent, segmentId, gridPosition, fromPositionKey, toPositionKey }` | ray-cast@v1（`resolveAction` 读取 `ev.agent`） |
| `track.loop-complete` | `{ agent, lapCount }` | entity-lifecycle@v1（回收 agent） |

### DAG Wiring Rules
- ✅ 正确接法：`parametric-track` 由引擎 tick 驱动，不依赖上游事件字段；下游 `ray-cast` 应监听 `track.attack-position`，因为其 `resolveAction` 从 `ev.agent` 中取 `gridPosition`/`segmentId`，刚好由本事件携带
- ✅ 正确接法：`track.loop-complete` → entity-lifecycle 做 agent 回收，`ev.agent` 包含完整 agent 快照（含 `lapCount`）
- ❌ 常见接错：让 `ray-cast` 监听 `track.enter-segment`——该事件粒度是每段一次，而非每格一次，会导致攻击判定遗漏格子
- ❌ 常见接错：下游假设 `track.attack-position` 的 `agent` 字段是 entity 引用——它是一个快照副本（deep copy），不要用 `===` 做身份比较
