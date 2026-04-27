---
game-aprd: "0.1"
project: pixel_pixijs-001
platform: [web]
runtime: pixijs
is-3d: false
mode: 单机
need-backend: false
language: zh-CN
color-scheme:
  palette-id: pixel-retro
  theme-keywords: [像素, 小猪, 传送带, 棋盘, 消除, 策略, puzzle]
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
must-have-features: [四周环形传送带, 颜色匹配攻击, 有限弹药小猪, 等待槽回收系统, 3阶段关卡递进, 胜负判定]
nice-to-have-features: [强化块系统, 攻击动画粒子, 回收动画反馈]
cut-preference: 先缩内容量，不先砍核心系统
support-level: 直接支持
engine-plan:
  runtime: pixijs
  reason: "棋盘格子型+像素视觉+粒子效果需求，PixiJS v8完美适配，best-fit匹配board-grid"
  version-pin: "pixi.js@8"
mvp-scope: [6x6棋盘, 四周传送带, 4种颜色小猪, 5个等待槽, 传送带容量4, 3阶段关卡, 普通块+强化块, 胜负判定, 回收系统]
risk-note:
  - "位置限定索敌规则需要在Playwright中验证，禁止全屏自动索敌是核心hard-rule"
  - "PixiJS v8 与 v7 API差异较大，需使用v8语法"

asset-strategy:
  mode: library-first
  rationale: >
    颜色匹配是核心判定条件，玩家必须快速分辨4种颜色的小猪和目标块；
    纯色方块+数字可以实现基础玩法，但会丢失像素风格沉浸感；
    核心小猪和目标块使用Kenney像素素材库，HUD和背景允许程序化生成但需配色一致。
  visual-core-entities: [pig, block]
  visual-peripheral: [hud-info]
  style-coherence:
    level: strict
    note: "核心实体必须同一像素pack；背景独立生成但配色要跟pixel-retro色板"

artifacts:
  scene-spec: specs/scene.yaml
  rule-spec: specs/rule.yaml
  data-spec: specs/data.yaml
  asset-plan: specs/assets.yaml
  event-graph: specs/event-graph.yaml
  implementation-contract: specs/implementation-contract.yaml
  game: game/
---

# Pixel Flow (像素传送带清板) Game PRD

## 1. 项目概述

### @game(main) 像素传送带清板益智游戏
> genre: board-grid
> platform: [web]
> runtime: pixijs
> mode: 单机
> player-goal: "通过合理安排派出顺序、颜色搭配和等待槽管理，逐步清空中央棋盘的所有目标块"
> core-loop: [@flow(main-round)]
> scenes: [@scene(start), @scene(play), @scene(result)]
> states: [@state(ready), @state(playing), @state(win), @state(lose)]
> levels: [@level(level-1), @level(level-2), @level(level-3)]
> resources: [@resource(pig-pool), @resource(block-configs)]
> controls: [@input(click-pig)]

像素风轻度休闲益智策略游戏。玩家点击不同颜色的小猪进入棋盘四周的传送带，小猪沿外圈移动，只能根据自己当前所处的位置，依序处理正对方向上的目标块。玩家需要通过合理安排出场顺序、颜色搭配和等待槽管理，逐步清空整块像素区域。

## 2. 目标玩家与使用场景

**目标玩家**：
- 喜欢益智策略游戏的休闲玩家
- 偏爱像素风格的复古游戏爱好者
- 追求策略深度的轻度玩家

**使用场景**：
- 碎片时间休闲游戏
- 策略思考与决策训练
- 轻度解压娱乐

**核心体验**：
- "顺序决策"属性明显，不是无脑点击
- 每一关都让玩家感受到：只要调整派出顺序，局面就可能从失败变为通关

## 3. 核心玩法边界与 MVP 定义

### 本版本必须做
- 四周环形传送带系统（闭环轨道，小猪沿外圈移动）
- 颜色匹配攻击机制（位置限定索敌，只能攻击正对方向第一个同色块）
- 有限弹药小猪单位（颜色+数值属性）
- 等待槽回收与再派出系统（5个槽位，保留剩余数值）
- 3阶段关卡递进（2色→3色→4色+强化块）
- 胜负判定（清空获胜/资源耗尽失败）

