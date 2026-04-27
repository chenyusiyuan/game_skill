---
name: game-phase-3-expand
description: "Phase 3: 规格展开（始终必做）。每次 codegen 前都把 GamePRD 的 @scene/@rule/@resource/@entity 展开为 specs/{mechanics,scene,rule,data,assets,event-graph,implementation-contract}.yaml，作为 Phase 4 的精确输入。"
---

# Phase 3: Expand（始终必做）

## 职责

把 GamePRD 的结构化信息**进一步展开**为更接近实现层的中间结构，让 Phase 4 codegen 有明确的数据 schema 可以直接用。**始终运行**，不做复杂度判断——原因：

1. LLM 从 markdown 直接 codegen 会做额外解释工作，错误面更大
2. yaml 是对 PRD 的无损拆解，可以让 codegen 子 agent 一次只关注一个维度
3. 简单游戏的 expand 成本也很低（先拆 mechanics，再并发 5 个 expander 产物）
4. 有 `specs/rule.yaml` 后，Phase 5 产品侧断言可以对照 yaml 定位失败点

**输出**：
- `specs/scene.yaml`：每个场景的布局、交互热区、UI 元素
- `specs/mechanics.yaml`：玩法 primitive DAG，作为 rule/event-graph/codegen 的语义基线
- `specs/rule.yaml`：每条 `@rule` 的展开伪代码
- `specs/data.yaml`：`@resource` 的 schema + 示例数据
- `specs/assets.yaml`：资源清单（图片 / 音频 / 字体）
- `specs/event-graph.yaml`：模块间的事件连接蓝图（inputEvent → outputEvent 映射）
- `specs/implementation-contract.yaml`：Expand → Codegen 的增强契约层，绑定 UI 语义、素材消费、引擎生命周期和验证证据

---

## 前置条件

- `docs/game-prd.md` 已通过 `check_game_prd.js`（包含 @rule.effect 伪代码检查）
- GamePRD 中 `@rule.effect` 已是伪代码风格——本阶段**不做翻译**，只做**拆解**
- `docs/spec-clarifications.md` 已存在。它由 Phase 2.5 `spec-clarify.md` 生成，记录功能机制澄清和默认假设；本阶段必须读取并遵守。

---

## 流程

### Step 1：extract_game_prd

```bash
node ${SKILL_DIR}/scripts/extract_game_prd.js docs/game-prd.md --list
```

输出：

- `SCENES`：所有 `@scene(id)` 列表
- `RULES`：所有 `@rule(id)` 列表
- `RESOURCES`：所有 `@resource(id)` 列表
- `ENTITIES`：所有 `@entity(id)` 列表
- `CONSTRAINTS`：所有 `@constraint(id)` 列表（重点挑 hard-rule）

### Step 1.5：读取 Spec Clarifications

```bash
test -f docs/spec-clarifications.md
```

若文件缺失，停止进入 Expand，回到 Phase 2.5。不要让 mechanic-decomposer 或 gameplay-expander 在没有机制澄清记录的情况下自行猜测。

### Step 2：子 agent 并发展开

**前置：读取 `references/common/game-systems.md` 的模块组合指南**，识别当前游戏需要的通用系统模块（§1-§16），在展开 RULE 层时引用对应模块的核心逻辑。

**事务语义**：先由 mechanic-decomposer 读取 `docs/spec-clarifications.md` 并写 `specs/.pending/mechanics.yaml`；5 份维度 yaml 继续写到 `specs/.pending/`；全部成功后，主 agent 用脚本生成 `implementation-contract.yaml`，也写到 `.pending/`。7 份全部通过 gate 后由主 agent 一次性 mv 到 `specs/`。子任务失败时保留 `.pending/` 下已成功的文件，下次恢复只重跑未完成部分。

同 turn 内发 5 个 `task_new`（agent_role = `gameplay-expander`），输出路径必须是 `specs/.pending/<dim>.yaml`：

