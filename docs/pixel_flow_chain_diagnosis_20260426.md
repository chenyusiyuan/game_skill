# Pixel Flow 生成链路问题定位

生成对象：`test/pixel.md`
覆盖会话：最近四个 Claude Code 会话（`phaser` / `canvas` / `pixijs` / `dom_ui`）
约束：未修改任何 `cases/*/game` 代码，本报告只定位链路问题。

## 结论

这批问题不是单个 case 写坏，而是链路把“能启动 / 有 trace / 有素材引用 / 静态合规”误当成“玩法正确 / 视觉语义正确 / 可交付”。当前最危险的口径漂移是：

- `check_project.js` 和 `check_skill_compliance.js` 都能在 Phaser 白屏时通过。
- `check_playthrough.js` 现在主要看 `window.__trace` 覆盖率，不校验攻击目标、首个阻挡块、状态变化是否真的符合 PRD。
- Phase 5 的交付报告可以被 agent 手写，未强制从真实校验结果聚合生成。
- case 生成过程中改了链路级文件，比如 `assets/library_2d/catalog.yaml` 和 `game_skill/skills/scripts/profiles/*.json`，这会污染后续 case。

## 四个会话证据

| 会话 | case | 状态 | 暴露的问题 |
|---|---|---|---|
| `dd042668...` | `cases/pixel-flow-phaser-001` | 当前 `check_game_boots.js` 失败 | Phaser 首屏白屏，`window.gameState` 和 `window.gameTest` 未暴露；但 `check_project.js` 与 `check_skill_compliance.js` 仍通过，最终报告还写成已完成。 |
| `f4a10e49...` | `cases/canvas` | 校验最终通过 | 多次失败原因是 trace 覆盖率不足，修复方向变成补 trace / 改 profile / 用 `forceWin()`、`forceLose()` 触发结果；没有验证“当前位置正对方向的第一个块”是否被正确命中。 |
| `3fc055b5...` | `cases/pixel-flow-001` | PixiJS 未完成 | 工程与 boot 已通过，但 playthrough 因 profile 缺 PRD checks 失败；会话在补全全局 profile 中中断。中途还改了 `assets/library_2d/catalog.yaml` 让 `sprites-puzzle` 支持 `pixel-retro`。 |
| `fc932b6f...` | `cases/dom_ui` | 最终口头交付 | boot 先因 `null` 图片和错误素材路径失败，后修到 boot 通过；playthrough 仍因 selector/profile 问题失败过，但最终仍写“核心功能全部实现”。 |

## 具体链路问题

### 1. 最终交付没有硬聚合门禁

Phaser 当前复跑结果：

```text
check_game_boots.js cases/pixel-flow-phaser-001/game/
✗ boot 失败:
  首屏没有可见文本或画布
  window.gameState 未定义
  [BOOT-TEST-API] phaser3 引擎项目但 window.gameTest / simulateCorrectMatch 未暴露
```

但同一个 case：

```text
check_project.js cases/pixel-flow-phaser-001/game/  -> 通过
check_skill_compliance.js cases/pixel-flow-phaser-001 -> 100/100 PASS
```

说明工程静态检查和合规审计没有把 boot/playthrough 纳入最终门槛。`eval/report.json` 也不是由统一脚本聚合真实结果，而是可被 agent 直接写出来。

### 2. 产品侧校验变成“trace 覆盖率”，不是“玩法语义”

`canvas` 的 profile 里大量步骤只是：

- `window.gameTest.getBlocks().length > 0`
- `window.gameTest.getWaitingSlots().length > 0`
- `window.gameTest.forceWin()`
- `window.gameTest.forceLose()`
- 等待足够久让 trace 出现

这能让 `check_playthrough.js` 通过，但不能证明：

- 小猪靠近同色方块时一定攻击；
- 异色第一块会阻挡后方同色块；
- 每次只攻击当前方向第一个目标；
- 等待槽回收保留数值且能再次派出。

当前 `check_playthrough.js` 已禁止 `expect`，转向 trace 判定，但 trace 只证明代码执行过某个分支，不证明 `before/after` 符合 PRD。

### 3. 攻击判定缺少“轨道位置到棋盘行列”的强契约

`canvas` 代码里 `raycastFromPig()` 没有使用小猪在轨道上的连续位置投影，只按 segment 固定从边缘扫描：

- top 永远从 `row=0`、`col=0` 开始；
- right 永远从 `row=0`、`col=gridSize-1` 开始；
- bottom / left 也没有从小猪当前位置映射到对应行列。

所以“靠近同色方块还是不攻击”是链路漏掉的：Phase 3 只写了 `grid-projection` 概念，codegen 没被迫实现；`check_mechanics.js` 的 symbolic scenario 也没有覆盖每个边、每个列/行的 first-hit 语义。

