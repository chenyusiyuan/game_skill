更准确地说：

```
工程方向：正确
P0 修复完成度：较高，约 75%～80%
是否可以继续小批量跑真实 case：可以
是否适合大规模跑高频模板 / 批量生成：还不建议
```

我这轮没有看到你之前提到的 `problem_case / problen_case` 目录。压缩包里只有 `cases/anchors/README.md`，没有最新失败 case 的游戏代码、Claude Code 历史和分析报告。所以这次 review 主要是看**链路代码本身**，不是逐 case 复盘。

------

## 1. 上轮指出的问题：完成情况

| 上轮问题                                                 | 本轮状态 | 判断                                                         |
| -------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| `js-yaml` 没进 `package.json`                            | 已修     | `package.json` 和 lock 里都有 `js-yaml`                      |
| engine adapter `_common` import 路径错                   | 已修     | canvas/phaser/pixi/three/dom 都改成 `../_common/...`         |
| 缺 template import path 测试                             | 已修     | `scripts/test/run.js` 已加模板 import resolver 测试          |
| runtime replay schema 不一致                             | 基本已修 | predicate / fsm / win-lose 等已对齐，我做了 smoke 验证       |
| runtime probe 的 `nonMutation` 没执行                    | 已修     | `check_runtime_semantics.js` 已读取 snapshot 并比较核心字段  |
| `check_playthrough` 的 `click-hits-nothing` 不真正 fail  | 已修     | 现在进入 `profileRuntimeErrors -> traceErrors` 链路          |
| asset evidence 只有 requested，没有 rendered/visible     | 部分修   | helper 和 checker 已升级，但 canvas/dom 模板还没闭环         |
| visual-slots 没落地                                      | 部分修   | 有 `generate_visual_slots.js/check_visual_slots.js`，但缺失时仍是 warn/pass |
| runtime primitive import 只查 import 不查 call/node/rule | 已修很多 | 现在查 import、call、`node`、`rule` 绑定                     |
| verify_all 没纳入新 gate                                 | 已修     | `visual_slots/runtime_semantics/level_solvability/pipeline_patterns` 都进了 |

------

## 2. 已经修得比较好的部分

### 2.1 `js-yaml` 依赖已补

新的 `package.json` 里已经有：

```
"devDependencies": {
  "js-yaml": "^4.1.1",
  "playwright": "^1.59.1"
}
```

这解决了我上次说的 clean checkout 下大量 checker 直接 `ERR_MODULE_NOT_FOUND` 的问题。

但我在当前沙箱里没有完整跑通 `npm test`，因为压缩包不含 `node_modules`，`npm install` 在沙箱里超时了。这个不是代码逻辑问题，但你自己机器或 CI 上应该补一条硬检查：

```
rm -rf node_modules
npm install
npm test
```

这条必须跑过，才算 clean checkout 可用。

------

### 2.2 engine adapter 的 `_common` import 路径已修

我检查了模板里的 `_common` import，现在已经从之前错误的：

```
../../../_common/...
```

改成了正确的：

```
../_common/...
```

例如：

```
import { validateManifest, buildStats } from "../_common/registry.spec.js";
import { recordAssetUsage } from "../_common/asset-usage.js";
```

这个问题以前会直接导致浏览器 ESM import 失败、白屏。现在方向是对的。

你还在 `scripts/test/run.js` 里加了模板路径测试：

```
Engine templates: _common import paths resolve after codegen copy
```

这是非常好的改法。它把“模板路径别再写错”变成了单元测试，不再靠人工记忆。

------

### 2.3 runtime replay schema 基本修好

我重点看了 `_runtime_replay.js`。之前我指出的几个不一致基本都修了。

现在：

```
verifyPredicateMatch()
```

已经兼容：

```
before.left / before.right
before.candidate / before.filter
```

`fsm-transition` 也改成了 reducer 需要的：

```
{ state: currentState }
```

`win-lose-check` 也改成了：

```
reducer.step(before, { type: "evaluate", ctx: before }, params)
```

我还手动做了 runtime smoke：

```
predicate-match@v1  -> replay ok:true
resource-consume@v1 -> replay ok:true
fsm-transition@v1   -> replay ok:true
win-lose-check@v1   -> replay ok:true
```

这说明 runtime emit trace 和 replay checker 至少在这几个核心 primitive 上已经对齐。

------

### 2.4 `nonMutation` 已经真正执行