```
task_new({
  task_id: "expand-scene",
  agent_role: "gameplay-expander",
  task: "展开 SCENE 层：为每个 @scene 生成 layout / interactive-zones / ui-slots，写 specs/.pending/scene.yaml"
})
task_new({
  task_id: "expand-rule",
  agent_role: "gameplay-expander",
  task: "展开 RULE 层：读取 docs/spec-clarifications.md，为每条 @rule 写 pseudocode (trigger/condition/effect)，引用 game-systems.md 对应模块的数据结构，写 specs/.pending/rule.yaml"
})
task_new({
  task_id: "expand-data",
  agent_role: "gameplay-expander",
  task: "展开 DATA 层：先从 PRD 的 @state/@entity 定义生成 initial-state（gameState 全部字段及初始值），再为每个 @resource 写 JSON schema 和 ≥ 3 条示例数据，写 specs/.pending/data.yaml"
})
task_new({
  task_id: "expand-assets",
  agent_role: "gameplay-expander",
  task: "展开 ASSETS 层：\n1. 根据引擎类型读取对应素材库 catalog：2D 引擎（phaser3/pixijs/canvas/dom-ui）读 assets/library_2d/catalog.yaml，Three.js 引擎读 assets/library_3d/catalog.yaml（**无论当前引擎是哪种，都必须执行此步骤**——素材选择与引擎无关，但素材库按 2D/3D 分开）\n2. 从 PRD front-matter 取出 color-scheme.palette-id 和 genre；genre 必须是 catalog.yaml 顶部 genres 枚举里的合法 id（否则视为 PRD bug，直接失败）。2D catalog 必须用 palette-style-aliases 将 palette-id 映射为 asset-style；若缺映射，视为 catalog 覆盖缺口直接失败。3D catalog 无 suitable-styles 时使用 lowpoly-3d 作为 asset-style。\n3. 候选包筛选（按优先级）：\n   a. 先查 catalog.style-genre-preferred 表，取 asset-style + genre 组合的首选包列表作为必选候选\n   b. 再遍历 packs：suitable-styles 命中 asset-style 或 [all]，且 suitable-genres 命中 genre 或 [all]，加入候选\n   c. 结果为候选包清单 C\n4. 选择具体文件：\n   - 语义文件名的包（naming='语义文件名'）：ls 目录按文件名选\n   - tile_XXXX 编号的包：读 catalog 中 index 字段指向的 _index.yaml，搜索关键词找到编号\n   - 需要某类语义元素（heart/coin/sword/button/panel 等）时，先查 catalog.semantic-hints 反向索引，在命中的包里挑，避免漏选或乱选\n   - **色块/目标块例外**：若 @entity/@ui 的语义是 色块/方块/目标块/color block，且玩法依赖 color 字段，必须输出 type: generated（或 graphics-generated/inline-svg）并写 visual-primitive: color-block；不要去 catalog 里挑 coin/gem/dungeon tile 之类具象素材。library-first 只作用于角色、UI、HUD、背景等真实素材槽，不覆盖抽象色块。\n5. **local-file 占比硬性门槛**：images 和 audio 中 type==local-file 比例必须 ≥ 30%（至少 UI 件和图标走 local-file）；仅当 catalog 里对应语义槽确实缺素材、或该语义本来就是抽象 color-block 时，才可用 inline-svg / graphics-generated / synthesized 补足；且必须在 selection-report 里写明原因\n6. **no-external-assets 约束的正确解读**（关键——不得误判）：\n   - PRD 中的 `@constraint(no-external-assets)` 仅禁止运行时从远程 CDN/HTTP 服务拉取资源（如 cdn.jsdelivr.net、googleapis.com 字体等），目的是让 `run-mode=file` 双击可运行、离线可用\n   - 项目仓库内 `assets/library_2d/` 与 `assets/library_3d/` 是**项目自包含**的本地资源（相对路径引用），不构成\"外部依赖\"，必须照常使用\n   - 遇到 no-external-assets 约束时，expander **禁止**据此把所有候选包 reject、把 images 设为 []；应正常走 local-file，反而把 google-fonts 这类远程字体替换为系统字体或 library_2d/fonts 本地字体\n   - 若 expander 产出的 assets.yaml 出现 \"images: []\"，视为误判，Phase 3 判 FAIL 要求整改\n7. 输出 specs/.pending/assets.yaml，末尾追加 selection-report 段，格式见 prd.md 后面的模板；每个候选包记录 {id, used: true|false, reason}，每个 type!=local-file 条目记录 {id, reason: 'catalog 缺对应语义 / 抽象 color-block 需要程序化生成 / 需要动态生成 / ...'}\n8. 路径规则：type==local-file 的 source 写项目根相对路径，2D 引擎如 assets/library_2d/ui-pixel/tile_0013.png，Three.js 引擎如 assets/library_3d/models/platformer/character.glb；禁止写 ../../../ 前缀（那是 codegen 的职责）"
})
task_new({
  task_id: "expand-event-graph",
  agent_role: "gameplay-expander",
  task: "展开 EVENT-GRAPH 层：读取 docs/spec-clarifications.md 和 game-systems.md 契约速查表，按已选模块的 inputEvents/outputEvents 生成事件连接蓝图，写 specs/.pending/event-graph.yaml"
})
```

子 agent 使用 `context: fork` 继承父 agent 上下文（含 GamePRD 内容）。

