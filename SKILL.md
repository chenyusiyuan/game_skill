# mini-game Skill

## 一句话目标

stage1 用最朴素事实判定一次首轮生成是否成功：真实输入驱动、真实画面变化、真实 milestone、失败诚实停。worker 直接写 case-local Phaser/TypeScript 游戏；用一页 `plan.json` 表达主闭环和最低 acceptance 契约；用一个真实输入派发的 delivery smoke 验证主闭环。

`delivery-pass` 只表示 first-cut evidence pass：首轮产物能启动、接收真实输入，并产出主闭环机械证据。它不表示用户需求已最终完整验收；后续体验问题和局部 bugfix 进入首交付后的演进说明。Stage 1 不做局部 repair loop；delivery evidence 失败要诚实说明，但只要 preview health 可启动，就应交付试玩并引导用户继续提出 bug、需求新增、机制修改、手感/数值或素材/布局调整。

## Step 0

所有 case 放在 `cases/<PROJECT>/`。进入 Phase A 前运行：

```bash
node scripts/configure_eval_provider.js cases/<PROJECT> --provider openrouter-api --default-from-policy
node scripts/resolve_vision_policy.js cases/<PROJECT> --host-model <actual-host-model> --requested unknown
node scripts/check_step0_confirmed.js cases/<PROJECT>
node scripts/check_vision_policy.js cases/<PROJECT>
```

vision policy 对图片读取的硬边界：`visionMode=disabled` 或 `allowedImageInputs=none` 时，主 agent 不得打开、查看、截图后肉眼解读或传递任何 PNG/JPG/WebP/GIF，只能使用 state/DOM/console/pageerror、截图路径、文件大小、尺寸和像素统计等文本证据。

## Phase A

先完成 `cases/<PROJECT>/docs/DESIGN.md` 与 `cases/<PROJECT>/docs/decisions.md` A 段，再产 `cases/<PROJECT>/specs/plan.json`。`plan.json` 的基础结构仍由 `schemas/plan.schema.json` 校验；v1.1 的 `derivedFrom` anchor 闭环由 `scripts/validate_plan.js` 在 schema 通过后追加校验。

最小字段：

- `meta.caseId`
- `rawQuery`：原始用户需求
- `primaryLoop`：1-3 句人话描述主闭环
- `controls[]`：玩家输入到效果对照表
- `requiredMechanics[]`：主闭环包含的机制清单，仅声明，不约束 runtime
- `acceptance.mustHave[]`：rawQuery 的最低验收契约，不得为了易通过而缩水；每条用 `mechanicRefs[]` 覆盖 `requiredMechanics[].name`，并用 `evidence[]` 指向 smoke 证据
- `acceptance.mustNot[]`（可选）：后续演进 / 人工复核用的反例约束，stage1 v1 不做机械执行
- `winCondition`：胜利触发条件
- `loseCondition`（可选）
- `nonblockingTodos[]`（可选）：Stage 2-5 待迭代项
- `implementationPlan[]`（可选）：worker 自查用的文件行动清单
- `smoke.steps[]`：真实输入序列（keydown / press / wait / click）
- `smoke.expect[]`：canvas-change / milestone / state 三类 assertion

校验：

```bash
node scripts/validate_plan.js cases/<PROJECT>
```

校验失败：`generation-blocked: plan-invalid`。

smoke 设计规则：

1. `smoke.steps` 全跑完时，游戏必须仍处于主闭环可继续取证的状态，不能故意进入 lose 终态
2. 若 plan 有 `loseCondition`，smoke 序列必须避开它：缩短输入、降低等待时间，或用稳定的初始局面收集主闭环证据
3. `state` 类 expect 优先断言数值 / 计数字段（如 `score`、`lives`、`level`、`progress`），避免用 `gameState == "playing"` 这类 enum 状态作为唯一证据
4. `top_down` / platformer / tower_defense 等实时移动 smoke 必须是确定性短路径：目标沿同一条主输入路径线性摆放，一次只证明主闭环的最小进展，不把迷宫探索、多目标收集、战斗受伤、出口通关全部塞进长导航
5. 需求里混有导航 / 战斗 / 收集 / 伤害 / 胜利反馈时，Phase A 先选能稳定取证的最小闭环；其他体验项写入 `nonblockingTodos[]` 或拆成更短的 milestone evidence，不用长 smoke 赌路径碰巧走通

