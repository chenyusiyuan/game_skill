---
game-aprd: "0.1"
project: pixel_canvas-001
platform: [web]
runtime: canvas
is-3d: false
mode: 单机
need-backend: false
language: zh-CN
color-scheme:
  palette-id: pixel-retro
  theme-keywords: [像素, 像素风, 传送带, 小猪, 颜色匹配, 益智, 清板, 休闲]
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
  extra-colors: ["#ef4444", "#3b82f6", "#eab308", "#22c55e"]
delivery-target: feature-complete-lite
must-have-features:
  - 四周环形传送带（小猪沿外圈移动）
  - 位置依赖索敌（只攻击当前位置正对方向第一个目标块）
  - 颜色匹配攻击（只有颜色相同才攻击）
  - 等待槽回收系统（未耗尽小猪可再次派出）
  - 多关卡递进（2色→3色→4色）
nice-to-have-features:
  - 强化块（耐久2+）
  - 锁定块（需先清除外层）
  - 传送带容量限制
  - 攻击动画粒子效果
cut-preference: 先缩内容量（关卡数/颜色种类），不先砍核心传送带和位置索敌机制
support-level: 直接支持
engine-plan:
  runtime: canvas
  reason: "board-grid + 规则清晰 + 网格布局，Canvas 最稳定，LLM 首轮正确率最高"
  version-pin: "-"
mvp-scope:
  - 四周环形传送带
  - 位置依赖索敌机制
  - 颜色匹配攻击
  - 等待槽回收
  - 3关卡递进（2色/3色/4色）
  - 普通块消除
  - 胜负判定
risk-note:
  - "位置索敌规则复杂，需要精确实现四个方向的判定逻辑"
  - "传送带动画与小猪位置同步需要仔细处理"
asset-strategy:
  mode: generated-only
  rationale: >
    颜色匹配是核心判定条件，玩家必须快速分辨 4 种颜色；
    像素风格可用程序化绘制方块+简单图形实现核心玩法；
    小猪用简单像素矩形+耳朵形状表示，目标块用颜色方块表示；
    纯生成方案足够支撑玩法，不需要外部素材库。
  visual-core-entities: [pig, block]
  visual-peripheral: [hud-level, conveyor, wait-slots]
  style-coherence:
    level: flexible
    note: "全部程序化绘制，保持像素风格一致即可"

artifacts:
  scene-spec: specs/scene.yaml
  rule-spec: specs/rule.yaml
  data-spec: specs/data.yaml
  asset-plan: specs/assets.yaml
  event-graph: specs/event-graph.yaml
  implementation-contract: specs/implementation-contract.yaml
  game: game/
---

# pixel_canvas Game PRD

## 1. 项目概述

### @game(main) 像素传送带清板益智游戏
> genre: board-grid
> platform: [web]
> runtime: canvas
> mode: 单机
> player-goal: "清空中央棋盘中的全部目标块"
> core-loop: [@flow(play-round)]
> scenes: [@scene(start), @scene(play), @scene(result)]
> states: [@state(ready), @state(playing), @state(win), @state(lose)]
> levels: [@level(level-1), @level(level-2), @level(level-3)]
> controls: [@input(click-dispatch)]

像素风、轻度休闲、益智策略、竖屏点击游戏。玩家点击不同颜色的小猪进入棋盘四周的传送带，小猪沿外圈移动，只能根据当前位置依序处理正对方向上的目标块。玩家需要通过合理安排出场顺序、颜色搭配和等待槽管理，逐步清空整块像素区域。

## 2. 目标玩家与使用场景

- **目标玩家**：喜欢轻度益智游戏的玩家，年龄不限
- **使用场景**：碎片化时间休闲娱乐，单局 2-5 分钟
- **核心体验**：顺序决策的策略感，颜色匹配的成就感

## 3. 核心玩法边界与 MVP 定义

### 本版本必须做（must-have）

1. **四周环形传送带**：小猪沿棋盘外圈持续移动，支持多只小猪同时在传送带上
2. **位置依赖索敌**：小猪只能攻击当前位置正对方向的第一个目标块，禁止全屏自动索敌
3. **颜色匹配攻击**：只有小猪颜色与目标块颜色相同时才攻击
4. **等待槽回收**：数值未耗尽的小猪返回等待槽，可再次派出
5. **多关卡递进**：3 关卡，颜色种类递增（2色→3色→4色）

