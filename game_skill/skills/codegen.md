---
name: game-phase-4-codegen
description: "Phase 4: 代码生成。读取 GamePRD 的 runtime，经 references/engines/_index.json 找到 guide + template，按 run-mode 产出可运行的 game/index.html 与可选 src/。"
---

# Phase 4: Codegen

## 职责

将 Phase 2 的 GamePRD（+ Phase 3 specs）转化为**可按 run-mode 运行**的前端游戏代码。

**输出**：
- `cases/{project-slug}/game/index.html`：必需入口
- `cases/{project-slug}/game/src/`：可选；`run-mode=local-http` 时常见
- `cases/{project-slug}/game/package.json`：可选；若 `src/*.js` 使用 ESM，需声明 `"type": "module"`

**关键约束**：
- 零 npm install、零构建步骤
- 必须在 `index.html` head 写 `<!-- ENGINE: {runtime} | VERSION: ... | RUN: {run-mode} -->`
- `run-mode=file`：允许双击打开，但不要依赖本地 ES module / 相对 `import`
- `run-mode=local-http`：允许 `src/*.js`、`import/export`、多文件结构
- 所有 CDN 依赖走 HTTPS，版本号 pin 到主版本（读 `_index.json.version-pin`）
- 必须暴露 `window.gameState`（Playwright 验证桥，见 verify-hooks.md）
- **必须在每条 `@rule` 触发时产出 `window.__trace` 证据**（T3 硬约束）：
  - 初始化时 `window.__trace = window.__trace || [];`
  - canvas / pixijs / phaser3 的全部 primitive-backed rule，以及 dom-ui 的逻辑/资源/状态/生命周期 primitive，必须把 `rule` / `node` 传给 `_common/primitives/*.runtime.mjs`，由 runtime 自动 push `{ primitive, rule, node, before, after }`
  - three 过渡期、dom-ui 暂不适用的空间/运动 primitive、以及非 primitive 规则，才允许在执行 effect 后手写：`window.__trace.push({ rule: "<rule-id>", before: {...}, after: {...}, t: Date.now() });`
  - `before` / `after` 至少包含 `event-graph.yaml` 里 `rule-traces.<rule-id>.actions` 声明的 `subject.field` 值
  - 目的：`check_playthrough.js` 用 trace 覆盖率（≥80%）判定玩法是否真的跑起来，profile 不再承担 expect
- **不得静默删除** `must-have-features`

---

## 为什么要区分 run-mode

浏览器对 `file://` 协议下的本地 ES module / 相对 import 施加严格限制：

```text
Access to script at 'file:///.../src/main.js' from origin 'null'
has been blocked by CORS policy
```

因此不能把“单文件”当成所有引擎的统一硬规则。当前默认是：

- 简单 `canvas`、且不需要 runtime primitive import 的纯静态 `dom-ui`：`run-mode=file`
- `phaser3` / `pixijs` / primitive-backed `dom-ui`：`run-mode=local-http`
- 复杂 DOM / Canvas 项目：也允许升级到 `local-http`

`local-http` 可通过 `python3 -m http.server` 或临时静态服务器解决模块加载问题，同时保留多文件工程结构。

---

## 前置条件

- `docs/game-prd.md` 已通过 `check_game_prd.js`
- GamePRD front-matter 含 `runtime` 和 `engine-plan.runtime`（两者一致）
- **Phase 3 `completed`，`specs/{mechanics,scene,rule,data,assets,event-graph,implementation-contract}.yaml` 存在**（始终必做，不会 skip）

---

## 流程

### Step 0：玩法语义闸先于写代码

Codegen 不是第二个玩法设计阶段。进入任何引擎模板前，必须先确认
`specs/mechanics.yaml` 已经是可执行的 primitive DAG：

```bash
node ${SKILL_DIR}/scripts/check_mechanics.js cases/${PROJECT}
```

