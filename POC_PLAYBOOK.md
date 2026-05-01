# POC Playbook

v2 新链路（dynamic mechanics + identity gate + Stage 1-5 + 7+1 支路）的端到端 POC 执行指南。沿用 `eval/` 四件套纪律（`iteration_testing_protocol` + `case_driven_iteration_flow` + `phase_gate_reviewer` + `case_deep_review`），针对 v2 新结构补 3 处调整和 3 个新 anchor case。

---

## 1. 为什么要跑 POC

v2 链路完成了 11 个 commit 的基础设施改造（从 `78bd70a` 到 `d2999ed`），但所有 check / schema / SOP 都只做了单元级 smoke test，**没跑过一条真实 query 的端到端**。POC 的目的不是"产出好游戏"，而是：

1. 验证 v2 新 check（`check_archetype_identity` / `check_stage_contract` / `check_preserve_regression` / `check_resource_loop` / `check_difficulty_curve` / `check_game_feel` / `check_decision_graph`）能真正拦住问题
2. 验证 Stage 1-5 分段推进 + preserve.lock 真能防止后续 Stage 偷改前期 core loop
3. 验证 identity-anchors + grep 证据闭环真能堵住 "第一眼就烂的 demo"
4. 发现 v2 链路上的具体卡点，登记到 `.pipeline_patterns.md`，驱动后续迭代

---

## 2. 现有 eval 流程与 v2 链路的映射

### 2.1 90% 直接复用

| 既有流程 | v2 下是否适用 |
|---|---|
| `iteration_testing_protocol.md` L1–L6 分层（改代码时用） | ✅ 直接用 |
| `case_driven_iteration_flow.md` 5-Stage 分阶段冻结（跑 case 用） | ✅ 直接用，但阶段清单要扩 |
| `phase_gate_reviewer.md` 驻留式审查（会话 B） | ✅ 直接用，但 routing 要补 |
| `case_deep_review.md` 终局深审查（会话 C） | ✅ 直接用 |
| **3 会话分离**（A 跑 case + B gate reviewer + D 修 skill） | ✅ 直接用 |
| `.pipeline_patterns.md` 登记 + 升级触发 | ✅ 直接用 |

### 2.2 需要在心里/执行时补 3 处（先不改 eval 文档，等 POC 结果驱动）

**补丁 A：阶段清单从 5 阶段扩成 Phase 1-3 + Stage 1-5**

`case_driven_iteration_flow.md` 原 Stage 1 涵盖 Phase 1-5，但 v2 下顺序是：

```
Phase 1 Understand
  → Phase 2 GamePRD
  → Phase 2.5A User Clarify
  → Phase 2.5B Design Strategy
  → Phase 3.0 Mechanic Decompose
  → Phase 3.x Expand (5 spec expanders + implementation-contract)
  → Stage 1 Vertical Slice      ← 用户必须确认
  → Stage 2 Content Expansion   ← 用户推荐确认
  → Stage 3 Variety             ← 自动，可打断
  → Stage 4 Progression         ← 自动，可打断
  → Stage 5 Balance & Polish    ← 自动
```

每个 Stage 1-5 都当作一个独立 gate 节点，会话 B 收到 "Stage N 完成" 同样做 Blocker/Debt 分类。

**补丁 B：Phase Gate 清单新增**

`phase_gate_reviewer.md` 的 Phase Routing 段本来只覆盖 Phase 1+2 / Phase 2.5 / Phase 3 / Phase 4 / Phase 5。v2 下要新增：

- **Phase 2.5A** 独立 routing：spec-clarifications.md 是否覆盖 trigger/condition/effect 级歧义
- **Phase 2.5B** 独立 routing：design-strategy.yaml 所有必填字段是否齐、identity-anchors 是否声明
- **Stage 1**：`check_archetype_identity` 通过 + identity-anchors grep 证据齐 + game_feel ≥ 5 MDPM + decision_graph ≥ 声明值 + preserve.lock 已生成
- **Stage 2**：`check_preserve_regression` 通过 + `check_difficulty_curve` 单调 + patch-based codegen 未覆盖主入口
- **Stage 3**：新 entity 不绕开 Stage 1 win/lose + local juice 齐
- **Stage 4**：`check_resource_loop` 闭环 + 不升级策略仍可完成 Stage 1 核心玩法
- **Stage 5**：平衡/节奏/反馈收敛，不改 Stage 3/4 行为

**补丁 C：基线 case 不能只有打地鼠**