### 本版本尽量做（nice-to-have）

1. **强化块**：耐久 2+ 的目标块，需要多次命中
2. **锁定块**：外层阻挡清除后才能攻击内层
3. **传送带容量**：同时最多 4 只小猪在传送带上

### 本版本后放

1. 排行榜系统
2. 成就系统
3. 教程引导

### MVP 边界

- 不含后端，纯前端实现
- 不含音效（可选后续添加）
- 不含复杂粒子效果

## 4. 主干流程

### @flow(play-round) 单局游戏流程
> entry: @scene(start)
> main-scene: @scene(play)
> exit: @scene(result)
> involves: [@scene(start), @scene(play), @rule(dispatch-pig), @rule(conveyor-move), @rule(position-attack), @rule(slot-recycle), @scene(result)]

玩家进入开始页点击开始 → 进入游戏页 → 选择小猪派出 → 小猪沿传送带移动 → 到达位置时检查正对方向第一个目标块 → 颜色匹配则攻击 → 数值未耗尽则回等待槽 → 循环直到棋盘清空（胜利）或资源耗尽（失败）→ 结算页

## 5. 场景规格

### @scene(start) 开始页
> entry: true
> layout: center-single
> inputs: [@input(click-start)]
> ui: [@ui(title), @ui(start-btn)]
> state-on-enter: @state(ready)

显示游戏标题和开始按钮，点击开始进入游戏页。

### @scene(play) 游戏主玩法页
> entry: false
> layout: three-zone
> inputs: [@input(click-dispatch)]
> ui: [@ui(hud-level), @ui(hud-pigs), @ui(board), @ui(conveyor), @ui(wait-slots)]
> state-on-enter: @state(playing)

核心玩法页面：
- 中央：棋盘网格（6×6），显示目标块
- 四周：环形传送带，显示移动的小猪
- 底部：等待槽（5个），显示可派出的小猪

### @scene(result) 结算页
> entry: false
> layout: center-single
> inputs: [@input(click-retry), @input(click-next)]
> ui: [@ui(result-title), @ui(result-score), @ui(retry-btn), @ui(next-btn)]
> state-on-enter: @state(win) | @state(lose)

显示胜负结果、分数，提供重试和下一关按钮。

## 6. 状态与实体

### @state(ready) 准备状态
> on-enter: "初始化关卡数据，重置分数"

游戏开始前的准备状态。

### @state(playing) 游戏中
> on-enter: "启动游戏循环，开始传送带移动"
> transitions: [@state(win), @state(lose)]

游戏进行中，玩家可以派出小猪。

### @state(win) 胜利状态
> on-enter: "棋盘全部清空，显示胜利结算"

所有目标块被清除，玩家胜利。

### @state(lose) 失败状态
> on-enter: "小猪资源耗尽，棋盘未清空，显示失败结算"

所有小猪耗尽但棋盘仍有目标块，玩家失败。

### @entity(pig) 小猪单位
> type: player
> fields: {id: string, color: string, ammo: number, x: number, y: number, row: number, col: number, direction: string, onConveyor: boolean, slotIndex: number}
> spawn-rule: "玩家点击等待槽中的小猪时派出"

小猪是玩家操作的核心单位：
- color: 颜色（red/blue/yellow/green）
- ammo: 剩余弹药量（攻击次数）
- x, y: 在传送带上的像素位置
- row, col: 当前对应的棋盘行列位置
- direction: 当前移动方向（top/right/bottom/left）
- onConveyor: 是否在传送带上
- slotIndex: 在等待槽中的位置（-1 表示不在槽中）

### @entity(block) 目标块
> type: tile
> fields: {id: string, color: string, hp: number, maxHp: number, row: number, col: number, cleared: boolean}
> spawn-rule: "关卡初始化时生成"

中央棋盘上的目标块：
- color: 颜色（red/blue/yellow/green）
- hp: 当前耐久
- maxHp: 最大耐久（普通块为 1，强化块为 2+）
- row, col: 在棋盘上的行列位置
- cleared: 是否已被消除

### @entity(conveyor) 传送带
> type: prop
> fields: {pigs: array, capacity: number, entryX: number, entryY: number}

