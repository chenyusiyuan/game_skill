# TODO — three 引擎纳入 runtime primitive（Deliverable C）

**状态**：已推迟。原因：当前仓库没有真实 three runtime case（只有 template / 文档 / checker 逻辑 / 3D catalog），Codex 不接受伪造 fixture。

**前置依赖**：至少一个可跑通 `verify_all.js` 的 three fixture case（由用户提供，或先走一轮 PRD → codegen 生成一个真实小游戏作为基准 case）。

**上游已落地**：
- A: `cbc38ac` phaser3 收编
- B: `f15053d` dom-ui 收编 + `ENGINE_RUNTIME_PRIMITIVES` 数据表 + `applicablePrimitivesFor` / `isPrimitiveApplicableToEngine`
- three 在 `_primitive_runtime_map.js` 里**故意留空**等本 TODO 接入

---

## 拆分：C1（静态可做）+ C2（fixture 阻塞）

### C1 — 仅需静态验证，未来任何时刻都可执行

交给 Codex 前请确认：仍未找到 three fixture 的情况下只做 C1；找到 fixture 可直接做 C1+C2 合并 commit。

#### 1. 数据表接入 three

改 `game_skill/skills/scripts/_primitive_runtime_map.js`：

```javascript
export const ENGINE_RUNTIME_PRIMITIVES = Object.freeze({
  canvas: FULL_RUNTIME_PRIMITIVES,
  pixijs: FULL_RUNTIME_PRIMITIVES,
  pixi: FULL_RUNTIME_PRIMITIVES,
  phaser3: FULL_RUNTIME_PRIMITIVES,
  phaser: FULL_RUNTIME_PRIMITIVES,
  "dom-ui": DOM_UI_RUNTIME_PRIMITIVES,
  dom: DOM_UI_RUNTIME_PRIMITIVES,
  three: DOM_UI_RUNTIME_PRIMITIVES,  // three 与 dom-ui 共享逻辑层子集
});
```

- 逻辑层 9 个 primitive（predicate-match / resource-consume / fsm-transition / win-lose-check / score-accum / slot-pool / capacity-gate / entity-lifecycle / cooldown-dispatch）在 three 里可直接复用 runtime
- 空间/运动 primitive（parametric-track / ray-cast / grid-step / grid-board / neighbor-query）暂时豁免，等 3D 变体

#### 2. 新增 3D 空间 primitive gap 文档

新建 `game_skill/skills/references/engines/_common/primitives/3D_GAP.md`：

每个 primitive 一个小节，内容包含：
- **Primitive id**（如 `ray-cast@v1`）
- **2D 语义**（现有实现怎么做）
- **3D 语义需求**（世界坐标 / scene graph / 射线-mesh 相交等）
- **暂时替代策略**（LLM 手写 + `window.__trace.push` 手写 trace；或借用 three 内置 Raycaster + 三分类 observer 记录）
- **未来 runtime 文件名**（如 `ray-cast-3d.runtime.mjs`）

末尾追加 `## C2 deferred: real three fixture` 段，登记：
- 当前 repo 无 three runtime case；C1 已接入逻辑子集 + 文档化空间 gap
- C2 所需：真实 three case（用户提供或独立触发 PRD → Codegen → 新 case）
- C2 验收门槛：真实 case 上 `verify_all` 完整通过；逻辑子集 primitive 全部 import + 调用；空间 primitive 继续豁免

#### 3. three template 骨架接入

改 `game_skill/skills/references/engines/three/template/`：

**只改 trace sink + test-hooks 三分类命名空间**，不强制 primitive 调用（本轮 three 只 enrolled 逻辑子集，但 template 没有逻辑业务代码）：

- `window.__trace = window.__trace || [];`
- `window.gameTest = { observers: {...}, drivers: {...}, probes: {...} }`
- import 路径准备好：`import { /* 逻辑 primitive */ } from './_common/primitives/index.mjs';`（允许空 import 作为占位）
- `cp -R ${SKILL_DIR}/references/engines/_common/. game/src/_common/` 与 `cp -R ${SKILL_DIR}/references/mechanics/. game/mechanics/` 两条复用 phaser3/dom-ui 的模式

#### 4. 更新 codegen.md 豁免名单

改 `game_skill/skills/codegen.md:453` 附近：