### Step 2.5：生成 Implementation Contract（不可跳过）

5 个 expander 维度产物都成功写到 `specs/.pending/` 后，主 agent 立刻生成增强契约层：

```bash
node ${SKILL_DIR}/scripts/generate_implementation_contract.js cases/${PROJECT}/ \
  --out specs/.pending/implementation-contract.yaml
```

`implementation-contract.yaml` 不是给 LLM 自由发挥的新文档，而是把前序 specs 收束成 codegen 必须遵守的机器契约：

- `runtime`：engine + run-mode
- `boot`：entry scene、ready condition、start action、scene transitions
- `asset-bindings`：每个素材绑定到什么 UI/游戏元素、是否文字承载、是否必须真实渲染、是否允许 fallback
- `engine-lifecycle`：引擎加载时序要求，例如 Phaser 必须在 `preload()` 阶段注册素材
- `verification`：report 只能引用 verifier 产出的运行时证据，不允许 LLM 自行解释错误

生成后用 `markSubtask(st, 'implementation-contract', 'completed', { output: 'specs/.pending/implementation-contract.yaml' })` 回写状态。

### Step 3：子任务状态回写

每个子 agent 返回后，主 agent 调 `_state.js` 的 `markSubtask` 更新状态（状态文件路径 `cases/<slug>/.game/state.json`）：

- 成功：`markSubtask(st, 'scene', 'completed', { output: 'specs/.pending/scene.yaml' })`
- 失败：`markSubtask(st, 'scene', 'failed', { error: '<摘要>' })`

任一失败 → 整个阶段标 failed：`markPhase(st, 'expand', 'failed')`，主流程停下报用户，**不得让 codegen 用部分产出**。

### Step 4：原子提交

所有 7 个 subtask 都 `completed` 后：

```bash
mv cases/${PROJECT}/specs/.pending/*.yaml cases/${PROJECT}/specs/
rmdir cases/${PROJECT}/specs/.pending
```

然后调 `commitExpand(st)`（会同时把 expand phase 标 completed 并写入 `outputs`）：

```bash
node -e "
import('./game_skill/skills/scripts/_state.js').then(m => {
  let st = m.readState('cases/${PROJECT}/.game/state.json');
  st = m.commitExpand(st);  // 内部校验 7 subtask 全 completed，否则抛错
  m.writeState('cases/${PROJECT}/.game/state.json', st);
})
"
```

### Step 4.5：Expand Gate Check（不可跳过）

原子提交后、进入 Phase 4 codegen 前，**必须立即运行素材选择 + implementation contract 双 gate**，在管线早期拦截素材选型和语义绑定错误：

```bash
node ${SKILL_DIR}/scripts/check_asset_selection.js cases/${PROJECT}/
node ${SKILL_DIR}/scripts/check_implementation_contract.js cases/${PROJECT}/ --stage expand
```

两条都 **退出码 0** 才能继续进入 Phase 4。常见拦截场景：
- expander 误读 `no-external-assets` 导致 `images: []`
- 选了语义不匹配的素材（如用按钮图片当卡片背景）
- contract 中把 local-file 注册成必须渲染，却允许静默 fallback
- contract 的 start-action target 或 scene-transition 指向不存在的 scene/zone
- genre/asset-style 与 catalog 不匹配
- local-file 占比不达标

**失败处理**：退出码非 0 → 整个 expand 阶段标 failed，回报具体错误项，要求修正 `.pending` 中对应 specs 后重新生成 contract。不得跳过此 gate 直接进入 codegen。

---

## yaml 格式示例

### specs/scene.yaml

