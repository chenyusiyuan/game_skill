---
name: game-phase-1-semantic-clarify
description: "Phase 1 子步骤：语义澄清。对信息不够丰富的 query，主动向用户确认关键设计参数，并按需确认视觉风格，将回答写回 brief.md 的 ClarifiedBrief 段，丰富 Phase 2 的语义输入。"
---

# Phase 1.s: Semantic Clarify（语义澄清）

## 职责

在结构字段补齐之后、写 brief 之前，针对**用户描述不够详细**的场景，主动提问关键设计决策。与 `clarify.md`（补缺口）互补，本步骤关注的是"字段都有但语义不丰富"的情况。

---

## 触发条件

在 Step 2 扫描完 Gaps 之后判定。语义澄清只处理**低信息量或高分叉**的 query，不能因为"没写风格"单独触发。

满足以下任一组条件才触发：

- 用户 query **≤ 30 字**，且满足以下任一：
  - `must-have-features` 推断结果 ≤ 2 条
  - core-loop / 胜负条件只能粗略推断
  - 内容范围、关卡规模、难度机制至少 2 项无法合理推断
- 用户使用大型或多义参考对象，导致实现方向分叉明显（如"王者荣耀""原神""roguelike""赛车游戏""地牢游戏"）
- 用户点了多个系统但没说明优先级，且 clarify 问题少于 3 个，仍有提问额度补关键语义参数
- 风格会显著影响素材选择或玩法表达（如"围棋"可走棋盘木纹/水墨，"地牢"可走像素/暗黑），且结构字段已经清晰、本轮仍有提问空位

**不触发**的情况：

- 用户 query ≥ 80 字且已包含风格偏好、关卡数、难度等细节
- 用户明确说了"你来决定就好"/"随便"/"默认即可"
- query 虽未写风格，但玩法、范围、难度、内容量已经足够明确；此时 Phase 2 按 theme-keywords 自动推断 color-scheme

---

## 提问规则

### 总量与优先级

一次性提问，**总计最多 3 个问题**（与 clarify.md 的提问额度共享——如果 clarify 已经问了 2 个缺口问题，语义澄清最多只能再问 1 个）。

优先级排序（**结构先于风格**，避免风格占掉关键澄清槽位）：

```
P0  结构缺口补齐        — 必问（来自 clarify.md 的缺口问题）
P1  核心设计参数        — 有空位时问（内容量、难度机制、核心规则变体）
P1  视觉风格选择        — 仅在结构字段清晰且仍有空位时问
```

### 风格选择问题（P1，固定格式）

仅当以下条件同时满足时生成：
- 用户未明确风格偏好
- 不存在 `genre` / `core-loop` / 胜负条件这类高影响结构缺口
- 本轮 3 问额度仍有空位
- 风格选择会明显影响 `color-scheme` / `asset-style` / 素材候选

**生成方式**：从 brief 的 Inferred 段提取 theme-keywords，按 `visual-styles.md` 的打分规则对 `color-palettes.yaml` 全部色板打分，取 **Top-3** 作为选项。

**问题模板**：

```
问：你希望游戏是什么视觉风格？
  - A. {palette-1-name}（{一句话描述}）  ← 推荐
  - B. {palette-2-name}（{一句话描述}）
  - C. {palette-3-name}（{一句话描述}）
  - D. 其他（请描述你想要的风格，如"赛博朋克""日系清新""蒸汽朋克"等）
  - E. 让我决定（采用最匹配的推荐风格）
```

**示例**（query="做个单词消消乐"）：

```
问：你希望游戏是什么视觉风格？
  - A. 糖果休闲 — 粉蓝渐变底 + 圆角卡片 + 弹跳动画（推荐）
  - B. 校园清新 — 浅绿底 + 手写体 + 清爽配色
  - C. 方块消除 — 深色底 + 高饱和方块 + 硬边像素风
  - D. 其他（请描述你想要的风格）
  - E. 让我决定（采用最匹配的推荐风格）
```

**用户回答的处理**：

- 选 A/B/C → 将对应 `palette-id` 写入 brief 的 `style-preference` 字段，同时将色板关键词追加到 `theme-keywords`
- 选 D（自描述）→ 将用户描述文本写入 `style-preference`，同时提取关键词追加到 `theme-keywords`；Phase 2 打分时这些关键词会参与匹配，如果命中现有色板则使用，否则 fallback 到 `neutral-clean`
- 选 E / "让我决定" → 不写强偏好的 `style-preference`，仅把 Top-1 推荐色板的关键词追加到 `theme-keywords`；Phase 2 仍按正常打分自动决定

### 核心设计参数问题（P1，动态生成）

根据已推断的 `genre` + `core-loop`，**由模型判断该类游戏最影响最终效果的 1-2 个参数**，动态生成问题。

**生成原则**：