acceptance 反稀释规则：

1. 每个 `requiredMechanics[].name` 必须至少出现在一条 `acceptance.mustHave[].mechanicRefs[]`
2. 每个 `mechanicRefs[]` 都必须引用已声明的 required mechanic，禁止靠自然语言猜测
3. 每条 `mustHave.evidence[]` 必须被 `smoke.expect[]` 覆盖
4. 每条 `mustHave` 至少包含一个 milestone 或 state evidence，不能只靠 canvas-change
5. 单一 `mechanicRef` 的 `mustHave` 必须使用该机制专属的 milestone/state evidence；不能用无关宽泛事件证明，如用 `brick-destroyed` 证明 `powerup-system`

不能稳定取证的机制应拆分 smoke 取证，或诚实放入 `nonblockingTodos[]`，不要用弱 evidence 稀释最低验收契约。

evidence 匹配规则：

- `canvas-change`：`smoke.expect.minChangedPixels >= acceptance.evidence.minChangedPixels`，acceptance 缺省为 1
- `milestone`：同 id，且 `smoke.expect.minOccurrences >= acceptance.evidence.minOccurrences`，两边缺省为 1
- `state`：同 path、同 operator、同 value；v1 不做强弱推理

## Phase A v1.1 引导密度(必填,plan.json 之前先做)

### A.0 工作 todo 列表(建议,不强制)

接到 query 后，建议先用 `write_todos` / `TaskCreate` / 等价 checklist 列出 8-12 步工作清单，作为自己的执行可见性工具。它不是 gate，也不改变判定语义；没有 todo 工具时，按本 SOP 手动核对即可。

建议 checklist：

1. 读 query，保留 rawQuery 与显式需求
2. 识别 archetype；若适用，加载 primer
3. 写 `docs/DESIGN.md`，填完 4 个必填 anchor
4. 写 `docs/decisions.md` A 段，记录 5-15 条 Q&A
5. 写 `specs/plan.json`，为 `requiredMechanics[].derivedFrom` 绑定 DESIGN anchor
6. 跑 `node scripts/validate_plan.js cases/<PROJECT>`
7. 进入 Phase B 前确认 helper 使用策略与 rubric 维度
8. Phase B 写核心循环、milestone emit、state 暴露与可见反馈
9. Phase B 更新 decisions.md B 段，覆盖实现差异与风险
10. Phase C 跑 delivery smoke，读取 `qualityHints`
11. Phase C 可选写 retrospective，沉淀后续 Stage 2-5 backlog

### A.1 archetype 识别 + on-demand primer

写 `cases/<PROJECT>/docs/decisions.md` 时，A 段第一题记录 archetype 识别：

> **Q**: 用户 query 最接近哪个已知 archetype?
>
> **A**: <写明判断，标 from-reasoning>

若识别为 `{vampire-survivors, shooter, breakout, topdown, tower-defense}` 之一，建议运行：

```bash
node scripts/load_primer.js cases/<id> --archetype <X>
```

未知、不确定或不在 5 个内，不加载 primer；自行设计，并可在 decisions.md C 段记录是否需要新增 primer。

### A.2 写 docs/DESIGN.md(4 必填 anchor)

Phase A 先写 `cases/<PROJECT>/docs/DESIGN.md`，再写 `plan.json`。DESIGN 必须包含 4 个 anchor：

- `visualIdentity`：palette + motif
- `uiSurfaces`：primary / secondary / feedback
- `coreLoop`：primaryAction / successSignal / failureSignal / iterationFeel
- `mustAvoid`：至少 3 条，且必须包含 `default-purple-blue-orbs`

可选 anchor：`temporalShape`。

不要使用已废弃的 action-bias anchor 名。意象锚点要写成可视化的真实场景，而不是只写“暗黑风格”“科技蓝”这类抽象标签。

### A.3 plan.json `derivedFrom` 必填

`requiredMechanics[]` 每条必须有 `derivedFrom` 字段，引用 DESIGN.md 中实际存在的 anchor 路径。例：