v2 引入的 identity-anchors / resource-loop / patch codegen 等新能力，打地鼠（reflex 类）能覆盖一部分，但无法检验其余。本文档 §4 给出 3 个新 anchor case 的 prompt，按优先级执行。

---

## 3. POC 三阶段执行路线

### 阶段 I — v2 链路自身能跑通（1-2 天）

**目标**：沿用 `cases/whack_a_mole_pixijs.md` 跑一遍 v2 新链路，验证基础设施。

**流程**：
1. 会话 A：按 `eval/cases/whack_a_mole_pixijs.md` 的 PROMPT TO MODEL 起会话
2. 会话 B：同时起 `eval/reviews/phase_gate_reviewer.md` 的驻留式 reviewer
3. 会话 D：备用（修 skill 用，暂不开）
4. 跑到 Stage 2 验收通过即可结束（Stage 3-5 本阶段不做，节省成本）
5. 记 `.pipeline_patterns.md` 前 3-5 类失败模式

**成功判据**：
- Phase 2.5B 能产出完整 design-strategy.yaml（7 个 required 字段齐）
- Stage 1 通过 `check_archetype_identity`（即便打地鼠 identity-anchors 可能很少甚至为空 → ok-skip 也算通过）
- Stage 1 通过 `check_game_feel` + `check_decision_graph`
- Stage 2 的 patch codegen 只改该改的文件，未重写 main.js

### 阶段 II — 扩展 anchor 覆盖 v2 新能力（2-3 天）

**目标**：用俄罗斯方块、2048、推箱子验证 identity gate / patch codegen / 难度递增这 3 种 v2 能力。

**顺序**：
1. `tetris-pixijs-v2`（本文档 §4.1）— 验证 identity-anchors 真能检验出 lock-delay 等手感
2. `2048-canvas`（本文档 §4.2）— 验证纯规则类 + Stage 2 patch codegen 加关卡选择
3. `sokoban-dom`（本文档 §4.3）— 验证难度单调递增、关卡 hash 不重复

每个 case 完整走 Phase 1 → Stage 1 → Stage 2，通过后升级为 anchor。

### 阶段 III — 难类型探索（按需）

**目标**：验证 v2 能否防止经营养成类翻车。

- `tamagotchi-dom`（本文档 §4.4）— 经营养成，零 reference 保底，全程 L3/L4
- 重点观察 `check_resource_loop` 能否真的堵住死锁 / 无限增殖 / 非闭环
- 若翻车 → 登记 `.pipeline_patterns.md` → 决定是加 check 还是调 SOP

---

## 4. 推荐 Anchor Case Prompts

以下 4 份 prompt 都遵循 `eval/cases/whack_a_mole_pixijs.md` 的模板：上方是选型理由 + 覆盖矩阵，下方是直接喂给模型的 PROMPT TO MODEL 段。

### 4.1 tetris-pixijs-v2（P0 · 最高优先级）

**为什么选**：
- 最高频 reference（真实数据 264 次提及，覆盖 24% query）
- identity-anchors 判定最清晰（lock-delay / wall-kick / next-queue 这 3 条是公认"这就是 Tetris"）
- 验证 `check_archetype_identity` 真能拦住 "会动但不像 tetris" 的生成
- 适合 pixijs 引擎

**覆盖矩阵**：
| 维度 | 覆盖 |
|---|---|
| 引擎 | pixijs |
| genre | board-grid 子类（下落型） |
| 核心 v2 能力 | identity-anchors + grep evidence + Stage 1 game_feel |
| 关键 check | check_archetype_identity / check_decision_graph / check_game_feel |
| 反面样本风险 | 模型可能生成"会下落会清行但没 lock-delay"→ identity gate 必须 fail |

**PROMPT TO MODEL**：