`_runtime_probes.js` 里 `no-penetration.mismatch` 仍然有：

```
nonMutation:
  - b-0-2
  - b-1-2
```

这次 `check_runtime_semantics.js` 已经实际执行了：

```
checkProbeStateExpectations(probe, baselineSnapshot, page)
```

它会：

```
1. resetWithScenario 后读 baseline snapshot；
2. 执行动作；
3. 再读 after snapshot；
4. 按 id 找实体；
5. 比较 alive / durability / hp / ammo / lifecycle / position 等核心字段。
```

这就能防住以前的问题：

```
trace 里 ray-cast 看起来命中正确，
但实际业务代码偷偷改了远处 block 的 durability。
```

这一块是实质性进步。

------

### 2.5 `check_playthrough` 的 click 空点问题已修

你现在的逻辑是：

```
if (interactionInertAssertions.length >= 3) {
  profileRuntimeErrors.push(msg);
}
...
traceErrors.push(...profileRuntimeErrors);
```

这比之前强很多。之前的问题是错误被 push 到 `profileShapeErrors`，但早期 shape fail 已经过去，后面不会再退出。现在它进入 `traceErrors`，会影响最终 playthrough 结果。

这条能更好地防止：

```
profile 里写了 click，但 click 实际没点到东西；
后面靠 gameTest.drivers.* 推进业务；
测试绿了，但真实 UI 交互是坏的。
```

------

### 2.6 `verify_all.js` 和 `run_phase_gate.js` 已经更像正式门禁

新的 `verify_all.js` 已纳入：

```
asset_selection
implementation_contract
visual_slots
boot
project
profile_runner_smoke
playthrough
runtime_semantics
level_solvability
pipeline_patterns
compliance
```

`run_phase_gate.js` 也把 expand/codegen/verify 阶段都收束起来了：

```
expand:
  check_spec_clarifications
  check_mechanics
  check_asset_selection
  check_implementation_contract --stage expand
  check_visual_slots
  check_level_solvability

codegen:
  check_mechanics
  check_project
  check_game_boots
  check_implementation_contract --stage codegen
  check_visual_slots
  check_runtime_semantics
```

这说明你已经从“文档要求 agent 跑”推进到了“runner 阻断”。方向正确。

------

## 3. 仍未完成的关键问题

### 3.1 新发现的 P0：`predicateMatch` 的 codegen 示例和 runtime API 不一致

这是这轮 review 里我认为最严重的问题。

你的 runtime 实现是：

```
export function predicateMatch(ctx) {
  const { rule, node = null, left, right, params = {} } = ctx;
  if (!left || !right) return false;
  ...
}
```

也就是说，runtime 只接受：

```
predicateMatch({
  rule,
  node,
  left,
  right,
  params: { fields: ["color"], op: "eq" }
})
```

但 `codegen.md` 和 `scripts/test/run.js` 的集成样例里用了：

```
const match = predicateMatch({
  rule: 'match-color',
  node: 'match-color',
  candidate: hit,
  filter: { color: pig.color },
});
```

这会出大问题。

我手动验证了当前 runtime：

```
predicateMatch({
  rule: "r",
  node: "n",
  candidate: { color: "red" },
  filter: { color: "red" },
  params: { fields: ["color"] }
});
```

结果是：

```
ok = false
trace length = 0
```

原因是 runtime 没有读取 `candidate/filter`，直接因为缺 `left/right` 提前 return false，并且不会 push trace。

这会导致真实 case 出现非常隐蔽的问题：

```
check_implementation_contract 看到 predicateMatch 被 import + call + 带 node/rule，于是通过；
runtime 运行时 predicateMatch 实际直接 false；
没有 predicate-match trace；
后续 consume 不触发；
游戏表现为“不攻击 / 不匹配 / 玩法坏了”。
```

这类问题会让你觉得“runtime 和 gate 都加了，为什么 case 还是坏”，因为 checker 现在没有检查 `predicateMatch` 的参数 shape。

#### 建议立刻修

优先改文档和测试，把所有：

```
predicateMatch({
  candidate: hit,
  filter: { color: pig.color }
})
```

改成：

```
predicateMatch({
  rule: "match-color",
  node: "match-color",
  left: pig,
  right: hit,
  params: {
    fields: ["color"],
    op: "eq"
  }
});
```

如果你想兼容旧写法，可以同时改 runtime：