### 本版本尽量做
- 强化块系统（耐久>1的目标块）
- 攻击动画与粒子效果
- 回收动画反馈

### 本版本后放
- 联机对战
- 关卡编辑器
- 排行榜系统

## 4. 主干流程

### @flow(main-round) 单局流程
> entry: @scene(start)
> main-scene: @scene(play)
> exit: @scene(result)
> involves: [@scene(start), @scene(play), @rule(pig-deploy), @rule(pig-attack), @rule(pig-recycle), @rule(win-check), @rule(lose-check), @scene(result)]

1. 玩家在开始页点击开始按钮
2. 进入play场景，中央棋盘生成目标块，底部等待槽生成小猪
3. 玩家点击等待槽中的小猪 → 小猪进入传送带
4. 小猪沿传送带移动，每经过一个方向时检查正对方向第一个目标块
5. 若颜色匹配 → 攻击一次，消耗1点数值，目标块耐久-1
6. 若颜色不匹配 → 继续前进不攻击
7. 小猪数值耗尽 → 离场消失；数值未耗尽 → 返回等待槽
8. 循环派出直到棋盘清空（胜利）或资源耗尽（失败）
9. 结算页显示结果，可重试或下一关

## 5. 场景规格

### @scene(start) 开始页
> entry: true
> layout: center-single
> inputs: [@input(click-start)]
> ui: [@ui(title), @ui(start-btn), @ui(level-select)]
> state-on-enter: @state(ready)

显示游戏标题、开始按钮、关卡选择。像素风格背景，居中布局。

### @scene(play) 主玩法页
> entry: false
> layout: three-zone
> inputs: [@input(click-pig)]
> ui: [@ui(hud-info), @ui(board-grid), @ui(conveyor-belt), @ui(waiting-slots)]
> state-on-enter: @state(playing)

三区域布局：
- 顶部HUD：关卡信息、剩余小猪数
- 中央区域：6×6棋盘 + 四周传送带（外圈闭环轨道）
- 底部：5个等待槽，显示小猪颜色和剩余数值

### @scene(result) 结算页
> entry: false
> layout: center-single
> inputs: [@input(click-retry), @input(click-next)]
> ui: [@ui(result-title), @ui(score-display), @ui(retry-btn), @ui(next-btn)]
> state-on-enter: @state(win) | @state(lose)

显示胜利/失败标题、得分、重试按钮、下一关按钮（胜利时显示）。

## 6. 状态与实体

### @state(ready) 准备状态
> on-enter: 初始化关卡数据，生成棋盘和等待槽
> transitions: [@state(playing)]

### @state(playing) 游戏中状态
> on-enter: 启动传送带动画，接受玩家点击
> on-exit: 停止传送带动画
> transitions: [@state(win), @state(lose)]

### @state(win) 胜利状态
> on-enter: 显示胜利动画，解锁下一关

### @state(lose) 失败状态
> on-enter: 显示失败动画

### @entity(pig) 小猪单位
> type: unit
> fields: {color: string, ammo: number, position: {edge: string, slot: number}, state: string}
> scene: @scene(play)
> spawn-rule: 玩家点击等待槽时生成，进入传送带

**属性说明**：
- color: 颜色（red/blue/yellow/green）
- ammo: 剩余弹药/攻击次数
- position: 在传送带上的位置（edge: top/right/bottom/left, slot: 0-5）
- state: 状态（waiting/on-belt/attacking/recycled）

### @entity(block) 目标块
> type: tile
> fields: {color: string, hp: number, maxHp: number, row: number, col: number, removed: boolean}
> scene: @scene(play)
> spawn-rule: 关卡开始时按配置生成在棋盘上

**属性说明**：
- color: 颜色（red/blue/yellow/green）
- hp: 当前耐久
- maxHp: 最大耐久（普通块=1，强化块=2-3）
- row, col: 棋盘坐标
- removed: 是否已消除

### @entity(conveyor) 传送带
> type: prop
> fields: {capacity: number, pigs: array, speed: number}
> scene: @scene(play)

**属性说明**：
- capacity: 容量上限（默认4）
- pigs: 当前在传送带上的小猪数组
- speed: 移动速度

### @entity(waiting-slot) 等待槽
> type: prop
> fields: {index: number, pig: object, occupied: boolean}
> scene: @scene(play)

