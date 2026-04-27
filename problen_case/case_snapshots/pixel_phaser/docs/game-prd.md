---
game-aprd: "0.1"
project: pixel_phaser-001
platform: [web]
runtime: phaser3
is-3d: false
mode: 单机
need-backend: false
language: zh-CN
color-scheme:
  palette-id: pixel-retro
  theme-keywords: [像素, 传送带, 清板, 益智, 策略, 休闲]
  primary: "#ef4444"
  secondary: "#facc15"
  accent: "#22c55e"
  background: "#1a1a2e"
  surface: "#16213e"
  text: "#e2e8f0"
  text-muted: "#94a3b8"
  success: "#22c55e"
  error: "#ef4444"
  border: "#334155"
  font-family: '"Press Start 2P", "VT323", monospace'
  border-radius: "0"
  shadow: "2px 2px 0 #000"
  fx-hint: pixel
delivery-target: feature-complete-lite
must-have-features: [四周环形传送带, 颜色匹配攻击, 等待槽回收, 多关卡递进, 容量管理]
nice-to-have-features: [攻击动画, 消除特效, 回收动画]
cut-preference: 先缩内容量，不先砍核心系统
support-level: 直接支持
engine-plan:
  runtime: phaser3
  reason: "棋盘格子型 + 实时传送带移动 + 碰撞检测 + 像素风格，Phaser 3 完美匹配"
  version-pin: phaser@3
mvp-scope: [3关卡递进, 四周传送带, 颜色匹配攻击, 等待槽回收, 传送带容量, 胜负判定]
risk-note:
  - "攻击判定必须严格按位置而非全屏索敌，Playwright 需验证"
  - "小猪移动速度与攻击判定时序需要精确调试"
asset-strategy:
  mode: library-first
  rationale: >
    颜色匹配是核心判定条件，玩家必须快速分辨红/蓝/黄/绿4种颜色；
    纯色方块+数字可以实现基本玩法，但会丢失像素风格沉浸感；
    核心小猪和目标块用Kenney素材库，HUD和背景允许程序化生成。
  visual-core-entities: [pig, block]
  visual-peripheral: [hud-score, hud-level, board]
  style-coherence:
    level: strict
    note: "核心实体同一像素pack；背景独立生成但配色要跟色板"

artifacts:
  scene-spec: specs/scene.yaml
  rule-spec: specs/rule.yaml
  data-spec: specs/data.yaml
  asset-plan: specs/assets.yaml
  event-graph: specs/event-graph.yaml
  implementation-contract: specs/implementation-contract.yaml
  game: game/
---

# 像素传送带清板 Game PRD

## 1. 项目概述

### @game(main) 像素传送带清板
> genre: board-grid
> platform: [web]
> runtime: phaser3
> mode: 单机
> player-goal: "清空中央棋盘所有目标块，通关全部关卡"
> core-loop: [@flow(play-round)]
> scenes: [@scene(start), @scene(play), @scene(result)]
> states: [@state(ready), @state(playing), @state(win), @state(lose)]
> levels: [@level(level-1), @level(level-2), @level(level-3)]
> resources: [@resource(color-blocks), @resource(pig-sprites)]
> controls: [@input(click-pig)]

像素风轻度休闲益智策略游戏。玩家点击底部等待槽中的小猪，使其进入棋盘四周的环形传送带，沿外圈移动时根据当前位置攻击正对方向的第一个同色目标块，逐步清空中央棋盘。

核心体验：通过合理安排出场顺序、颜色搭配和等待槽管理，在有限资源下完成清板目标。

---

## 2. 目标玩家与使用场景

**目标玩家**：喜欢益智策略游戏、休闲消遣的玩家，年龄层覆盖广。

**使用场景**：
- 碎片化休闲时间（5-10分钟/局）
- 网页端即开即玩，无需下载安装
- 竖屏适配，支持移动端浏览器

**核心价值**：
- 简单易上手，单局时间短
- 顺序决策带来策略深度
- 像素风格视觉舒适

---

## 3. 核心玩法边界与 MVP 定义

### 本版本必须做
- 四周环形传送带系统（小猪沿外圈持续移动）
- 颜色匹配攻击（按当前位置正对方向第一个目标块判定）
- 有限弹药单位（小猪数值耗尽后消失）
- 等待槽回收与再派出
- 传送带容量上限管理
- 多关卡递进（2色→3色→4色+强化块）
- 胜负判定与结算页

### 本版本尽量做
- 攻击动画（发射像素弹）
- 目标块消除特效（闪烁+缩放）
- 小猪回收动画