```yaml
scenes:
  - id: start
    # layout 必须是对象，四段齐全（T15/L1）——codegen 按这些数值/比例渲染，避免首屏偏移
    # viewport: 目标画布或 body 尺寸（"full" = 100% × 100% / 具体 "1280x720" / {w,h} 对象）
    # board-bbox: 玩法主区域矩形；start/result 场景可用 "none"
    # hud-bbox: HUD 区域矩形；没有 HUD 的场景可用 "none"
    # safe-area: 所有关键 UI 必须落在的安全区，通常 "centered-80%" 或具体比例对象
    layout:
      viewport: "full"
      board-bbox: "none"
      hud-bbox: "none"
      safe-area: { x: "10%", y: "10%", width: "80%", height: "80%" }
      preset: center-stack      # 原 layout 字符串降级为 preset 标签（可选，供 codegen 参考）
    zones:
      - id: title-area
        shape: rect
        geometry: { x: "50%", y: "30%", width: "80%", height: "auto" }
      - id: start-btn
        shape: rect
        geometry: { x: "50%", y: "65%", width: 200, height: 60 }
    ui-slots:
      - { id: title-text, position: center, binds: "config.title" }
    state-on-enter: idle
    # 场景转场定义
    enter-transition:
      type: fade-in         # fade-in | slide-left | slide-up | zoom-in | none
      duration: 400
    exit-transition:
      type: fade-out
      duration: 300
    # 元素出场动画顺序（codegen 按此顺序添加 tween/CSS animation）
    enter-sequence:
      - { target: title-area, delay: 0, animation: "scale-bounce" }
      - { target: start-btn, delay: 200, animation: "fade-slide-up" }

  - id: play
    layout:
      viewport: "full"
      board-bbox: { x: "25%", y: "15%", width: "50%", height: "70%" }
      hud-bbox: { x: 0, y: 0, width: "100%", height: "10%" }
      safe-area: { x: "2%", y: "2%", width: "96%", height: "96%" }
      preset: grid-two-column
    zones:
      - id: card-grid-en
        shape: rect
        geometry: { col: 0, rows: "*", width: "50%" }
      - id: card-grid-zh
        shape: rect
        geometry: { col: 1, rows: "*", width: "50%" }
    ui-slots:
      - { id: hud-level, position: top-center, binds: "state.level" }
      - { id: hud-timer, position: top-right, binds: "state.timeLeft" }
      - { id: hud-score, position: top-left, binds: "state.score" }
    state-on-enter: ready
    enter-transition:
      type: fade-in
      duration: 300
    exit-transition:
      type: fade-out
      duration: 300
    enter-sequence:
      - { target: hud-level, delay: 0, animation: "fade-in" }
      - { target: hud-timer, delay: 0, animation: "fade-in" }
      - { target: hud-score, delay: 0, animation: "fade-in" }
      - { target: card-grid-en, delay: 100, animation: "stagger-fade-up" }
      - { target: card-grid-zh, delay: 200, animation: "stagger-fade-up" }

  - id: result
    layout:
      viewport: "full"
      board-bbox: "none"
      hud-bbox: "none"
      safe-area: { x: "10%", y: "20%", width: "80%", height: "60%" }
      preset: center-stack
    zones:
      - id: result-panel
        shape: rect
        geometry: { x: "50%", y: "40%", width: "70%", height: "auto" }
    ui-slots:
      - { id: result-title, position: center-top, binds: "state.isWin ? '恭喜通关!' : '时间到!'" }
      - { id: final-score, position: center, binds: "state.score" }
      - { id: retry-btn, position: center-bottom }
    state-on-enter: idle
    enter-transition:
      type: zoom-in
      duration: 500
    enter-sequence:
      - { target: result-title, delay: 0, animation: "scale-bounce" }
      - { target: final-score, delay: 300, animation: "count-up" }
      - { target: retry-btn, delay: 600, animation: "fade-slide-up" }

# 启动契约（codegen 必须严格遵守，verify 据此校验）
boot-contract:
  entry-scene: start                          # 游戏加载后的首个场景
  ready-condition: "window.gameState.phase === 'ready'"  # 启动完成的判定条件
  start-action:                               # 用户触发"开始游戏"的方式
    trigger: click                            # click | auto | keypress
    target: start-btn                         # scene.yaml 中的 zone id
    result: "phase → playing; scene → play"   # 触发后的状态变化
  # 场景转场路由（codegen 据此生成 scene manager / Phaser scene transition）
  scene-transitions:
    - from: start
      to: play
      trigger: "click start-btn"
      guard: "phase === 'ready'"              # 转场前置条件
    - from: play
      to: result
      trigger: "phase === 'win' || phase === 'lose'"
      guard: null
    - from: result
      to: play
      trigger: "click retry-btn"
      guard: null
```

**场景转场字段说明**：
- `enter-transition` / `exit-transition`：场景整体进入/退出动画，codegen 按引擎翻译（Phaser: scene transition / Camera fade；PixiJS: container alpha tween；DOM: CSS animation；Canvas: 手写 alpha 插值）
- `enter-sequence`：元素出场顺序，delay 控制错开时间（ms），animation 指定动画类型。codegen 应为每个元素创建**独立的 tween/animation 实例**（不共享参数——对应异步安全规范）
- 如果 PRD 没有指定转场，expand 应默认填 `fade-in` / `fade-out`，不留空

**boot-contract 字段说明**（`scene.yaml` 底部必须包含）：
- `entry-scene`：游戏加载完成后首先显示的场景 id
- `ready-condition`：JS 表达式，Phase 5 据此判断游戏是否启动成功
- `start-action`：用户如何触发"开始游戏"——codegen 据此绑定按钮/键盘事件，verify 据此写 profile 的第一条 assertion
- `scene-transitions`：所有场景间的转场路由，codegen 据此生成完整的场景管理器，verify 据此检查转场链路完整性
  - `guard`：转场前置条件（如 `phase === 'ready'`），codegen 必须在转场代码中检查此条件

