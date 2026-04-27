---
game-aprd: "0.1"
project: pixel_dom_ui
platform: [web]
runtime: dom-ui
is-3d: false
mode: 单机
need-backend: false
language: zh-CN
color-scheme:
  palette-id: pixel-retro
  theme-keywords: [像素, 传送带, 清板, 益智, 策略, 颜色匹配, 小猪, 棋盘]
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
must-have-features: [四周传送带, 颜色匹配攻击, 小猪单位系统, 等待槽回收, 中央棋盘目标块, 位置依赖索敌, 胜负条件]
nice-to-have-features: [战斗反馈动画, 多关卡递进, 强化块/锁定块]
cut-preference: 先缩内容量，不先砍核心系统
support-level: 降级支持
engine-plan:
  runtime: dom-ui
  reason: "用户选择 DOM；棋盘格子型+实时动画非 DOM 最佳场景，但可通过 CSS animation/setInterval 模拟"
  version-pin: "@tailwindcss/browser@4"
mvp-scope: [中央棋盘, 四周传送带, 小猪单位, 等待槽, 颜色匹配攻击, 位置依赖索敌, 胜负判定, 基础反馈动画]
risk-note:
  - "DOM 实现实时动画（传送带移动）需要 setInterval/CSS animation，性能不如 Canvas/Phaser"
  - "位置依赖索敌需要精确的碰撞检测，DOM 需用 getBoundingClientRect 模拟"
  - "像素风格素材需内联 SVG 或 emoji 替代，否则需从素材库加载"

asset-strategy:
  mode: generated-only
  rationale: >
    颜色匹配是核心判定条件，玩家必须快速分辨 4 种颜色；
    使用 DOM+CSS 可以用纯色方块+emoji/SVG 实现视觉；
    小猪用 emoji 🐷，目标块用 CSS 渲染的彩色方块，无需外部素材库。
  visual-core-entities: [pig, block]
  visual-peripheral: [hud-timer, hud-score, conveyor, wait-slots]
  style-coherence:
    level: flexible
    note: "核心用 emoji + CSS 方块，背景用 CSS 渐变，风格统一即可"

artifacts:
  scene-spec: specs/scene.yaml
  rule-spec: specs/rule.yaml
  data-spec: specs/data.yaml
  asset-plan: specs/assets.yaml
  event-graph: specs/event-graph.yaml
  implementation-contract: specs/implementation-contract.yaml
  game: game/
---

# 像素传送带清板益智游戏 Game PRD

## 1. 项目概述

### @game(main) 像素传送带清板
> genre: board-grid
> platform: [web]
> runtime: dom-ui
> mode: 单机
> player-goal: "清空中央棋盘中的全部目标块"
> core-loop: [@flow(play-round)]
> scenes: [@scene(start), @scene(play), @scene(result)]
> states: [@state(ready), @state(playing), @state(win), @state(lose)]
> levels: [@level(level-1), @level(level-2), @level(level-3)]
> controls: [@input(click-pig)]

像素风、轻度休闲、益智策略、竖屏点击游戏。核心逻辑：四周环形传送带、颜色匹配攻击、有限弹药单位、等待槽回收、容量管理、顺序清板。玩家需要通过合理安排出场顺序、颜色搭配和等待槽管理，逐步清空整块像素区域。

## 2. 目标玩家与使用场景

**目标玩家**：喜欢益智策略游戏的休闲玩家，偏好轻度思考、不追求反应速度的点击操作。

**使用场景**：碎片时间消遣，单局 3-5 分钟，竖屏操作，单手可玩。

**体验目标**：体现明显的"顺序决策"属性，每一关都让玩家感受到"只要调整派出顺序，局面就可能从失败变为通关"。

## 3. 核心玩法边界与 MVP 定义

### 本版本必须做

- 四周环形传送带系统：小猪沿外圈持续移动
- 颜色匹配攻击机制：小猪只能攻击正对方向第一个同色目标块
- 小猪单位系统：颜色属性 + 弹药数值
- 等待槽回收机制：未耗尽小猪可回收再派出
- 中央棋盘目标块：普通块（耐久1）、强化块（耐久2+）、空白格
- 位置依赖索敌：严格按当前位置处理正对方向第一个目标块
- 胜负条件：清空棋盘=胜利，资源耗尽=失败

### 本版本尽量做

- 战斗反馈动画：攻击弹道、命中闪烁、消除动画、回收动画
- 多关卡递进：2色→3色→4色+强化块
- 锁定块：外层阻挡消除后内侧才可被攻击

### 本版本后放