### 本版本后放
- 排行榜
- 关卡编辑器
- 自定义词库/皮肤
- 联机对战

---

## 4. 主干流程

### @flow(play-round) 单局流程
> entry: @scene(start)
> main-scene: @scene(play)
> exit: @scene(result)
> involves: [@scene(start), @scene(play), @rule(attack-check), @rule(win-check), @rule(lose-check), @scene(result)]

玩家进入开始页 → 点击开始 → 进入主玩法页 → 点击等待槽派出小猪 → 小猪进入传送带移动 → 遇同色块攻击 → 数值未耗尽则回收 → 循环操作直到清空棋盘或资源耗尽 → 结算页（胜利/失败）

---

## 5. 场景规格

### @scene(start) 开始页
> entry: true
> layout: center-stack
> inputs: [@input(click-start)]
> ui: [@ui(title), @ui(start-btn), @ui(level-select)]

显示游戏标题、开始按钮、关卡选择（已解锁关卡高亮）。

### @scene(play) 主玩法页
> entry: false
> layout: vertical-three-zone
> inputs: [@input(click-pig)]
> ui: [@ui(hud-level), @ui(hud-score), @ui(board), @ui(conveyor), @ui(waiting-slots)]
> state-on-enter: @state(ready)

**布局三区域**：
1. 顶部 HUD：关卡信息、得分
2. 中央区域：棋盘 + 四周传送带
3. 底部：等待槽（5个槽位）

### @scene(result) 结算页
> entry: false
> layout: center-stack
> inputs: [@input(click-retry), @input(click-next)]
> ui: [@ui(result-title), @ui(final-score), @ui(retry-btn), @ui(next-btn)]

显示胜利/失败、最终得分、重试按钮、下一关按钮（仅胜利时可用）。

---

## 6. 状态与实体

### @state(ready) 准备状态
> on-enter: "初始化棋盘、等待槽、传送带"
> transitions: [@state(playing)]

### @state(playing) 游戏中
> on-enter: "启用玩家输入"
> transitions: [@state(win), @state(lose)]

### @state(win) 胜利
> on-enter: "棋盘清空 → 显示胜利结算"
> transitions: [@scene(result)]

### @state(lose) 失败
> on-enter: "资源耗尽且无法继续 → 显示失败结算"
> transitions: [@scene(result)]

### @entity(pig) 小猪单位
> type: unit
> fields: {color: enum(red|blue|yellow|green), ammo: int, position: enum(waiting|conveyor), conveyorSlot: int}
> scene: @scene(play)

**属性说明**：
- `color`：小猪颜色，决定能攻击的目标块颜色
- `ammo`：剩余攻击次数，耗尽后消失
- `position`：当前位置（等待槽/传送带）
- `conveyorSlot`：传送带上的位置索引

### @entity(block) 目标块
> type: tile
> fields: {color: enum(red|blue|yellow|green), hp: int, gridX: int, gridY: int, cleared: bool}
> scene: @scene(play)

**属性说明**：
- `color`：目标块颜色
- `hp`：耐久度，普通块=1，强化块=2+
- `gridX/gridY`：棋盘坐标
- `cleared`：是否已消除

### @entity(conveyor) 传送带
> type: prop
> fields: {capacity: int, pigs: array, speed: float}
> scene: @scene(play)

**属性说明**：
- `capacity`：最大容量（默认4）
- `pigs`：当前在传送带上的小猪数组
- `speed`：移动速度

### @entity(waiting-slot) 等待槽
> type: prop
> fields: {slots: array, capacity: int}
> scene: @scene(play)

**属性说明**：
- `slots`：5个槽位，每槽可放一只小猪或为空
- `capacity`：最大槽位数（固定5）

### @ui(title) 游戏标题
> scene: @scene(start)
> role: display
> position: top-center

### @ui(start-btn) 开始按钮
> scene: @scene(start)
> role: button
> position: center

### @ui(level-select) 关卡选择
> scene: @scene(start)
> role: selector
> position: bottom

### @ui(hud-level) 关卡信息
> scene: @scene(play)
> role: display
> position: top-left

### @ui(hud-score) 得分显示
> scene: @scene(play)
> role: display
> position: top-right

### @ui(board) 棋盘
> scene: @scene(play)
> role: game-area
> position: center

### @ui(conveyor) 传送带
> scene: @scene(play)
> role: game-area
> position: surround-board

### @ui(waiting-slots) 等待槽区域
> scene: @scene(play)
> role: game-area
> position: bottom

### @ui(result-title) 结算标题
> scene: @scene(result)
> role: display
> position: top-center

### @ui(final-score) 最终得分
> scene: @scene(result)
> role: display
> position: center