### specs/rule.yaml

```yaml
rules:
  - id: match-check
    trigger: "selected.length == 2 && sides differ"
    condition: "selected[0].pairId == selected[1].pairId"
    effect-on-true:
      logic:                    # 纯状态变更（codegen 翻译为 gameState 操作）
        - "state.score += 10"
        - "state.combo += 1"
        - "selected.forEach(c => c.matched = true)"
        - "if state.combo >= 3: state.score += 5"
        - "check rule:win-check"
      visual:                   # 视觉反馈（codegen 翻译为引擎特效）
        - "particle-burst at selected positions, color: green"
        - "score float-text '+10' at match position"
        - "if combo >= 3: screen-shake intensity=2 duration=100ms"
        - "matched cards scale-down and fade-out 300ms"
    effect-on-false:
      logic:
        - "state.timeLeft -= 3"
        - "state.combo = 0"
        - "selected.forEach(c => c.selected = false)"
      visual:
        - "selected cards tint-flash red 200ms then restore"
        - "screen-shake intensity=3 duration=150ms"
        - "timer-hud pulse-red 400ms"
```

**rule.yaml 字段说明**：
- `effect-on-true.logic` / `effect-on-false.logic`：纯状态变更伪代码，codegen 直接翻译为 `gameState.xxx = yyy`
- `effect-on-true.visual` / `effect-on-false.visual`：视觉反馈描述，codegen 按引擎 guide 的特效 Cookbook 翻译。视觉描述使用标准化动词：`particle-burst`、`float-text`、`screen-shake`、`tint-flash`、`scale-bounce`、`fade-out`、`pulse`
- 拆分的好处：logic 部分可以直接对照 `@check` 写断言（只验状态不验动画），visual 部分可以对照特效分级做检查

### specs/data.yaml

```yaml
# gameState 初始值定义（codegen 必须完整搬入，不得遗漏字段）
initial-state:
  currentScene: "start"
  level: 1
  score: 0
  combo: 0
  timeLeft: 60
  totalPairs: 8
  matchedPairs: 0
  attempts: 0
  isWin: false
  isProcessing: false      # 异步锁（codegen 必须保留）
  selectedCards: []         # 当前选中的卡片

# 资源数据
resources:
  - id: default-word-bank
    schema:
      en: string
      zh: string
    examples:
      - { en: "apple", zh: "苹果" }
      - { en: "book",  zh: "书" }
      - { en: "cat",   zh: "猫" }
      - { en: "dog",   zh: "狗" }
      # ... 至少 24 条
```

**data.yaml 字段说明**：
- `initial-state`：**codegen 必须原样搬入** `window.gameState` 的初始值。每个字段都有明确类型和默认值，避免 LLM 遗漏或猜错初始值
- `isProcessing: false` 是异步锁的初始值，必须包含——对应代码架构规范中的异步间隙加锁要求
- `selectedCards: []` 等交互临时状态也要在此声明，让 codegen 和 verify 都知道有这个字段

**数值平衡校验段（必须包含）**：

expand 在生成 data.yaml 时，**必须**为每个关卡附带一段 `balance-check`，用于 codegen 和 verify 阶段的可玩性自检。这是通用规范，适用于所有有"资源消耗→目标完成"循环的游戏。

核心思想：**玩家可用资源总量 ≥ 通关所需消耗总量**，否则关卡设计不可通关。

```yaml
# 数值平衡校验（codegen 阶段和 verify 阶段都必须检查）
balance-check:
  # 通用公式：supply >= demand，否则关卡不可通关
  levels:
    - id: 1
      supply:                       # 玩家可用资源总量
        description: "4 只小猪 × 每只 2 次攻击 = 8 次总攻击"
        formula: "sum(unit.ammo for unit in available_units)"
        value: 8
      demand:                       # 通关所需消耗总量
        description: "12 个目标块 × 每块 1 次攻击 = 12 次总消耗"
        formula: "sum(block.hp for block in target_blocks)"
        value: 12
      verdict: "FAIL: supply(8) < demand(12)，玩家不可能通关"
      fix-suggestion: "增加小猪弹药至 3，或减少目标块至 8"
```

**通用 supply/demand 映射表**（expand 阶段根据游戏类型填写）：

