---
name: game-phase-1-understand
description: "Phase 1: 需求理解。读取用户 query（及可能的上传文档），总结成 brief，既扫描 GamePRD 必填字段缺口，也扫描功能优先级和交付预期缺口。若有缺口进入 clarify.md，否则直接进入 Phase 2。"
---

# Phase 1: 需求理解 (Understand)

## 职责

将用户一句或一段描述转化为**结构化 Brief**，作为 Phase 2 GamePRD 生成的输入。

**输出**：`docs/brief.md`

---

## 流程

### Step 1：收集原始需求

- 用户 query（本轮对话里的第一条用户消息，或 `test/*.md` / `assets/*.md` 之类的文件）
- 参考图（若用户上传了 png/jpg，记录路径）
- 历史上下文（若从 `.game/state.json` 恢复）

### Step 2：扫描 GamePRD 必填字段 + 功能优先级（关键）

对照 `references/common/game-aprd-format.md` 中 `@game` 的 6 个必填属性：

| 必填 | 能从 query 推断吗？ | 缺口 |
|---|---|---|
| `genre` | 9 大类之一 | 用户说「贪吃蛇」→ board-grid；说「育成小猫」→ simulation；说不清 → 缺口 |
| `platform` | `[web]` 默认 | 通常能推断为 web，除非明确 iOS/Android → simulation |
| `runtime` | `_index.json` 登记的引擎之一（2D 默认 phaser3/pixijs/canvas/dom-ui；明确 3D 时为 three） | 用户未指定 → **Phase 1 末尾 AskUserQuestion 让用户选择**（附推荐），不算缺口 |
| `mode` | 单机 / 联机 / AI 对战 | 大多数小游戏默认「单机」，只要没提多人即可 |
| `core-loop` | `[@flow(...)]` | 有主玩法循环描述即可 |
| `player-goal` | 玩家目标 | 能从 core-loop 派生 |

再额外扫描**功能与预期层面的缺口**：

| 维度 | 典型信号 | 若不澄清会影响什么 |
|---|---|---|
| `must-have-features` | 用户点了多个系统，但没说优先级 | Strategy 会默认裁成最小闭环，容易和预期不符 |
| `delivery-target` | 用户没说明要 demo、最小可玩还是较完整首版 | Strategy 不知道该按 `prototype / playable-mvp / feature-complete-lite` 哪种标准收敛 |
| `cut-preference` | 用户说了很多功能，但没说超预算时先砍什么 | 可能错误地先砍用户最在意的系统 |
| 引用型需求版本差异 | “做个 roguelike / 类暗黑 / 像 vampire survivors” | `@system`、`@rule`、`@check` 的规模会差很多 |

**3D / 2D 维度识别（新增）**：

默认 `is-3d: false`（2D），仅当用户 query 明确命中以下**任一**信号时置为 `is-3d: true`：

- 明确关键词：「3D」「three.js」「Three.js」「WebGL」
- 视角/玩法描述：「第一人称」「俯视 3D」「伪 3D」「立体」
- 3D 品类引用：「3D 平台跳跃」「3D 赛车」「3D FPS」「3D 走迷宫」「3D 模型」
- 用户上传 `.glb` / `.gltf` / `.fbx` / `.obj` 素材

**处理规则**：
- 命中 → 置 `is-3d: true`，引擎候选**仅限** `three`（2D 引擎不在候选中）
- 未命中 → 置 `is-3d: false`，引擎候选为 `phaser3 / pixijs / canvas / dom-ui`（`three` 不在候选中）
- 用户描述模糊（例如只说"立体感"但未提 3D）→ 触发 clarify 模板 8 二选一

这个维度必须在 ClarifiedBrief 中显式记录为 `is-3d: true|false`，供 Phase 2 回写到 GamePRD front-matter。

**Clarify 触发条件**：