```json
{
  "name": "auto-fire",
  "summary": "玩家武器自动开火",
  "derivedFrom": "coreLoop.primaryAction"
}
```

至少有一条引用以下稳定 anchor 之一：

- `visualIdentity.palette`
- `uiSurfaces.primary`
- `coreLoop.primaryAction`
- `mustAvoid.<具体禁忌>`

引用不存在的 anchor 时，按 `generation-blocked: design-anchor-missing` 处理，先修 DESIGN / plan 再进入 Phase B。

### A.4 写 decisions.md A 段(5-15 条 Q&A,来源标签)

`cases/<PROJECT>/docs/decisions.md` A 段写 5-15 条 Q&A，每条标来源：

- `from-query`：用户原文显式要求
- `from-genre-knowledge`：品类公约推断
- `from-reasoning`：临场设计判断

`from-query` 标出的核心要求必须进入 `plan.json.requiredMechanics[].name` 或 `acceptance.mustHave[].text`。如果降级到 `nonblockingTodos[]`，必须写明降级理由；否则进入 `scope-leak` warning。

### A.5 nonblockingTodos 0-8 灵活

- query 含明显扩展项时，建议写 3 条以上
- 不得把 `coreLoop.*` 核心循环、核心反馈、核心 UI 降级到 `nonblockingTodos[]`
- 上限 8 条；超过 8 条通常说明 Phase A 范围设计过大

## Phase B

worker 直接写 case-local 游戏。

开写代码前请先：

1. 读完 `specs/plan.json` 完整字段，不只看 `smoke.steps`
2. 对照 `acceptance.mustHave[]` 和 `mechanicRefs[]`，确认每个 required mechanic 都会在业务代码中真实落地
3. 把 `smoke.expect[].id` 列表抄进自己的 todo，确保业务 emit 的 id 与 plan 一致
4. 列 `implementationPlan[]`（如有）的文件清单作为 todos
5. 然后才开始写代码

如卡住，参考 `docs/known-issues.md`。禁止读 sibling case 源码，case 间隔离是硬约束，触发 `chain-blocked`。

允许写：

- `cases/<PROJECT>/specs/plan.json`
- `cases/<PROJECT>/game/src/main.ts`（覆盖 prepare 写的占位）
- `cases/<PROJECT>/game/src/scenes/**`、`systems/**`、`entities/**` 等业务子目录
- `cases/<PROJECT>/eval/known_todos.json`（仅非 primary 后续项）
- `cases/<PROJECT>/assets/**`、`cases/<PROJECT>/docs/**`

禁止写：

- `templates/**`、`scripts/**`、`schemas/**`
- `SKILL.md / AGENTS.md / README.md`
- `.gitignore`、`package.json`、lockfile、`cases/.gitignore` 等 repo metadata
- sibling case
- `cases/<PROJECT>/game/{index.html, package.json, tsconfig.json, vite.config.js}`：KEEP scaffold
- `cases/<PROJECT>/game/src/milestone.ts`：KEEP helper
- `cases/<PROJECT>/game/node_modules/**`

KEEP scaffold 由 prepare / check_delivery 从 `templates/scaffold/` 同步；不要靠改 case-local KEEP 文件修类型、依赖或入口问题。

worker SOP：

1. 不读 KEEP scaffold 模板源
2. 覆盖 `game/src/main.ts` 写真实 Phaser 入口；必须显式 `import Phaser from "phaser"`，并保留 `import './milestone'` 路径
3. 业务 milestone 用 `emitMilestone(id, payload)`；id 必须出现在 `plan.json` 的 `smoke.expect[].id` 集合内
4. 可选 `window.__state`：仅在 plan 声明 state path 时挂对应字段
5. 不 import 仓库其他路径
6. 不用 git 命令修 delivery，不 `git add -f` / `stash` / 改 ignore 来改变校验结果
7. 不在 case 内 `npm install`
8. 不要往 `cases/<PROJECT>/game/package.json` 加 `dependencies` / `devDependencies`；runtime（phaser / vite / typescript）由 repo root 持有
9. `plan.smoke.viewport`（默认 480×360）仅用于 headless smoke 浏览器窗口，与游戏画布无关。Phaser canvas（config 的 `width` / `height`）按可玩性选，推荐 640×480 或 800×600；强烈建议同时设 `scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }`，让真实浏览器能撑满。canvas 超过 viewport 1.5× 会有非阻塞 warning，超过 2× 才有 GPU stall 风险
10. Liveness 规则：游戏若包含时间压力 / NPC 自主行为 / 倒计时 / 持续动效（即任何"不靠玩家输入也在变化"的元素），主 scene 必须实现 `update(time, delta)` 并至少推进一个 delta-based 状态。可照抄：

