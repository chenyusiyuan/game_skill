# grid_logic interaction prototype

OpenGame 五原型之一：grid + turn/static logic。它不是 puzzle 品类枚举，而是判断玩法是否由离散格子、一步一格、格状态变化和规则推演驱动。

## 选择条件

- 位置以格子为单位，移动或操作通常是离散步骤。
- 物理引擎不是主角；碰撞、胜负、阻挡、消除、推箱、连锁都由格状态决定。
- 可以覆盖 Sokoban、棋类、战棋、Match-3、Minesweeper、Snake、Tetris、roguelike 小地图等。
- 回合制、步进式、实时格子都可以，但必须有明确 grid state。

关键问题：核心进展是不是发生在离散 cell 上？如果是，优先按 `grid_logic` 处理。

## Phase A 设计重点

- `coreLoop.primaryAction` 写成输入 -> 格状态变化 -> 反馈 -> 胜负检查。
- 明确 grid 尺寸、cell 语义、实体类型、可移动/可阻挡/可收集/可破坏规则。
- `temporalShape` 写清关卡、回合、步数限制、撤销、重开或分数目标。
- `uiSurfaces.primary` 显示步数、分数、目标、当前关、剩余机会或选中状态。
- 桌面标准画布为 960×720；棋盘/谜题可用 800×600，但要在 decisions.md 说明信息密度足够。

## Phase B 落地提醒

- Board/grid state 是单一真相源，不要同时让 tilemap、sprite 坐标和状态数组各自决定规则。
- 输入处理要有锁，避免一次按键触发多步或动画没结束又改状态。
- 每次有效操作都要有可见反馈：移动、推箱、消除、翻牌、开门、受伤、胜利。
- 多关卡要变化布局或规则组合，不能只重置同一个棋盘。
- 暂停和重开要清晰区分；暂停不重置棋盘，重开才恢复初始局面。

## Smoke 建议

- 用短解法证明规则：一步移动、一次推/交换/翻开、一次得分或一个目标达成。
- 对 grid case，state evidence 很重要：例如 `moves == 1`、`score > 0`、`boxOnGoal == true`、`revealedCells >= 1`。
- 不要把完整复杂谜题、长解法或随机牌序当成 Stage 1 硬 smoke。

## 常见失败形态

- 看起来是格子，但内部仍用连续物理碰撞，导致状态和画面不同步。
- cell 太小或颜色太接近，玩家看不清格子边界和目标。
- 输入没有 debounce，一次按键推进多次。
- 胜负条件只在文本里写了，业务状态不会真正变化。
- 关卡变体只是换颜色，没有规则或布局差异。