退出码非 0 时，**不得开始写 game/**，也不得靠代码“修”一个结构性不成立的
mechanics。正确处理是回到 Phase 3.0 修 `mechanics.yaml`：

- `grid-board + 四周/外圈传送带` 必须是 `parametric-track.shape=rect-loop`，不是 `ring`
- `ray-cast.coord-system=grid` 必须由上游 agent 提供 `gridPosition`
- 至少一个 `simulation-scenarios` 能到达 `expected-outcome: win`
- 每个 hard-rule 都映射到 primitive 字段或 invariant

### Step 1：解析 runtime / run-mode 并加载引擎资源

```bash
RUNTIME=$(grep "^runtime:" docs/game-prd.md | head -1 | awk '{print $2}')
```

`run-mode` 优先级：

1. 模板 `index.html` 里的 `RUN: ...` 标记
2. `_index.json.default-run-mode`
3. 兜底默认：
   - `phaser3` / `pixijs` / `three` → `local-http`
   - `dom-ui` → `local-http`（primitive-backed 模板默认）
   - `canvas` → `file`

### Step 2：multi_read 引擎规范 + template

**必须**一次性读取：

- `${SKILL_DIR}/references/engines/_index.json`，用其中当前 runtime 的 `guide` / `template` / `default-run-mode` / `version-pin` 字段定位资源；禁止按 runtime 名直接拼引擎目录（例如 `dom-ui` 映射到 `engines/dom/`）
- `${SKILL_DIR}/references/${ENGINE_GUIDE}`
- `${SKILL_DIR}/references/${ENGINE_TEMPLATE}/index.html`
- `${SKILL_DIR}/references/common/visual-styles.md`（配色推断规则 + 特效指南）
- `${SKILL_DIR}/references/common/color-palettes.yaml`（预设色板库）
- `${SKILL_DIR}/references/common/fx-presets.yaml`（特效预设库）
- `${SKILL_DIR}/references/common/game-systems.md` **仅读索引部分**（从文件开头到「## 1. 状态机系统」之前）——包含契约速查表、依赖图、模块组合指南。**不要全量读取**，完整模块实现在 Step 4.1 按需读取。
- `docs/game-prd.md`
- `specs/mechanics.yaml`、`specs/rule.yaml`、`specs/scene.yaml`、`specs/data.yaml`、`specs/assets.yaml`、`specs/event-graph.yaml`、`specs/implementation-contract.yaml`
- `references/common/verify-hooks.md`

若模板自带 `src/`，也要一并读取相关文件。

同时从 PRD 读出：

- `delivery-target`
- `must-have-features`
- `nice-to-have-features`
- `cut-preference`

### Step 3：确定配色方案 + 契约消费策略

#### 3.0 Implementation Contract 是 codegen 的第一输入

先读取 `specs/mechanics.yaml` 与 `specs/implementation-contract.yaml`。前者是玩法 primitive DAG，后者是素材/启动/生命周期契约；两者共同高于 LLM 对 `assets.yaml`/`scene.yaml` 的自由解释：

- `boot` 决定首屏、ready condition、开始动作、场景转场链路
- `asset-bindings` 决定每个素材绑定到什么 UI/游戏元素、是否文字承载、是否必须真实渲染、是否允许 fallback
- `engine-lifecycle` 决定引擎加载时序，例如 Phaser 必须在 `preload()` 阶段注册素材
- `verification` 决定 report 可引用的证据来源

**禁止**绕过 contract：不得只生成 manifest/registry 后不在业务代码消费 required local-file；不得把 `allow-fallback:false` 的素材静默降级为程序化绘制；不得让 report 自行解释运行时错误。

**禁止**绕过 mechanics：不得无视 `mechanics.yaml` 自写另一套运动/攻击/胜负逻辑；每个 primitive node 都必须在代码里有对应实现点。

从 GamePRD front-matter 读 `color-scheme` 段（由 Phase 2 从 brief 关键词自动推断）：

- `color-scheme.palette-id`：色板 ID，对应 `color-palettes.yaml` 的 palette
- `color-scheme.primary/secondary/accent/background/...`：具体色值硬值
- `color-scheme.fx-hint`：特效预设类型（soft/pixel/glow/bounce/ink），对应 `fx-presets.yaml`
- `color-scheme.font-family`：字体堆栈
- `color-scheme.border-radius`：圆角值
- `color-scheme.shadow`：阴影值

**禁止自创配色**。color-scheme 里有什么就用什么。

若 front-matter 无 `color-scheme` 段，停止 codegen 并回到 Phase 2 修 PRD；不得在代码生成阶段自行选择 fallback-default。

#### 3.1 素材消费策略（不可跳过）

读取 `specs/assets.yaml`，按以下优先级确定每个视觉元素的实现方式：

1. **`type: local-file`**（最高优先级）→ 必须加载外部图片/音频文件
2. **`type: inline-svg` / `type: graphics-generated`** → 内联 SVG 或程序化绘制
3. **`type: synthesized`** → 运行时合成（Web Audio API 等）
4. **无素材定义** → 允许程序化绘制

**关键规则**：
- 如果 `assets.yaml` 中为某个实体/场景/UI 定义了 `type: local-file` 素材，**代码中必须加载并使用该文件，禁止用程序化绘制替代**
- 读 `visual-styles.md` 的「Kenney 素材消费约定」获取每个引擎的加载 API 和路径回退规则
- 路径规则：游戏代码在 `cases/{project}/game/` 下，引用素材需回退到项目根 → 2D 引擎（phaser3/pixijs/canvas/dom-ui）使用 `../../../assets/library_2d/...`，Three.js 引擎使用 `../../../assets/library_3d/...`

#### 3.2 素材语义适配检查（不可跳过）

对 `assets.yaml` 中每个 `type: local-file` 条目，检查其 **文件名语义** 与 **实际用途** 是否匹配：

| 文件名模式 | 适合用途 | 禁止用途 |
|---|---|---|
| `button_*.png` | 按钮、可点击控件 | ❌ 卡片背景、平台 tile、精灵 |
| `tile_XXXX.png`（编号） | 地图瓦片、平台、地形 | ❌ 按钮（除非是 UI tile 包的按钮组件） |
| `character/player/enemy` | 角色精灵、NPC | ❌ 背景、按钮、面板 |
| `panel/window/frame` | 对话框、面板、容器 | ❌ 角色、子弹 |
| `icon_*/board-icons/*` | HUD 图标、装饰 | ❌ 全屏背景 |

**核心原则**：不透明的按钮/面板图片不得用作「需要在其上显示文字/内容」的元素背景（如卡片背景），否则内容会被完全遮挡。卡片类 UI 应优先用 `type: graphics-generated`（程序化绘制圆角矩形 + 浅色填充）。

**色块/目标块特殊规则**：如果 PRD 或 assets/contract 明确说某实体是"色块 / 方块 / 目标块 / color block"，并且玩法判定依赖 `color` 字段，则该实体的视觉语义是 `visual-primitive: color-block`。此时默认必须用 `type: generated` / `graphics-generated` 绘制纯色格子、描边、耐久角标，**禁止**绑定金币、地牢 tile、角色、图标等具象 local-file 素材。只有用户明确要求"纹理方块 / 宝石 / 图标块"时，才允许给色块绑定 local-file，并且必须在 `assets.yaml.selection-report` 里说明原因。

如果发现 `assets.yaml` 或 `implementation-contract.yaml` 中存在语义不匹配条目，**不得在 codegen 阶段悄悄修正 specs**。正确处理是返回 failed，让 Phase 3 修正 `assets.yaml` 并重新生成 contract；否则会出现 specs 与代码不一致。

**Contract 回退流程**（当 codegen 发现 contract 不合理时）：

1. codegen 标记当前阶段为 `failed`，`failReason` 写明具体的 contract 问题（如"card-bg 绑定了 button 素材"）
2. 调用 `markPhase(st, 'codegen', 'failed')` 写入 state.json
3. **不回退到 expand 自动重跑**——由主 agent 收到失败后决定是否重新进入 Phase 3 的 assets subtask
4. 重新进入 Phase 3 时只需修正对应 specs 文件，然后重新运行 `generate_implementation_contract.js` + gate check
5. gate check 通过后重新进入 Phase 4

生成素材加载清单，确认每个 `local-file` 素材在代码中的加载位置：

```text
素材加载清单示例（2D 引擎）：
  ✅ player_knight.png → preload(): this.load.spritesheet('player', '../../assets/library_2d/...')
  ✅ tile_floor.png → preload(): this.load.image('floor', '../../assets/library_2d/...')
  ✅ sfx_hit.wav → preload(): this.load.audio('hit', '../../assets/library_2d/...')
  ⚠ skill_fireball.png → type: generated → 程序化绘制（允许）
  ❌ button_rectangle_flat.png → usage: card-background → 语义不匹配！改为 graphics-generated

素材加载清单示例（Three.js 引擎）：
  ✅ character.glb → GLTFLoader.load('../../../assets/library_3d/models/platformer/character.glb')
  ✅ sfx_hit.wav → AudioLoader.load('../../../assets/library_3d/audio/...')
```

### Step 4：复制 template → game/

```bash
# ENGINE_TEMPLATE 来自 references/engines/_index.json 当前 runtime 的 template 字段
cp -R ${SKILL_DIR}/references/${ENGINE_TEMPLATE}/. game/

# 共享层（含 primitives runtime）拷进 game/src/_common/；
# canvas / pixijs / phaser3 / dom-ui(local-http) 业务代码通过 './_common/...' 或 '../_common/...' import
mkdir -p game/src/_common
cp -R ${SKILL_DIR}/references/engines/_common/. game/src/_common/

# primitive runtime 在浏览器中会 import 对应 reducer；
# 必须同步 reducer 依赖，否则 ESM 会请求 game/mechanics/** 并白屏
mkdir -p game/mechanics
cp -R ${SKILL_DIR}/references/mechanics/. game/mechanics/
```

说明：`_common/primitives/*.runtime.mjs` + `primitives/index.mjs` 是 §4.0.6 mandatory
runtime 库的实体；`game/mechanics/**/*.reducer.mjs` 是 runtime 的浏览器依赖；
`_common/test-hook.js` 是 §4.0.5 第 ③ 步的三分类 hook；
`_common/fx.spec.js` / `registry.spec.js` 是 adapter 依赖。漏掉任意一个文件都会让
业务代码 `import` 失败。

### Step 4.0.5：生成 registry manifest + 共享层依赖（P1-1 新增）

所有引擎模板自带 `src/adapters/<engine>-{registry,fx}.js` 和共享 spec（位于
`${SKILL_DIR}/references/engines/_common/`）。Codegen 阶段需要做两件事：

**① 生成 registry manifest**（数据驱动加载素材，替代 LLM 手写 loader）：

```bash
node ${SKILL_DIR}/scripts/generate_registry.js cases/${PROJECT}
```

产出 `game/src/assets.manifest.json`（或 canvas/dom 单文件时 `game/assets.manifest.json`）。
结构和 `_common/registry.spec.js` 的 schema 对齐：images / spritesheets / audio 三段，
每项含 `id` + `type` + 引擎加载需要的字段。**codegen 禁止手写 preload / this.load.image
/ Assets.load 循环**，一律改成：

```js
// pixijs: const registry = await createRegistry(manifest);
// canvas: const registry = await createRegistry(manifest);
// dom:    const registry = await createRegistry(manifest);
import { createRegistry } from './adapters/<engine>-registry.js';
import manifest from './assets.manifest.json' with { type: 'json' };
const registry = await createRegistry(manifest);
```

拿资源统一走 `registry.getTexture(id)` / `getSpritesheet(id)` / `getAudio(id)`。

**P1.6 runtime evidence**：每次 `registry.getTexture / getSpritesheet / getAudio` 被业务
代码调用时，canvas / pixijs adapter 内部自动 `recordAssetUsage(...)` 把一条
entry push 到 `window.__assetUsage`（带 bindingTo / visualPrimitive / colorSource
/ 业务传的 `extra`）。check_asset_usage.js 的 runtime 层会读取它，要求每个
`must-render=true` 的 asset 在 Playwright 实际跑游戏后至少出现一次——比 grep
静态消费更硬。业务代码对 color-block / color-unit **建议**把当前颜色传进 extra：

```js
registry.getTexture('pig-red', { color: pig.color });
```

**Phaser 例外**：由于 Phaser Loader 生命周期要求素材在 `preload()` 阶段注册，Phaser 模板**必须**使用两段式 registry（禁止单段式）：

```js
import { preloadRegistryAssets, createRegistry } from './adapters/phaser-registry.js';
import manifest from './assets.manifest.json' with { type: 'json' };