```ts
update(_time: number, delta: number) {
  this.patience -= delta / 1000;
  enemy.x += enemy.speed * delta / 1000;
  this.hudPulse += delta;
}
```

不在 `update()` 里推进任何状态，runner 会观测到 `idleNoise = 0` 双 warning。纯回合制游戏可豁免，但需在 plan 的 `nonblockingTodos[]` 里显式声明，避免 review 误判。
11. 不发明新 milestone id

进入 Phase C 前 worker 自己应该确保 `game/` 下能 `npx tsc --noEmit` 与 `npx vite build` 干净通过。

## Phase B v1.1 引导密度

### B.1 优先用 lib/ helper

`prepare_case_game.js` 会把 v1.1 默认 helper 复制到 `cases/<PROJECT>/game/src/lib/`：

- `lib/visualTheme.ts`：粒子、相机、tween、伤害字、hit-stop、boss 出场；CANVAS-safe 核心 + WebGL FX optional
- `lib/inputController.ts`：WASD、方向键、触摸虚拟摇杆
- `lib/hudBuilder.ts`：meterBar、statusText、iconSlot
- `lib/progressionMath.ts`：linearRamp、waveScale、thresholdCurve、clamp、lerp

强烈建议至少调用 2 个 helper；仅 import 不算调用。低调用会进入 `delivery.json.qualityHints.warnings` 的 `low-helper-usage`，warn-only，不阻塞 delivery。

### B.2 decisions.md B 段(in-flight 实现期决策)

每新增文件、重构一段或跳过一个复杂度，都在 decisions.md B 段记录一条外显决策：

- 决策：做了什么
- 依据：来自 plan、DESIGN、rubric 或实现约束
- 与 plan 的差异：若有，说明为什么
- 风险：若有，写后续可能需要回头处理的点

这里只写 decision log / rationale，不写私密推理过程。

### B.3 implementationPlan 责任覆盖

`plan.json.implementationPlan[]` 给方向，不锁文件名。Phase B 可以调整文件清单，但 plan 列出的所有 `purpose` 都必须由最终代码承担；差异写进 decisions.md B 段。

### B.4 LOC warn-only 阈值

- 业务文件 LOC > 600：`file-loc-soft`
- 业务文件 LOC > 900：`file-loc-hard`
- MainScene 占 `game/src` 总 LOC > 70%：`mainscene-occupancy-soft`
- MainScene 占 `game/src` 总 LOC > 85%：`mainscene-occupancy-hard`
- 总 LOC < 900 时，MainScene 占比检查禁用

这些都是 warn-only，用于提示拆分风险，不改变 Stage1 verdict。

### B.5 自评 rubric

交付前写 `cases/<PROJECT>/.game/rubric.json`，6 维度 0-5 自评：

```json
{
  "content-density": 0,
  "mechanical-differentiation": 0,
  "visual-feedback": 0,
  "hud-information": 0,
  "feel-juice": 0,
  "genre-fitness": 0
}
```

缺字段触发 warn-only，不阻塞 delivery。

## Phase C

固定顺序：

```bash
node scripts/check_delivery.js cases/<PROJECT>
node scripts/check_preview.js cases/<PROJECT>
node scripts/write_handoff.js cases/<PROJECT>
node scripts/start_preview.js cases/<PROJECT>
```

`check_delivery.js` 内部按顺序执行：

