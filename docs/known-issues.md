# Known Issues for Case Generation

本文档是 worker 在 Phase B 卡住时的只读引导。每条按 5 段写：症状 / 原因 / 推荐修法 / 备选修法 / 禁止项。

核心规则：不引用 sibling case 路径；修法以最小化脱敏代码片段或文字原则形式给出；每条都含“禁止项”，明确禁止从 sibling case 复制源码。

永不演化为 `protocol.json` / yaml / 自动匹配脚本。仅人工累积。

---

## Phaser Headless WebGL 不可用

### 症状

- `vite build` 通过，但 delivery 启动后 console 报 `WebGL not supported` 或 page 立刻 pageerror
- Chromium headless 默认无 WebGL，但 Phaser 启动时仍尝试 WebGL feature probe

### 原因

Phaser 默认 `type: Phaser.AUTO` 优先选 WebGL；headless Chromium 未启用 GPU 时 WebGL 上下文创建失败。

### 推荐修法

在 Phaser game config 显式指定 `type: Phaser.CANVAS`：

```ts
const config = {
  type: Phaser.CANVAS,
  width: 480,
  height: 360,
  scene: [PlayScene],
};
```

`plan.smoke.viewport` 只是 headless smoke 浏览器窗口，不要求 Phaser canvas 同尺寸。Phaser config 推荐使用 640×480 或 800×600，并设置 `scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }`；过大的 canvas 会增加 headless pixel readback 压力。

### 备选修法

如仍有 WebGL probe warning，在 `import "phaser"` 之前临时屏蔽 `window.WebGLRenderingContext`，import 完毕后恢复。这是 case-local 修复，不要扩散到 KEEP scaffold。

### 禁止项

- 不要修改 delivery runner 让它放宽 pageerror 判定
- 不要在 plan 的 `smoke.expect` 里下调 milestone timeout 来掩盖问题
- 不要从 sibling case 复制 main.ts 源码
- 不要修改 `templates/scaffold/main.ts` 占位

---

## Smoke 末尾误判 Game Over

### 症状

- `runner-result.json` 里 `diagnostic.failedExpects` 出现 `state` 失败，例如 `path: "gameState"`、`observed: "game-over"`、`needed: "playing"`
- 同时 `diagnostic.canvasMounted: true`、`pixelsAvailable: true`、`inputDispatched: true`、`stepsExecuted == stepsTotal`
- `milestonesAny` 大于 0，说明主循环曾经跑起来并发过 milestone

### 原因

smoke 输入序列太长或等待太久，让游戏在取证结束前进入 lose 终态。打砖块、平台跳跃、闪避类游戏都容易因为掉落、死亡、时间耗尽而出现这种误判。

### 推荐修法

- 缩短 `smoke.steps`，在进入 lose 前收集主闭环证据
- 把 `state` 断言换成更稳定的数值 / 计数字段，如 `score >= 1`、`lives >= 1`、`level >= 1`
- 若确实要断言状态，优先断言阶段内的可观测进展，不要把 `gameState == "playing"` 当唯一证据

### 备选修法

在 Phase A 重新设计 smoke：让它只覆盖主闭环最小证据，不追求完整通关或长时间存活。必要时把更长的体验验证放进 Stage2 issue。

### 禁止项

- 不要先重写碰撞、物理、AI 或道具系统来迎合过长 smoke
- 不要删除 `loseCondition` 来掩盖失败状态
- 不要给业务逻辑加无敌、永不掉落、永不失败等专门绕过 smoke 的保护
- 不要扩大 timeout 让游戏失败后靠重置碰巧满足断言

---

## 实时导航 Smoke 过长

### 症状

- `runner-result.json` 中 `canvasMounted: true`、`pixelsAvailable: true`、`inputDispatched: true`，且 `milestonesAny > 0`
- 但 `failedExpects` 持续出现钥匙、敌人击杀、受伤、出口、胜利等后半段 milestone `observed: 0`
- worker 反复改地图、改路径、改碰撞范围、改输入时长，每次只推进一小段