preload() {
  preloadRegistryAssets(manifest, { scene: this });
}

create() {
  const registry = createRegistry(manifest, { scene: this });
}
```

禁止在 `create()` 或 adapter 内调用 `scene.load.start()`；`check_implementation_contract.js --stage codegen` 会把它判为生命周期错误。

**② 特效统一走 fx runtime**：

```js
import { createFx } from './adapters/<engine>-fx.js';
// phaser: const fx = createFx({ scene });
// pixijs: const fx = createFx({ app, stage });
// canvas: const fx = createFx({ canvas, ctx });
// dom:    const fx = createFx({ root });

fx.playEffect('screen-shake', { intensity: 3, duration: 150 });
fx.playEffect('particle-burst', { x, y, color: '#ff0', count: 12 });
```

**动词白名单**（和 `specs/rule.yaml.effect-on-*.visual` 保持一致）：
`particle-burst` / `screen-shake` / `tint-flash` / `float-text` / `scale-bounce` / `pulse` / `fade-out`

codegen 翻译 `rule.yaml.effect-on-*.visual` 的每一条字符串为一次 `fx.playEffect(...)` 调用。
禁止散写 `this.cameras.main.shake` / `ColorMatrixFilter` / 手写粒子循环（共享层已实现）。

**③ test hook**：

```js
import { exposeTestHooks } from '../_common/test-hook.js';  // 5 引擎通用
exposeTestHooks({
  state,  // 挂到 window.gameState
  // 旧入参（保留；自动 mirror 到新 drivers 命名空间）
  hooks: { clickStartButton, clickRetryButton, ... },  // 挂到 window.gameTest.*；只能辅助测试，不能替代真实 UI 输入
  simulators: { simulateCorrectMatch, simulateWrongMatch },  // 兼容旧 window.* 断言，也会 mirror 到 drivers.*

  // 新三分类（推荐；check_runtime_semantics.js 依赖 probes）
  observers: { getSnapshot, getTrace, getAssetUsage },  // 挂到 window.gameTest.observers.*，只读
  drivers:   { clickStartButton, clickRetryButton, simulateCorrectMatch, simulateWrongMatch }, // 挂到 window.gameTest.drivers.*，真实用户输入映射；可和 hooks/simulators 同名，drivers 显式传的覆盖 mirror
  probes:    { resetWithScenario, stepTicks, seedRng }, // 挂到 window.gameTest.probes.*，仅确定性语义测试可用；profile 若调用 probes.* 会被 check_playthrough 直接 fail
});
```

**分类约定**：
- `observers`：只读快照（getSnapshot 返回 deep copy，禁止返回可变引用），用于断言读取现场。
- `drivers`：把"一次真实用户输入"封装成函数调用（内部应派发 click/press/fill 或模拟等价事件），可被 playthrough profile 使用。
- `probes`：把系统推入指定场景的裸 API（如 `resetWithScenario({board, pigs})` 直接设置状态、`stepTicks(n)` 固定推进 n 帧、`seedRng(n)` 固定种子）。**playthrough 不能调 probes**；只有 `check_runtime_semantics.js` 注入固定场景时用。

### Step 4.0.5.1：模板已内置的校验桥（codegen 必须保留和扩展）

引擎模板已经在 `state.js` / `index.html` 中内置了以下全局变量初始化：

```js
window.__trace = window.__trace || [];
window.__assetUsage = window.__assetUsage || [];
```

以及在 `main.js` / `index.html` 中内置了 `window.gameTest` 的 stub 结构（含 observers/drivers/probes）。

**codegen 的职责**：
1. **保留**模板中已有的 `window.__trace` / `window.__assetUsage` 初始化，不要删除
2. **不手写**适用 primitive 的 `window.__trace.push(...)` —— 由 `_common/primitives/*.runtime.mjs` 自动推送（canvas/pixijs/phaser3 全量；dom-ui 逻辑/资源/状态/生命周期子集）；three 过渡期与 dom-ui 空间/运动 primitive 仍需手写
3. **填充** `window.gameTest.drivers` 的具体方法，映射到真实 UI 操作：
   ```js
   window.gameTest.drivers = {
     clickStartButton: () => { /* 点击开始按钮的真实 DOM/Phaser/Pixi 操作 */ },
     clickRetryButton: () => { /* 点击重试按钮 */ },
   };
   ```
4. **实现** `window.gameTest.probes.resetWithScenario(scenario)` — 接收一个 scenario 对象（与 mechanics.yaml simulation-scenarios.setup 结构相同），将游戏状态重置到该场景：
   ```js
   window.gameTest.probes = {
     resetWithScenario: (scenario) => {
       // 清空当前棋盘/实体
       // 按 scenario.pigs / scenario.blocks 重建
       // 重置 score/phase
       // 调用渲染刷新
     },
     stepTicks: (n) => {
       // 强制推进 n 个 game tick（跳过 RAF）
     },
   };
   ```
5. **probes 不参与 playthrough profile** — 只有 `check_runtime_semantics.js` 使用；playthrough 调用 probes 会被反作弊拦截

**检查清单**（codegen 完成后自检）：
- [ ] `window.__trace` 在状态初始化后存在
- [ ] `window.__assetUsage` 在状态初始化后存在
- [ ] `window.gameTest.observers.getSnapshot()` 返回 gameState 深拷贝
- [ ] `window.gameTest.drivers` 至少有 `clickStartButton`
- [ ] `window.gameTest.probes.resetWithScenario` 已实现（不是 console.warn stub）

### Step 4.0.6：强制 import primitive runtime（P1-1 新增；canvas + pixijs + phaser3 + dom-ui 子集）

`specs/mechanics.yaml` 里引用的每个 primitive 都对应一个 **浏览器 runtime 模块**，位于
`${SKILL_DIR}/references/engines/_common/primitives/` 并由 Step 4 的
`cp -R _common/. game/src/_common/` 一并同步到 `game/src/_common/primitives/`。
业务代码（canvas / pixijs / phaser3 全量；dom-ui 适用子集）**必须**从该库 import
对应 API。canvas / pixijs / phaser3 **禁止**再手写 ray-cast /
resource-consume / predicate-match / fsm-transition / win-lose-check /
score-accum / parametric-track / grid-step / grid-board / neighbor-query 的实现。
dom-ui 只强制纯逻辑层 primitive；空间/运动类 primitive 因 DOM 节点布局没有统一
positional 语义，暂不纳入强制 runtime。

**runtime 映射表**（`engines/_common/primitives/index.mjs` 聚合导出）：

| mechanics primitive | runtime API | reducer 来源 |
|---|---|---|
| `parametric-track@v1` | `tickTrack(ctx)` / `positionAt(ctx)` | `parametric-track.reducer.mjs` |
| `grid-step@v1` | `gridMove(ctx)` | `grid-step.reducer.mjs` |
| `ray-cast@v1` | `rayCastGrid(ctx)` / `rayCastGridFirstHit(ctx)` | `ray-cast.reducer.mjs` |
| `grid-board@v1` | `addCell(ctx)` / `removeCell(ctx)` | `grid-board.reducer.mjs` |
| `neighbor-query@v1` | `queryNeighbors(ctx)` | `neighbor-query.reducer.mjs` |
| `predicate-match@v1` | `predicateMatch(ctx)` | `predicate-match.reducer.mjs` |
| `resource-consume@v1` | `consumeResource(ctx)` | `resource-consume.reducer.mjs` |
| `fsm-transition@v1` | `fireTrigger(ctx)` | `fsm-transition.reducer.mjs` |
| `win-lose-check@v1` | `checkWinLose(ctx)` | `win-lose-check.reducer.mjs` |
| `score-accum@v1` | `accumulateScore(ctx)` | `score-accum.reducer.mjs` |
| `slot-pool@v1` | `bindSlot(ctx)` / `unbindSlot(ctx)` | `slot-pool.reducer.mjs` |
| `capacity-gate@v1` | `requestCapacity(ctx)` / `releaseCapacity(ctx)` | `capacity-gate.reducer.mjs` |
| `entity-lifecycle@v1` | `transitionLifecycle(ctx)` | `entity-lifecycle.reducer.mjs` |
| `cooldown-dispatch@v1` | `requestDispatch(ctx)` | `cooldown-dispatch.reducer.mjs` |

**engine-aware 适用表**（`check_implementation_contract.js` 从
`scripts/_primitive_runtime_map.js` 读取，不允许写 if-else 魔数）：

| engine | mandatory primitive runtime |
|---|---|
| `canvas` / `pixijs` / `phaser3` | 上表全部 primitive |
| `dom-ui` | `predicate-match@v1` / `resource-consume@v1` / `fsm-transition@v1` / `win-lose-check@v1` / `score-accum@v1` / `slot-pool@v1` / `capacity-gate@v1` / `entity-lifecycle@v1` / `cooldown-dispatch@v1` |
| `three` | 过渡期整引擎豁免，Deliverable C 只纳入逻辑层子集 |

**调用约定**：

```js
// business code 在 game/src/main.js 或 game/src/scenes/*.js 里：
import {
  rayCastGridFirstHit, predicateMatch, consumeResource,
  tickTrack, checkWinLose, accumulateScore,
} from './_common/primitives/index.mjs';   // 相对 game/src/ 指向 game/src/_common/primitives/
// 场景文件多一层目录时用：
// import { ... } from '../_common/primitives/index.mjs';

