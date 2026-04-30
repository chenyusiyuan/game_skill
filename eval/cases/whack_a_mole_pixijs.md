# Case Prompt — pixijs + 打地鼠（whack-a-mole lite）

**用途**：本轮生成层重构（P0/P1/P2 + 三分类 + 引擎收编 A/B + P1 profile 迁移）完成后，用真实 case 做一轮 e2e 健康检查，产出第一个 anchor case。

**直接喂给模型的 prompt 在下方"PROMPT TO MODEL"段。上方是上下文，模型不读也可以。**

---

## 为什么选这个 case

- **引擎 pixijs**：本轮所有改动都没在 pixijs 上跑过真实 case，需要证据
- **玩法打地鼠**：覆盖 P1 新加的 4 个 lifecycle primitive（slot-pool / capacity-gate / entity-lifecycle / cooldown-dispatch）
- **genre reflex**：验证 P2 solvability 的 reflex schema-only 分支（你另外两个 case 都走 board-grid/edu-practice，不会触发这条路径）
- **复杂度低**：2-3 小时能跑完完整 Stage 1–5，调试信号清晰
- **产出 anchor**：成功后升级为 `cases/anchors/whack-a-mole-pixijs-min/`，作为未来回归基线

---

## 覆盖矩阵

| 维度 | 本 case 覆盖 |
|---|---|
| 引擎 | pixijs（P1 enforced FULL primitive set） |
| genre | reflex（P2 solvability schema-only 分支） |
| primitive runtime（P1） | resource-consume / score-accum / fsm-transition / win-lose-check / slot-pool / capacity-gate / entity-lifecycle / cooldown-dispatch / predicate-match |
| test-hooks 三分类 | observers（getSnapshot / getTrace）+ drivers（clickStartButton）+ probes（resetWithScenario） |
| profile 新命名空间 | 新 profile 必须使用 `window.gameTest.drivers.*` |
| 产品验证链 | check_game_boots + check_project + check_playthrough + check_runtime_semantics + check_level_solvability |

本 case **不覆盖**的（故意的，留给二轮测试）：
- ray-cast / parametric-track / grid-board / grid-step / neighbor-query（空间/运动 primitive）
- board-grid solvability replay 路径
- dom-ui 引擎
- canvas 引擎（已有 pre-existing 覆盖）

---

## PROMPT TO MODEL

把下面这段完整复制给模型（Claude / Codex）。