四周环形传送带：
- pigs: 当前在传送带上的小猪数组
- capacity: 容量上限（默认 4）
- entryX, entryY: 入口位置坐标

### @entity(wait-slot) 等待槽
> type: prop
> fields: {slots: array, maxSlots: number}

底部等待槽：
- slots: 槽位数组，每个槽位可放置一只小猪或为空
- maxSlots: 槽位数量（默认 5）

## 7. 规则与系统

### @ui(title) 游戏标题
> scene: @scene(start)
> role: display
> position: center-top

开始页的游戏标题文字。

### @ui(start-btn) 开始按钮
> scene: @scene(start)
> role: interactive
> position: center
> binds: @input(click-start)

开始页的开始按钮。

### @ui(result-title) 结果标题
> scene: @scene(result)
> role: display
> position: center-top

结算页显示"胜利"或"失败"的标题。

### @ui(result-score) 结果分数
> scene: @scene(result)
> role: display
> position: center

结算页显示分数的区域。

### @ui(retry-btn) 重试按钮
> scene: @scene(result)
> role: interactive
> position: bottom-left
> binds: @input(click-retry)

结算页的重试按钮。

### @ui(next-btn) 下一关按钮
> scene: @scene(result)
> role: interactive
> position: bottom-right
> binds: @input(click-next)

结算页的下一关按钮。

### @ui(hud-level) 关卡信息
> scene: @scene(play)
> role: info
> position: top

显示当前关卡编号和剩余目标块数量。

### @ui(hud-pigs) 小猪状态
> scene: @scene(play)
> role: info
> position: top-right

显示传送带上的小猪数量和等待槽状态。

### @ui(board) 棋盘网格
> scene: @scene(play)
> role: game-area
> position: center

显示中央棋盘和目标块。

### @ui(conveyor) 传送带
> scene: @scene(play)
> role: game-area
> position: surrounding-board

显示四周环形传送带和移动中的小猪。

### @ui(wait-slots) 等待槽
> scene: @scene(play)
> role: interactive
> position: bottom
> binds: @input(click-dispatch)

显示底部等待槽，玩家点击派出小猪。

### @input(click-start) 点击开始
> device: click
> targets: [@ui(start-btn)]

开始页点击开始按钮进入游戏。

### @input(click-dispatch) 点击派出小猪
> device: click
> targets: [@ui(wait-slots)]
> bindings: "点击等待槽中有小猪的槽位 → 派出该小猪进入传送带"

玩家点击等待槽中的小猪，将其派出到传送带。

### @input(click-retry) 点击重试
> device: click
> targets: [@ui(retry-btn)]

结算页点击重试按钮重新开始当前关卡。

### @input(click-next) 点击下一关
> device: click
> targets: [@ui(next-btn)]

结算页点击下一关按钮进入下一关卡。

### @rule(dispatch-pig) 派出小猪
> trigger: "玩家点击等待槽中有小猪的槽位，且传送带未满"
> effect: "pig.onConveyor = true ; pig.x = conveyor.entryX ; pig.y = conveyor.entryY"
> scope: @scene(play)
> priority: 1

玩家点击等待槽，将小猪派出到传送带入口位置。

### @rule(dispatch-pig-2) 派出小猪后续
> trigger: "@rule(dispatch-pig) 执行后"
> effect: "pig.direction = 'top' ; conveyor.pigs.push(pig) ; wait-slot.slots[slotIndex] = null"
> scope: @scene(play)
> priority: 2

完成派出小猪的后续操作：设置方向、加入传送带、清空槽位。

### @rule(conveyor-move) 传送带移动-X
> trigger: "游戏循环每帧"
> effect: "for each pig in conveyor.pigs → pig.x += speed * cos(direction)"
> scope: @scene(play)
> priority: 3

小猪沿传送带移动（X方向）。

### @rule(conveyor-move-y) 传送带移动-Y
> trigger: "游戏循环每帧"
> effect: "for each pig in conveyor.pigs → pig.y += speed * sin(direction)"
> scope: @scene(play)
> priority: 4

小猪沿传送带移动（Y方向）。

### @rule(conveyor-turn) 传送带转向
> trigger: "小猪到达传送带角落"
> effect: "pig.direction = nextDirection(pig.direction)"
> scope: @scene(play)
> priority: 5

