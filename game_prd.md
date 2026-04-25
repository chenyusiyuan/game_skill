---
game-aprd: "0.1"
project: word-match-lite-002
platform: [web]
runtime: dom-ui
is-3d: false
mode: 单机
need-backend: false
language: zh-CN
color-scheme:
  palette-id: campus-fresh
  theme-keywords: [教育, 背单词, 配对]
  primary: "#2563eb"
  secondary: "#16a34a"
  accent: "#eab308"
  background: "#eff6ff"
  surface: "#ffffff"
  text: "#1e3a5f"
  text-muted: "#64748b"
  success: "#22c55e"
  error: "#ef4444"
  border: "#bfdbfe"
  font-family: '"Nunito", "M PLUS Rounded 1c", "PingFang SC", sans-serif'
  border-radius: "12px"
  shadow: "0 2px 8px rgba(37,99,235,0.1)"
  fx-hint: bounce
delivery-target: feature-complete-lite
must-have-features: [点击配对, 3关卡递进, 结果页重试/下一关]
nice-to-have-features: [连击加分, 卡片翻转动画]
cut-preference: 先缩内容量，不先砍核心系统
support-level: 直接支持
engine-plan:
  runtime: dom-ui
  reason: "教育练习型 + 点击交互 + 无实时循环，DOM 最稳"
  version-pin: "@tailwindcss/browser@4"
mvp-scope: [3关卡, 默认词库, 点击配对, 倒计时, 分数统计, 结果页, 重试, 下一关]
risk-note: []
artifacts:
  scene-spec: specs/scene.yaml
  rule-spec: specs/rule.yaml
  data-spec: specs/data.yaml
  asset-plan: specs/assets.yaml
  event-graph: specs/event-graph.yaml
  implementation-contract: specs/implementation-contract.yaml
  game: game/
---

# 单词消消乐 Game PRD

## 1. 项目概述

### @game(main) 单词消消乐
> genre: edu-practice
> platform: [web]
> runtime: dom-ui
> mode: 单机
> player-goal: "在限时内完成所有英文-中文配对，依次通关 3 个关卡"
> core-loop: [@flow(play-round)]
> scenes: [@scene(start), @scene(play), @scene(result)]
> states: [@state(ready), @state(playing), @state(win), @state(lose)]
> levels: [@level(level-1), @level(level-2), @level(level-3)]
> resources: [@resource(default-word-bank)]
> controls: [@input(click-card)]

这是一个面向英语初学者的轻量网页小游戏。

玩家进入关卡后，会看到一组英文单词卡和一组中文释义卡。玩家通过点击，依次选中一个英文单词和一个中文释义；如果两者匹配成功，则两张卡片消除并获得分数；如果匹配失败，则卡片翻回，并扣除少量时间。

这个项目当前的目标不是做复杂动画或重系统版本，而是优先交付一版功能完整度足够、适合小学生使用的首版可玩游戏，并验证这类教育练习型小游戏是否适合走 Web + DOM/UI 的专用链路。

---

## 2. 目标玩家与使用场景

目标用户为英语初学者、小学阶段学生，以及需要短时记忆训练的学习者。

主要使用场景包括：
- 课堂热身
- 课后复习
- 3 到 5 分钟的碎片化记忆训练

当前版本更强调"轻量、直观、快速进入玩法"，不强调复杂成长系统和长期留存机制。

---

## 3. 核心玩法边界与 MVP 定义

当前版本的交付范围聚焦于以下核心功能：
- 单机模式 / 3 个关卡 / 默认词库
- 点击配对 / 倒计时 / 分数统计
- 结果页 / 重试 / 下一关

当前版本**不包含**：
- 登录 / 排行榜 / 班级管理 / 自定义导入词库 / 发音 / 图片辅助 / 广告 / 后端存档

这样定义的原因是，当前阶段优先保证玩家能完整体验配对、闯关和结算这三个核心系统；超出该范围的后台与管理能力后放，而不是先牺牲用户已经点名的核心玩法。

---

## 4. 主干流程

### @flow(play-round) 单局配对流程
> entry: @scene(start)
> main-scene: @scene(play)
> exit: @scene(result)
> involves: [@scene(start), @scene(play), @rule(match-check), @rule(win-check), @rule(lose-check), @scene(result)]

