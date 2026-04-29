# Game APRD 格式规范

Game APRD（Annotated PRD for Games）是小游戏专用链路的**唯一事实源**。格式目标：**机器可精确提取，人可直接阅读**，所有下游 skill（strategy / expand / codegen / verify）都围绕这份文档工作。文件名固定为 `docs/game-prd.md`。

本格式沿用 APRD 的语法（`@tag(id)` + `> key: value` + 正文 + 固定章节），对象体系替换为小游戏对象集。

---

## Front-matter

```yaml
---
game-aprd: "0.1"
project: word-match-lite-002              # 必须含数字/时间戳后缀，避免重名
platform: [web]                           # web / mobile / [web, mobile]
runtime: dom-ui                           # phaser3 | pixijs | canvas | dom-ui | three
is-3d: false                              # 默认 false；true 必须配合 runtime: three
mode: 单机                                # 单机 | 联机 | AI 对战 | 本地双人
need-backend: false
language: zh-CN
color-scheme:                             # Phase 2 从 brief/theme-keywords 自动推断，硬值来自 color-palettes.yaml
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
delivery-target: feature-complete-lite    # prototype | playable-mvp | feature-complete-lite
must-have-features: [点击配对, 3关卡递进]  # 用户这一版明确要求保留的功能
nice-to-have-features: [连击加分, 翻牌动画]
cut-preference: 先缩内容量，不先砍核心系统
support-level: 直接支持                   # 直接支持 | 降级支持 | 暂不支持（Phase 2.x strategy 回写）
engine-plan:                              # Phase 2.x strategy 回写
  runtime: dom-ui
  reason: "教育练习型 + 点击交互 + 无实时循环，DOM 最稳"
  version-pin: "@tailwindcss/browser@4"
mvp-scope: []                             # Phase 2.x strategy 回写：当前版本收敛的功能点
risk-note: []                             # Phase 2.x strategy 回写：已识别的风险

# LLM 必须在 Phase 2 按 "asset-strategy 决策脚手架" 填写。下游所有 asset check 脚本都读这段动态决定行为。
asset-strategy:
  mode: library-first                     # library-first | generated-only | none
  rationale: >                            # ≥ 80 chars；解释：玩家分辨什么？纯生成视觉能否支撑玩法？核心实体是谁？
    颜色差异决定攻击判定，像素风格决定沉浸感；核心单位必须用素材库以保证辨识度。
    hud / 背景可 generated，但要与核心素材风格匹配。
  visual-core-entities:                   # 必须有清晰视觉表达的 @entity/@ui id；每个 id 必须在 PRD 定义
    - pig
    - block
  visual-peripheral:                      # 允许 generated/inline-svg 的外围元素
    - hud-timer
    - scene-background
  style-coherence:
    level: strict                         # strict (pack ≥ 85%) | flexible (pack ≥ 50%) | n/a (跳过)
    note: "核心实体同一 pack；背景独立生成但需配色一致"

artifacts:
  scene-spec: specs/scene.yaml            # Phase 3 产出
  rule-spec: specs/rule.yaml              # Phase 3 产出
  data-spec: specs/data.yaml              # Phase 3 产出
  asset-plan: specs/assets.yaml           # Phase 3 产出
  event-graph: specs/event-graph.yaml     # Phase 3 产出
  implementation-contract: specs/implementation-contract.yaml # Phase 3 产出
  game: game/                             # Phase 4 产出目录
---
```

**字段约束**：

- `game-aprd` 固定字符串版本号，当前 `"0.1"`。
- `project` **必须**含数字/时间戳后缀（如 `-002` 或 `-2026-04-24-120530`），避免撞车覆盖 `cases/` 下已有目录。
- `runtime` 取值**必须**来自 `references/engines/_index.json` 中登记的引擎 id。允许扩展，但新引擎必须先挂到 _index.json。
- `is-3d` 默认 `false`（绝大多数 Web 小游戏是 2D）。置为 `true` 的两个硬性条件：
  - 用户在 query 中**明确**提出 3D、Three.js、第一人称、俯视 3D、3D 模型等需求
  - 同时 `runtime` 必须设为 `three`；反之 `runtime: three` 要求 `is-3d: true`
  - 检查脚本会校验这两项一致性，不一致直接 `FM016` error。