小猪到达传送带角落时转向下一方向。

### @rule(position-attack) 位置攻击
> trigger: "小猪到达棋盘边缘某一侧的判定点"
> effect: "target = findFirstBlockInDirection(pig) ; if target != null && target.color == pig.color → attack"
> scope: @scene(play)
> priority: 6

小猪到达判定点时，检查正对方向的第一个目标块。

### @rule(attack-effect) 攻击效果
> trigger: "@rule(position-attack) 命中目标"
> effect: "block.hp -= 1 ; pig.ammo -= 1 ; if block.hp <= 0 → block.cleared = true"
> scope: @scene(play)
> priority: 7

攻击命中时扣减目标块耐久和小猪弹药。

### @rule(find-top-block) 查找上方首个块
> trigger: "被 @rule(position-attack) 调用，pig.direction == 'top'"
> effect: "for col from pig.col to board.cols-1 → find first !cleared block in that column"
> scope: @scene(play)
> priority: 8

从上往下查找当前列第一个未消除块。

### @rule(find-right-block) 查找右侧首个块
> trigger: "被 @rule(position-attack) 调用，pig.direction == 'right'"
> effect: "for row from 0 to pig.row → find first !cleared block in that row"
> scope: @scene(play)
> priority: 9

从右往左查找当前行第一个未消除块。

### @rule(find-bottom-block) 查找下方首个块
> trigger: "被 @rule(position-attack) 调用，pig.direction == 'bottom'"
> effect: "for col from pig.col to 0 → find first !cleared block in that column"
> scope: @scene(play)
> priority: 10

从下往上查找当前列第一个未消除块。

### @rule(find-left-block) 查找左侧首个块
> trigger: "被 @rule(position-attack) 调用，pig.direction == 'left'"
> effect: "for row from pig.row to board.rows-1 → find first !cleared block in that row"
> scope: @scene(play)
> priority: 11

从左往右查找当前行第一个未消除块。

### @rule(slot-recycle) 等待槽回收
> trigger: "小猪完成一圈传送带移动且 ammo > 0"
> effect: "pig.onConveyor = false ; conveyor.pigs.remove(pig) ; find empty slot → slot.pig = pig"
> scope: @scene(play)
> priority: 12

小猪绕传送带一圈后，如果还有剩余弹药，返回等待槽。

### @rule(pig-expire) 小猪耗尽
> trigger: "pig.ammo <= 0"
> effect: "pig.onConveyor = false ; conveyor.pigs.remove(pig) ; pig = null"
> scope: @scene(play)
> priority: 13

小猪弹药耗尽后直接消失，不返回等待槽。

### @rule(win-check) 胜利判定
> trigger: "所有目标块 cleared == true"
> effect: "state.phase = 'win' ; switch to @scene(result)"
> scope: @scene(play)
> priority: 14

棋盘上所有目标块被消除，玩家胜利。

### @rule(lose-check) 失败判定
> trigger: "conveyor.pigs.length == 0 && wait-slot为空 && 棋盘有未消除块"
> effect: "state.phase = 'lose' ; switch to @scene(result)"
> scope: @scene(play)
> priority: 15

所有小猪耗尽，棋盘仍有目标块，玩家失败。

### @system(level-manager) 关卡管理
> depends: []
> outputs: [currentLevel, blockConfig, pigConfig]
> config: "读取关卡配置，初始化棋盘和小猪"

管理关卡数据和初始化。

## 8. 资源与数据

### @level(level-1) 第1关
> difficulty: easy
> resources: []
> params: {colors: 2, boardSize: "6x6", pigs: 8}
> unlock-after: -

第1关：2种颜色，6×6棋盘，8只小猪（每色4只）。

### @level(level-2) 第2关
> difficulty: medium
> resources: []
> params: {colors: 3, boardSize: "6x6", pigs: 12}
> unlock-after: @level(level-1)

第2关：3种颜色，6×6棋盘，12只小猪（每色4只）。

### @level(level-3) 第3关
> difficulty: hard
> resources: []
> params: {colors: 4, boardSize: "7x7", pigs: 16}
> unlock-after: @level(level-2)

第3关：4种颜色，7×7棋盘，16只小猪（每色4只）。