```
跑一个真实 case 验证 v2 identity gate 能否拦住烂俄方。严格按协议，不跳步。

## Case 基本信息
- 项目目录: cases/tetris-pixijs-v2/
- 引擎: pixijs
- run-mode: local-http
- 玩法: 经典俄罗斯方块
  - 10x20 棋盘
  - 7 种标准 tetromino，SRS 旋转规则简化版即可
  - next queue 至少 1 块（推荐 3 块）
  - 落地前 500ms lock-delay
  - 贴墙旋转有基础 wall-kick（至少 L/R 一格偏移）
  - 消行计分，累计 10 行 level+1，落速上调
- 不要: 多人 / 联机 / 排行榜 / 音效素材 / T-spin 高级判定

## 必读参考
- eval/protocols/iteration_testing_protocol.md
- eval/protocols/case_driven_iteration_flow.md
- game_skill/skills/SKILL.md（CC）或 game_skill/skills/SKILL-codex.md（Codex）

## 执行纪律
1. Stage 0 在 cases/tetris-pixijs-v2/INTENT.md 写：
   - 本轮目的: 验证 identity-anchors 能真正拦住缺手感的 tetris 生成
   - 不允许的修复: identity-anchors 字段空着跳过 check / 为了过 check 塞假 mitigation 字符串
   然后停下等我授权进入 Phase 1。

2. Phase 2.5B 产出 docs/design-strategy.yaml 时必须声明 identity-anchors 数组，至少 3 条：lock-delay / wall-kick / next-queue（若你识别到 tetris reference，自行判断还要不要加）。每条带 id / description / mitigation / grep-evidence。

3. 每个 Phase / Stage 完成停下：
   - Phase 1+2 → 贴 check_game_prd.js exit code → 停
   - Phase 2.5A → 贴 spec-clarifications.md 决策摘要 → 停
   - Phase 2.5B → 贴 design-strategy.yaml 的 identity-anchors 段 + check_design_strategy.js 结果 → 停
   - Phase 3.0 → 贴 mechanics.yaml 节点清单 → 停
   - Phase 3.x → 贴 7 份 spec + implementation-contract，跑 verify check → 停
   - Stage 1 Codegen → 跑 verify_all --stage 1 → 贴所有 check 结果 → 停
   - Stage 2 Codegen → patch 归档位置 + verify_all --stage 2 → 停

## 测试硬约束（不过即 fail 本 case）
- design-strategy.yaml 必须声明 ≥ 3 条 identity-anchors
- Stage 1 必须 check_archetype_identity 通过（不得用空数组绕过）
- Stage 1 必须 check_game_feel MDPM ≥ 5，p95 延迟 ≤ 200ms
- Stage 2 codegen 必须是 patches.json 形式，不得整覆盖 main.js

## 不需要确认的动作
- 新建 cases/tetris-pixijs-v2/ 目录
- 写入 INTENT.md / docs/ / specs/ / game/
- 跑 check / verify_all

## 必须停下等我授权
- 任何"绕过 check 以过 case"的动作
- 删除或修改 preserve.lock.yaml
- 对 skill 本身（game_skill/skills/）的任何改动 → 必须走会话 D

## 第一条回复格式
按 `case_driven_iteration_flow.md` Stage 0 的要求，第一条回复只包含 INTENT.md 内容 + "Stage 0 完成，等授权进入 Phase 1"。

## 失败兜底
卡死 / 死循环 / 产物前后不一致 → 停下发给我，不要自己 debug 超过 10 分钟。
```

---

### 4.2 2048-canvas（P0 · 并列最高）

**为什么选**：
- 纯规则类，reference 明确但识别难度中等（模型可能只做"会合并的方块"但漏掉"每步必有合法移动"）
- 2048 的 identity 比 tetris 更"数字驱动"：方向输入 → 整排滑动 → 合并同数 → 空格生成新数
- 适合 canvas 引擎（最薄的渲染层，排除引擎复杂度）
- Stage 2 天然要加"多尺寸棋盘 / 最高分排行榜"，验证 patch codegen

**覆盖矩阵**：
| 维度 | 覆盖 |
|---|---|
| 引擎 | canvas |
| genre | board-grid（合并型） |
| 核心 v2 能力 | identity-anchors + Stage 2 patch codegen |
| 关键 check | check_archetype_identity / check_decision_graph / check_difficulty_curve（Stage 2 时） |

**PROMPT TO MODEL**：