**属性说明**：
- index: 槽位索引（0-4）
- pig: 槽内小猪（可为null）
- occupied: 是否被占用

## 7. 规则与系统

### @input(click-pig) 点击小猪派出
> device: click
> targets: [@entity(waiting-slot)]
> bindings: 点击等待槽中的小猪 → 触发派出

玩家点击等待槽中已占用的小猪 → 检查传送带容量 → 容量未满则派出小猪进入传送带。

### @input(click-start) 点击开始按钮
> device: click
> targets: [@ui(start-btn)]
> bindings: 点击开始按钮 → 进入游戏

开始页点击开始按钮，进入第一关。

### @input(click-retry) 点击重试按钮
> device: click
> targets: [@ui(retry-btn)]
> bindings: 点击重试按钮 → 重新开始当前关卡

结算页点击重试按钮，重新挑战当前关卡。

### @input(click-next) 点击下一关按钮
> device: click
> targets: [@ui(next-btn)]
> bindings: 点击下一关按钮 → 进入下一关

结算页点击下一关按钮，进入下一关卡。

### @rule(pig-deploy) 小猪派出规则
> trigger: 玩家点击等待槽中的小猪且 conveyor.pigs.length < conveyor.capacity
> effect: "pig.state = 'on-belt' ; conveyor.pigs.push(pig) ; slot.pig = null ; slot.occupied = false"
> scope: @scene(play)
> priority: 1

将等待槽中的小猪移动到传送带入口位置。

### @rule(pig-move) 小猪移动规则
> trigger: 游戏tick且pig.state = 'on-belt'
> effect: "pig.position.slot += 1"
> scope: @scene(play)
> priority: 2

小猪沿传送带持续移动，每tick移动一个槽位。edge循环顺序：top → right → bottom → left → top。

### @rule(pig-move-edge) 小猪换边规则
> trigger: pig.position.slot > 5
> effect: "pig.position.slot = 0 ; pig.position.edge = nextEdge(pig.position.edge)"
> scope: @scene(play)
> priority: 3

小猪移动到传送带边界时切换到下一条边。

### @rule(pig-attack) 小猪攻击规则
> trigger: 小猪移动到新位置且pig.ammo > 0
> effect: "target = findFirstBlock(pig.position)"
> scope: @scene(play)
> priority: 4

**findFirstBlock逻辑**：
- pig在top边 → 检查正对那一列，从上往下找第一个未消除的目标块
- pig在right边 → 检查正对那一行，从右往左找第一个未消除的目标块
- pig在bottom边 → 检查正对那一列，从下往上找第一个未消除的目标块
- pig在left边 → 检查正对那一行，从左往右找第一个未消除的目标块

### @rule(pig-attack-hit) 小猪攻击命中规则
> trigger: target != null AND target.color == pig.color
> effect: "pig.ammo -= 1 ; target.hp -= 1"
> scope: @scene(play)
> priority: 5

颜色匹配时，小猪消耗1点弹药攻击目标块。

### @rule(block-remove) 目标块消除规则
> trigger: target.hp <= 0
> effect: "target.removed = true"
> scope: @scene(play)
> priority: 6

目标块耐久归零后立即消除。

### @rule(pig-recycle) 小猪回收规则
> trigger: 小猪绕传送带一周且pig.ammo > 0
> effect: "pig.state = 'recycled' ; conveyor.pigs.remove(pig)"
> scope: @scene(play)
> priority: 7

小猪绕完一圈后，若仍有剩余弹药，准备返回等待槽。

### @rule(pig-recycle-slot) 小猪回槽规则
> trigger: pig.state = 'recycled'
> effect: "slot = findEmptySlot() ; slot.pig = pig ; slot.occupied = true"
> scope: @scene(play)
> priority: 8

小猪进入等待槽的空位。

### @rule(pig-exhaust) 小猪耗尽规则
> trigger: pig.ammo <= 0
> effect: "pig.state = 'exhausted' ; conveyor.pigs.remove(pig)"
> scope: @scene(play)
> priority: 9

小猪弹药耗尽后直接离场消失。

### @rule(win-check) 胜利判定
> trigger: 所有目标块 target.removed == true
> effect: "gameState.phase = 'win'"
> scope: @scene(play)
> priority: 10

所有目标块消除后，游戏胜利。

