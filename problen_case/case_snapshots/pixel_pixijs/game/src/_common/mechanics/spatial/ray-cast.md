# ray-cast@v1

## Semantic Contract

从 source 点沿 direction 投射一条射线，在 obstacles 集合中取命中结果。
支持两种停止模式：first-hit（取最近一个） / all-hits（取全部按距离排序）。
**禁止跨越阻挡**：若有中间阻挡存在，即使后方存在匹配目标，也不得返回后方目标。

## Required State Fields

source agent / target 列表各自需具备：

| 字段 | 类型 | 含义 |
|---|---|---|
| `position` | {x, y} \| {row, col} | 世界坐标或网格坐标 |
| `alive` | boolean | 仅 alive=true 参与命中 |

## Params

```yaml
source:         # 动态源
  from: "<agent-field-ref>"      # 如 pig.position
direction:
  mode: fixed | normal-to-track | toward-field
  # fixed:            vector {dx, dy}
  # normal-to-track:  读 source agent 的 segmentId，由 segment-direction-map 决定
  # toward-field:     朝某个字段指定的点
  value: {dx, dy}                # 当 mode=fixed 时
  segment-direction-map:         # 当 mode=normal-to-track 时
    top:    { dx: 0,  dy: 1 }    # 从上边向下
    right:  { dx: -1, dy: 0 }
    bottom: { dx: 0,  dy: -1 }
    left:   { dx: 1,  dy: 0 }
targets:
  from: "<collection-ref>"       # 如 blocks
coord-system: pixel | grid       # grid 模式下用 row/col
stop-on: first-hit | all-hits
max-distance: number | null
```

## Invariants

1. **no-penetration**: first-hit 模式下，返回的 target 必须是 source 到目标连线上距离最近的 alive target；不得跳过中间 target
2. **source-dependency**: 命中结果必须是 source.position 的函数；**禁止**与 source 位置无关的全局搜索
3. **direction-determinism**: 给定同样的 source.position 和 mode 下的输入（如 segmentId），方向必须唯一确定
4. **coord-consistency**: 所有 targets 的 position 必须与 coord-system 一致

## Discrete Events Exposed

| 事件 | 触发条件 |
|---|---|
| `ray.hit-candidate` | 命中一个或多个 target（payload: `{source, targets: [...], distances: [...]}`） |
| `ray.miss` | 无命中 |

## Common Composition

- 配 `predicate-match` 判定"命中后是否满足条件（如同色）"：ray-cast 只负责定位，不负责匹配
- 配 `parametric-track`：direction.mode=normal-to-track，自动从 segmentId 查方向
- 配 `resource-consume`：命中+匹配成功后扣血

## Engine Adaptation Hints

| 引擎 | 建议 |
|---|---|
| canvas | grid 模式：从 source 按 (dx,dy) 步进格子查询；pixel 模式：用 segment-intersect 算法 |
| pixijs | 同 canvas，考虑用空间分区（Grid/QuadTree）提速，但 POC 阶段不需要 |
| phaser | grid 模式用自写循环；pixel 模式可用 `Phaser.Geom.Line` + `Intersects.LineToRectangle` |
| dom | grid 模式查二维数组最快 |

**禁止**：
- 全局 `blocks.find(b => b.color === pig.color)`（违反 source-dependency，这是 pixel-flow 类游戏的核心 bug）
- 无视 alive 字段（必须过滤 alive=false）
- 在 grid 模式下走 pixel 距离（必须走曼哈顿步数）