- 只问**影响内容量和核心体验**的参数，不问纯技术细节
- 每个问题提供 3-5 个选项（含推荐），格式与 `clarify.md` 的 AskUserQuestion 一致
- 选项应当覆盖"简单→丰富"的梯度，让用户有直觉
- 每个问题最后必须提供"让我决定"选项；用户选择后按 genre 默认策略回填，不再追问

**各 genre 的典型参数参考**（仅作为启发，不是固定列表）：

| genre | 典型参数 | 示例问题 |
|---|---|---|
| board-grid | 棋盘尺寸、关卡数 | "棋盘大小？8×8 / 10×10 / 自适应" |
| edu-practice | 内容范围、难度分级 | "词库范围？小学3年级 / 4年级 / 混合" |
| single-reflex | 速度曲线、生命数 | "难度递增方式？匀速加快 / 每10分加速 / 手动选难度" |
| platform-physics | 关卡数、操控方式 | "多少关？3关体验版 / 5关标准版 / 10关完整版" |
| simulation | 养成维度、内容深度 | "养成几个属性？饥饿+心情 / 加上健康 / 完整5维" |
| strategy-battle | 单位种类、回合数 | "有几种兵种？3种基础 / 5种含特殊 / 自定义" |
| narrative | 分支数、结局数 | "剧情分支？线性单结局 / 2个分支结局 / 多分支" |
| quiz-rule | 题目数量、题库来源 | "每局几道题？5题快速 / 10题标准 / 20题挑战" |
| social-multi | 玩家人数、交互方式 | "几人同屏？2人对战 / 4人派对 / 观战模式" |

**不要穷举**——如果 genre + core-loop 已经足够清晰（如"经典贪吃蛇"），且风格对素材选择影响不大，可以跳过功能参数，只让 Phase 2 自动推断风格。

---

## 输出

将用户回答回填到 `docs/brief.md` 的 `ClarifiedBrief` 段：

- **风格选择** → 用户明确选择 A/B/C/D 时新增 `style-preference` 字段；用户选"让我决定"时不写强偏好，仅追加 Top-1 推荐关键词到 `theme-keywords`
- **设计参数** → 追加到 `must-have-features` 或新增专属字段（如 `content-scope`、`difficulty-mode`）

Phase 2 必须按以下规则消费新增字段，不能只保留在 brief：

| ClarifiedBrief 字段 | GamePRD 落点 |
|---|---|
| `style-preference` / `theme-keywords` | front-matter `color-scheme.theme-keywords` 与 palette 打分 |
| `content-scope` | `@resource` / `@level` / §8 资源与数据 |
| `difficulty-mode` | `@rule` / `@level` / §3 MVP 边界 |
| 追加的 `must-have-features` | front-matter `must-have-features` 与 §3 must-have |

```markdown
## ClarifiedBrief
...
- style-preference: candy-pop          # 用户选择的色板 ID 或自描述文本
- theme-keywords: [单词, 消消乐, 教育, 糖果, 休闲]   # 原有 + 风格追加
- content-scope: "小学3-4年级词库，共60词"            # 语义澄清补充
- difficulty-mode: "3关递进，每关限时递减"             # 语义澄清补充
...
```

然后继续正常流程（写 brief → 引擎选择 → Phase 2）。

---

## 与 clarify.md 的关系

| | clarify.md | semantic-clarify.md（本文件） |
|---|---|---|
| 触发条件 | 必填字段缺口 ≥ 2 / 功能优先级不清 | query 信息量不足或高分叉（短 query / 大型参考对象 / 内容难度不清） |
| 问什么 | 结构字段缺口（genre、胜负条件等） | 核心设计参数 + 按需风格偏好 |
| 优先级 | P0（最高） | 功能参数 P1 / 风格 P1 |
| 提问额度 | 共享 3 问上限 | 共享 3 问上限 |
| 输出位置 | brief 的 ClarifiedBrief 段 | brief 的 ClarifiedBrief 段（同一位置） |

**合并提问**：如果 clarify 和 semantic-clarify 同时触发，将所有问题按优先级排序后合并为一次 AskUserQuestion，总计不超过 3 问。排序：结构缺口（P0）> 核心设计参数（P1）> 风格选择（P1）。

**时机约束**：当 `genre` / `core-loop` / 胜负条件仍高度不确定时，不生成 Top-3 风格推荐；先问结构问题。只有结构字段可推断，且本轮处理完更高优先级问题后仍有空位时，才把风格问题合并进同一轮。

---

## 不要做的事

- ❌ 在用户已经说了"像素风""暗黑风"等明确偏好时还问风格
- ❌ 问纯表现细节（字体大小、按钮颜色）——这些由色板决定
- ❌ 问技术实现（用什么框架、怎么加载资源）
- ❌ 一次问超过 3 个问题（含 clarify 的问题）
- ❌ 对已经很详细的 query（≥ 80 字 + 含风格偏好）还触发语义澄清
- ❌ 在风格选项中展示用户不太可能选的冷门色板（Top-3 已保证相关性）