### 4. 方形棋盘和圆形轨道的冲突来自 specs 放行

原需求是“四周环形传送带 / 棋盘外围”，语义上是围绕方形棋盘的四段矩形轨道。当前链路把它展开成：

- `scene.yaml` 有的 case 写 `shape: ring`；
- `mechanics.yaml` 写 `shape: ring`；
- codegen 据此画 `ctx.arc(...)`。

链路缺少 `grid-board + around-board` 的形状一致性校验：棋盘是正方形时，轨道应是 `rect-loop` / 四边路径，而不是几何圆。

### 5. 素材语义检查太弱，导致“色块”绑定成杂素材

DOM UI 的 `assets.yaml` 把目标块绑定到 dungeon tile / coin：

- `block-red -> tiles/dungeon/tile_0078.png`
- `block-yellow -> ui-pixel/tile_0040.png`
- `block-green -> tiles/dungeon/tile_0080.png`

这满足 `binding-to: block` 和 local-file 占比，但不满足“目标块就是颜色方块”的视觉语义。更糟的是 contract 把这些核心 block 标为 `role: decorative` 仍然通过。链路需要区分：

- `binding-to` 只说明绑定对象；
- `semantic-slot` / `visual-primitive` 才说明“它应该长什么样”。

否则只要素材存在、被引用、binding-to 指向 block，就会把错误素材当成正确素材。

### 6. 生成会话污染了链路级资产和 profile

会话中出现了两类危险写入：

- 修改 `assets/library_2d/catalog.yaml`，把 `sprites-puzzle` 加进 `pixel-retro`，使原本的风格不匹配变成通过。
- 多次修改 `game_skill/skills/scripts/profiles/*.json`，而这些 profile 是全局脚本资源，不是 case-local 产物。

case 生成链路应该只允许写：

- `cases/{slug}/...`
- 明确的临时 profile / eval artifact

不应该在单个 case 生成过程中改全局 catalog、全局 checker、全局 profile。

## 修复优先级

### P0：加最终统一门禁

新增一个 `verify_all.js` 或等价入口，唯一允许它把 `state.verify=completed` 和生成 `eval/report.json`：

1. `check_game_boots.js`
2. `check_project.js`
3. `check_playthrough.js`
4. `check_skill_compliance.js`

任一失败，禁止写交付成功。`eval/report.json` 必须从这四个脚本的真实退出码和日志聚合，不能手写。

### P0：禁止 case 生成改全局链路文件

Phase 4/5 agent 写入白名单限制到 `cases/{slug}/`。Profile 改为 case-local，例如：

- `cases/{slug}/eval/profile.json`
- `cases/{slug}/.game/profile.json`

全局 `game_skill/skills/scripts/profiles/` 只放模板或基准，不在 case 生成时写。

### P0：产品校验恢复语义断言

`profile` 可以继续只负责驱动，但 checker 必须读取 `@check.expect` / `rule-traces.actions` 做状态语义验证。至少增加三类固定断言：

- attack：给定 side + projected row/col + blocks，验证命中的是“当前方向第一个目标块”。
- no-penetration：第一块异色时，后方同色不能被攻击。
- recycle：小猪剩余数值 > 0 时回到等待槽并保留数值。

并禁止产品检查用 `forceWin()` / `forceLose()` 这类直接改结果状态的 API 充当真实玩法。

### P1：轨道语义从 `ring` 拆成 `rect-loop`

`grid-board + around-board` 默认应展开为：

```yaml
track-shape: rect-loop
segments: [top, right, bottom, left]
projection:
  top: col = floor(progress * gridSize)
  right: row = floor(progress * gridSize)
  bottom: col = gridSize - 1 - floor(progress * gridSize)
  left: row = gridSize - 1 - floor(progress * gridSize)
```

如果 specs 写 `shape: ring`，必须要求 PRD 明确要圆形轨道；否则 gate fail。

### P1：资产语义要从“有绑定”升级为“绑定正确”

对核心实体增加 `visual-primitive`：

- `block`: `color-square`
- `pig`: `colored-unit`
- `track`: `rect-loop-path`

当 `visual-primitive=color-square` 时，优先 `graphics-generated` / 程序化色块；local-file 只有在 catalog 标注为 square/block/tile 且颜色语义可控时才允许。`role: decorative` 不能满足核心实体。

### P1：Phaser/Pixi boot 必须进入最终门禁

Phaser 当前 `check_project` 通过但 boot 白屏，说明静态检查不够。`check_project` 可以继续做静态检查，但最终报告必须依赖 `check_game_boots` 的真实结果；Phaser/Pixi 还应额外检查：

- HTML 实际加载的 module 路径不 404；
- `window.gameState`、`window.gameTest` 在浏览器运行时存在；
- start action 后 `phase=playing` 且 canvas 非空。