// 每个调用 ctx 必须传 rule + node，命中 mechanics.yaml 的 node-id/rule-id。
// runtime 自动 push window.__trace.push({primitive, rule, node, before, after})，
// 业务代码不得再手写 __trace.push。

function onPigTickIntoSegment(pig) {
  const hit = rayCastGridFirstHit({
    rule: 'attack-consume',        // 必填：对应 rule.yaml id
    node: 'attack-consume',        // 必填：对应 mechanics.yaml node id
    source: { id: pig.id, row: pig.row, col: pig.col, gridPosition: pig.gridPosition },
    direction: directionFromSegment(pig.segmentId),
    targets: state.blocks,
    params: { 'stop-on': 'first-hit', 'coord-system': 'grid' },
  });
  if (!hit) return;

  const match = predicateMatch({
    rule: 'attack-consume', node: 'attack-consume',
    candidate: hit, filter: { color: pig.color },
  });
  if (!match) return;

  const next = consumeResource({
    rule: 'attack-consume', node: 'attack-consume',
    agent: pig, target: hit,
    params: { 'agent-field': 'ammo', 'target-field': 'durability' },
  });
  Object.assign(pig, next.agent);
  Object.assign(hit, next.target);
}
```

**禁止模式**（`check_implementation_contract.js` P1.4 会逐条扫描）：

- ❌ 在业务代码里写 `blocks.find(b => b.color === pig.color)` —— 该语义归
  `ray-cast + predicate-match`，必须走 runtime。
- ❌ 手写循环沿着 `segmentId` 对整行/整列 `for (let r=0; r<rows; r++)` 扫描 —— 该语义
  归 `ray-cast.coord-system=grid`。
- ❌ 手写 `pig.ammo--; block.durability--` —— 该语义归 `resource-consume`，必须透传
  `agent-field / target-field`。
- ❌ 手写 FSM：`if (state.phase === 'start' && event === 'click') state.phase = 'playing'`
  —— 该语义归 `fsm-transition`，必须用 `fireTrigger({currentState, trigger, params})`。
- ❌ 手写 `state.win = true` / `state.lose = true` —— 该语义归 `win-lose-check`，必须
  用 `checkWinLose({state, params})` 返回值驱动。
- ❌ 手写 `state.score += 10` —— 必须走 `accumulateScore({currentScore, eventPayload, params})`。
- ❌ 手写 `window.__trace.push({rule: 'xxx'})` —— runtime 内部自动推送；业务代码
  只能消费 `window.__trace`（测试可读），不得写入。

**LLM 职责收窄**：
- wiring（哪个 event 在哪个 tick 触发哪个 primitive）
- UI 渲染（asset binding、layout、text）
- 特殊非 primitive 的 scene/boot 逻辑

**LLM 不再负责**：primitive 内部算法、trace 推送、before/after 快照。

**引擎例外**：three 过渡期允许不 import runtime；Deliverable C 会改成只豁免
空间几何 primitive。dom-ui 已纳入逻辑层 mandatory runtime，只有
`parametric-track@v1` / `ray-cast@v1` / `grid-step@v1` / `grid-board@v1` /
`neighbor-query@v1` 暂不适用。canvas / pixijs / phaser3 无例外。

### Step 4.1：识别需要的通用系统模块

读 GamePRD 的 `@system` / `@rule` / `@entity` 标签，对照 `game-systems.md` 的「模块组合指南」，列出本游戏需要的模块：

| 游戏需求关键词 | 需要的模块 |
|---|---|
| 血量/攻击/伤害 | §2 战斗/打击感 + §9 Buff |
| 等级/经验/成长 | §3 等级 + §8 难度曲线 |
| 金币/商店/资源 | §4 资源循环 |
| 跳跃/移动/弹射 | §5 物理碰撞 |
| 倒计时/冷却/技能 CD | §6 计时器 |
| 随机掉落/地图生成 | §7 随机系统 |
| 波次/敌人生成 | §6.3 波次控制 |
| 大量子弹/特效 | §11 对象池 |
| 敌人行为/巡逻 | §12 寻路 AI |
| 存档/继续游戏 | §10 存档 |
| 多种游戏对象/实体管理 | §13 实体/变换 |
| 技能释放/子弹/飞行物 | §14 技能/投射物 |
| 背包/装备/物品拾取 | §15 背包/物品 |
| 建筑升级/生产/条件解锁/关卡推进 | §16 生产/升级/解锁 |
| **所有游戏** | §1 状态机 |

**必须在写代码前确认模块列表**，然后**按需读取** `game-systems.md` 中对应模块的章节（如 `## 2. 战斗/伤害系统`），理解其核心数据结构、API 设计模式和易错点，按具体需求化用调参。不要全量读取整个文件，也不要从零发明这些基础系统。