### @rule(lose-check) 失败判定
> trigger: 所有等待槽为空 AND 传送带为空 AND 棋盘仍有未消除目标块
> effect: "gameState.phase = 'lose'"
> scope: @scene(play)
> priority: 10

资源耗尽但棋盘未清空，游戏失败。

### @ui(title) 游戏标题
> scene: @scene(start)
> role: info-display
> binds: 显示游戏名称"Pixel Flow"

### @ui(start-btn) 开始按钮
> scene: @scene(start)
> role: player-control
> binds: 点击开始游戏

### @ui(level-select) 关卡选择
> scene: @scene(start)
> role: player-control
> binds: 选择已解锁的关卡

### @ui(result-title) 结算标题
> scene: @scene(result)
> role: info-display
> binds: 显示"胜利"或"失败"

### @ui(score-display) 得分显示
> scene: @scene(result)
> role: info-display
> binds: 显示本关得分

### @ui(retry-btn) 重试按钮
> scene: @scene(result)
> role: player-control
> binds: 点击重试当前关卡

### @ui(next-btn) 下一关按钮
> scene: @scene(result)
> role: player-control
> binds: 点击进入下一关(胜利时显示)

### @ui(hud-info) 顶部HUD信息
> scene: @scene(play)
> role: info-display
> binds: 关卡编号、剩余小猪总数

### @ui(board-grid) 中央棋盘
> scene: @scene(play)
> role: game-area
> binds: 6×6网格，每个格子显示目标块或空白

### @ui(conveyor-belt) 四周传送带
> scene: @scene(play)
> role: game-area
> binds: 外圈闭环轨道，显示小猪移动动画

### @ui(waiting-slots) 底部等待槽
> scene: @scene(play)
> role: player-control
> binds: 5个槽位，显示小猪颜色和剩余弹药数

### @system(level-manager) 关卡管理
> depends: [@entity(block), @entity(pig)]
> outputs: 生成关卡配置
> config: 3阶段难度递进

**关卡配置**：
- Level 1: 2种颜色（红、蓝），普通块，简单布局
- Level 2: 3种颜色（红、蓝、黄），加入强化块，中等难度
- Level 3: 4种颜色（红、蓝、黄、绿），更多强化块，复杂布局

## 8. 资源与数据

### @resource(pig-pool) 小猪池配置
> type: data
> source: inline
> schema: {level: number, pigs: [{color: string, ammo: number, count: number}]}
> count: 3
> format: json

```json
[
  {"level": 1, "pigs": [{"color": "red", "ammo": 3, "count": 3}, {"color": "blue", "ammo": 3, "count": 3}]},
  {"level": 2, "pigs": [{"color": "red", "ammo": 3, "count": 2}, {"color": "blue", "ammo": 3, "count": 2}, {"color": "yellow", "ammo": 2, "count": 3}]},
  {"level": 3, "pigs": [{"color": "red", "ammo": 3, "count": 2}, {"color": "blue", "ammo": 3, "count": 2}, {"color": "yellow", "ammo": 2, "count": 2}, {"color": "green", "ammo": 2, "count": 2}]}
]
```

### @resource(block-configs) 目标块配置
> type: data
> source: inline
> schema: {level: number, board: [[{color: string, hp: number}]]}
> count: 3
> format: json

```json
[
  {"level": 1, "boardSize": 6, "blocks": [{"row": 0, "col": 1, "color": "red", "hp": 1}, ...]},
  {"level": 2, "boardSize": 6, "blocks": [{"row": 0, "col": 0, "color": "blue", "hp": 2}, ...]},
  {"level": 3, "boardSize": 6, "blocks": [{"row": 0, "col": 0, "color": "red", "hp": 2}, ...]}
]
```