```
export function predicateMatch(ctx) {
  const left = ctx.left ?? ctx.candidate;
  const right = ctx.right ?? ctx.filter;
  const params = ctx.params ?? {};

  if (!left || !right) return false;
  if (!Array.isArray(params.fields) || params.fields.length === 0) {
    // 严格模式建议直接 return false + trace error，或者让 checker fail
    return false;
  }

  ...
}
```

但我更建议**不要自动从 filter 推 fields**，因为：

```
filter: { color: pig.color }
```

看似能推 `fields=["color"]`，但对更复杂 predicate 会变得不清楚。最好让 codegen 明确写：

```
params: { fields: ["color"], op: "eq" }
```

同时在 `check_implementation_contract.js` 里新增：

```
checkPredicateMatchRuntimeContract:
  每个 predicateMatch 调用必须包含：
    left
    right
    params.fields 非空数组
```

否则这个坑还会反复出现。

------

### 3.2 asset evidence 只完成了一半：checker 已升级，canvas/dom 模板没闭环

你现在的 `_common/asset-usage.js` 已经很好了，新增了：

```
recordAssetUsage()
recordAssetRendered()
recordAssetVisible()
recordAssetRenderEvidence()
renderSlot()
getAssetUsageSnapshot()
```

`check_asset_usage.js` 也已经升级为按 phase 检查：

```
audio:
  requested

普通视觉 asset:
  requested + rendered

core visual asset:
  requested + rendered + visible
```

这个方向完全正确。

但模板层还有断点。

我检查各引擎 registry：

```
phaser3: 有 recordAssetRenderEvidence
pixijs:  有 recordAssetRenderEvidence
three:   有 recordAssetRenderEvidence

canvas:  只有 recordAssetUsage
dom:     只有 recordAssetUsage
```

也就是说，canvas/dom 现在默认只能记录：

```
requested
```

不能模板级记录：

```
rendered / visible
```

虽然 `_common/asset-usage.js` 里有 `renderSlot()`，但 canvas/dom 模板没有原生封装 `drawAsset()` / `renderImageElement()` 这类 API。这样就把关键证据又丢回给 codegen/LLM 自觉调用。

这会导致两种情况：

```
情况 A：
  codegen 忘了 recordAssetRendered / renderSlot
  -> check_asset_usage fail
  -> case 过不了

情况 B：
  为了过 checker，codegen 手写 recordAssetRendered
  -> 可能没有真实 drawImage / DOM 插入
  -> 又变成面向测试补证据
```

#### 建议修法

给 canvas registry 增加一个真实渲染 wrapper：

```
drawAsset(ctx, id, rect, opts = {}) {
  const img = this.getTexture(id, opts.extra ?? null);
  if (!img) return false;

  ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height);

  recordAssetRenderEvidence({
    id,
    section: "images",
    kind: "canvas-draw-image",
    manifestItem: manifestImageById.get(id),
    slotId: opts.slotId ?? null,
    entityId: opts.entityId ?? null,
    semanticSlot: opts.semanticSlot ?? null,
    renderZone: opts.renderZone ?? null,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    visible: true,
    source: "canvas-registry.drawAsset"
  });

  return true;
}
```

给 DOM registry 增加：

```
createImageElement(id, opts = {}) {
  const url = this.getTextureUrl(id, opts.extra ?? null);
  if (!url) return null;

  const img = document.createElement("img");
  img.src = url;
  ...

  recordAssetRenderEvidence({
    id,
    section: "images",
    kind: "dom-img",
    width,
    height,
    visible: true,
    source: "dom-registry.createImageElement"
  });

  return img;
}
```

然后 codegen 明确禁止 canvas/dom 业务代码裸写：

```
ctx.drawImage(registry.getTexture(id), ...)
```

而要写：

```
registry.drawAsset(ctx, id, rect, { entityId, slotId })
```

这样 asset evidence 才不是“补 trace”，而是真实渲染副产品。

------

### 3.3 `visual-slots` 已有雏形，但仍是过渡模式，不是硬约束

你现在新增了：

```
generate_visual_slots.js
check_visual_slots.js
```

这是对的。

`check_visual_slots.js` 能检查：

```
visual-slots-version
slot.id / entity / semantic-slot / render-zone / state-driven-fields
asset fulfills-slot 是否存在
核心 must-render asset 是否绑定 slot
slot.entity 是否和 binding-to 一致
visual-primitive 是否在 allowed-visual-primitives 内
asset-kind 是否命中 disallowed-asset-kinds
required slot 是否有 must-render asset
```