#### 4.1.1 自动依赖校验

确认模块列表后，**必须**对照 `game-systems.md` 的「模块契约速查表」做依赖校验，阻断缺失依赖的情况：

**校验流程**：

1. 对每个已选模块，读取其 `requires` 字段
2. 检查 `requires` 中的每个依赖是否也在已选模块列表中
3. 对每个已选模块，读取其 `optional` 字段，检查是否有遗漏的常用搭配

**处理规则**：

| 情况 | 处理方式 |
|---|---|
| `requires` 依赖未选中 | **报错阻断**：必须补选该依赖模块后才能继续 codegen |
| `optional` 依赖未选中 | **Warning 提示**：在注释中标注"可选模块 §X 未启用，如需 Y 功能请补充" |
| 模块的 `inputEvents` 无来源 | **Warning 提示**：该模块的某个输入事件没有其他模块 emit，需确认是否由用户交互直接触发 |

**示例**：

```text
已选模块：[system.combat, system.buff, system.ai]

校验结果：
  ❌ system.combat requires system.health → 未选中 → 阻断，请补选
  ⚠️ system.combat optional system.feedback → 未选中 → 建议补选以获得打击感反馈
  ⚠️ system.ai optional system.physics → 未选中 → 如需追踪移动请补选
  ✅ system.buff requires 无 → 通过
```

**校验通过后**，在代码注释中记录最终模块清单：

```js
// @modules: system.fsm, system.combat, system.health, system.buff, system.ai
// @dependencies-verified: true
```

#### 4.1.2 读取事件连接蓝图

读取 `specs/event-graph.yaml`（Phase 3 产出），用于：

1. 确认各模块之间的事件连接关系
2. 生成 glue code 时按 event-graph 的 listens/emits 连接模块
3. 确保每个 `listens` 事件都有对应的 `emits` 来源（`input.*` 除外，由用户交互触发）

### Step 4.2：数值平衡校验（可玩性自检，不可跳过）

读取 `specs/data.yaml` 的 `balance-check` 段，**在写代码前**验证每个关卡的数值平衡：

1. 对每个关卡，计算 `supply`（玩家可用资源总量）和 `demand`（通关所需消耗总量）
2. 检查 `supply >= demand`，否则该关卡不可通关——**必须修正数值后再 codegen**
3. 检查 `supply >= demand * 1.2`（20% 容错余量），不足则 Warning

```text
校验示例：
  Level 1: supply=8 (4猪×2弹药), demand=12 (12块×1HP) → ❌ FAIL: 不可通关
  Level 2: supply=15, demand=14 → ⚠ WARNING: 余量仅 7%，容错空间不足
  Level 3: supply=20, demand=15 → ✅ PASS: 余量 33%
```

**修正优先级**：
- 首选：增加玩家资源（增加单位数量/弹药/时间）
- 次选：降低通关需求（减少目标块/降低 HP）
- 禁止：只在代码中静默修改数值而不同步更新 `data.yaml`

修正后将修改写回 `specs/data.yaml` 的 `balance-check` 段。

### Step 5：按 GamePRD 填充玩法

实现优先级固定：

1. 先落 `must-have-features`
2. 再落核心 scene / rule / system 闭环
3. 再补 `nice-to-have-features`
4. 最后补视觉和演出（**见 Step 5.3**）

若复杂度超预算，裁剪顺序遵守 `cut-preference`；默认是"先缩内容量，不先砍核心系统"。

建议分工：

- 主 agent：入口文件、state 设计、模块装配
- 子 agent：单个 `@scene` / 单个玩法子系统

`run-mode=file` 且逻辑很小（< 150 行预估）时，可直接单文件生成；否则优先按 `src/` 分模块。

### Step 5.1：must-have-features 落点检查

在真正写代码前先列清单：

- 每个 `must-have-feature` 对应哪个 scene / rule / ui / state
- 是否有可观察 UI 或 `window.gameState` 字段能验证它存在
- 若只能做 lite 版，必须在代码注释或 delivery 中可识别

如果发现某个 `must-have-feature` 无法在当前 runtime + run-mode 下实现：

- **不要静默省略**
- 回到 strategy / 风险说明
- 由上游决定是否接受降级

### Step 5.2：代码架构规范（通用，所有引擎必须遵守）

以下规则从已有 case 的高频 bug 中提炼而来，**在写代码前必须阅读并遵守**。

#### 5.2.1 状态管理

**gameState 纯净原则**：`window.gameState` 只存游戏逻辑状态，禁止混入以下内容：

| 禁止放入 gameState | 应该放在哪 |
|---|---|
| UI 层临时数据（按钮边界、DOM 元素引用） | Scene 实例属性（Phaser `this.xxx`）或模块级变量 |
| 定时器 ID（setInterval/setTimeout 返回值） | 模块级变量 |
| 动画中间状态（opacity、scale 插值） | 引擎动画系统管理，不手动存 state |
| 内部锁（isProcessing） | Scene 实例属性，但**推荐同时在 gameState 上暴露只读副本**供测试观测 |

```js
// ✅ 正确：gameState 只有逻辑数据
const state = { phase: "ready", score: 0, combo: 0, cards: [], selectedCards: [] };
window.gameState = state;

// Scene 内部的非逻辑状态
this.isProcessing = false;  // 交互锁
this.cardContainers = {};   // UI 引用
```

**状态修改集中化**：对于核心逻辑（得分、生命、关卡进度），推荐通过命名函数修改，不要在事件回调里散写：

```js
// ❌ 散乱：多处直接修改 state.score
hitArea.on("pointerdown", () => { state.score += 10; state.combo++; });

// ✅ 集中：通过函数修改，逻辑清晰且可复用
function addScore(points) { state.score += points; }
function incrementCombo() { state.combo++; }
function resetCombo() { state.combo = 0; }
```

#### 5.2.2 交互模式通用规范

**同侧互斥选择**：配对/匹配类游戏中，同侧（同区域/同类型）只能有一个元素被选中。当用户点击同侧另一个元素时，必须先取消前一个的选中状态，再选中新的。**必须同时更新逻辑状态和视觉状态**。

```js
// ✅ 正确模式
selectCard(card) {
  if (this.isProcessing) return;
  if (card.matched) return;

  const sameSide = state.selectedCards.find(c => c.side === card.side);
  if (sameSide) {
    sameSide.selected = false;
    this.updateVisual(sameSide, "default");  // 同步更新视觉
    state.selectedCards = state.selectedCards.filter(c => c.id !== sameSide.id);
  }

  card.selected = true;
  state.selectedCards.push(card);
  this.updateVisual(card, "selected");

  if (state.selectedCards.length === 2) {
    this.isProcessing = true;
    // ...
  }
}
```

**计数逻辑规范**："尝试次数"（totalAttempts）只在**一次完整配对判定时**+1，不能在每次点击卡片时+1。这直接影响正确率计算。