- 以上 6 项中 **2 个及以上**无法合理推断 → 走 clarify（读 `clarify.md`）
- 或功能优先级不清：`must-have-features` / `delivery-target` / `cut-preference` 任一无法合理推断
- 或用户写了 3 个及以上显式系统，但没有说明本次哪些必须保留
- 或用户的**强约束/硬规则**（"禁止 / 必须 / 一定要"）与当前 runtime 能力矛盾 → 走 clarify
- 否则直接写 ClarifiedBrief 段，进入 Phase 2

### Step 3：生成 `docs/brief.md`

模板：

```markdown
# Brief: {项目名}

## Raw Query
<用户原始输入的逐字复制>

## Inferred
- genre: {enum}
- platform: [web]
- mode: 单机
- reference-games: [<如有参考>]
- hard-rules: [<用户 prompt 里的"禁止/必须/强约束"逐条列出>]
- interaction: [<如"click-only" / "keyboard-arrow" / "drag">]
- assets-hint: <用户提到的资源，如"默认词库"、"像素风"等>
- is-3d: false   # 默认 2D；仅当用户明确 3D/Three.js/第一人称/3D 模型时改 true

## Gaps
- {gap-1}: <为什么还不确定>
- {gap-2}: ...

## ClarifiedBrief  （若无 gap 直接填；有 gap 先 clarify 再回填）
- genre: edu-practice
- platform: [web]
- mode: 单机
- core-loop: "进入关卡 → 限时配对 → 结算 → 下一关"
- player-goal: "限时内完成所有卡片配对并通关"
- must-have-features: ["点击配对", "3关卡递进", "结果页可重试/下一关"]
- nice-to-have-features: ["连击加分", "卡片翻转动画"]
- delivery-target: feature-complete-lite
- cut-preference: "先缩内容量，不先砍核心系统"
- constraints:
  - mvp-boundary: "不含登录、排行榜、班级管理"
  - hard-rule: <若有>
- suggested-runtime: dom-ui   # 仅建议，由 Phase 2 末尾 strategy 正式回写
- is-3d: false                # 与 Inferred 保持一致；Phase 2 回写到 front-matter
- mvp-cut: ["暂不做登录", "暂不做自定义词库"]
- project-slug: word-match-lite
```

### Step 4：决策

- **无 gap**：写出 ClarifiedBrief 段 → 进入 Phase 2
- **有 gap**：按 `clarify.md` 提问，把用户回答写回 ClarifiedBrief 段 → Phase 2
- **若必填字段能推断，但功能优先级/交付档位不清**：仍然必须走 clarify，不能直接默认最小 MVP
- 更新 `state.json` 的 `understand.status = "completed"`

---

## 强约束识别（特别重要）

用户 prompt 中出现下列词或等价表达时，**必须原样收集到 `hard-rules`**，不得改写/精简：

- 「**必须**」「一定要」「强制」
- 「**禁止**」「不得」「不要做成」
- 「不能」「严格体现」
- 编号规则（"9×5 网格"、"6 波关卡"、"3 个职业"）

这些条目在 Phase 2 会落到 `@constraint(kind: hard-rule)` + 关联 `@check(layer: product)`，Phase 5 Playwright 会做硬断言。

---

## 功能优先级识别（特别重要）

用户 prompt 中明确点名的系统，默认按以下原则处理：

- 若用户说“必须有 / 一定要 / 核心就是” → 直接记入 `must-have-features`
- 若用户列了多个功能但没分级 → 触发 clarify，不得默认全部降成可选
- 若用户只说“先做个 demo / 原型 / 验证玩法” → `delivery-target = prototype`
- 若用户是一句短 query，没强调完整度 → 可默认 `delivery-target = playable-mvp`
- 若用户给了长规格、多个系统、明确参考对象 → 默认优先推断为 `feature-complete-lite`

Phase 2 strategy 只能在这些优先级之上做收敛，**不能静默删除 `must-have-features`**。

---

## 输出清单

- [ ] `docs/brief.md` 存在且含 Raw Query / Inferred / Gaps / ClarifiedBrief 四段
- [ ] 所有 hard-rule 都已记录
- [ ] 无 gap 或 clarify 对话已完成
- [ ] `.game/state.json` 的 `understand` 阶段 status = completed