这说明你已经开始把素材从：

```
binding-to
```

升级到：

```
fulfills-slot / semantic-slot / render-zone
```

但它现在还有一个重要限制：

```
if (!existsSync(visualSlotsPath)) {
  warn("specs/visual-slots.yaml 不存在，按过渡策略跳过");
  finish();
}
```

也就是说，`visual-slots.yaml` 不存在时仍然 pass。

这适合兼容旧 case，但对“新链路生成质量”来说还不够硬。

#### 建议修法

在 `run_phase_gate.js` 或 `check_visual_slots.js` 里加新 case 判定：

```
如果 asset-strategy.visual-core-entities 非空
且 implementation-contract 有 must-render core visual asset
则 specs/visual-slots.yaml 必须存在。
```

旧 case 可以用 flag 豁免：

```
check_visual_slots.js cases/foo --allow-missing
```

但正常新链路不要默认跳过。

------

### 3.4 `decor > 40%` 仍然只是 warn

`check_asset_selection.js` 里 decor 占比仍然是 warning：

```
if (decorRatio > 0.4) {
  warn(...)
}
```

这条不是 P0，但会影响素材乱用/偷懒不用问题。

你现在已经有：

```
visual-core-entities
core binding 检查
visual-primitive 检查
visual-slots 检查
```

所以可以逐步把 decor 规则升级成：

```
如果 visual-core-entities 非空：
  任一 core entity 不允许靠 decor 满足；
  local-file decor ratio > 40% => fail

如果 visual-core-entities 为空：
  decor ratio > 40% => warn
```

现在它仍然偏宽松。

------

### 3.5 runtime_semantics 仍然偏 ray-cast 专项，不是通用 primitive scenario

当前 `check_runtime_semantics.js` 的 selector 主要来自：

```
selectApplicableProbes(mech)
```

而 `_runtime_probes.js` 目前主要是：

```
RAY_CAST_GRID_PROBES
```

也就是说，它对 Pixel Flow 这类：

```
parametric-track + ray-cast + predicate-match + resource-consume
```

非常有帮助。

但对于：

```
quiz-rule
2048
gomoku
memory-match
slot-pool/capacity-gate/lifecycle
```

还没有对应 probe pack。

虽然 `_runtime_replay.js` 已经能 replay 很多 primitive，但前提是浏览器里已经产生了 trace。若某个 primitive 调用参数错、提前 return、没有 push trace，当前 checker 不一定能发现。

`predicateMatch(candidate/filter)` 这个问题就是例子：

```
primitive API 被调用了；
node/rule 静态检查过了；
但 runtime 提前 return false，没有 trace；
runtime_semantics 不一定知道这个 primitive 应该产生 trace。
```

所以后续需要补：

```
1. API call-shape checker；
2. 每类 archetype 的 semantic probes；
3. 每个 mechanics node 至少一个 runtime trace 证据，或声明允许 silent。
```

------

## 4. 这次新增的好东西

除了修我上轮的问题，你还额外加了一些值得保留的东西。

### 4.1 archetype preset 方向正确

你新增了：

```
references/archetypes/index.yaml
references/archetypes/quiz-rule.yaml
references/archetypes/board-grid.2048.yaml
references/archetypes/board-grid.gomoku.yaml
references/archetypes/board-grid.memory-match.yaml
check_archetype_presets.js
```

`check_archetype_presets.js` 明确禁止 archetype 携带完整 game code template，只允许提供：

```
archetype-plan
mechanics-preset
data-schema
visual-slots-preset
profile-skeleton
gate-policy
runtime-modules
semantic-probes
```

这个方向是对的。它避免了“高频模板”退化成厚代码模板。

### 4.2 failure attribution / pipeline patterns 方向正确

`verify_all.js` 现在失败后会生成：

```
failures/<timestamp>-<check>-fail.md
```

而且下一次 `verify_all` 前会检查 attribution 模板是否填完。

这非常好。它会强迫每次失败都回答：

```
起源层在哪里？
根因是什么？
修在哪里？
不动哪里？
是否属于重复 pattern？
```

这正是你后续根据实际 case 优化链路最需要的纪律。

------

## 5. 我建议你立刻补的几个点

### P0：修 `predicateMatch` API 不一致

这是当前最该修的。

改三处：

#### 1. 改 `codegen.md`