```js
// ❌ 错误：每次点击都+1，导致正确率严重失真
onCardClick(card) {
  state.totalAttempts++;  // 点第1张+1，点第2张+1
  // ...
}

// ✅ 正确：只在配对判定时+1
checkMatch() {
  state.totalAttempts++;  // 一次配对尝试 = 一次计数
  if (card1.pairId === card2.pairId) { /* success */ }
  else { /* fail */ }
}
```

#### 5.2.3 场景切换安全

**切换前清理**：切换场景前必须确保：
- 所有进行中的动画/tween 不会在新场景中执行回调
- 定时器已清除（`clearInterval`/`clearTimeout` 或 Phaser `timerEvent.remove()`）
- 异步锁已重置

**副作用隔离**：场景的 `create()` 方法禁止修改"下一关"等全局状态，这类修改应只在用户明确操作（点击按钮）时触发：

```js
// ❌ 错误：ResultScene.create() 中直接修改 currentLevel
create() {
  if (isWin) {
    state.currentLevel = nextLevel;  // 用户还没点按钮就改了！
    this.createButton("下一关", () => this.scene.start("PlayScene"));
  }
}

// ✅ 正确：只在按钮回调中修改
create() {
  if (isWin) {
    this.createButton("下一关", () => {
      state.currentLevel = nextLevel;  // 用户点击时才修改
      state.timeLeft = LEVELS[nextLevel - 1].timeLimit;
      this.scene.start("PlayScene");
    });
  }
}
```

#### 5.2.4 硬编码治理

布局参数、动画参数、游戏平衡参数必须提取为命名常量，不要散写魔法数字：

```js
// ❌ 散写
const y = 120 + index * (60 + 12);
this.time.delayedCall(200, () => this.checkMatch());

// ✅ 提取为常量
const LAYOUT = { CARD_WIDTH: 160, CARD_HEIGHT: 60, CARD_GAP: 12, START_Y: 120 };
const TIMING = { MATCH_DELAY: 200, SHAKE_DURATION: 50, FADE_DURATION: 300 };
const SCORING = { MATCH_POINTS: 10, COMBO_MULTIPLIER: 2, TIME_PENALTY: 3 };

const y = LAYOUT.START_Y + index * (LAYOUT.CARD_HEIGHT + LAYOUT.CARD_GAP);
this.time.delayedCall(TIMING.MATCH_DELAY, () => this.checkMatch());
```

### Step 5.3：视觉演出实现（不可跳过）

"视觉和演出"不是可选项。它是让游戏有**游戏感**而不是**网页感**的关键区别。

**必读**：`references/common/visual-styles.md` 的「游戏特效分级指南」章节。

#### 实现流程

1. **读取 `color-scheme`**：从 GamePRD front-matter 获取配色方案和 `fx-hint`
2. **列出游戏事件清单**：梳理当前游戏的所有事件点（选中、成功、失败、得分、combo、通关、失败等）
3. **对照特效预设**：按 `fx-presets.yaml` 中 `fx-hint` 对应的预设，为每个事件分配特效层级
4. **查引擎 Cookbook**：读对应引擎 guide 的「视觉特效 Cookbook」，直接复制代码片段并调整参数

#### 最低要求

| 引擎 | 最低特效层级 | 具体要求 |
|---|---|---|
| **Phaser 3** | L0-L2 | 必须用到**粒子**（`this.add.particles`）+ **Camera 效果**（shake/flash）+ **tween**（不能只用 setAlpha/setTint 无过渡） |
| **PixiJS** | L0-L2 | 必须用到**Filter**（BlurFilter/ColorMatrixFilter）+ **手写粒子或 @pixi/particle-emitter** + **tint 动画** |
| **Canvas** | L0-L1 | 缩放/位移插值 + 颜色闪烁 + 淡入淡出 |
| **DOM** | L0-L1 | CSS transition/animation + 缩放 + 颜色变化 |

**如果是 Phaser/PixiJS 项目，却只用了 L0 级别的基础 tween，等于浪费了引擎选型的意义——验收不通过。**

#### 检查清单

codegen 完成后自查：

- [ ] 配对/点击成功有**粒子爆发**或**闪光**（Phaser/PixiJS）
- [ ] 配对/点击失败有**屏幕震动** + **红色反馈**
- [ ] 得分增加有**飘字动画**（向上飘走 + 淡出）
- [ ] Combo 有**递进式视觉反馈**（字号/颜色/粒子数量随 combo 增加）
- [ ] 通关有**庆祝粒子**（全屏烟花/星星）
- [ ] 时间紧迫有**警告效果**（脉冲/红晕/文字变色）
- [ ] 所有特效的颜色/形状与 `color-scheme` 设定一致

### Step 5.4：素材落地（assets.yaml 有 local-file 时不可跳过）

如果 Step 3.1 的素材加载清单中存在语义适配通过的 `type: local-file` 条目，**必须在此步骤将素材加载代码写入游戏代码中**。但如果素材语义不匹配（例如 `button_*.png` 被选作单词卡片背景），先回写 `specs/assets.yaml`：把该条目改为 `graphics-generated` 或替换为真正的 panel/card 素材，再进入加载实现。

#### 实现流程

1. **确定路径前缀**：游戏代码在 `cases/{project}/game/` 下，素材库按引擎类型区分：2D 引擎在 `assets/library_2d/`，Three.js 引擎在 `assets/library_3d/`。计算相对路径（通常 `../../../assets/library_2d/...` 或 `../../../assets/library_3d/...`）
2. **写入加载代码**（按引擎不同）：

   **Phaser 3**：在 `preload()` 方法中加载所有 `local-file` 素材
   ```js
   preload() {
     const BASE = "../../../assets/library_2d";
     // 角色精灵表
     this.load.spritesheet("player", `${BASE}/tiles/dungeon/tile_0030.png`, { frameWidth: 16, frameHeight: 16 });
     // 地牢瓦片
     this.load.image("floor", `${BASE}/tiles/dungeon/tile_0000.png`);
     // 音效
     this.load.audio("hit", `${BASE}/audio/sfx/hit.wav`);
   }
   ```

   **PixiJS v8**：在 `async init` 中用 `Assets.load` 加载
   ```js
   import { Assets, Sprite } from "pixi.js";
   const BASE = "../../../assets/library_2d";
   const textures = await Assets.load([
     { alias: "player", src: `${BASE}/tiles/dungeon/tile_0030.png` },
     { alias: "floor", src: `${BASE}/tiles/dungeon/tile_0000.png` },
   ]);
   const playerSprite = Sprite.from("player");
   ```

   **Canvas**：在游戏启动前用 `Promise.all` 预加载所有 Image
   ```js
   function loadImage(src) {
     return new Promise((resolve, reject) => {
       const img = new Image();
       img.onload = () => resolve(img);
       img.onerror = reject;
       img.src = src;
     });
   }
   const BASE = "../../../assets/library_2d";
   const [playerImg, floorImg] = await Promise.all([
     loadImage(`${BASE}/tiles/dungeon/tile_0030.png`),
     loadImage(`${BASE}/tiles/dungeon/tile_0000.png`),
   ]);
   // 渲染时使用 ctx.drawImage(playerImg, x, y, w, h)
   ```

   **DOM**：用 `<img>` 标签或 CSS `background-image`
   ```html
   <img src="../../../assets/library_2d/tiles/dungeon/tile_0030.png" alt="player">
   ```

3. **在渲染/实体创建时使用已加载素材**，替换语义适配通过的程序化占位图形。文字承载型卡片、输入框、透明 HUD 等没有合适贴图时，优先保留 `graphics-generated`，不要用不透明按钮图强行铺底。
4. **加载失败降级**：如果 `local-file` 素材路径不存在，降级为 `type: generated` 模式（程序化绘制），但必须在控制台输出 warning

