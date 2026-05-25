# mini-game Skill

## 一句话目标

stage1 用最朴素事实判定一次首轮生成是否成功：真实输入驱动、真实画面变化、真实 milestone、失败诚实停。worker 直接写 case-local Phaser/TypeScript 游戏；用一页 `plan.json` 表达主闭环和最低 acceptance 契约；用一个真实输入派发的 delivery smoke 验证主闭环。

`delivery-pass` 只表示 first-cut evidence pass：首轮产物能启动、接收真实输入，并产出主闭环机械证据。它不表示用户需求已最终完整验收；后续体验问题和局部 bugfix 进入首交付后的演进说明。stage1 不做局部修复、不触发 repair loop；失败只诚实停，或由后续流程整份重生。

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

只产 `cases/<PROJECT>/specs/plan.json`，结构由 `schemas/plan.schema.json` 校验。

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

## Phase C

只跑：

```bash
node scripts/check_delivery.js cases/<PROJECT>
```

它内部按顺序执行：

1. import guard：禁止业务代码 import templates / scripts / schemas / archive / legacy / sibling case
2. plan validate：AJV 校验 `specs/plan.json`
3. prepare scaffold：`prepare_case_game.js` 拷贝 KEEP 文件，不覆盖 `main.ts` 业务实现
4. typecheck + vite build
5. delivery runner：Playwright 启动 vite dev、派发 `smoke.steps`、观测 `smoke.expect`，并落地截图 / summary / warnings 作为后续演进输入证据
6. 写 `eval/delivery.json` 四态 verdict

Phase C 不跑 mechanism smoke、不跑 playable-demo、不跑 receipt vocab 校验、不触发自动修复。
Phase C 不再读取 git diff / git status，不要求 `--baseline`，也不会因工作树里其他 case 或 repo-level 改动而阻塞。
同一仓库同一 case 不要并行跑 `check_delivery`；如需多 agent 并行，优先用不同 case 或 git worktree 物理隔离。
`check_delivery` 不是 repair loop。首轮 Stage1 同一 case 最多运行 3 次 `check_delivery`（首次 + 最多 2 次小修复复测）；若仍是 `generation-blocked`，或修法需要重设地图、路径、机制、plan 主结构，立刻按失败汇报停，不继续局部修到 pass。

Phase C 物证：

- `eval/screenshots/mount.png`
- `eval/screenshots/after-steps.png`
- `eval/screenshots/final.png`
- `eval/runner-result.json` 中的 `summary`、`warnings`、`screenshots`

截图仅作物证，不是视觉裁判。若 vision policy 禁止读图，agent 只能使用截图路径、文件大小、尺寸、像素统计等文本证据，不得肉眼解读图片内容。

## 4 态出口

| status | 含义 |
|---|---|
| `delivery-pass` | import guard / plan / build / runner 全 pass，nonblockingTodos 为空，无非 fatal console.error |
| `delivery-with-warnings` | 全 pass，但 nonblockingTodos 非空 / 或有非 fatal console.error / 或 milestone 后 canvas 不再变化 |
| `generation-blocked` | worker 自身写的代码或 plan 出错：plan invalid、tsc/vite 失败、pageerror、canvas 无变化、milestone 未捕获、state 断言失败 |
| `chain-blocked` | 链路承诺过但没提供：import 不存在的 helper / 越界依赖、prepare 自身失败、runner 自身异常 |

`chain-blocked` 只能由 runner / guard 自动判定，worker 不能自报。

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
| Phase A | `cases/<PROJECT>/specs/plan.json` | 其他全部 |
| Phase B | `cases/<PROJECT>/game/src/<业务文件>`、`eval/known_todos.json`、`assets/**`、`docs/**` | KEEP scaffold、`templates/**`、`scripts/**`、`schemas/**`、其他 case、`SKILL.md` |
| Phase C | 主 agent 只读 | `eval/delivery.json` 等产物由脚本写 |

## 允许读（Phase B 卡住时）

- `docs/known-issues.md`：只读引导，不要从中复制 sibling case 源码

## 禁读列表

- `templates/**`（含 KEEP scaffold 源）
- sibling case (`cases/<其他 slug>/**`)
- `eval/runner-result.json` 完整 milestone 流；只读 summary、status、blockReason、必要 milestone id

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

Stage 1 行为不变：不会自动进入演进环，不把演进 query 回流到首轮生成链路，也不在本 SOP 中实现 Stage 2-5 worker。