| 游戏类型 | supply（玩家资源） | demand（通关需求） |
|---|---|---|
| 传送带/攻击类 | 单位数量 × 每单位弹药 | 目标块总血量 |
| 配对/消除类 | 可用配对次数 or 无限（限时） | 需消除的配对数 |
| 塔防类 | 初始金币 + 每波收益 | 全波敌人总血量 ÷ 塔输出 |
| 资源管理类 | 初始资源 + 产出速率 × 时间 | 目标所需资源总量 |
| 限时类 | 时间限制 × 每秒最大操作数 | 需完成的操作总数 |
| 教育/答题类 | 题库数量 | 通关所需正确数 |

**规则**：
- 每个关卡的 `balance-check` 必须有明确的 supply 值和 demand 值
- 若 supply < demand 的 **1.2 倍**（即容错余量不足 20%），标 `WARNING`
- 若 supply < demand，标 `FAIL`，expand 阶段必须修正后再输出
- codegen 阶段必须核对实际代码中的数值与 `balance-check` 一致

### specs/assets.yaml

```yaml
# color-scheme 由 Phase 2 从 brief 关键词自动推断；asset-style 由 catalog.palette-style-aliases 派生
genre: platform-physics             # 从 GamePRD front-matter 复制
color-scheme:                       # [新增] 从 PRD front-matter 复制
  palette-id: pixel-retro
  fx-hint: pixel
asset-style: pixel-retro            # 从 palette-id 映射得到，用于匹配 catalog.suitable-styles

# ── binding-to 规则（T8/L3 必读）──
# 每条 type: local-file 条目都必须声明 binding-to，值有两类：
#   A) PRD 中的 @entity(id) 或 @ui(id) 的 id —— 说明这个素材是该实体/UI 的视觉表达
#      codegen 会用它决定"哪个素材渲染在哪里"，verify 会用它决定"哪些素材必须真的被业务代码消费"
#      典型例子：btn-start → @ui(btn-start)；pig-red → @entity(pig)；block-red → @entity(block)
#   B) "decor" —— 纯装饰素材（背景音效、字体、转角贴图、点缀图等），不绑玩法
#      codegen 可选消费，verify 不强制
# 写错或漏写 binding-to 会让 check_asset_selection.js 直接 fail。
# 原则：尽量绑核心 @entity/@ui；写 decor 是退路，不要用它水通过——decor 超过 40% 会 warn。
#
# 色块/目标块规则：
# 如果 @entity/@ui 的语义是 色块/方块/目标块/color block，且玩法依赖 color 字段，
# 不要绑定具象 local-file 素材。应使用 generated/graphics-generated，并显式声明：
#   visual-primitive: color-block
#   color-source:    entity.color     # 颜色来自绑定实体的字段
# codegen 将用 PRD color-scheme 的色值画纯色格子、描边和耐久角标。
#
# ── visual-primitive 规则（P0.4 硬门禁）──
# binding-to 落在 asset-strategy.visual-core-entities 的视觉 asset 必须声明 visual-primitive，
# 值必须 ∈ 下面枚举；错写（如 btn / color_block）会被 check_asset_selection.js 直接 fail：
#   color-block / color-unit / colorable-token   —— 颜色来自玩法字段的抽象色块 / 单位 / 令牌
#   ui-button / ui-panel / ui-readout / ui-text-surface  —— UI 控件与文字承载面
#   background / grid / track / track-segment   —— 场景结构
#   icon / terrain-cell / decorative            —— 图标/地格/装饰
#
# color-source 字段（visual-primitive ∈ {color-block, color-unit, colorable-token} 时必填）：
#   entity.<field>    —— 从绑定实体的某个字段取色，如 entity.color
#   palette.<name>    —— 从调色板命名色，如 palette.primary
#   #rrggbb / rgb(..) —— 字面色值
# 这条约束保证 "同一个实体的颜色" 在 color-scheme / entity 字段 / asset 渲染之间有唯一真相源。

# ── 图片资源 ──
images:
  # 优先使用本地 Kenney 素材（相对于项目根目录）
  - id: btn-start
    source: assets/library_2d/ui-pixel/tile_0013.png    # 像素按钮左端(button_left)
    type: local-file
    binding-to: btn-start           # → @ui(btn-start)
    usage: "开始按钮（与 tile_0014 + tile_0015 拼成完整按钮）"
  - id: heart-full
    source: assets/library_2d/ui-pixel/tile_0031.png    # 满心(heart_full)
    type: local-file
    binding-to: hud-hearts          # → @ui(hud-hearts)
    usage: "HUD 生命值（满）"
  - id: heart-empty
    source: assets/library_2d/ui-pixel/tile_0033.png    # 空心(heart_empty)
    type: local-file
    binding-to: hud-hearts
    usage: "HUD 生命值（空）"
  - id: block-red
    source: generated
    type: generated
    binding-to: block
    visual-primitive: color-block
    color-source: entity.color                 # 色值来自 @entity(block).color
    usage: "红色目标色块（纯色格子，不绑定具象素材）"
  - id: pig-red
    source: assets/library_2d/ui-pixel/tile_0013.png
    type: local-file
    binding-to: pig
    visual-primitive: color-unit               # 小猪是"颜色单位"，本身有造型但颜色由字段决定
    color-source: entity.color                 # codegen 将用 tint/overlay 按 pig.color 染色
    usage: "小猪单位（本地素材 + 动态上色）"
  # 本地素材不足时，用 inline-svg 或 graphics-generated 补充
  - id: custom-bg
    source: inline-svg
    type: generated
    usage: "自定义游戏背景"
    svg: '<svg>...</svg>'

# ── 音频资源 ──
audio:
  - id: sfx-click
    source: assets/library_2d/audio/ui-clicks/click1.ogg
    type: local-file
    binding-to: decor               # 音效通常算装饰
    usage: "按钮点击音效"
  - id: sfx-success
    source: assets/library_2d/audio/ui-interface/confirmation_001.ogg
    type: local-file
    binding-to: decor
    usage: "配对成功音效"
  - id: sfx-error
    source: assets/library_2d/audio/ui-interface/error_001.ogg
    type: local-file
    binding-to: decor
    usage: "配对失败音效"
  # 无合适本地音效时，用合成音效
  - id: bgm-loop
    source: inline
    type: synthesized
    format: synthesized

# ── 字体 ──
fonts:
  - family: "Press Start 2P"
    source: google-fonts
  - family: "Kenney Future"
    source: assets/library_2d/fonts/Kenney Future.ttf
    type: local-file
    binding-to: decor               # 字体统一写 decor

# ── 精灵表（如使用 roguelike/pixel tilemap）──
spritesheets: []
  # - id: dungeon-tiles
  #   source: assets/library_2d/tiles/dungeon/tilemap_reference.png
  #   type: local-file
  #   frame-width: 16
  #   frame-height: 16

# ── 色板（从 color-scheme 复制，禁止自行发明）──
color-palette:
  primary: "#ef4444"
  secondary: "#facc15"
  success: "#22c55e"
  info: "#3b82f6"
  background: "#1a1a2e"

# ── 素材选型报告（必填，check_asset_selection.js 会读取）──
# 目的：让后续审查和校验知道为什么某个包没被用、某个条目为何走 generated
selection-report:
  genre: platform-physics
  candidate-packs:                  # 遍历 catalog 后的候选清单（包括未选的）
    - { id: ui-pixel-adventure, used: true,  reason: "pixel-retro + platform-physics 首选 UI 包，取按钮/面板/心/金币" }
    - { id: sprites-platformer-pixel, used: true,  reason: "主角与僵尸/骷髅精灵，风格完全对应" }
    - { id: tiles-platformer-pixel,  used: true,  reason: "4色地形 + 机关 + 敌人，覆盖整个关卡" }
    - { id: audio-sfx,               used: true,  reason: "跳跃/金币/受伤/碰撞音效" }
    - { id: audio-ui-clicks,         used: true,  reason: "按钮点击/悬停" }
    - { id: sprites-platformer,      used: false, reason: "风格不匹配当前色板" }
    - { id: cards,                   used: false, reason: "语义不匹配（非卡牌游戏）" }
  local-file-ratio:                 # 每类资源的本地素材占比
    images: 0.78                    # 78% 图片走 local-file
    audio:  0.85
    threshold:                      # 统一最低占比
      images: 0.60                  # pixel-retro 要求 ≥ 60%
      audio:  0.60
  fallback-reasons:                 # 所有 type!=local-file 条目的原因登记
    - { id: custom-bg,        type: generated,  reason: "需要按关卡动态换色，本地素材缺" }
    - { id: bgm-loop,         type: synthesized, reason: "无合适 bgm 本地素材，用 WebAudio 合成" }
```