#### 检查清单

- [ ] `assets.yaml` 中每个语义适配通过的 `type: local-file` 条目在代码中都有对应的加载调用
- [ ] 加载路径正确（相对路径回退到素材库）
- [ ] 渲染代码使用了加载的素材；若使用 `fillRect` / `Graphics.rect()` / CSS `background-color`，对应条目必须是 `graphics-generated` 或有明确 fallback reason
- [ ] 有加载失败的降级处理（不至于白屏）
- [ ] spritesheet 的 frameWidth/frameHeight 与 assets.yaml 中的定义一致

#### 硬规则：registry 不是"注册即消费"

codegen 常见失误模式（背单词 phaser/pixijs case 已复现）：

```
生成了 assets.manifest.json ✅
生成了 adapters/<engine>-registry.js ✅
业务代码（scenes/main.js）0 次 add.image / 0 次 new Sprite / 0 次 drawImage ❌
```

**只在 manifest 注册不算消费**。每个 `type: local-file` 条目必须在业务代码（非 adapter / 非 manifest）中有**至少一次**引擎级消费调用：

| 引擎 | 最小消费调用 |
|---|---|
| canvas | `ctx.drawImage(registry.getTexture(id), x, y)` 或 `<img src="...">` |
| dom-ui | `<img src="{registry.getTextureUrl(id)}">` 或 CSS `background-image: url(...)` |
| phaser3 | `this.add.image(x, y, id)` / `this.add.sprite(x, y, id)` / `this.sound.add(id)` |
| pixijs | `new Sprite(registry.getTexture(id))` 或 `Sprite.from(id)` |
| three | `new THREE.TextureLoader().load(url)` / `new GLTFLoader().load(url)` / `new THREE.Sprite(new SpriteMaterial({ map: tex }))` |

**业务代码 vs adapter/manifest 的区分**：`game/src/adapters/*` 与 `game/src/assets.manifest.json` 是 codegen 自动铺设的数据管线，不计入"业务消费"。消费必须发生在 `scenes/`、`main.js`、`index.html` 等真正的玩法/渲染代码里。

#### Hard gate：由 `check_project.js` 链式执行

codegen 完成后必须跑 `check_project.js`。它会链式调用以下三条门槛，均通过才能 `completed`：

```bash
node game_skill/skills/scripts/check_project.js cases/{slug}/game/ --log ${LOG_FILE}
```

`check_implementation_contract.js` 校验：
- `specs/implementation-contract.yaml` 存在且结构完整
- `boot` 的 scene/zone/transition target 都能在 `scene.yaml` 找到
- 每个 local-file 素材都有 asset-bindings
- 文字承载 UI 不绑定错误素材（如 button 图片当 card surface）
- required local-file 必须出现在 manifest 且在业务代码形成消费证据
- Phaser 禁止 `scene.load.start()` 这类 create 阶段加载反模式

`check_asset_selection.js` 校验：
- color-scheme.palette-id 可映射为 catalog asset-style，genre 是 catalog 登记的合法 id
- 每个 `type: local-file` 的文件实际存在
- 每个 `type: local-file` 所属 pack 的 `suitable-styles` / `suitable-genres` 覆盖当前 asset-style + genre 组合（捕获"选了风格不匹配的素材"）
- local-file 占比 ≥ 阈值（统一 images ≥ 30%；audio ≥ 30%）
- 存在 `selection-report` 段说明候选包的取舍
- **`no-external-assets` 约束不豁免 ratio 检查**（此约束仅禁止远程 CDN/HTTP 运行时依赖，不禁止仓库内 `assets/library_2d/`、`assets/library_3d/` 这类项目自包含的 local-file 素材）

`check_asset_usage.js` 校验：
- 每个 `type: local-file` 的 id/basename 在业务代码中有引用（≥ 60%）
- 业务代码中存在引擎级消费调用（按引擎分类的最小模式，见上表）

需要诊断单层失败时，可单独运行：

```bash
node game_skill/skills/scripts/check_implementation_contract.js cases/{slug}/ --stage codegen
node game_skill/skills/scripts/check_asset_selection.js cases/{slug}/
node game_skill/skills/scripts/check_asset_usage.js   cases/{slug}/
```

任一失败不得进入 Phase 5 验证。

### Step 6：引擎特定填充规则

读 `_index.json` 当前 runtime 对应 guide 的「LLM 易错点」章节，避开这些错误。

| runtime | 必须做的事 |
|---|---|
| dom-ui | 单向 state→render，禁止事件处理直接改 DOM；primitive-backed 模板默认 `run-mode=local-http`；无 runtime import 的纯静态页才可 `file` |
| canvas | `update(state, dt)` 与 `draw(ctx, state)` 严格分离；简单项目默认 `run-mode=file` |
| phaser3 | 默认 `run-mode=local-http`；CDN pin `phaser@3`；`window.game` 暴露；Container 交互必须 `setSize` 或显式 hitArea |
| pixijs | 默认 `run-mode=local-http`；`await app.init()`；`app.canvas` 非 `app.view` |
| three | 默认 `run-mode=local-http`；**必须** importmap pin `three@0.160` 且位于 head 中 `<script type="module">` 之前；`window.app = { renderer, camera, active }` 暴露；只能用 ESM `import * as THREE from "three"`，禁 `require("three")` 与 `three@latest`；每帧不要 new 几何体/材质；至少一盏光（HemisphereLight + DirectionalLight）；相机离开原点（如 `camera.position.set(0, 4, 8)`）避免卡在物体里 |

### Step 6.1：玩法原语落地规则

这些规则来自 mechanics 层，不是可选建议。**canvas / pixijs / phaser3** 上这些规则由
`_common/primitives/*.runtime.mjs` runtime 库强制实现，业务代码只做 wiring（见 §4.0.6）；
**dom-ui** 上逻辑/资源/状态/生命周期 primitive 也必须走 runtime，空间/运动 primitive
仍由业务代码按 DOM 布局手写并保留 trace 证据；three 仍在过渡期。

- `parametric-track.shape=rect-loop`：画棋盘四周的直角闭环。Canvas 禁用 `ctx.arc()` 画轨道；DOM/Phaser/Pixi 禁用圆形 path 代替外圈。
- `parametric-track + grid-projection`：每个运动 agent 必须维护 `gridPosition`，并随 `t/segmentId` 更新。canvas/pixijs/phaser3 用 `tickTrack({ agent, dt, params })` 推进。
- `ray-cast.coord-system=grid`：射线从 `source.gridPosition + direction` 开始逐格扫描；禁止只根据 `segmentId` 从整行/整列固定起点扫。canvas/pixijs/phaser3 必须 `import { rayCastGridFirstHit } from './_common/primitives/index.mjs'`（或 `'../_common/...'`），禁止手写扫描循环。
- `predicate-match(fields:[color])`：ray-cast 只返回第一个阻挡候选，颜色匹配在 predicate 层做；禁止先全局找同色块再攻击。canvas/pixijs/phaser3/dom-ui 必须用 `predicateMatch({ left, right, params })`。
- `resource-consume`：扣除 `agent-field` 与 `target-field` 后再发事件，不能只改视觉。canvas/pixijs/phaser3/dom-ui 必须用 `consumeResource({ agent, target, params })`，禁止手写 `agent.ammo--`。
- DOM UI：只初始化静态 shell 一次，tick 中做 keyed update；禁止在 `setInterval` / `requestAnimationFrame` 中整页 `innerHTML = ...`，否则会闪烁和丢事件绑定。
- Phaser/Pixi：首屏必须真实可见，StartScene/入口要有标题或开始按钮，点击后进入 playing；不能只创建空 canvas 等待测试 hook。
- Phaser：任何 `Container` 绑定 `pointerdown` 前必须 `setSize(w,h)` 或显式 `setInteractive(hitArea, callback)`。禁止对由 `createXxx()` 返回的 Container 在调用方直接 `setInteractive({ useHandCursor: true })`，因为真实点击会出现 hitAreaCallback 错误或无响应。