玩家进入开始页后，阅读简短说明并点击开始按钮，进入主玩法场景。在主玩法场景中，系统展示当前关卡对应数量的英文单词卡和中文释义卡，玩家通过点击完成一一配对。当当前关卡全部配对完成时，进入胜利结算；当倒计时结束且仍有未完成配对时，进入失败结算。结算页展示结果，并允许玩家重试或进入下一关。

---

## 5. 场景规格

### @scene(start) 开始页
> entry: true
> layout: centered-hero
> inputs: [@input(click-card)]
> ui: [@ui(title), @ui(btn-start)]

展示：游戏标题、简短玩法说明、开始按钮。目标是让玩家快速理解玩法并进入游戏，不承担复杂配置功能。

### @scene(play) 主玩法页
> entry: false
> layout: grid-two-column
> inputs: [@input(click-card)]
> ui: [@ui(hud-level), @ui(hud-timer), @ui(hud-score), @ui(card-grid)]
> state-on-enter: @state(ready)

需要展示：当前关卡、倒计时、当前分数、英文单词卡区域、中文释义卡区域。这是游戏的核心场景，所有主要操作、判定、反馈和状态变化都发生在这里。

### @scene(result) 结果页
> entry: false
> layout: centered-hero
> inputs: [@input(click-card)]
> ui: [@ui(result-summary), @ui(btn-retry), @ui(btn-next)]

需要展示：当前关卡结果（通关 / 失败）、本关得分、正确配对数量、重试按钮、下一关按钮（仅通关时显示）。

---

## 6. 状态与实体

### @state(ready)
> on-enter: "加载当前关卡的卡片数据并渲染到 card-grid，倒计时未启动"
> on-exit: "玩家首次点击任意卡片后进入 playing"

### @state(playing)
> on-enter: "启动倒计时、开放卡片交互"
> on-exit: "win 或 lose 触发时进入对应状态"
> transitions: [win, lose]

### @state(win)
> on-enter: "停止倒计时、展示结果页通关态、计算最终得分"

### @state(lose)
> on-enter: "停止倒计时、展示结果页失败态"

### @entity(card) 卡片
> type: card
> fields: "id: string, side: en|zh, pairId: string, matched: boolean"
> scene: @scene(play)
> spawn-rule: "关卡初始化时按 level.difficulty 生成对应数量的 en/zh 卡对"

---

## 7. 规则与系统

### @input(click-card) 点击卡片
> device: click
> targets: [@entity(card)]
> bindings: "pointerdown/tap → @rule(select-card)"

### @ui(hud-timer) 倒计时显示
> scene: @scene(play)
> role: indicator
> binds: "gameState.timeLeft"
> position: top-right

### @ui(hud-score) 分数显示
> scene: @scene(play)
> role: indicator
> binds: "gameState.score"
> position: top-left

### @ui(hud-level) 当前关卡
> scene: @scene(play)
> role: indicator
> binds: "gameState.level"
> position: top-center

### @ui(card-grid) 卡片网格
> scene: @scene(play)
> role: playfield
> binds: "gameState.cards"

### @ui(title) 游戏标题
> scene: @scene(start)
> role: text

### @ui(btn-start) 开始按钮
> scene: @scene(start)
> role: button

### @ui(btn-retry) 重试按钮
> scene: @scene(result)
> role: button

### @ui(btn-next) 下一关按钮
> scene: @scene(result)
> role: button

### @ui(result-summary) 结果摘要
> scene: @scene(result)
> role: text
> binds: "gameState.lastRoundResult"

### @rule(select-card) 卡片选择
> trigger: "玩家在 @scene(play) 点击一张未消除的卡片"
> effect: "selected.push(card) ; if selected.length == 2 and sides differ → goto @rule(match-check)"
> scope: @scene(play)
> priority: 1

### @rule(match-check) 配对判定
> trigger: "玩家已选中两张卡片且分属 en/zh"
> effect: "if selected[0].pairId == selected[1].pairId → score += 10 ; combo += 1 ; selected.forEach(c → c.matched = true) ; else → timeLeft -= 3 ; combo = 0 ; flash selected 400ms → unselect"
> scope: @scene(play)
> priority: 2

### @rule(combo-bonus) 连击加分
> trigger: "match-check 成功后"
> effect: "if combo >= 3 → score += 5"
> scope: @scene(play)
> priority: 3