- `color-scheme` 是必填结构，由 Phase 2 从 brief / 用户 query 的 `theme-keywords` 匹配 `references/common/color-palettes.yaml` 后写入。`palette-id` 必须存在于色板库，且必须复制完整硬值：`primary` / `secondary` / `accent` / `background` / `surface` / `text` / `text-muted` / `success` / `error` / `border` / `font-family` / `border-radius` / `shadow` / `fx-hint`。下游 codegen 只消费这些硬值，禁止自行发明配色。
- `delivery-target` 建议显式填写：`prototype` / `playable-mvp` / `feature-complete-lite`。长规格、重功能需求默认建议 `feature-complete-lite`。
- `must-have-features` 建议显式填写，避免 Phase 2 strategy 默认走最小闭环。
- `cut-preference` 用来告诉 strategy：超预算时先缩什么，默认推荐“先缩内容量，不先砍核心系统”。
- `support-level`、`engine-plan`、`mvp-scope`、`risk-note` 在 Phase 1 初始生成时可留空（`-` 或 `[]`），由 Phase 2.x strategy 回写。
- `platform` 默认 `[web]`；小游戏大多跑在 Web/webview，`mobile` 仅在明确移动端原生时使用。
- `need-backend` 默认 `false`；一旦为 `true`，需另出 `@api` / `@service` tag（本 V0 不强求）。

---

## Tag 语法

```
### @tag-type(id) 显示名称
> attr1: value
> attr2: [val1, val2]         # 多值用方括号
> attr3: -                    # 半角 - 表示「无」

正文自然语言描述...
```

- tag 必须在 Markdown 标题中（`##` `###` `####`）
- `> key: value` 行紧跟标题，遇空行或非 `>` 行停止
- 跨 tag 引用：`@scene(play)`、`@rule(match-check)` 等内联语法
- **所有属性值只用半角 ASCII 符号**（冒号、方括号、竖线、短横）——全角符号会让校验脚本误判

---

## 对象体系（核心）

| Tag | 必填属性 | 可选属性 | 说明 |
|-----|---------|---------|------|
| `@game(id)` | `genre`, `platform`, `runtime`, `mode`, `core-loop`, `player-goal` | `support-level`, `controls`, `scenes`, `states`, `levels`, `resources` | 游戏根对象；`genre` 必须是 9 大类 enum（见下），`runtime` 取值 `phaser3\|pixijs\|canvas\|dom-ui\|three`（或 `_index.json` 已登记的新引擎 id） |
| `@flow(id)` | `entry`, `main-scene`, `exit` | `involves` | 主玩法流程，节点引用 `@scene/@state/@rule` |
| `@scene(id)` | `entry` | `layout`, `inputs`, `ui`, `state-on-enter` | 场景（start/play/result/pause 等） |
| `@state(id)` | — | `on-enter`, `on-exit`, `transitions` | 状态机节点 |
| `@entity(id)` | `type` | `fields`, `scene`, `spawn-rule` | 实体（卡片/玩家/敌人/子弹） |
| `@rule(id)` | `trigger`, `effect` | `scope`, `priority` | 规则（匹配/胜负/扣时/得分） |
| `@input(id)` | `device`, `targets` | `bindings` | 输入（click/drag/key/swipe） |
| `@ui(id)` | `scene`, `role` | `binds`, `position` | HUD / 按钮 / 倒计时等 |
| `@system(id)` | `depends`, `outputs` | `tick`, `config` | 系统级逻辑（经济/掉落/题库/AI） |
| `@level(id)` | `difficulty` | `resources`, `params`, `unlock-after` | 关卡 |
| `@resource(id)` | `type`, `source` | `schema`, `count`, `format` | 资源（词库/图集/音频/关卡表） |
| `@constraint(id)` | `kind` | `value`, `severity`, `mechanics-scope` | 平台/性能/MVP/强约束；kind ∈ `platform\|perf\|mvp-boundary\|hard-rule` |
| `@check(id)` | `layer` | `method`, `expect` | 验收检查点；layer ∈ `engineering\|product\|requirement` |

**device 取值**：`click`、`tap`、`drag`、`key`、`pointer`、`swipe`、`gesture`、`timer`

**genre 取值（@game.genre，9 大类枚举）**：
- `board-grid`：棋盘/格子规则型（俄罗斯方块、贪吃蛇、五子棋、Pixel Flow）
- `platform-physics`：控制闯关/物理型（马里奥、平台跳跃、物理解谜）
- `simulation`：经营养成型（电子宠物、clicker、idle）
- `strategy-battle`：策略战斗型（塔防、卡牌、回合制 RPG、Roguelike）
- `single-reflex`：单屏反应型（打地鼠、飞机大战、接球、打砖块）
- `quiz-rule`：规则问答型（猜数字、谜题、测验）
- `social-multi`：多人社交型（联机对战、你画我猜）
- `edu-practice`：教育练习型（单词消消乐、数学练习、闪卡）
- `narrative`：剧情互动型（AVG、选择树、文字冒险）

