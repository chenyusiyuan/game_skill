# Brief: pixel_phaser

## Raw Query
像素传送带清板益智游戏开发，详见 test/pixel.md

## Inferred
- genre: board-grid
- platform: [web]
- mode: 单机
- reference-games: [Pixel Flow]
- hard-rules:
  - 禁止做成全屏自动索敌
  - 禁止小猪一次攻击多个同色块
  - 禁止穿透前方异色块攻击后方目标
  - 禁止做成整行整列直接清除
  - 禁止做成三消、塔防、自动射击或普通消除游戏
  - 必须严格体现"四周传送带 + 按当前位置依序处理当前方向上的第一个目标块 + 等待槽回收再派出"的玩法核心
- interaction: click-only（点击派出小猪）
- assets-hint: 像素风、小猪、颜色块、传送带
- is-3d: false

## Gaps
- runtime: 用户指定文件夹名 `pixel_phaser` 暗示 Phaser 3，但需确认
- delivery-target: 长规格需求，需确认是 feature-complete-lite 还是 playable-mvp

## ClarifiedBrief
- genre: board-grid
- platform: [web]
- mode: 单机
- core-loop: "派出小猪 → 沿传送带移动 → 依序攻击正对方向第一个同色块 → 数值未耗尽则回收到等待槽 → 再次派出"
- player-goal: "清空中央棋盘所有目标块，通关关卡"
- must-have-features:
  - 四周环形传送带系统（小猪沿外圈持续移动）
  - 颜色匹配攻击（按当前位置正对方向第一个目标块判定）
  - 有限弹药单位（小猪数值耗尽后消失）
  - 等待槽回收与再派出
  - 传送带容量上限
  - 多关卡递进（2色→3色→4色+强化块）
- nice-to-have-features:
  - 攻击动画（发射小球/像素弹）
  - 目标块消除特效（闪烁/缩放）
  - 回收动画
- delivery-target: feature-complete-lite
- cut-preference: "先缩内容量，不先砍核心系统"
- constraints:
  - mvp-boundary: "不含排行榜、登录、联机、自定义关卡"
  - hard-rule: 6条硬约束（见 hard-rules）
- style-preference: pixel-retro
- theme-keywords: [像素, 传送带, 清板, 益智, 策略, 休闲]
- content-scope: "至少3关（2色入门→3色进阶→4色+强化块）"
- difficulty-mode: "逐步递进，强调顺序决策"
- suggested-runtime: phaser3
- confirmed-runtime: phaser3
- is-3d: false
- mvp-cut: ["暂不做排行榜", "暂不做关卡编辑器", "暂不做联机"]
- project-slug: pixel_phaser