```
跑 2048 真实 case，验证 v2 patch codegen 在 Stage 2 工作正常。

## Case 基本信息
- 项目目录: cases/2048-canvas/
- 引擎: canvas
- run-mode: local-http
- 玩法: 经典 2048
  - 4x4 棋盘
  - 方向键滑动整排，同数合并
  - 每次有效移动后空格里随机生 2 或 4（90/10）
  - 合成 2048 提示胜利（非强制关）
  - 无合法移动 → game over
- Stage 2 扩展预期: 加 3x3 / 5x5 模式切换 + localStorage 最高分

## 必读参考
同 §4.1

## 执行纪律
1. Stage 0 INTENT.md:
   - 本轮目的: 验证 Stage 2 patch codegen 不重写 Stage 1 骨架
   - 不允许的修复: Stage 2 直接覆盖 main.js（必须用 add-file / edit anchor / replace-function op）

2. Phase 2.5B identity-anchors 至少声明:
   - row-sliding: 所有方块必须整排滑动，不是单格移动
   - merge-once-per-move: 同排每对同数每次移动最多合一次（不能链式合并）
   - spawn-only-empty: 新方块只在空格生成

3. Stage 1 acceptance 通过后，Stage 2 必须:
   - codegen agent 输出 patches.json（对齐 schemas/patch.schema.json）
   - apply_patch.js 应用后不触碰 Stage 1 的 row slide 核心逻辑
   - 归档到 .game/stages/2/patches.json

## 硬约束
- Stage 1 codegen 后必须通过 check_archetype_identity（identity-anchors ≥ 3）
- Stage 2 必须走 patch codegen（verify patches.json 存在且 apply_patch.js 成功）
- Stage 2 后必须通过 check_preserve_regression（preserve.lock 未被破坏）
- Stage 2 加 3x3/5x5 模式后必须通过 check_difficulty_curve

## 其余纪律同 §4.1
```

---

### 4.3 sokoban-dom（P1）

**为什么选**：
- 推箱子是关卡数据驱动的典型，天然适合 Stage 2 的 content expansion 验证
- DOM 引擎（最薄渲染）排除物理引擎复杂度
- identity 相对简单（box-push-not-pull / wall-stop / goal-match）
- 关卡布局 hash 必须不同，能检验 `check_difficulty_curve` 硬判据

**覆盖矩阵**：
| 维度 | 覆盖 |
|---|---|
| 引擎 | dom-ui |
| genre | board-grid（推拉型） |
| 核心 v2 能力 | Stage 2 content expansion + 关卡数据扩展 |
| 关键 check | check_difficulty_curve（5 关布局 hash 唯一） |

**PROMPT TO MODEL**：

```
跑推箱子真实 case，验证 Stage 2 多关卡扩展 + check_difficulty_curve 硬判据。

## Case 基本信息
- 项目目录: cases/sokoban-dom/
- 引擎: dom-ui（CSS grid 渲染关卡）
- run-mode: local-http
- 玩法: 经典推箱子
  - 方向键移动，只能推不能拉
  - 箱子全部推到目标格 → 过关
  - 支持 undo（上一步还原）
  - Stage 1 做 1 关；Stage 2 扩 5 关（难度单调递增）

## 必读参考
同 §4.1

## 执行纪律
1. Stage 0 INTENT.md:
   - 本轮目的: Stage 2 多关卡 + check_difficulty_curve 能真的拒绝"换皮不换规模"
   - 不允许的修复: 5 关用同一张地图换颜色

2. Phase 2.5B identity-anchors:
   - box-push-only: 箱子前方有墙或另一箱 → 不能推
   - goal-match: 所有箱子都在目标点才算胜利
   - undo-one-step: 撤销一步回退

3. Stage 2 必须:
   - specs/data.yaml 的 levels[] 至少 5 关，每关 layout 字段 sha256 hash 互不相同
   - 至少一维难度（步数上限 / 箱子数 / 墙障密度）单调递增
   - check_difficulty_curve 通过

## 其余纪律同 §4.1
```

---

### 4.4 tamagotchi-dom（P1 · 难类型探索）

**为什么选**：
- 经营养成类 61 条真实 query 全部 L3/L4 + 零 reference → v2 下风险最高的一类
- 验证 `check_resource_loop` 能否真的堵死循环（喂食→开心度→饥饿→回喂食）
- Stage 4 progression 的试金石
- DOM 引擎（无物理，逻辑集中于状态）

**覆盖矩阵**：
| 维度 | 覆盖 |
|---|---|
| 引擎 | dom-ui |
| genre | 经营养成 |
| 核心 v2 能力 | check_resource_loop + Stage 4 progression |
| 关键 check | check_resource_loop balance 1.1-1.3 + 闭环验证 |

**PROMPT TO MODEL**：