1. import guard：禁止业务代码 import templates / scripts / schemas / archive / legacy / sibling case
2. plan validate：AJV 校验 `specs/plan.json`
3. prepare scaffold：`prepare_case_game.js` 拷贝 KEEP 文件，不覆盖 `main.ts` 业务实现
4. typecheck + vite build
5. delivery runner：Playwright 启动 vite dev、派发 `smoke.steps`、观测 `smoke.expect`，并落地截图 / summary / warnings 作为后续演进输入证据
6. 写 `eval/delivery.json` 四态 verdict

`check_preview.js` 是试玩健康检查，不派发 `smoke.steps`，不判定 milestone/state/canvas expect；它只检查 runtime、import guard、prepare、typecheck、vite build、dev server mount、pageerror、canvas mounted / pixels available，并写 `eval/preview.json`。

`write_handoff.js` 读取 `plan.json`、`delivery.json`、`preview.json`、`qualityHints`，写 `eval/handoff.json`。preview-ready 时，主 agent 必须启动游戏，说明玩法和操作，并明确告诉用户：如果遇到 bug、想增加需求、修改现有机制、调整手感/数值、素材/颜色/布局/UI，都可以继续说。

Phase C 不跑 mechanism smoke、不跑 playable-demo、不跑 receipt vocab 校验、不触发自动修复，不自动进入 Stage 2-5。
Phase C 不再读取 git diff / git status，不要求 `--baseline`，也不会因工作树里其他 case 或 repo-level 改动而阻塞。
同一仓库同一 case 不要并行跑 `check_delivery`；如需多 agent 并行，优先用不同 case 或 git worktree 物理隔离。
`check_delivery` 不是 repair loop。首轮 Stage1 同一 case 最多运行 3 次 `check_delivery`（首次 + 最多 2 次小修复复测）；若仍是 `generation-blocked`，或修法需要重设地图、路径、机制、plan 主结构，先跑 `check_preview`。preview-ready 则可试玩交付并把 evidence 失败写进 handoff；preview-blocked 才按阻塞汇报停。

Phase C 物证：

- `eval/screenshots/mount.png`
- `eval/screenshots/after-steps.png`
- `eval/screenshots/final.png`
- `eval/runner-result.json` 中的 `summary`、`warnings`、`screenshots`
- `eval/preview.json` 中的 preview health、试玩截图和 launch command
- `eval/handoff.json` 中的玩法说明、操作说明、检查摘要和后续迭代引导

截图仅作物证，不是视觉裁判。若 vision policy 禁止读图，agent 只能使用截图路径、文件大小、尺寸、像素统计等文本证据，不得肉眼解读图片内容。

## Phase C v1.1 引导密度

### C.1 delivery.json.qualityHints 解读

`delivery.json.qualityHints` 是 Stage 2-5 backlog 输入，包含 4 个子项：

| 子项 | 含义 |
|---|---|
| `visual` | `_visual_warn.js` 从 `final.png` 计算 `colorCount` / `shapeRegions` / `hudOccupancy` / `centerActivity`；失败时写 `available=false` 和 `reason` |
| `rubric` | 读取 `.game/rubric.json` 的 6 维度自评 |
| `scopeReport` | 统计 `from-query` / `from-genre-knowledge` / `from-reasoning`，并记录 scope leak / demoted 项 |
| `loc` | 记录 `scaffoldLoc` / `businessLoc` / `helperImportCount` / `helperCallCount`，避免把模板体积当作生成质量 |

所有 qualityHints 子项都是 warn-only，不影响 delivery verdict。verdict 仍按 milestone / canvas-change / state assertion 判定。

### C.2 视觉信号默认文本指标，vision-policy opt-in 多模态

默认不把 `final.png` 喂给模型；视觉信号走 `_visual_warn.js` 计算出的文本指标，再写入 `qualityHints.visual`。支持多模态时，必须通过 `.game/vision-policy.json` opt-in，且仍遵守 Step 0 的图片读取边界。

### C.3 decisions.md C retrospective

delivery 后建议读取 `delivery.json.qualityHints`，在 decisions.md C 段写 retrospective：

- 视觉指标读后感，例如 colorCount / hudOccupancy 极端值的可能原因
- 如果重来会改什么，作为 Stage 2-5 backlog 种子
- scope 自评：from-query 是否都落地，from-genre-knowledge 推迟了哪些

retrospective 可选，但有助于后续演进环少猜。