### 原因

`top_down` / platformer / tower_defense 这类实时输入 case，如果 Stage1 smoke 同时要求自由导航、多目标收集、战斗、受伤和通关，就会变成脆弱的完整 playthrough。首轮 smoke 只适合证明最小主闭环证据，不适合验证完整关卡路线。

### 推荐修法

Phase A 就把 smoke 设计成确定性短路径：把目标沿同一条主输入路径线性摆放，一次只证明一个最小闭环进展。例如钥匙都放在起点向右同一行，敌人放在第一发子弹路径上，出口放在最后一个目标旁边。

### 备选修法

把不稳定的完整体验项放进 `nonblockingTodos[]` 或 Stage2 issue，不要让首轮 delivery 为它们反复修地图。若已经进入 Phase C 才发现 smoke 过长，按 `generation-blocked` 停并报告需要重写 Phase A smoke，而不是继续局部 patch。

### 禁止项

- 不要靠不断加 timeout 或延长 keydown 时长赌路径走通
- 不要反复扩大碰撞盒来掩盖路线不可达
- 不要把所有体验项都塞进同一个长 smoke 再一路 repair 到 pass

---

## Phaser 类型或运行时未引入

### 症状

- `tsc` 报 `Cannot find namespace 'Phaser'` 或找不到 Phaser 类型
- `vite build` 通过但 delivery 里 `pageErrors` 出现 `Phaser is not defined`
- `diagnostic.canvasMounted: false`，页面没有挂出 canvas

### 原因

业务入口只使用了全局 `Phaser` 名字，但没有显式导入 Phaser；或者 worker 试图改 case-local KEEP `tsconfig.json` 来补类型，随后被 prepare / check_delivery 同步回 scaffold。

### 推荐修法

在真实入口顶部显式导入 Phaser，并保留 milestone helper：

```ts
import Phaser from "phaser";
import "./milestone";
```

然后在 Phaser config 中继续使用 `type: Phaser.CANVAS`，并从 `game/` 目录运行 `npx tsc --noEmit` 与 `npx vite build`。

### 备选修法

如果入口拆分到多个业务文件，仍由 `game/src/main.ts` 显式 import Phaser；其他文件可以按 TypeScript 需要导入具体类型或复用 `Phaser.*` 类型。

### 禁止项

- 不要修改 case-local `game/tsconfig.json`、`game/package.json`、`game/src/milestone.ts` 等 KEEP scaffold 文件
- 不要用 triple-slash reference 修 Phaser 类型
- 不要在 case 内 `npm install`
- 不要为了消除 `Phaser is not defined` 去修改 delivery runner

---

## Milestone 局部缺失

### 症状

- `runner-result.json` 里 `diagnostic.failedExpects` 出现 `milestone observed 0`
- 同时 `diagnostic.canvasMounted: true`、`pixelsAvailable: true`、`inputDispatched: true`
- `milestonesAny > 0`，说明游戏已运行，只有某个 expect id 没被触发

### 原因

该 milestone 的业务路径被条件分支跳过，或触发条件没有真实发生。常见例子包括掉落物没有 physics body / overlap，所以拾取逻辑永远不进入；也可能是 emit id 与 plan id 不一致。

### 推荐修法

先沿 `smoke.expect[].id` 反查业务 emit 路径：确认 id 完全一致、前置条件能被 smoke 输入触发、碰撞或 overlap 对象确实有 physics body / overlap 支持，并检查该分支是否被随机概率或距离条件挡住。

### 备选修法

如果机制确实难以用首轮 smoke 稳定覆盖，回到 Phase A 拆分更短的 smoke 取证路径，或把非 primary 机制放入 `nonblockingTodos[]`，不要强行让随机路径碰巧通过。

### 禁止项