```
跑电子宠物真实 case，验证 v2 经营养成类能否不崩（零 reference，高风险）。

## Case 基本信息
- 项目目录: cases/tamagotchi-dom/
- 引擎: dom-ui
- run-mode: local-http
- 玩法: 电子宠物
  - 一只宠物，3 项基础状态: 饥饿 / 情绪 / 精力（每项 0-100）
  - 每 10 秒所有状态自然下降
  - 玩家可操作: 喂食（饥饿↑，情绪↑少量）/ 玩耍（情绪↑，精力↓）/ 睡觉（精力↑，饥饿↓少量）
  - 任一状态归 0 → 宠物不开心（UI 明确提示）
  - Stage 1 只做单只宠物 + 3 操作；Stage 4 加金币系统（宠物开心 → 产币，币可买高级食物）

## 必读参考
同 §4.1

## 执行纪律
1. Stage 0 INTENT.md:
   - 本轮目的: 验证 check_resource_loop 能防止经营类死锁 / 无限增殖
   - 不允许的修复: 为过 check 人工调 balance-target 数值到刚好 1.2

2. Phase 2.5B identity-anchors（经营类可选，本 case 建议空或只声明核心玩法特征）:
   - 若声明 → 至少 1 条关于状态自然衰减的 mitigation（防止作弊静止不动）

3. Phase 2.5B resource-loop 字段必须完整:
   - resources: hunger / mood / energy（Stage 4 加 coin）
   - 每个 resource 的 sources 和 sinks 都齐
   - balance-target 落在 [1.1, 1.3]

4. Stage 4 必须:
   - 加金币系统后重跑 check_resource_loop，仍然闭环
   - 不升级策略下（不花金币）仍能玩 Stage 1 核心玩法

## 硬约束
- Phase 2.5B check_design_strategy.js 通过（resource-loop 字段完备）
- Stage 4 check_resource_loop.js 通过 + 产出/消耗比 [1.1, 1.3]
- Stage 4 后 preserve.lock 未被破坏（Stage 1 核心 loop 仍可跑）

## 其余纪律同 §4.1
```

---

## 5. 跑完一个 case 后要做什么

沿用 `case_driven_iteration_flow.md` Stage 5:

1. 登记 `.pipeline_patterns.md`（失败模式登记 + 升级触发）
2. 提升本 case 为 anchor（`cases/anchors/<name>/`）
3. 决定是否需要 skill 改动：
   - 发现是 **SYSTEMATIC** blocker → 在会话 D 修 skill，新增 check 或调 SOP 文字
   - 发现是 **CASE-LOCAL** → 只改本 case 的 spec，skill 不动
4. 每 3-4 个 case 之后，回头看 `.pipeline_patterns.md` 是否出现抽象升级信号（同类失败出现 ≥ 3 次 → 考虑写 check 脚本）

---

## 6. 常见问题处理

### Q1：POC 期间要不要改 skill？
默认不改。只有会话 B 判定为 SYSTEMATIC 且 `.pipeline_patterns.md` 同类已累积 ≥ 2 次时，才开会话 D 改。

### Q2：anchor case 失败了怎么办？
不要回退 anchor。把失败归因 .md 登到 `cases/<name>/failures/` 下；failures gate 会自动拦住 verify_all，强制你处理。

### Q3：Codex 下某个 Phase 跑不动（context 爆、subprocess 卡）怎么办？
- 短期：按 SKILL-codex.md §165 规范保存 state 新开会话续跑
- 长期：若反复出现 → 考虑 CODEX-ADAPTATION.md §已知降级点 的 Tier 1 升级（subprocess 真并发）

### Q4：CC 和 Codex 都跑的话怎么协调？
推荐：同一个 case prompt 分别在 CC 和 Codex 各跑一次，对比：
- 同一 identity-anchors 被两个平台分别推断得是否一致
- Stage 1 acceptance 哪个平台更快通过
- 失败模式是否平台相关

结果登到 `.pipeline_patterns.md`，作为后续平台抽象层（若真要做）的依据。

---

## 7. 启动检查清单

开跑前确认：

- [ ] `cases/anchors/` 存在且未被 git status 标为修改
- [ ] `.gitignore` 仍在 ignore `cases/*/`（除 anchors）
- [ ] 当前分支 `main`，HEAD 在 `d2999ed` 或更新
- [ ] `node game_skill/skills/scripts/verify_all.js --help` 正常
- [ ] CC 或 Codex 能读到对应入口文档（SKILL.md / SKILL-codex.md）
- [ ] 本文档 §3 提到的 3 会话模板你心里清楚：A 跑 case / B gate reviewer / D 修 skill

检查清单全过 → 按 §3 阶段 I 先跑打地鼠，阶段 II 再上 tetris / 2048 / sokoban。