### C.4 delivery-pass 不等于完整完成

`delivery-pass` 只表示首交付证据通过：主闭环可启动、接收输入、产生 milestone / canvas / state 证据。它不等于需求完整验收、视觉达标或体验打磨完成；这些看 qualityHints、rubric、retrospective，并留给 Stage 2-5 演进处理。

### C.5 preview-ready 是试玩交付 gate

`preview-ready` 只表示游戏可启动试玩：build、页面 mount、canvas 和像素读取健康。它不表示 delivery evidence 通过，也不表示需求完整完成。

若 `delivery.status` 是 `generation-blocked`，但 `preview.status` 是 `preview-ready`，最终对用户的状态应是“可试玩，但自动检查未完全通过”。主 agent 仍要启动游戏、说明玩法/操作，并把失败的 expect 或 diagnostic 作为后续 Stage 2-5 backlog，而不是把游戏藏起来。

`preview-blocked` 才表示无法展示给用户；此时优先在 Stage 1 小修复预算内修到可启动，修不动再按阻塞汇报。

## 4 态出口

| status | 含义 |
|---|---|
| `delivery-pass` | import guard / plan / build / runner 全 pass，nonblockingTodos 为空，无非 fatal console.error |
| `delivery-with-warnings` | 全 pass，但 nonblockingTodos 非空 / 或有非 fatal console.error / 或 milestone 后 canvas 不再变化 |
| `generation-blocked` | worker 自身写的代码或 plan 出错：plan invalid、tsc/vite 失败、pageerror、canvas 无变化、milestone 未捕获、state 断言失败 |
| `chain-blocked` | 链路承诺过但没提供：import 不存在的 helper / 越界依赖、prepare 自身失败、runner 自身异常 |

`chain-blocked` 只能由 runner / guard 自动判定，worker 不能自报。

## Preview / Handoff 出口

| status | 含义 |
|---|---|
| `preview-ready` | 游戏能启动、页面能 mount、canvas 可读，可给用户试玩 |
| `preview-blocked` | 缺 runtime、越界 import、prepare/typecheck/vite/page mount/pageerror/canvas 不可用，不能给用户试玩 |
| `handoff.ready` | 已生成玩法说明、操作说明、检查摘要和后续迭代引导 |
| `handoff.blocked` | preview 不可用，无法正常交付试玩 |

warning 使用结构化数组，`kind` 至少包括：`unexpected-milestone`、`console-warning`、`console-error`、`nonblocking-todos`、`canvas-static-after-milestone`、`static-between-inputs`、`idle-frozen`、`auto-cleaned-junk`、`canvas-exceeds-viewport`。unexpected milestone 不直接 fail，但会让结果进入 `delivery-with-warnings`。

## 失败时怎么读 diagnostic

`eval/runner-result.json` 的 `diagnostic` 字段用于分诊。先按下表定位，再决定是否改代码；不要看到失败就先重写业务逻辑。

| diagnostic 模式 | 最可能原因 | 先查 |
|---|---|---|
| `canvasMounted: false` | 业务没起来或入口没挂游戏 | `game/src/main.ts` 是否执行 `new Phaser.Game()` |
| `canvasMounted: true, pixelsAvailable: false` | canvas 起来但读不到像素 | Phaser config 是否 `type: Phaser.CANVAS` |
| `pixelsAvailable: true, milestonesAny: 0` | 业务跑了但没发 milestone | `emitMilestone` 调用是否被跳过，id 是否和 plan 一致 |
| `inputDispatched: false, stepsExecuted < stepsTotal` | smoke step 本身抛错 | `runner-result.json` 顶层 `error` / `pageErrors` |
| `failedExpects[].type == "canvas-change"` 且 `observed > 0` 但小于 `needed` | 画面在动但变化量小 | viewport / canvas 尺寸、渲染面积、输入窗口是否过短 |
| `failedExpects[].type == "milestone"` 且 `milestonesAny > 0` | 部分 milestone 有，某个 id 没到 | 该 id 的业务路径是否被 condition 跳过 |
| `failedExpects[].type == "state"` 且 path 类似 `gameState` / `status` / `phase` | smoke 末尾可能进了 lose 或 plan 断言太脆 | 先看 `docs/known-issues.md` 的 smoke 末尾误判条目，优先改 smoke / state 证据 |
| `failedExpects[].type == "state"` 且 path 是数值字段 | 主闭环没真正进展或状态没挂对 | 业务计数更新、`window.__state` 暴露路径 |