```
我要测本轮生成层重构是否健康。跑一个真实 case，走完 Phase 1-5 e2e，产出
anchor case + baseline。严格按协议执行，不要跳步。

## Case 基本信息

- 项目目录: cases/whack-a-mole-pixijs-min/
- 引擎: pixijs
- run-mode: local-http
- genre: reflex（playability.genre 必须声明 reflex）
- 玩法: 打地鼠简化版
  - 3x3 或 4x4 网格（你自己决定合理值，写入 PRD）
  - 地鼠随机从格子冒出，保持一段时间后自动缩回
  - 玩家点击命中得分 +1
  - 失误（漏点）达到上限或倒计时归零 → 游戏结束
  - 一关，不分关，不存档
- 不要: 分关卡系统 / 难度递增 / 音效素材 / 复杂动画 / 排行榜

## 必读参考

1. /Users/bytedance/Project/game_skill/eval/protocols/iteration_testing_protocol.md
2. /Users/bytedance/Project/game_skill/eval/protocols/case_driven_iteration_flow.md

读完后按 case_driven_iteration_flow.md 的 5 Stage 流程执行。

## 执行纪律

1. Stage 0 先把下面三样写到 cases/whack-a-mole-pixijs-min/INTENT.md:
   - 本轮目的: 验证生成层重构后的完整 5-Phase 链路
   - 预期 blast layers: 无预设
   - 不允许的修复: profile 层打补丁 / checker 层加豁免 / 绕过 schema
   然后停下等我授权进入 Stage 1。

2. Stage 1 分阶段跑，每完成一个 Phase 停下:
   - Phase 1+2: 产出 docs/game-prd.md，跑 check_game_prd.js，把 exit code 和
     产物摘要贴给我 → 停，等我授权
   - Phase 2.5: 产出 spec-clarifications.md → 停
   - Phase 3.0: 产出 specs/mechanics.yaml，跑 check_mechanics.js → 停
   - Phase 3.x: 产出 7 份 spec + contract，跑 check_asset_selection /
     check_implementation_contract --stage expand / check_mechanics → 停
   - Phase 4: 产出 game/，跑 check_game_boots + check_project +
     check_implementation_contract --stage codegen + check_mechanics → 停
   - Phase 5: 写好 profile，跑 verify_all → 停

   每次 Phase 完成时，把 exit code / 产物关键字段 / 异常摘要 贴给我。

3. 任何 check 失败时:
   - 先按 case_driven_iteration_flow.md Stage 2 写 Failure Attribution 到
     cases/whack-a-mole-pixijs-min/failures/<timestamp>.md
   - 不写分析不动手
   - 分析完告诉我起源层和建议改哪里，等我授权再改

4. 修复原则:
   - 只能在起源层修
   - 禁止 symptom-level patch（不在 profile 层 / checker 正则上兜底）
   - 修完只从修复的那一 Phase 往后重跑，不要全链路从 Phase 1 重生成

5. 模式观察:
   - 如果某类失败在本 case 内重复出现 3 次，停下来告诉我
   - 你认为这是应该做的"抽象升级"方向（新 primitive / 新 checker rule /
     schema 扩展 / 新 Phase gate），让我决策

6. Stage 5 收尾:
   - Stage 1-4 全绿后，把 case 升级为 anchor:
     cases/anchors/whack-a-mole-pixijs-min/（拷贝 docs/specs/game/eval 和
     report.baseline.json）
   - 追加一条 .pipeline_patterns.md 记录（如果有暴露任何模式）
   - 建议一个 commit message 但不要直接 commit，等我 review

## 测试硬约束（不满足即 fail 本 case）

- implementation-contract.yaml 的 required-test-hooks 必须是三桶对象格式
- profile 必须用 window.gameTest.drivers.clickStartButton() 等三分类命名空间，
  禁止用 window.gameTest.clickStartButton() 或 window.simulate* 等扁平形式
- 产出的 game/src/ 必须 import 至少 3 个 lifecycle primitive runtime（本 case 的
  打地鼠玩法强烈要求 slot-pool + capacity-gate + entity-lifecycle）
- check_level_solvability 必须走到 reflex 分支，输出 "done:reflex"
- verify_all.js 产出的 report.json 必须 generated_by=verify_all.js

## 不需要向我确认的动作

- 跑任何 check 脚本
- 读产物文件
- 写 INTENT.md / failures/*.md / .pipeline_patterns.md
- 写 Stage 报告给我

## 必须停下等我授权的动作

- 修任何 .claude/agents/*.md 或 game_skill/skills/**/*
- 改 PRD 或 specs
- 更新 baseline
- git commit / git push
- 决定"是否需要抽象升级"（你可以提议，决策权在我）

## 第一条回复的格式

把你读完协议和本 prompt 的理解，按下面模板回复，然后停:

---
### Stage 0 准备清单

**本 case 目标**: （你的一句话理解）

**识别的 blast layers**: （未开始跑，暂列预期范围）

**建议的 INTENT.md 草稿**:
（3-5 行）

**Phase 1+2 启动计划**:
- 第一步我会做 ___
- 然后跑 ___
- 产出 ___ 给你看

**我需要你确认的事情**:
（0-3 条，有则列，没有则跳过）

等你 OK，我开始跑 Phase 1+2。
---
```

---

## 我（人）怎么用这份 prompt

1. 新开一个对话（不要在当前会话里跑，保留上下文干净）
2. 粘贴上面"PROMPT TO MODEL"段的全部内容
3. 模型回第一条 Stage 0 准备清单后，review 并授权
4. 按 Stage 1–5 逐 Phase 推进，期间严守"每 Phase 停下"
5. 失败时读模型产的 Failure Attribution，再授权修

---

## 失败兜底

任一情况出现 → 停下调整，不要硬推：

| 症状 | 处理 |
|---|---|
| 模型忽视协议直接跑到 Phase 5 | 打断，强制回到 Stage 0 重新起 |
| 某 Phase 反复失败 3+ 次 | 按 Stage 4 触发规则停下做抽象升级，不要继续补丁 |
| Failure Attribution 写得敷衍 | 要求补细节：具体哪条 check、对应什么规则、怎么级联 |
| 修复后跨层改动多 | 要求拆成多个 commit，每个 commit 单一起源层 |
| verify_all 红但模型说"没关系，整体大部分都过了" | 不接受；红就是红 |

---

## 二轮测试预告（本 case 过了之后）

下一轮建议：**phaser3 + 贪吃蛇（snake）**。

覆盖差异：
- genre board-grid（solvability replay 路径，本 case 未覆盖）
- grid-board + grid-step + predicate-match + resource-consume
- phaser3 在 A commit 之外的另一个玩法形态，补齐覆盖

两轮测完你会有：
- 2 个 anchor case
- 2 个主要引擎的 e2e 证据
- 2 种 genre solvability 分支覆盖
- 13 个 primitive 中约 11 个有 case 覆盖
- 实战检验过的 case_driven_iteration_flow 协议