- 自定义关卡编辑器
- 排行榜
- 音效系统

## 4. 主干流程

### @flow(play-round) 单局
> entry: @scene(start)
> main-scene: @scene(play)
> exit: @scene(result)
> involves: [@scene(start), @scene(play), @rule(match-attack), @rule(pig-recycle), @scene(result)]

玩家进入开始页点击开始 → 进入主玩法页 → 点击等待槽派出小猪 → 小猪沿传送带移动 → 依序攻击目标块 → 弹药未耗尽则回收到等待槽 → 循环直至胜负判定 → 结算页。

## 5. 场景规格

### @scene(start) 开始页
> entry: true
> layout: center-single
> inputs: [@input(click-start)]
> ui: [@ui(start-btn), @ui(title)]

显示游戏标题和开始按钮，点击开始进入主玩法页。

### @scene(play) 主玩法页
> entry: false
> layout: vertical-stack
> inputs: [@input(click-pig)]
> ui: [@ui(hud-timer), @ui(hud-score), @ui(board), @ui(conveyor), @ui(wait-slots)]
> state-on-enter: @state(ready)

**布局结构**：
- 顶部 HUD：关卡信息、得分、剩余小猪数
- 中部：中央棋盘（6×6 网格）+ 四周传送带
- 底部：等待槽（5 个槽位）

**中央棋盘**：固定网格，方块不会下落、不会补充、不会重排。目标是将棋盘上的所有目标块逐步清空。

**四周传送带**：闭环轨道，小猪只能沿棋盘外圈移动。传送带有容量上限。

### @scene(result) 结算页
> entry: false
> layout: center-single
> inputs: [@input(click-retry), @input(click-next)]
> ui: [@ui(result-title), @ui(result-score), @ui(retry-btn), @ui(next-btn)]

显示胜负结果、最终得分，提供重试和下一关按钮。

## 6. 状态与实体

### @state(ready) 准备
> on-enter: "初始化棋盘、等待槽、传送带"

游戏初始化状态，设置关卡数据。

### @state(playing) 进行中
> on-enter: "启用点击响应、启动传送带动画"
> on-exit: "停止动画、禁用点击"

主玩法进行中状态。

### @state(win) 胜利
> on-enter: "棋盘清空 → 显示胜利结算页"
> transitions: [@scene(result)]

### @state(lose) 失败
> on-enter: "资源耗尽且棋盘未清空 → 显示失败结算页"
> transitions: [@scene(result)]

### @entity(pig) 小猪
> type: pickup
> fields: {color: string, ammo: number, slotIndex: number, position: number, direction: string}
> spawn-rule: "玩家点击等待槽时派出"

小猪包含颜色（红/蓝/黄/绿）、弹药数值、传送带位置和移动方向。弹药耗尽后离场消失，未耗尽则回收到等待槽。

### @entity(block) 目标块
> type: tile
> fields: {color: string, hp: number, row: number, col: number}
> spawn-rule: "关卡初始化时放置"

目标块位于中央棋盘格子中，包含颜色和耐久值。被对应颜色命中后耐久-1，耐久归零后消失变为空白格。

### @entity(conveyor-slot) 传送带槽位
> type: prop
> fields: {position: number, occupant: pig|null}

传送带上的槽位，记录当前位置和占据的小猪（如有）。

### @entity(wait-slot) 等待槽位
> type: prop
> fields: {index: number, pig: pig|null}

底部等待槽，记录槽位索引和放置的小猪（如有）。

## 7. 规则与系统

### @input(click-pig) 点击小猪
> device: click
> targets: [@entity(wait-slot)]
> bindings: "点击等待槽中有小猪的槽位 → 派出该小猪到传送带"

玩家点击底部等待槽中的小猪，将其派出到传送带上。

### @input(click-start) 点击开始
> device: click
> targets: [@ui(start-btn)]

开始游戏，进入主玩法页。

### @input(click-retry) 点击重试
> device: click
> targets: [@ui(retry-btn)]

重试当前关卡。

### @input(click-next) 点击下一关
> device: click
> targets: [@ui(next-btn)]

进入下一关卡。

### @rule(match-attack) 颜色匹配攻击-方向判定
> trigger: "小猪移动到棋盘边位置时"
> effect: "target = getFirstBlockInDirection(pig.position, pig.direction)"
> scope: @scene(play)
> priority: 1

小猪移动到棋盘边缘位置时，根据方向获取正对方向的第一个目标块。