### @ui(retry-btn) 重试按钮
> scene: @scene(result)
> role: button
> position: bottom-left

### @ui(next-btn) 下一关按钮
> scene: @scene(result)
> role: button
> position: bottom-right

---

## 7. 规则与系统

### @input(click-pig) 点击小猪
> device: click
> targets: [@entity(pig)]
> bindings: "点击等待槽中的小猪 → 派出到传送带"

玩家点击等待槽中的小猪，如果传送带未满，则将该小猪派入传送带。

### @input(click-start) 点击开始
> device: click
> targets: [@ui(start-btn)]
> bindings: "点击开始按钮 → 进入游戏"

### @input(click-retry) 点击重试
> device: click
> targets: [@ui(retry-btn)]
> bindings: "点击重试按钮 → 重新开始当前关卡"

### @input(click-next) 点击下一关
> device: click
> targets: [@ui(next-btn)]
> bindings: "点击下一关按钮 → 进入下一关"

### @rule(dispatch-pig) 派出小猪
> trigger: "玩家点击等待槽中的小猪 且 传送带容量未满"
> effect: "pig.position = conveyor ; pig.conveyorSlot = firstEmptySlot ; conveyor.pigs.push(pig)"
> scope: @scene(play)
> priority: 1

### @rule(dispatch-cleanup) 派出清理槽位
> trigger: "@rule(dispatch-pig) 执行后"
> effect: "waiting-slot.slots[clickedIndex] = null"
> scope: @scene(play)
> priority: 1

### @rule(conveyor-move) 传送带移动
> trigger: "每帧 update"
> effect: "for each pig in conveyor.pigs → pig.conveyorSlot = (pig.conveyorSlot + speed * dt) % totalSlots"
> scope: @scene(play)
> priority: 0

小猪沿传送带持续移动，经过棋盘四边时检查攻击机会。

### @rule(attack-check) 攻击判定
> trigger: "小猪移动到棋盘四边位置 且 该边正对方向存在目标块"
> effect: "target = findFirstBlockInDirection(pig.position) ; if target.color == pig.color → trigger @rule(attack-exec)"
> scope: @scene(play)
> priority: 2

**方向判定规则**：
- 小猪在上边 → 检查正对那一列"从上往下数第一个未消除块"
- 小猪在右边 → 检查正对那一行"从右往左数第一个未消除块"
- 小猪在下边 → 检查正对那一列"从下往上数第一个未消除块"
- 小猪在左边 → 检查正对那一行"从左往右数第一个未消除块"

### @rule(attack-exec) 执行攻击
> trigger: "@rule(attack-check) 判定为同色"
> effect: "target.hp -= 1 ; pig.ammo -= 1 ; if target.hp <= 0 → target.cleared = true"
> scope: @scene(play)
> priority: 3

### @rule(attack-aftermath) 攻击后续
> trigger: "@rule(attack-exec) 执行后"
> effect: "play attack animation ; if pig.ammo <= 0 → remove pig from conveyor"
> scope: @scene(play)
> priority: 3

### @rule(recycle-pig) 回收小猪
> trigger: "小猪离开传送带 且 pig.ammo > 0"
> effect: "pig.position = waiting ; pig.conveyorSlot = -1 ; find empty waiting-slot → place pig"
> scope: @scene(play)
> priority: 4

小猪走完一圈传送带后，如果还有剩余弹药，回收到等待槽空位。

### @rule(win-check) 胜利判定
> trigger: "棋盘上所有目标块 cleared == true"
> effect: "state.phase = win ; state.gameOver = true"
> scope: @scene(play)
> priority: 5

### @rule(lose-check) 失败判定
> trigger: "等待槽为空 且 传送带为空 且 棋盘仍有未消除块"
> effect: "state.phase = lose ; state.gameOver = true"
> scope: @scene(play)
> priority: 5

### @constraint(no-global-autoaim) 禁止全屏自动索敌
> kind: hard-rule
> severity: critical

攻击必须严格依赖「小猪当前所在位置」，只能攻击正对方向第一个目标块，不得全屏自动寻找同色块。

### @constraint(no-multi-attack) 禁止一次攻击多块
> kind: hard-rule
> severity: critical

每次攻击只处理1个目标块，不得一次攻击整行、整列或全屏所有同色块。

### @constraint(no-penetration) 禁止穿透攻击
> kind: hard-rule
> severity: critical

小猪不能跳过前方异色块去攻击后方同色块，必须先清除外层阻挡。

### @constraint(core-mechanics) 核心玩法约束
> kind: hard-rule
> severity: critical