## 主 agent 边界

| 阶段 | 允许写 | 禁止写 |
|---|---|---|
| Phase A | `cases/<PROJECT>/docs/DESIGN.md`、`cases/<PROJECT>/docs/decisions.md`、`cases/<PROJECT>/specs/plan.json` | 业务代码、`eval/**`、`assets/**`、KEEP scaffold、`templates/**`、`scripts/**`、`schemas/**`、其他 case、`SKILL.md` |
| Phase B | `cases/<PROJECT>/game/src/<业务文件>`、`eval/known_todos.json`、`assets/**`、`docs/**` | KEEP scaffold、`templates/**`、`scripts/**`、`schemas/**`、其他 case、`SKILL.md` |
| Phase C | 主 agent 只读 | `eval/delivery.json` 等产物由脚本写 |

## 允许读（Phase B 卡住时）

- `docs/known-issues.md`：只读引导，不要从中复制 sibling case 源码

## 禁读列表

- `templates/**`（含 KEEP scaffold 源）
- sibling case (`cases/<其他 slug>/**`)
- `eval/runner-result.json` 完整 milestone 流；只读 summary、status、blockReason、必要 milestone id

## 决策日志原则(decision log / rationale)

`cases/<PROJECT>/docs/decisions.md` 是外显 decision log，不是私密推理复刻，也不是完整心理过程复刻。

记录：

- 结论：做了什么决策
- 依据：基于什么信息、约束或偏好
- 权衡：考虑过的其他方案与未采用原因
- 后续风险：环境变化后可能需要回头处理的点

不要求暴露逐步推理、内心草稿或完整心理活动。它的功能是让后续维护者复核“为什么这样选”，不是复刻“怎么想到的”。

格式分三段：

- A 段(Phase A 写)：设计期决策，5-15 条 Q&A，标 `from-query` / `from-genre-knowledge` / `from-reasoning`
- B 段(Phase B in-flight 写)：实现期决策，记录架构选择、跳过的复杂度、文件清单变更理由
- C 段(Phase C 后写，可选)：retrospective，记录 qualityHints 读后感、如果重来会改什么、scope 自评

## Phaser 3.90 常见坑(Phase B 写代码时参考)

本段只列高频 10 条：

1. **ParticleEmitter unified API**：用 `add.particles(x, y, key, config).explode(n)`，不要用已删除的 `manager.createEmitter()`；缺粒子素材时用 `lib/visualTheme.ts` 的 `ensureProceduralTextures(scene)`。
2. **FX WebGL-only no-op fallback**：Glow / Bloom / Pixelate 只在 WebGL 有效，CANVAS 下必须有 no-op fallback；不要把 FX 当核心画面证据。
3. **camera force=true**：重复触发 shake / flash 时带 `force=true`，否则正在运行的 camera FX 可能忽略新调用。
4. **timeScale reset**：`time.timeScale` 影响整个 scene；hit-stop 或慢动作后必须 reset，避免后续计时全局变慢。
5. **Container input 不传播**：子对象 `setInteractive` 后事件不冒泡到 container；需要子对象单独监听，或把按钮元素扁平放到 scene 顶层。
6. **scene.restart 清 tween/timer**：restart 前后在 shutdown 钩子里清理 tween / timer，避免跨 scene 残留事件和内存泄漏。
7. **Texture key 缺失**：贴图 key 不存在会导致渲染异常；主动 `textures.exists(key)` 检查，或用程序贴图保底。
8. **delta-based update**：运动写 `entity.x += speed * delta / 1000`，不要写每帧固定增量，否则帧率变化会改变玩法。
9. **循环变量 shadow**：循环变量不要和函数参数同名，避免把数值参数 shadow 成对象导致 TS 类型和运行时错误。
10. **addKeys 返回 Record**：`addKeys('W,A,S,D')` 返回 `Record<string, Phaser.Input.Keyboard.Key>`，不要当作固定 `KeyKeys` 类型乱断言。

