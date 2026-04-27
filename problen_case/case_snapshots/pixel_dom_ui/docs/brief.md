# Brief: 像素传送带清板益智游戏

## Raw Query
用户需求文档：test/pixel.md

核心内容：像素风、轻度休闲、益智策略、竖屏点击游戏。核心逻辑：四周环形传送带、颜色匹配攻击、有限弹药单位、等待槽回收、容量管理、顺序清板。

## Inferred
- genre: board-grid（棋盘/格子规则型）
- platform: [web]
- mode: 单机
- reference-games: [Pixel Flow 类]
- hard-rules:
  - 禁止做成全屏自动索敌
  - 禁止小猪一次攻击多个同色块
  - 禁止穿透前方异色块攻击后方目标
  - 禁止做成整行整列直接清除
  - 禁止做成三消、塔防、自动射击或普通消除游戏
  - 必须严格体现"四周传送带 + 按当前位置依序处理当前方向上的第一个目标块 + 等待槽回收再派出"的玩法核心
- interaction: [click-only]
- assets-hint: 像素风、小猪、颜色块、传送带
- is-3d: false

## Gaps
- runtime: 用户指定文件夹名 `pixel_dom_ui` 暗示 DOM 引擎，但该游戏涉及实时动画（小猪沿传送带持续移动）和像素风格，需确认引擎选择

## ClarifiedBrief
- genre: board-grid
- platform: [web]
- mode: 单机
- core-loop: "派出小猪 → 沿传送带移动 → 依序攻击目标块 → 数值未耗尽则回收至等待槽 → 再次派出"
- player-goal: "清空中央棋盘中的全部目标块"
- must-have-features:
  - 四周环形传送带系统
  - 颜色匹配攻击机制
  - 小猪单位系统（颜色+弹药数值）
  - 等待槽回收再派出机制
  - 中央棋盘目标块（普通块/强化块/锁定块）
  - 位置依赖索敌（按当前位置处理正对方向第一个目标块）
  - 明确的胜负条件
- nice-to-have-features:
  - 战斗反馈动画（攻击弹道、命中闪烁、消除动画、回收动画）
  - 多关卡递进（2色→3色→4色）
- delivery-target: feature-complete-lite
- cut-preference: "先缩内容量，不先砍核心系统"
- constraints:
  - mvp-boundary: "不含联机、排行榜、自定义关卡"
  - hard-rule: "位置依赖索敌是核心，禁止全屏自动索敌"
- style-preference: pixel-retro
- theme-keywords: [像素, 传送带, 清板, 益智, 策略, 颜色匹配, 小猪, 棋盘]
- content-scope: "前期2色关卡，中期3色，后期4色+强化块"
- difficulty-mode: "递进式难度，强调顺序决策"
- suggested-runtime: dom-ui（用户选择）
- is-3d: false
- mvp-cut: ["暂不做联机", "暂不做自定义关卡编辑器"]
- project-slug: pixel_dom_ui