### specs/event-graph.yaml

```yaml
# 描述模块间事件连接关系，codegen 据此生成 glue code
modules:
  - id: system.selection
    listens: [input.card-clicked]
    emits: [selection.changed, selection.full]

  - id: system.match
    listens: [selection.full]
    emits: [match.success, match.failed]

  - id: system.score
    listens: [match.success]
    emits: [score.changed]

  - id: system.timer
    listens: [match.failed]
    emits: [timer.tick, timer.end]

  - id: system.objective
    listens: [match.success]
    emits: [objective.completed]

  - id: system.winlose
    listens: [objective.completed, timer.end]
    emits: [game.win, game.lose]

  - id: system.feedback
    listens: [match.success, match.failed, game.win, game.lose]
    emits: [animation.play, sfx.play]

# 异步边界（codegen 必须在这些点加锁/解锁 isProcessing）
async-boundaries:
  - id: match-check-flow
    description: "选中两张卡 → 匹配判定 → 动画 → 恢复交互"
    entry-lock: "isProcessing = true"       # 在哪一步加锁
    exit-unlock: "isProcessing = false"     # 在哪一步解锁
    async-steps:                            # 中间的异步操作列表
      - "match animation (tween/CSS transition) ~300ms"
      - "result delay (setTimeout/delayedCall) ~500ms"
    danger: "如果在 animation 结束前不加锁，用户可以选第三张卡导致状态混乱"

  - id: scene-transition-flow
    description: "场景切换 → 淡出动画 → 清理旧场景 → 加载新场景 → 淡入动画"
    entry-lock: "isProcessing = true"
    exit-unlock: "isProcessing = false"
    async-steps:
      - "exit-transition animation"
      - "cleanup old scene objects"
      - "enter-transition animation"
    danger: "转场中途如果用户点击，会触发已销毁的对象"

# 需要暴露给 Playwright 测试的 API（codegen 必须实现，verify 据此校验）
test-hooks:
  # Canvas / Pixi / Phaser 引擎必须暴露（DOM 引擎可跳过，用 Playwright click 真实 DOM）
  required:
    - name: "window.gameTest.clickStartButton"
      description: "模拟点击开始按钮，触发 phase ready → playing"
    - name: "window.simulateCorrectMatch"
      description: "模拟一次正确配对，走真实的 selectCard → matchCheck 链路"
    - name: "window.simulateWrongMatch"
      description: "模拟一次错误配对，走真实的 selectCard → matchCheck 链路"
  recommended:
    - name: "window.gameTest.clickRetryButton"
      description: "模拟点击重试按钮"
    - name: "window.gameTest.getCards"
      description: "返回当前卡片列表（用于动态构造测试数据）"

# 悬空事件检查：每个 listens 必须有至少一个模块 emits 对应事件（input.* 除外）
# 孤立模块检查：每个模块至少有一个 listens 或 emits 与其他模块相连
```