完整 16 条与更多兼容细节见 [evolution-docs/research-notes-phaser.md](./evolution-docs/research-notes-phaser.md)。

## 推荐 milestone id 与 state schema(品类通用,Phase B emit 时优先)

### 推荐 milestone id

| id | 含义 |
|---|---|
| `player-input` | 首次接收到玩家有效输入 |
| `progress-event` | 任何正向进度，如击杀、拼对、建筑放置、闯关、收集 |
| `setback-event` | 任何负向事件，如受伤、拼错、资源不足、失去一命 |
| `phase-transition` | 阶段、关卡、波次推进 |
| `session-resolved` | 会话终结，如胜利、失败、通关、时限到 |

case 可以加自己的 milestone，但优先复用通用 id；`check_delivery.js` 可据此派生 progress velocity、setback rate、phase completion、resolved distribution 等文本信号。

### 推荐 window.__state schema

```ts
window.__state = {
  session: {
    phase: 'menu' | 'playing' | 'paused' | 'ended-win' | 'ended-lose',
    elapsedMs: 0
  },
  player: {
    progress: 0,
    life: 3
  }
};
```

通用 schema 保留 `session` / `player` 顶层结构；其他 genre-specific 字段按需添加。

## 视觉信号(文本默认 / 多模态 opt-in)

链路对视觉的判定默认走文本路径：

```text
final.png -> _visual_warn.js -> qualityHints.visual
```

`_visual_warn.js` 输出 `colorCount`、`shapeRegions`、`hudOccupancy`、`centerActivity` 等文本指标，供 retrospective 与 Stage 2-5 backlog 使用。

多模态只通过 `vision-policy` opt-in：支持读图的模型也必须先满足 `.game/vision-policy.json` 与 Step 0 的边界，不能绕过 policy 直接肉眼读图。

`_visual_warn.js` 失败时写 `qualityHints.visual.available = false` 与 `reason`；这不影响 Stage1 verdict，视觉指标全是 warn-only。

## 失败汇报

```text
mini-game 阻塞
phase: <Step0|A|B|C>
status: <generation-blocked|chain-blocked>
blockReason: <脚本输出的 reason>
现象: <stderr/stdout 摘要>
已产物: <eval/delivery.json 路径>
判断: <generation-blocked = case 自身错；chain-blocked = 链路能力不够>
下一步: <用户决策点>
```

如果 `eval/preview.json` 是 `preview-ready`，不要使用上面的阻塞模板作为最终交付话术；改用 `eval/handoff.json` 的玩法/操作/检查摘要，说明自动证据未完全通过但游戏可试玩，并邀请用户继续迭代。

## 视觉表现建议（非门禁，参考用）

下列建议不影响 delivery 判定，仅作 worker 在写 Phase B 时的参考。链路对美感无信号、不强制。

- 主对象用至少 2 层形状（圆 + 矩形 + 文本叠加），避免单一纯色矩形
- 重要反馈用 tween / 短暂飘字 / flash
- 点击 / 命中 / 得分需有瞬时视觉反馈（不只数字跳）
- HUD 和游戏区域用背景色或边框分层
- 结算 / Game Over 用 overlay 而非只靠新 scene 跳转

## 不在范围

- VU/IA / 视觉裁判 / 素材精修
- 多候选自动选优
- 自动进 Stage 2-5
- mechanism smoke / playthrough.spec / scorecard
- receipt 字面量匹配
- repair loop（任何）

## 首交付后的演进说明

Stage 2-5 的演进设计见 [evolution-docs/README.md](./evolution-docs/README.md)。

Stage 1 行为不变：不会自动进入演进环，也不把演进 query 回流到首轮生成链路。

当前仓库已提供首交付后的显式 evolution CLI：`scripts/triage_router.js` 与 `scripts/run_evolution.js`。它们从最近 passing baseline、delivery / runner 证据、`docs/DESIGN.md`、`docs/decisions.md` 和 `eval/delivery.json.qualityHints` 出发，按 Stage 2-5 边界做局部修复、新增、深化和美化；具体实现状态与边界以 `evolution-docs/README.md` 为准。