### @level(level-1) 第一关
> difficulty: easy
> resources: [@resource(pig-pool)#level1, @resource(block-configs)#level1]
> params: {colors: 2, boardSize: 6, conveyorCapacity: 4, waitingSlots: 5}
> unlock-after: null

2种颜色入门关卡，帮助玩家理解传送带和位置限定索敌规则。

### @level(level-2) 第二关
> difficulty: medium
> resources: [@resource(pig-pool)#level2, @resource(block-configs)#level2]
> params: {colors: 3, boardSize: 6, conveyorCapacity: 4, waitingSlots: 5}
> unlock-after: @level(level-1)

3种颜色，加入强化块（hp=2），强调阻挡关系和小猪回收利用。

### @level(level-3) 第三关
> difficulty: hard
> resources: [@resource(pig-pool)#level3, @resource(block-configs)#level3]
> params: {colors: 4, boardSize: 6, conveyorCapacity: 4, waitingSlots: 5}
> unlock-after: @level(level-2)

4种颜色，更多强化块和复杂布局，考验策略深度。

## 9. 运行方式与框架策略

### 引擎选择
**PixiJS v8** 被选为本项目的游戏引擎，理由如下：
1. 完美适配棋盘格子型游戏
2. 高性能2D渲染，支持粒子效果
3. 与像素风格视觉完美契合
4. `best-fit` 匹配 `board-grid` 类型

### 运行模式
**RUN: local-http** - PixiJS 项目需要本地HTTP服务器运行，支持ES Module和跨文件import。

### 版本锁定
- pixi.js@8（锁定主版本，不使用@latest）
- Google Fonts: "Press Start 2P" 像素字体

### 性能考量
- 6×6棋盘共36个格子，目标块数量可控
- 传送带容量4，同时在线小猪数量有限
- 无需担心性能瓶颈

## 10. 校验点与验收标准

### @constraint(no-global-autoaim) 禁止全屏自动索敌
> kind: hard-rule
> severity: critical

攻击必须严格依赖「小猪当前所在位置」，不得做成全屏自动寻找同色块。小猪只能攻击正对方向上的第一个目标块。

### @constraint(single-target-attack) 单目标攻击
> kind: hard-rule
> severity: critical

每次攻击只处理1个目标块，不能一次攻击整行、整列或全屏所有同色块。

### @constraint(no-pierce-attack) 禁止穿透攻击
> kind: hard-rule
> severity: critical

小猪不能跳过前方异色块去攻击后方同色块。必须先处理外围阻挡块。

### @constraint(core-mechanics) 核心玩法约束
> kind: hard-rule
> severity: critical

必须严格体现"四周传送带 + 按当前位置依序处理当前方向上的第一个目标块 + 等待槽回收再派出"的玩法核心。

### @constraint(not-match3-tower-defense) 游戏类型约束
> kind: hard-rule
> severity: high

禁止做成三消、塔防、自动射击或普通消除游戏。

### @check(game-boots) 游戏启动检查
> layer: engineering
> method: "打开game/index.html，检查无console error，游戏画面正常显示"

### @check(pig-deploy-work) 小猪派出功能
> layer: product
> method: "点击等待槽中的小猪，验证小猪进入传送带并开始移动"
> expect: "conveyor.pigs.length增加1，小猪state变为on-belt"

### @check(attack-direction) 位置限定索敌
> layer: product
> method: "小猪移动到不同边时，验证只攻击正对方向的第一个目标块"
> expect: "攻击目标与小猪位置关系正确，不攻击其他位置的同色块"

### @check(single-target) 单目标攻击验证
> layer: product
> method: "小猪攻击时，验证只减少1个目标块的HP"
> expect: "每次攻击只影响1个目标块，不会同时消除多个"

### @check(recycle-mechanics) 回收机制
> layer: product
> method: "小猪绕圈后仍有弹药，验证返回等待槽并保留数值"
> expect: "小猪返回等待槽，ammo数值正确保留"

### @check(win-condition) 胜利条件
> layer: product
> method: "清空棋盘所有目标块，验证进入胜利结算"
> expect: "state变为win，显示胜利界面"

### @check(lose-condition) 失败条件
> layer: product
> method: "耗尽所有小猪但棋盘仍有目标块，验证进入失败结算"
> expect: "state变为lose，显示失败界面"

### @check(level-progression) 关卡递进
> layer: product
> method: "完成前一关后解锁下一关，验证难度递增"
> expect: "关卡2颜色数>关卡1，关卡3有强化块"

## 11. 可选扩展

本版本暂不实现以下功能，后续迭代可考虑：
- 关卡编辑器：允许玩家自定义棋盘布局
- 排行榜系统：记录通关时间和步数
- 成就系统：完成特定挑战解锁成就
- 更多关卡：扩展到10+关卡
- 特殊小猪：带有特殊能力的小猪单位