> 当前：`**引擎例外**：dom-ui / three 过渡期允许不 import runtime`
>
> 目标：`**引擎例外**：three 的空间/运动 primitive（ray-cast / parametric-track / grid-step / grid-board / neighbor-query）过渡期允许手写；逻辑/资源/状态/生命周期 primitive 必须走 runtime`

#### 5. 单元测试

在 `game_skill/skills/scripts/test/check_implementation_contract.engine-subset.test.mjs` 新增 2 条：

```javascript
test("three applicable primitive subset matches dom-ui logic set", () => {
  const three = applicablePrimitivesFor("three");
  assert.equal(isEngineEnforced("three"), true);
  for (const p of ["predicate-match@v1", "score-accum@v1", "entity-lifecycle@v1"]) {
    assert.equal(three.has(p), true);
  }
  for (const p of ["parametric-track@v1", "ray-cast@v1", "grid-board@v1"]) {
    assert.equal(three.has(p), false);
  }
});

test("check_implementation_contract skips three spatial primitives without failing", () => {
  // fixture: engine=three + mechanics 含 ray-cast + 业务代码无 ray-cast import
  // 断言 checker 输出 "跳过 N 个不适用 primitive" 且 exit=0
  // 实现照搬 dom-ui subset test 的临时 fixture 模式
});
```

同步把 `run.js` 里的 `isEngineEnforced` 集成断言从 `!isEngineEnforced("three")` 改为 `isEngineEnforced("three")`，并新增 three 子集断言。

#### 6. Commit 约束

- 单独 commit，message：`feat(engines): enroll three for logic primitives, document 3D gaps`
- **验收命令**（不跑真实 three case）：
  ```bash
  node --test game_skill/skills/scripts/test/check_implementation_contract.engine-subset.test.mjs
  node game_skill/skills/scripts/test/run.js  # 若被 three 断言影响
  cat game_skill/skills/references/engines/_common/primitives/3D_GAP.md
  git grep "three" game_skill/skills/references/engines/three/template/ | head
  ```

#### 7. 绝对不做

- 不实现 3D 版 primitive（ray-cast-3d 等）
- 不新建 three fixture / problem_case 伪造 case
- 不跑 verify_all 假装通过
- 不动 dom-ui / phaser3 / canvas / pixijs 已 enrolled 的代码

---

### C2 — fixture 到位后再做

#### 前置

用户提供或独立触发生成一个真实 three 小游戏 case，至少满足：
- `specs/implementation-contract.yaml` 的 `runtime.engine === "three"`
- mechanics 含至少一个逻辑层 primitive（如 score-accum / win-lose-check）
- 业务代码使用 three 的 Scene / Camera / Mesh，有真实渲染
- 能启动（index.html 打开不白屏）

#### 工作项

1. 在新 case 上跑 `verify_all.js --profile <id>`，确认全链路通过
2. `check_implementation_contract.js --stage codegen` 在该 case 输出 "[runtime] runtime primitive import 完整" + "跳过 N 个不适用 primitive"
3. 按照与 A/B 一致的 fixture 策略把 `_common/primitives/**` + `game/mechanics/**` 拷入 case 目录
4. Commit：`feat(engines): validate three logic primitive enrollment on real case`

#### 3D primitive runtime 的后续（C2 之外）

若 three 真正进入主流使用，再开一个 stage：
- 实现 `ray-cast-3d.runtime.mjs`（基于 three 的 Raycaster + scene graph）
- 实现 `parametric-track-3d.runtime.mjs`（世界坐标曲线）
- 对应扩展 `ENGINE_RUNTIME_PRIMITIVES.three` 到 FULL
- 更新 3D_GAP.md 逐项归档

---

## 相关上下文文件

- 方案来源：`/Users/bytedance/Project/game_skill/生成层重构.md` §3 / §10
- 数据表：`/Users/bytedance/Project/game_skill/game_skill/skills/scripts/_primitive_runtime_map.js`
- Checker：`/Users/bytedance/Project/game_skill/game_skill/skills/scripts/check_implementation_contract.js`
- 三分类 schema：`/Users/bytedance/Project/game_skill/game_skill/skills/schemas/implementation-contract.schema.json`
- 引擎模板：`/Users/bytedance/Project/game_skill/game_skill/skills/references/engines/three/`
- A/B 参考实现：`cbc38ac`（phaser3）+ `f15053d`（dom-ui）