必须严格体现"四周传送带 + 按当前位置依序处理当前方向上的第一个目标块 + 等待槽回收再派出"的玩法核心。

---

## 8. 资源与数据

### @resource(color-blocks) 颜色方块素材
> type: sprite
> source: assets/library_2d/tiles/
> count: 4
> format: png

红、蓝、黄、绿四种颜色的像素方块素材。

### @resource(pig-sprites) 小猪精灵
> type: sprite
> source: assets/library_2d/characters/
> count: 4
> format: png

红、蓝、黄、绿四种颜色的小猪像素素材。

### @level(level-1) 第1关
> difficulty: easy
> params: {colors: 2, gridSize: 5x5, blocks: 15, pigs: 8, conveyorCapacity: 4}
> unlock-after: -

**关卡配置**：
- 颜色数：2（红、蓝）
- 棋盘：5×5
- 目标块：15个（全为普通块）
- 初始小猪：8只（红4蓝4，弹药随机2-3）
- 传送带容量：4

### @level(level-2) 第2关
> difficulty: medium
> params: {colors: 3, gridSize: 6x6, blocks: 25, pigs: 12, conveyorCapacity: 4}
> unlock-after: @level(level-1)

**关卡配置**：
- 颜色数：3（红、蓝、黄）
- 棋盘：6×6
- 目标块：25个（含3个强化块hp=2）
- 初始小猪：12只
- 传送带容量：4

### @level(level-3) 第3关
> difficulty: hard
> params: {colors: 4, gridSize: 7x7, blocks: 35, pigs: 16, conveyorCapacity: 4}
> unlock-after: @level(level-2)

**关卡配置**：
- 颜色数：4（红、蓝、黄、绿）
- 棋盘：7×7
- 目标块：35个（含5个强化块hp=2，2个强化块hp=3）
- 初始小猪：16只
- 传送带容量：4

---

## 9. 运行方式与框架策略

**引擎选择**：Phaser 3

**选择理由**：
1. 棋盘格子型游戏，Phaser 3 完美适配
2. 传送带移动需要实时动画和碰撞检测，Phaser 内置 tween 和 physics 支持
3. 像素风格渲染，Phaser 的 pixel-art 配置完善
4. 单文件 HTML 可直接运行，或本地 HTTP 服务器模式

**运行模式**：`local-http`

**CDN 引入**：
```html
<script src="https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js"></script>
```

**游戏配置**：
- 分辨率：竖屏 720×1280（响应式适配）
- 渲染模式：WebGL 优先，Canvas 降级
- 像素完美渲染：`pixelArt: true`

---

## 10. 校验点与验收标准

### @check(game-boots) 游戏启动
> layer: engineering
> method: "Playwright 打开 game/index.html → 等待 3 秒"
> expect: "无 JS 错误，Phaser 游戏场景正常渲染，window.gameState 存在"

### @check(click-dispatch) 点击派出
> layer: product
> method: "Playwright 点击等待槽小猪 → 检查小猪是否出现在传送带上"
> expect: "pig.position == conveyor，传送带小猪数+1"

### @check(attack-logic) 攻击逻辑
> layer: product
> method: "Playwright 派出红色小猪 → 等待其移动到正对红色目标块的位置 → 检查目标块 hp"
> expect: "target.hp 减 1，pig.ammo 减 1"

### @check(no-autoaim) 禁止全屏索敌验证
> layer: product
> method: "Playwright 派出红色小猪 → 在其前方放置蓝色块阻挡 → 检查后方红色块是否被攻击"
> expect: "后方红色块不被攻击,只有前方蓝色块受影响(或都不攻击因为颜色不匹配)"

### @check(win-condition) 胜利条件
> layer: product
> method: "Playwright 完成关卡1的所有目标块消除 → 检查结果页"
> expect: "state == win，显示胜利结算页"

### @check(lose-condition) 失败条件
> layer: product
> method: "Playwright 消耗所有小猪但棋盘仍有未消除块 → 检查结果页"
> expect: "state == lose，显示失败结算页"

### @check(recycle-mechanics) 回收机制
> layer: product
> method: "Playwright 派出弹药>1的小猪 → 等待其走完一圈 → 检查等待槽"
> expect: "小猪回到等待槽，ammo 保留剩余值"

### @check(level-progression) 关卡递进
> layer: product
> method: "Playwright 通关第1关 → 检查第2关是否解锁"
> expect: "第2关解锁可用"

---

## 11. 可选扩展

本版暂不包含：
- 排行榜系统
- 关卡编辑器
- 自定义皮肤/词库
- 联机对战模式
- 成就系统

后续版本可考虑接入。