- 不要先调大随机概率、timeout 或等待时间来赌 milestone 出现
- 不要看到单个 milestone 缺失就大重写主循环
- 不要删除该 `smoke.expect` 来掩盖未验证机制
- 不要读取 sibling case 源码寻找现成修法

---

## Phaser 键盘输入 Milestone 不触发

### 症状

- `failedExpects` 出现某个 movement / shoot / 操作类 milestone（如 `player-movement`、`fire-bullet`）`observed: 0`
- 同时 `milestonesAny > 0` —— 其他业务 milestone 已 emit，只有键盘相关分支没起来
- 试过 `cursors.W.isDown`、`addKeys("W,A,S,D")`、`addKey(KeyCodes.W)`、`addKey('KeyW')`、`window.addEventListener('keydown')` 都不触发

### 原因

通常**不是键盘 API 写错**：Phaser 的几种键盘订阅写法都能收到 Playwright 派发的事件。问题往往是**主循环已结束** —— 比如 win 条件、scene.pause()、scene.stop() 在键盘 milestone 之前就触发，scene update 不再跑，emit 路径不再执行。常见 trigger 顺序问题：所有敌人被击杀立即 win → 后续移动事件无人监听。

### 推荐修法

先临时加一个 debug milestone 确认按键真的到达 page：

```ts
window.addEventListener('keydown', (e) => emitMilestone('raw-keydown', { code: e.code }));
```

如果 `raw-keydown` milestone **正常 emit** 而 `player-movement` 仍 0，根因就在主循环已结束。检查：
- win / lose 条件是否在第一个移动 step 之前就被满足（如 smoke 第 1 步是攻击、所有敌人一击 KO）
- scene.pause() / stop() 在 milestone emit 路径上游
- update() 里的 early return 是否提前激活

调整 smoke 顺序，先派发 1-2 个移动 step 再派发触发胜负的 step；或在业务里改让 win 不立刻 stop scene。

### 备选修法

把 `addKeys` / `createCursorKeys` 调用从 `update()` 搬到 `create()`，避免每帧重建 key 对象（次要原因，但不踩没坏处）。

### 禁止项

- 不要在 6 种键盘 API 写法之间反复切换试错；先用 `raw-keydown` debug milestone 定位
- 不要为了让 `player-movement` 过把 win 条件砍掉
- 不要 emit `player-movement` 在 `keydown` 监听器里来作弊（应该 emit 在业务移动逻辑里）

---

## Phaser overlap 回调每帧触发导致状态飘走

### 症状

- runner 通过若干 milestone，但 state 类 expect 的数值字段崩到不可能值（如 `health: -4199`、`score: 999999`、`combo: 1024`）
- 业务 collision / overlap 回调里的副作用被执行了几十上百次

### 原因

Phaser 的 `physics.add.overlap(a, b, callback)` 在 `a` 与 `b` 持续重叠的每一帧都会调用 callback。子弹打中敌人、player 撞钥匙、player 撞敌人这类一次性效果如果直接在回调里 `health -= 1` 或 `score += 10`，会按帧累计。

### 推荐修法

加 invincibility frame / cooldown / once 标记：

```ts
this.physics.add.overlap(player, enemy, (p, e) => {
  if ((p as any)._iframeUntil > this.time.now) return;
  (p as any)._iframeUntil = this.time.now + 800;
  health -= 1;
  emitMilestone('player-hit', { health });
});
```

或一次性物体（钥匙、道具）在拾取后立刻 `target.destroy()` / `setActive(false)` 让 overlap 不再匹配。

### 备选修法

用 `physics.add.collider` 配合 `processCallback` 在物理解算前判断；或把 overlap 改成手动距离判定 + `Set` 追踪已 collected 物体。

### 禁止项

- 不要靠 clamp `health = Math.max(0, health)` 掩盖飘走的累计
- 不要把 callback 改成空函数让 milestone 仍 emit
- 不要靠把 smoke timeout 缩到极短躲过累计