把示例改成：

```
const match = predicateMatch({
  rule: "match-color",
  node: "match-color",
  left: pig,
  right: hit,
  params: {
    fields: ["color"],
    op: "eq"
  }
});
```

#### 2. 改 `scripts/test/run.js`

把集成 fixture 里这个：

```
predicateMatch({
  rule: 'match-color',
  node: 'match-color',
  candidate: hit,
  filter: { color: pig.color },
});
```

改成：

```
predicateMatch({
  rule: 'match-color',
  node: 'match-color',
  left: pig,
  right: hit,
  params: { fields: ['color'], op: 'eq' },
});
```

#### 3. 给 `check_implementation_contract.js` 加 call-shape 检查

新增：

```
checkPredicateMatchRuntimeContract:
  predicateMatch 调用必须包含：
    left
    right
    params.fields
```

如果你为了兼容旧 case，也可以让 runtime 支持 alias：

```
const left = ctx.left ?? ctx.candidate;
const right = ctx.right ?? ctx.filter;
```

但即使兼容 alias，也建议 checker 对新 case 强制 left/right。

------

### P0：补 canvas/dom render evidence wrapper

现在 asset checker 已经升级，如果不补 canvas/dom wrapper，会让 codegen 很容易卡在素材 rendered/visible 证据上。

建议加：

```
canvas-registry.js:
  drawAsset(ctx, id, rect, opts)

dom-registry.js:
  createImageElement(id, opts)
  setBackgroundAsset(el, id, opts)
```

并且在 `check_asset_usage.js` 的静态 pattern 中优先识别这些 wrapper。

------

### P1：让 `visual-slots.yaml` 对新 case 必填

当前缺失只是 warn。建议改成：

```
asset-strategy.visual-core-entities 非空
  -> visual-slots.yaml 必填

asset-strategy.mode = none
  -> 可跳过

旧 case
  -> 显式 --allow-missing
```

否则 visual-slots 会变成“有也行，没有也行”的软建议。

------

### P1：补 archetype semantic probes

你已经有 archetype preset 了，下一步不要急着写更多模板，先给已有四个补 probe：

```
quiz-rule:
  correct-answer-advances
  wrong-answer-feedback
  finish-after-last-question

board-grid.2048:
  merge-once-per-tile
  no-move-no-spawn
  spawn-after-valid-move

board-grid.gomoku:
  five-in-row-win
  four-not-win
  blocked-but-still-five-win 按规则定义

board-grid.memory-match:
  same-pair-stays-open
  wrong-pair-flips-back
  all-pairs-win
```

这些 probe 才是模板真正拉开通用 app 生成的地方。

------

## 6. 我对当前压缩包的最终判断

### 已完成

```
1. js-yaml 依赖声明。
2. engine adapter _common 路径修复。
3. template import path 单测。
4. runtime replay schema 大体对齐。
5. nonMutation 语义检查。
6. click-hits-nothing 进入 fail 链路。
7. verify_all / run_phase_gate 纳入更多 gate。
8. visual-slots 过渡层。
9. archetype preset 基础。
10. failure attribution / pipeline pattern 基础。
```

### 未完成 / 仍需补

```
1. predicateMatch codegen 示例和 runtime API 不一致，这是当前 P0。
2. canvas/dom 缺模板级 rendered/visible wrapper。
3. visual-slots 缺失仍然 pass，对新 case 不够硬。
4. decor 高占比仍然只是 warn。
5. runtime_semantics 仍主要覆盖 ray-cast，不覆盖 quiz/2048/gomoku 等 archetype probe。
6. npm test 未在 clean install 环境验证通过。
```

### 是否需要再重构链路？

**不需要大重构。**

你现在已经走在正确方向上。当前应该做的是**收敛性补全**，不是推倒重来。

下一步优先顺序我建议是：

```
1. 修 predicateMatch API / codegen 示例 / checker call-shape。
2. 给 canvas/dom 补真实 render evidence wrapper。
3. 新 case 强制 visual-slots.yaml。
4. 跑 clean install + npm test。
5. 用 2 个真实 case 验证：
   - quiz-rule
   - board-grid.2048 或 Pixel Flow
6. 每个失败 case 都走 failures attribution，不允许直接改到绿。
```

如果这六步跑通，你这条链路就可以进入下一阶段：**用真实 case 反复提炼 archetype probes 和 data generator**，而不是继续补 prompt。