### @rule(win-check) 胜利判定
> trigger: "每次配对成功后检查"
> effect: "if remainingPairs == 0 → phase = win"
> scope: @scene(play)
> priority: 4

### @rule(lose-check) 失败判定
> trigger: "倒计时每秒更新后检查"
> effect: "if timeLeft <= 0 and remainingPairs > 0 → phase = lose"
> scope: @scene(play)
> priority: 5

---

## 8. 资源与数据

### @resource(default-word-bank) 默认词库
> type: word-pair-list
> source: inline-json
> schema: "{ en: string, zh: string }[]"
> count: "at least 24 entries, covers 3 levels x 8 pairs max"

每条词条至少包含英文单词和中文释义。当前版本不强制要求音标、例句、图片和发音资源。示例：apple-苹果、book-书、cat-猫、dog-狗。

### @level(level-1)
> difficulty: easy
> params: "pairs=4, timerSec=45"
> resources: [@resource(default-word-bank)]

### @level(level-2)
> difficulty: medium
> params: "pairs=6, timerSec=60"
> resources: [@resource(default-word-bank)]
> unlock-after: @level(level-1)

### @level(level-3)
> difficulty: hard
> params: "pairs=8, timerSec=75"
> resources: [@resource(default-word-bank)]
> unlock-after: @level(level-2)

当前版本建议优先使用简单、常见、易识别的基础英语词汇，以确保玩家能快速理解玩法。

---

## 9. 运行方式与框架策略

当前版本采用 **DOM + Tailwind v4** 方案实现，原因：
1. 核心交互是点击配对，不强依赖复杂实时循环
2. 重点是验证内容组织、状态推进和反馈闭环
3. DOM/UI 能更快完成最小可玩的网页原型，且 LLM 生成代码首轮正确率最高

后续若需要卡片翻转动画、更强视觉反馈、更明显关卡表现、更丰富游戏感，再考虑迁移到 Canvas 或 Phaser 方案（按 `engines/_index.json` 同步更新 `runtime` / `engine-plan`，再重跑 Phase 3-5）。

---

## 10. 校验点与验收标准

### @constraint(mvp-no-backend) MVP 不含后端
> kind: mvp-boundary
> severity: critical

当前版本不生成登录、排行榜、班级管理、自定义导入等非 MVP 功能。所有数据内联在前端，`need-backend: false` 必须严格体现。

### @check(playable-loop) 主循环可玩
> layer: product
> method: "Playwright 打开 game/index.html → 点击开始 → 完成一轮配对 → 进入结算页"
> expect: "window.gameState.phase 最终进入 win 或 lose；score 为非负数"

玩家可以从开始页进入主玩法页，并完成至少一轮配对与结算。

### @check(rule-closure) 规则闭环
> layer: product
> method: "脚本化点击配对成功与失败各一次，读 window.gameState"
> expect: "成功 → matchedCount 增加，score 增加；失败 → timeLeft 减少，combo 归零"

匹配成功、匹配失败、加分、扣时、通关、失败这些规则之间没有明显冲突，能够形成闭环。

### @check(content-visibility) 内容可见性
> layer: engineering
> method: "首屏 DOM 断言"
> expect: "level / timer / score / en-cards / zh-cards 节点全部存在且有文本"

单词、释义、分数、倒计时、关卡信息都能被正常展示，并且在游戏过程中更新正确。

### @check(mvp-boundary) MVP 边界
> layer: requirement
> method: "代码搜索 + 人工过一遍"
> expect: "不出现 login / leaderboard / class / upload 关键词相关实现"

当前版本不生成登录、排行榜、班级管理、自定义导入等非 MVP 功能。

### @check(retry-next-level) 重试与下一关
> layer: product
> method: "Playwright 完成一关后点击'下一关'，确认进入 level-2"
> expect: "gameState.level 从 1 切到 2；失败后点击'重试'回到当前关卡的 ready 状态"

失败后可以重试，成功后可以进入下一关，主流程不会中断。

---

## 11. 可选扩展

当前版本不实现，列出来用于后续迭代锚点：

- 排行榜 / 登录 / 班级管理（引入后端时）
- 自定义导入词库（管理员功能）
- 音标、例句、发音音频
- 图片辅助记忆（cat 卡片贴猫图）
- 翻转/消除动画升级（届时考虑切 runtime=canvas 或 phaser3）