---

## 失败处理

- 子 agent 某个任务失败 → 该 yaml 标 failed，**整个阶段 failed**（不得让 codegen 用部分产出）
- 阶段失败时 codegen **必须回退到读 GamePRD** 模式，或者拒绝 codegen 并要求用户手动修正

---

## 输出清单

- [ ] 7 份 yaml 均存在且语法合法（含 mechanics.yaml 与 implementation-contract.yaml）
- [ ] 每条 rule 有 trigger+condition+effect（effect 拆分为 logic + visual）
- [ ] 每个 scene 有 zones + ui-slots + enter-transition + enter-sequence
- [ ] scene.yaml 包含 boot-contract 段（entry-scene + ready-condition + start-action + scene-transitions）
- [ ] data.yaml 包含 initial-state 段，字段完整且类型明确
- [ ] event-graph 中每个 listens 事件都有对应 emits 来源（input.* 除外）
- [ ] event-graph 包含 async-boundaries 段（每个异步交互链路有 entry-lock + exit-unlock）
- [ ] event-graph 包含 test-hooks 段（Canvas/Pixi/Phaser 引擎的 required API 列表）
- [ ] assets.yaml 包含 selection-report 段（candidate-packs + local-file-ratio + fallback-reasons）
- [ ] assets.yaml 中 genre 是 catalog.yaml 顶部 genres 登记的合法 id
- [ ] implementation-contract.yaml 通过 `check_implementation_contract.js --stage expand`
- [ ] `state.json` `expand.status = "completed"`

---

## 附：Phase 5 Profile 生成指引

本阶段虽然不直接生成 profile，但展开的 specs 和 PRD 的 `@check` 条目是 Phase 5 profile 的来源。为确保后续校验不被架空，expand 阶段应在 `specs/rule.yaml` 中为每条规则标注**可测性标记**：

```yaml
rules:
  - id: match-check
    trigger: "selected.length == 2 && sides differ"
    condition: "selected[0].pairId == selected[1].pairId"
    testable: true
    test-hint: "通过 eval 直接操作 gameState.selectedCards 模拟选中，然后检查 score/combo 变化"
```

`test-hint` 字段帮助 Phase 5 快速生成有效的 profile assertion，避免只写出静态状态检查。

**规则：** 每条 `@rule` 如果在 PRD 中有对应的 `@check(layer: product)`，必须标注 `testable: true` 和 `test-hint`。