### Step 7：hard-rule 落点校验

对每条 `@constraint(kind: hard-rule)`，在代码里注释对应实现点：

```js
// @hard-rule(no-global-autoaim): 仅检测当前 direction 的第一个目标块
```

同时对 `must-have-features` 做最小落点校验：

```js
// @must-have(combo-system): 连击加分系统已实现
```

### Step 7.1：异步交互安全检查（通用，所有引擎）

在代码生成完成后，必须**逐一检查**所有包含异步操作的交互链路：

**检查清单：**

1. **异步间隙加锁**：凡有 `setTimeout` / `requestAnimationFrame` 回调 / Phaser `delayedCall` / tween `onComplete` 等异步窗口，必须确保在异步开始时设置 `isProcessing = true`，在**所有**异步分支的最终回调中释放锁。用户输入处理函数入口必须检查锁状态并提前 return。

2. **动画 target 独立性**：凡动画（CSS transition / Canvas 动画 / Phaser tween / PixiJS ticker）同时作用于多个对象，且起始/结束值依赖各对象自身属性（坐标、透明度等）时，**必须为每个对象创建独立动画**，禁止共用同一组参数值。

3. **状态与视觉同步**：异步操作中修改状态（如 `selected = false`）的时机必须与视觉恢复（如卡片样式重置）严格同步——要么都在异步回调内，要么都在外面，不能一个在回调内、一个在回调外。

**触发条件**：以下代码模式出现时必须做此检查——
- `setTimeout` / `setInterval` + 用户输入处理
- `requestAnimationFrame` + 点击/键盘事件
- Phaser: `this.time.delayedCall` / `this.tweens.add` + `pointerdown`
- PixiJS: `app.ticker.add` / `gsap.to` + 交互事件
- DOM: CSS `transitionend` / `animationend` + click 事件
- Canvas: 自定义动画循环 + 用户输入

### Step 8：自检 + 硬门槛（不可跳过）

代码写完后，**必须依次通过**以下检查才能标记 codegen completed：

#### 8.1 工程侧硬门槛

```bash
node ${SKILL_DIR}/scripts/check_mechanics.js cases/${PROJECT}
node ${SKILL_DIR}/scripts/check_project.js cases/${PROJECT}/game/ --log ${LOG_FILE}
```

两条退出码都必须为 0。包含玩法结构检查与引擎专属静态检查：
- phaser3：代码中必须有 `window.game`
- phaser3：Container 交互对象必须有 `setSize` 或显式 hitArea
- pixijs：必须有 `window.app`、`await app.init()`、禁 `app.view`
- phaser3/pixijs/canvas/three：必须暴露 `window.gameTest` 或 `simulateCorrectMatch`
- 交互类玩法：必须出现 `isProcessing` 或等效异步锁字段

#### 8.2 冒烟硬门槛

```bash
node ${SKILL_DIR}/scripts/check_game_boots.js cases/${PROJECT}/game/ --log ${LOG_FILE}
```

退出码必须为 0。除原有检查外，引擎项目还会校验：
- `window.gameTest` 存在（Canvas/Pixi/Phaser/Three）
- 点击开始按钮后 `phase` 能变为 `playing`（"能开始一局"）

#### 8.3 契约、素材加载与消费校验（由 check_project 覆盖）

`check_project.js` 已经链式执行 contract / asset-selection / asset-usage 三层门槛，确保契约、素材选择和业务消费全部闭环。校验逻辑见 Step 5.4 的 "Hard gate" 段；只有定位失败时才需要单独运行子脚本。

常见失败：
- `check_asset_selection`: `images: []` + 风格是 pixel-retro/cartoon-bright → FAIL；通常是 expander 误读 `no-external-assets` 约束导致
- `check_asset_usage`: manifest 里 20+ 个 image id，但 `scenes/main.js` 里 0 次 `add.image`/`new Sprite`/`drawImage` → FAIL；通常是 codegen 只搭了 preload 管线没做业务消费

**check_mechanics + check_project + check_game_boots 全部通过后才能标 codegen completed。**
未通过 → 进入修复循环（≤3 轮）。

#### 8.4 补充自检（非脚本，人工 review）

- 所有 `must-have-features` 在代码或 UI 中都有可观察落点
- 引擎标识注释存在：`grep "<!-- ENGINE: ${RUNTIME}" game/index.html`

### Step 9：更新状态

```json
{
  "codegen": {
    "status": "completed",
    "outputs": ["game/index.html", "game/src/"],
    "runtime": "dom-ui",
    "run-mode": "file",
    "engine-version": "@tailwindcss/browser@4"
  }
}
```

---

## 修复循环

Step 8 的硬门槛（`check_project.js` + `check_game_boots.js`）未通过时：

- 最多 **3 轮修复**
**每一轮修复必须严格执行以下 3 步**：

**Step A — 记录失败详情到日志**（在修改代码之前）：
```bash
echo '{"timestamp":"'$(date -u +%FT%TZ)'","type":"fix-applied","phase":"codegen","round":<N>,"failures":["<逐条列出脚本报告的错误>"],"fix_description":"<计划修复什么>","files_changed":["<将要修改的文件>"]}' >> ${LOG_FILE}
```

**Step B — 修改代码修复问题**

**Step C — 重跑未通过的门槛脚本**（带 `--log`）

> ⚠ **Step A 是硬性要求**。不写日志就修代码 = 违规。

- 超限（3 轮）标 failed，返回未通过项

---

## 禁止事项

| ❌ | ✅ |
|---|---|
| 本地 `import` 路径用 `@scenes/...` 等别名 | 用相对路径 `./scenes/MainScene.js` |
| `run-mode=file` 还写 `<script type="module" src="./src/main.js">` | 改 `run-mode=local-http`，或退回 classic/inline script |
| `phaser@latest` / `pixi.js@latest` | pin 主版本 |
| 在 codegen 里添加 npm install 指示 | 零构建 |
| 引用未在 `_index.json` 登记的引擎 | 先按 `_adding-new-engine.md` 登记 |
| 不暴露 `window.gameState` | 每个 runtime 都必须暴露 |
| 把用户点名核心功能静默删掉 | 若实现不了，升级为风险或失败，不得偷删 |

---

## 输出清单

- [ ] `game/index.html` 含 `<!-- ENGINE: ... | RUN: ... -->` 注释
- [ ] CDN 引用 pin 主版本（读 `_index.json.version-pin`）
- [ ] `window.gameState` 至少有一处暴露
- [ ] JS 文件 `node --check` 全通过
- [ ] 所有 hard-rule 在代码里有对应注释
- [ ] 所有 `must-have-features` 有对应实现或显式降级说明
- [ ] **`check_mechanics.js` 退出 0**（玩法 primitive DAG 可执行，至少一个 win scenario 可达）
- [ ] **`check_project.js` 退出 0**（含引擎专属静态检查、implementation-contract、asset-selection、asset-usage）
- [ ] **`check_game_boots.js` 退出 0**（游戏能启动 + 能开始一局）
- [ ] `state.json` `codegen.status = "completed"`