### @resource(color-palette) 颜色配置
> type: config
> source: inline
> schema: {red: "#ef4444", blue: "#3b82f6", yellow: "#eab308", green: "#22c55e"}
> count: 4

4种颜色对应的十六进制值。

### @resource(level-configs) 关卡配置
> type: config
> source: inline
> schema: {level: number, colors: array, boardSize: string, pigCount: number, blockLayout: array}
> count: 3

3个关卡的完整配置数据。

## 9. 运行方式与框架策略

### 引擎选择

**选择 Canvas 2D**：
- board-grid 类型，规则清晰的网格游戏
- 无复杂物理，无大量粒子
- Canvas 2D 最稳定，LLM 首轮正确率最高
- 支持 `run-mode=file`，双击即可运行

### 运行模式

`RUN: file` — 单个 HTML 文件，无需服务器

### 版本锁定

无需外部依赖，使用浏览器原生 Canvas API。

## 10. 校验点与验收标准

### @constraint(no-global-autoaim) 禁止全屏自动索敌
> kind: hard-rule
> severity: critical

攻击必须严格依赖「小猪当前所在位置」，不得做成全屏自动寻找同色块。Phase 4 生成的代码必须体现这一点。

### @constraint(no-multi-attack) 禁止一次攻击多个块
> kind: hard-rule
> severity: critical

小猪每次只能攻击一个目标块，不能一次清除整行或整列。

### @constraint(no-pierce-attack) 禁止穿透攻击
> kind: hard-rule
> severity: critical

小猪不能跳过前方异色块攻击后方目标，必须先清除阻挡块。

### @constraint(conveyor-required) 必须有传送带机制
> kind: hard-rule
> severity: critical

小猪必须沿四周环形传送带移动，不能直接在棋盘上移动。

### @constraint(slot-recycle-required) 必须有等待槽回收
> kind: hard-rule
> severity: critical

未耗尽的小猪必须能返回等待槽，支持再次派出。

### @check(game-boots) 游戏启动
> layer: engineering
> method: "Playwright 打开 game/index.html"
> expect: "无控制台错误，window.gameState 存在"

游戏能正常启动，无运行时错误。

### @check(dispatch-works) 派出功能
> layer: product
> method: "Playwright 点击等待槽中的小猪 → 小猪出现在传送带上"

派出小猪功能正常工作。

### @check(conveyor-moves) 传送带移动
> layer: product
> method: "Playwright 派出小猪 → 等待 → 小猪位置沿传送带变化"

传送带移动功能正常。

### @check(position-attack) 位置攻击
> layer: product
> method: "Playwright 派出红色小猪 → 等待到达红色块前方 → 攻击发生 → 目标块 hp 减少"

位置攻击功能正常，只攻击正对方向的第一个目标块。

### @check(color-match) 颜色匹配
> layer: product
> method: "Playwright 派出红色小猪 → 经过蓝色块前方 → 不攻击；到达红色块前方 → 攻击"

颜色匹配规则正确执行。

### @check(slot-recycle) 等待槽回收
> layer: product
> method: "Playwright 派出小猪 → 等待绕圈完成 → 小猪返回等待槽"

等待槽回收功能正常。

### @check(win-condition) 胜利条件
> layer: product
> method: "Playwright 完成关卡 → 所有目标块清除 → 显示胜利界面"

胜利判定正确。

### @check(lose-condition) 失败条件
> layer: product
> method: "Playwright 耗尽所有小猪 → 棋盘仍有目标块 → 显示失败界面"

失败判定正确。

### @check(no-global-autoaim-test) 禁止全屏索敌验证
> layer: requirement
> method: "Playwright 派出小猪 → 验证攻击时只检查正对方向第一个块 → 不会跳过异色块攻击后方同色块"
> expect: "攻击严格按位置索敌，不实现全屏自动匹配"

验证没有实现全屏自动索敌。

### @check(level-progression) 关卡递进
> layer: product
> method: "Playwright 完成第1关 → 进入第2关 → 颜色数量增加"

关卡递进功能正常。

## 11. 可选扩展

本版本暂不实现：
- 排行榜系统
- 成就系统
- 教程引导
- 音效
- 强化块（nice-to-have）
- 锁定块（nice-to-have）