### @rule(match-attack-hit) 颜色匹配攻击-命中
> trigger: "target存在且target.color == pig.color"
> effect: "target.hp -= 1 ; pig.ammo -= 1 ; if target.hp <= 0 → removeBlock(target)"
> scope: @scene(play)
> priority: 2

若目标块颜色匹配：攻击一次，目标块耐久-1，小猪弹药-1。若颜色不匹配则不攻击，继续前进。

**方向判定**：
- 小猪在棋盘上边 → 检查该列从上往下第一个未消除块
- 小猪在棋盘右边 → 检查该行从右往左第一个未消除块
- 小猪在棋盘下边 → 检查该列从下往上第一个未消除块
- 小猪在棋盘左边 → 检查该行从左往右第一个未消除块

### @rule(pig-recycle) 小猪回收
> trigger: "小猪完成一圈移动且弹药 > 0"
> effect: "pig.position = -1 ; slot.pig = pig"
> scope: @scene(play)
> priority: 2

小猪沿传送带移动一圈后，若弹药未耗尽，则回收到等待槽，保留剩余弹药。玩家可再次点击派出。

### @rule(pig-exhaust) 小猪耗尽离场
> trigger: "小猪弹药 = 0"
> effect: "pig.position = -1 ; pig = null"
> scope: @scene(play)
> priority: 3

小猪弹药耗尽后直接离场消失，不回收到等待槽。

### @rule(win-check) 胜利判定
> trigger: "每帧检查"
> effect: "if state.blocksRemaining == 0 → state.phase = 'win'"
> scope: @scene(play)
> priority: 10

所有目标块被消除时判定胜利。state.blocksRemaining 归零时触发胜利状态。

### @rule(lose-check) 失败判定
> trigger: "每帧检查"
> effect: "if state.availablePigs == 0 && state.blocksRemaining > 0 → state.phase = 'lose'"
> scope: @scene(play)
> priority: 10

所有小猪耗尽且棋盘未清空时判定失败。

### @rule(conveyor-capacity) 传送带容量限制
> trigger: "玩家点击派出小猪"
> effect: "if conveyorPigs.length >= MAX_CONVEYOR → return ; else → deployPig()"
> scope: @scene(play)
> priority: 0

传送带有容量上限，超过容量时不能继续派出新的小猪。

### @ui(hud-timer) 计时器 HUD
> scene: @scene(play)
> role: info
> binds: state.elapsedTime

显示当前游戏时间（可选，本版本暂不强制计时）。

### @ui(hud-score) 得分 HUD
> scene: @scene(play)
> role: info
> binds: state.score

显示当前得分。

### @ui(board) 中央棋盘
> scene: @scene(play)
> role: gameplay
> position: center

显示中央棋盘和目标块。使用 CSS Grid 布局。

### @ui(conveyor) 传送带
> scene: @scene(play)
> role: gameplay
> position: around-board

显示四周环形传送带，小猪沿其移动。使用绝对定位 + CSS animation。

### @ui(wait-slots) 等待槽
> scene: @scene(play)
> role: interaction
> position: bottom

显示底部等待槽，玩家点击槽位派出小猪。

### @ui(start-btn) 开始按钮
> scene: @scene(start)
> role: interaction
> position: center

开始游戏按钮，点击进入主玩法页。

### @ui(title) 游戏标题
> scene: @scene(start)
> role: info
> position: top

显示游戏标题文字。

### @ui(result-title) 结算标题
> scene: @scene(result)
> role: info
> position: top

显示胜利/失败结果标题。

### @ui(result-score) 结算得分
> scene: @scene(result)
> role: info
> position: center

显示最终得分。

### @ui(retry-btn) 重试按钮
> scene: @scene(result)
> role: interaction
> position: bottom

重试当前关卡按钮。

### @ui(next-btn) 下一关按钮
> scene: @scene(result)
> role: interaction
> position: bottom

进入下一关卡按钮。

### @ui(conveyor) 传送带
> scene: @scene(play)
> role: gameplay
> position: around-board

显示四周环形传送带，小猪沿其移动。使用绝对定位 + CSS animation。

### @system(level-manager) 关卡管理
> depends: []
> outputs: [levelData]
> config: {levels: [@level(level-1), @level(level-2), @level(level-3)]}

管理关卡数据和进度。

## 8. 资源与数据

### @level(level-1) 第一关
> difficulty: easy
> resources: [@resource(level-1-data)]
> params: {colors: 2, boardSize: "6x6", pigCount: 8}

入门关卡：2 种颜色，帮助玩家理解规则。