Phase 2.x strategy 会根据 `genre` 去 `_index.json.best-fit` 匹配推荐引擎（不替代人工拍板）。

**type 取值（@entity）**：`card`、`player`、`enemy`、`npc`、`tile`、`projectile`、`pickup`、`prop`、`trigger`

**kind 取值（@constraint）**：
- `platform`：平台约束（web-only、需要 WebGL、不支持 iOS Safari 等）
- `perf`：性能约束（帧率、内存、首屏时间）
- `mvp-boundary`：当前版本不做的功能
- `hard-rule`：用户 prompt 中明确的**禁止**/**必须**项（Pixel Flow prompt 的「禁止全屏自动索敌」属于此类，Phase 4 codegen 必须落到校验）

**mechanics-scope 取值（@constraint，可选但推荐）**：
- `mechanics`：该 hard-rule 是玩法/规则语义，必须映射到 `mechanics.yaml.invariants`，例如 `no-global-autoaim`、`no-penetration`、`grid-size`。
- `non-mechanics`：该 hard-rule 是交付边界或周边功能禁用，不进入 mechanics DAG，例如 `no-sound`、`no-leaderboard`、`no-multi-level`。它仍需在产品/工程检查中覆盖，但 `check_mechanics.js` 不强制映射。

**layer 取值（@check）**：
- `engineering`：工程侧（是否启动、首屏无报错、核心循环跑得起来）
- `product`：产品侧（玩法闭环、规则正确、反馈清晰）
- `requirement`：需求侧（是否覆盖用户指定内容）

---

## 固定章节顺序

`docs/game-prd.md` 必须按此顺序组织；`check_game_prd.js` 通过章节标题严格校验：

```
# <项目名> Game PRD

## 1. 项目概述              ← @game(main)
## 2. 目标玩家与使用场景
## 3. 核心玩法边界与 MVP 定义  ← 历史标题保留；当前用于表达“本次交付边界 + 功能优先级”
## 4. 主干流程              ← @flow(...)
## 5. 场景规格              ← @scene(...)
## 6. 状态与实体            ← @state(...) / @entity(...)
## 7. 规则与系统            ← @rule(...) / @input(...) / @ui(...) / @system(...)
## 8. 资源与数据            ← @resource(...) / @level(...)
## 9. 运行方式与框架策略    ← 正文描述 runtime 选择原因；Phase 2.x strategy 回写
## 10. 校验点与验收标准     ← @check(...) / @constraint(...)
## 11. 可选扩展             ← 不在 MVP 内的字段（排行榜/登录/联机等）
```

允许省略 §11（无扩展时）；其他章节**必须存在**，即使为空也要留标题 + 一句「本版暂无」说明，便于后续迭代定位。

---

## 常见写法示例

### @game 根对象

```
### @game(main) 单词消消乐
> genre: edu-practice
> platform: [web]
> runtime: dom-ui
> mode: 单机
> player-goal: "在限时内完成所有英文-中文配对，通关全部关卡"
> core-loop: [@flow(play-round)]
> scenes: [@scene(start), @scene(play), @scene(result)]
> states: [@state(ready), @state(playing), @state(win), @state(lose)]
> levels: [@level(level-1), @level(level-2), @level(level-3)]
> resources: [@resource(default-word-bank)]
> controls: [@input(click-card)]

面向小学生英语初学者的轻量网页小游戏……
```

### @flow 主流程

```
### @flow(play-round) 单局
> entry: @scene(start)
> main-scene: @scene(play)
> exit: @scene(result)
> involves: [@scene(start), @scene(play), @rule(match-check), @scene(result)]

玩家进入开始页点击开始……
```

### @scene 场景

```
### @scene(play) 主玩法页
> entry: false
> layout: grid-two-column
> inputs: [@input(click-card)]
> ui: [@ui(hud-timer), @ui(hud-score), @ui(card-grid)]
> state-on-enter: @state(ready)

玩家在这里完成主要的配对操作……
```

### @rule 规则

```
### @rule(match-check) 配对判定
> trigger: "玩家在 play 场景选中两张分属不同区域的卡片"
> effect: "match-success → 消除 + 加分 + 连击 +1；match-fail → 翻回 + 扣时 + 连击清零"
> scope: @scene(play)
> priority: 1

系统检查这两张卡片是否属于同一组……
```

### @constraint 强约束（Pixel Flow 风格）

```
### @constraint(no-global-autoaim) 禁止全屏自动索敌
> kind: hard-rule
> mechanics-scope: mechanics
> severity: critical

攻击必须严格依赖「小猪当前所在位置」，不得做成全屏自动寻找同色块。Phase 4 生成的代码必须体现这一点；Phase 5 Playwright 断言需验证玩家无法通过一次派出清空全屏同色。
```

非玩法 DAG 的禁用项要显式标注：

```
### @constraint(no-sound) 禁止音效
> kind: hard-rule
> mechanics-scope: non-mechanics
> severity: critical

本版本不添加音效素材或播放逻辑。该约束由 asset/code/compliance gate 检查，不映射到 mechanics.yaml.invariants。
```

### @check 检查点

```
### @check(playable-loop) 主循环可玩
> layer: product
> method: "Playwright 打开 game/index.html → 点击开始 → 完成至少一轮配对 → 查看结算页"
> expect: "window.gameState.phase 最终进入 win 或 lose；得分有数值"

玩家可以从开始页进入主玩法页，并完成至少一轮配对与结算。
```

**`@check.id` 的强约束**：
- 必须是 kebab-case，**全文档内唯一**（profile skeleton / check_playthrough 的反向绑定 key）
- 一旦 PRD 公开，id 视为稳定契约：改名等于破坏下游 profile 的 `check_id` 绑定，会触发 `⚠ profile-drift` 警告
- 如果确实要改 check 语义，优先废弃旧 id 再新增一条（用 `> deprecated: true` 标注），不要直接 rename

**`@rule.effect` 的字段语义约束（P2-2 新增）**：
- `effect` 里引用的**每个 `<subject>.<field>` 形式**（例如 `player.hp`、`attacker.critMult`、`boss.phase`），只要 `<subject>` 是已声明 `@entity` id 或其常见别名（`attacker`/`target`/`self`/`me`/`opponent` 等自动映射到对应 `@entity`），`<field>` 必须在 `@entity.fields` 中声明过。否则 `check_game_prd.js` 会报 `RL004` warning。
- 设计原因：历史 case 中反复出现 "PRD 里写 `boss.atkSpeed`、另一份 PRD 写 `boss.attackSpeed`、codegen 看到什么用什么" 这种漂移，导致 Phase 5 的 profile 断言失配。让字段名从 PRD 阶段就被强校验。
- 修复建议：
  - 若字段合法，在对应 `@entity(X).fields: {...}` 中补齐它（例如把 `critMult` 声明进 `@entity(player).fields`）
  - 若字段名打错，改 effect 用声明过的字段名
  - 若字段是 Phase 4 codegen 的视觉/渲染中间态（比如 `target.flashWhite`、`target.sprite`），**不应该**写进 rule.effect，改用 `visual:` 段描述

---

## 符号规范（严格）

**所有属性值只能用半角 ASCII 符号**。全角符号会让 `check_game_prd.js` 的正则解析提前终止，误报大量「缺少必填属性」错误。

| 场景 | ✅ 正确 | ❌ 禁止 |
|------|--------|---------|
| 无值标记 | `> params: -` | `> params: —`（全角破折号）、`> params: ──` |
| 枚举分隔符 | `enum(a\|b\|c)` | `enum(a｜b｜c)`（全角竖线） |
| 冒号 | `> key: value` | `> key：value`（全角冒号） |
| 括号 | `@scene(play)` | `@scene（play）`（全角括号） |
| 方括号 | `> scenes: [@scene(a)]` | `> scenes：【@scene（a）】` |

`check_game_prd.js` 兼容 `-`、`—`（U+2014）、`–`（U+2013）、`none` 作为「无值」标记，但**生成时仍应使用半角 `-`**。

---

## 跨引用规则

- **`@flow.involves`、`@game.scenes/states/levels/resources/controls`、`@scene.inputs/ui`、`@rule.scope`** 等属性中出现的每个 `@tag(id)` 引用，**必须**在文档其他位置有对应的 `### @tag(id)` 定义。
- `check_game_prd.js` 会扫描所有引用并校验，缺失引用报 error。
- 允许引用同类 tag（如 `@rule(match-check)` 引用 `@scene(play)`），但不得形成循环依赖（同 tag 类内部 A→B→A）。

---

## 写作强约束

1. **交付边界清晰**：§3 必须明确 `must-have / nice-to-have / deferred`，而不只是“最小闭环做什么”。
2. **强规则显式化**：用户 prompt 中所有「禁止/必须/强约束」都必须落到 `@constraint(kind: hard-rule)`，且关联 `@check(layer: product)`。如果该约束不描述玩法 DAG 行为，必须写 `mechanics-scope: non-mechanics`，避免 Phase 3 强行映射不存在的机制。
3. **可校验优先**：每个 `@rule` 都应该可通过 Playwright + `window.gameState` 观察到效果；不能仅用自然语言描述。
4. **runtime 一致**：`@game.runtime` 必须与 front-matter `runtime` 一致，且与 `engine-plan.runtime`（Phase 2.x 回写后）一致。
5. **章节空可以，缺席不行**：即使某章节本版暂无内容，也必须保留标题 + 一句「本版暂无 X，后续可接入 Y」，防止章节顺序错位。
6. **`@rule.effect` 必须伪代码风格**（下一节详述），否则 Phase 3 Expand 无法无损地把 rule 展开为可执行逻辑。
7. **不得静默删核心功能**：`must-have-features` 中的功能若无法交付，必须在 `risk-note` 中写明，并在 Phase 2.x strategy 阶段显式降级或回问用户。

---

## @rule.effect 伪代码约定（强制）

`@rule.effect` 是 Phase 3 Expand 和 Phase 4 Codegen 的直接输入，模型会根据它生成代码。**禁止散文**，必须用伪代码风格，让 LLM 近乎一一对应翻译。

### 格式要求

1. 用 ` → ` 表示 then（全角箭头或半角 `->` 都可，但单 PRD 内统一）
2. 用 `;` 分隔并列的效果步骤
3. 用 `==` / `!=` / `>=` / `<=` / `>` / `<` 表达比较
4. 用 `+=` / `-=` / `*=` / `= value` 表达状态变更
5. 变量名与 `state.*` 字段 或 `@entity(id)` 字段对齐（eg `player.hp`、`state.combo`、`card.matched`）
6. 分支用 `if <cond> → <action>；else → <action>`
7. 禁止出现「系统会 / 玩家感受到 / 给予友好反馈 / 优雅地 / ...」类型的感受性描述
8. 单条 `effect` 建议 ≤ 120 字符；超过时必须拆多条 `@rule`

### 长度超限时怎么办

如果一条规则实在表达不完，**拆成多个 `@rule` 对象**，用 `priority` 控制执行顺序，或用中间字段（如 `state.pendingEffect`）把它切成两步。

示例：暴风雪技能释放 → 持续造成范围伤害，可以拆成：

```
### @rule(cast-blizzard)
> trigger: "玩家按下技能键 2 且 state.mp >= 30"
> effect: "state.mp -= 30 ; spawn @entity(blizzard-aoe) at player.targetPos ; state.pendingEffect = blizzard-tick"

### @rule(blizzard-tick)
> trigger: "每 tick 且存在 active blizzard-aoe"
> effect: "for each enemy in aoe.range → enemy.hp -= 5 ; aoe.duration -= dt ; if aoe.duration <= 0 → remove aoe"
```

### 合法示例

```
> effect: "selected[0].pairId == selected[1].pairId → score += 10 ; combo += 1 ; selected.forEach(c → c.matched = true) ; if combo >= 3 → score += 5 ; else → state.timeLeft -= 3 ; combo = 0"
```

### 非法示例（禁用）

```
# ❌ 散文
> effect: "系统会检查卡片是否匹配，如果匹配就给玩家加分并消除两张卡片，否则翻回并扣除时间"

# ❌ 感受性描述
> effect: "给玩家一个正反馈，让他感觉配对成功"

# ❌ 用户要自行揣摩的模糊表达
> effect: "触发合适的逻辑"
```

---

## 与 coze_skill/appgen/APRD 的差异

| 维度 | appgen APRD | Game APRD |
|---|---|---|
| front-matter key | `aprd: "1.0"` | `game-aprd: "0.1"` |
| 核心对象 | `@web-page` / `@mobile-page` / `@api` / `@server-module` / `@feature` / `@data-model` / `@role` | `@game` / `@flow` / `@scene` / `@state` / `@entity` / `@rule` / `@input` / `@ui` / `@system` / `@level` / `@resource` / `@constraint` / `@check` |
| 章节顺序 | 产品概述→角色→功能→数据模型→API→页面 | 项目概述→玩家→MVP→流程→场景→状态实体→规则系统→资源→运行方式→校验 |
| 运行时字段 | `stack.server / web / mobile` | `runtime: phaser3\|pixijs\|canvas\|dom-ui` |
| 校验脚本 | `check_prd.js` | `check_game_prd.js`（复用解析框架） |

当前版本 Game APRD **不继承** `@role` / `@api` / `@server-module`——小游戏 V0 绝大部分无后端、无多角色权限。若后续需要（如排行榜、班级管理），再在 §11 可选扩展引入。