### @level(level-2) 第二关
> difficulty: medium
> resources: [@resource(level-2-data)]
> params: {colors: 3, boardSize: "6x6", pigCount: 10}
> unlock-after: @level(level-1)

进阶关卡：3 种颜色，强调阻挡关系和回收利用。

### @level(level-3) 第三关
> difficulty: hard
> resources: [@resource(level-3-data)]
> params: {colors: 4, boardSize: "7x7", pigCount: 12, hasReinforcedBlocks: true}
> unlock-after: @level(level-2)

挑战关卡：4 种颜色 + 强化块，提升策略深度。

### @resource(level-1-data) 第一关数据
> type: json
> source: inline
> schema: {blocks: [{row, col, color, hp}], pigs: [{color, ammo}]}
> count: 1

第一关棋盘布局和小猪配置。

### @resource(level-2-data) 第二关数据
> type: json
> source: inline
> schema: {blocks: [{row, col, color, hp}], pigs: [{color, ammo}]}
> count: 1

第二关棋盘布局和小猪配置。

### @resource(level-3-data) 第三关数据
> type: json
> source: inline
> schema: {blocks: [{row, col, color, hp}], pigs: [{color, ammo}]}
> count: 1

第三关棋盘布局和小猪配置。

## 9. 运行方式与框架策略

**引擎选择**：DOM + Tailwind CSS v4（用户选择）

**选择原因**：
- 用户明确选择 DOM 引擎
- 棋盘格子型 + 点击交互适合 DOM
- 实时动画（传送带移动）通过 setInterval + CSS transform 模拟

**风险提示**：
- DOM 实现实时循环动画性能不如 Canvas/Phaser
- 位置依赖索敌需要用 getBoundingClientRect 计算碰撞

**版本锁定**：`@tailwindcss/browser@4`

## 10. 校验点与验收标准

### @check(game-boots) 游戏启动
> layer: engineering
> method: "打开 game/index.html，检查无 console error"
> expect: "window.gameState 存在且 phase = 'ready'"

游戏能够正常启动，无报错。

### @check(clickable-pigs) 小猪可点击派出
> layer: product
> method: "点击等待槽中的小猪 → 小猪出现在传送带上并开始移动"
> expect: "等待槽小猪减少，传送带小猪增加，小猪沿外圈移动"

核心交互可操作。

### @check(color-match-attack) 颜色匹配攻击正确
> layer: product
> method: "小猪移动到匹配颜色块正对位置 → 攻击并减少目标块耐久"
> expect: "目标块 hp 减少，小猪 ammo 减少，播放攻击动画"

攻击机制按设计工作。

### @check(no-penetration) 禁止穿透攻击
> layer: product
> method: "小猪正对方向第一个块为异色 → 不攻击，继续前进"
> expect: "小猪不攻击后方同色块，弹药不减少"

位置依赖索敌正确实现。

### @check(pig-recycle) 小猪回收正确
> layer: product
> method: "小猪完成一圈且弹药 > 0 → 回收到等待槽"
> expect: "等待槽显示该小猪，弹药保留"

回收机制正确。

### @check(win-condition) 胜利判定正确
> layer: product
> method: "清空所有目标块 → 显示胜利结算页"
> expect: "phase = 'win'，显示胜利界面"

胜利条件判定正确。

### @check(lose-condition) 失败判定正确
> layer: product
> method: "所有小猪耗尽且棋盘未清空 → 显示失败结算页"
> expect: "phase = 'lose'，显示失败界面"

失败条件判定正确。

### @constraint(no-auto-aim) 禁止全屏自动索敌
> kind: hard-rule
> severity: critical

攻击必须严格依赖小猪当前所在位置，只能攻击正对方向的第一个目标块，不得做成全屏自动寻找同色块。

### @constraint(single-target) 禁止多目标攻击
> kind: hard-rule
> severity: critical

每次攻击只能处理 1 个目标块，不能一次攻击整行、整列或全屏所有同色块。

### @constraint(no-penetration) 禁止穿透攻击
> kind: hard-rule
> severity: critical

小猪不能跳过前方异色块去攻击后方同色块。

### @constraint(not-match3) 禁止做成三消
> kind: hard-rule
> severity: critical

禁止做成三消、塔防、自动射击或普通消除游戏。必须严格体现"四周传送带 + 按当前位置依序处理当前方向上的第一个目标块 + 等待槽回收再派出"的玩法核心。

## 11. 可选扩展

本版本暂不实现：
- 自定义关卡编辑器
- 排行榜系统
- 音效系统
- 多人联机

后续可接入：更多关卡、关卡编辑器、成就系统。
