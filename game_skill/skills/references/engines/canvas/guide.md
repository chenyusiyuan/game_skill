---
name: engine-canvas
description: "原生 Canvas 2D 引擎规范。适用于棋盘格子型 / 教育练习型 / 轻量反应型。简单项目默认 run-mode=file；复杂项目可升级到 local-http。"
---

# 原生 Canvas 2D 引擎指南

## 选型建议

| 场景 | 推荐度 |
|---|---|
| 棋盘格子型 | ✅ 最佳 |
| 单屏反应型 | ✅ 最佳 |
| 教育练习型 | ✅ 最佳 |
| Pixel Flow 等网格规则型 | ✅ 最佳 |
| 经营养成型（>50 实体） | ⚠️ 可用但管理复杂 |
| 策略战斗型 | ❌ 不适合 |
| 控制闯关物理型 | ❌ 物理要手撸，易错 |

## 技术栈

- 零依赖：`<canvas>` + `getContext("2d")`
- 简单项目默认 `run-mode=file`
- 复杂项目可切 `RUN: local-http` 并拆 `src/*.js`
- 推荐模式：`update(state, dt)` + `draw(ctx, state)` + RAF

## 素材加载（assets.yaml 有 local-file 时必须实现）

Canvas 游戏需要在游戏主循环启动前，预加载所有 `assets.yaml` 中 `type: local-file` 的图片素材。

### 图片预加载模式

```js
// 通用图片加载器
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn(`素材加载失败，降级为程序化绘制: ${src}`);
      resolve(null);  // 降级而非崩溃
    };
    img.src = src;
  });
}

// 批量预加载（在 init 中调用）
async function preloadAssets() {
  const BASE = "../../../assets/library_2d";
  const assets = {
    player: await loadImage(`${BASE}/tiles/dungeon/tile_0030.png`),
    floor: await loadImage(`${BASE}/tiles/dungeon/tile_0000.png`),
    wall: await loadImage(`${BASE}/tiles/dungeon/tile_0009.png`),
  };
  return assets;
}

// 渲染时使用
function drawEntity(ctx, entity, assets) {
  if (assets[entity.type]) {
    ctx.drawImage(assets[entity.type], entity.x, entity.y, entity.w, entity.h);
  } else {
    // 降级：程序化绘制
    ctx.fillStyle = entity.color;
    ctx.fillRect(entity.x, entity.y, entity.w, entity.h);
  }
}
```

### LLM 易错点

| 错误 | 纠正 |
|---|---|
| 不预加载直接在 draw 循环中 `new Image()` | **必须在游戏启动前 await 预加载完毕** |
| 忽略 assets.yaml 的 local-file 素材，全部用 fillRect | **local-file 素材必须加载使用，仅在加载失败时降级** |
| 路径写成绝对路径或相对于项目根 | **从 game/ 目录回退 3 级：`../../../assets/library_2d/...`** |

## 最小骨架代码

**默认 file 模式：**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<!-- ENGINE: canvas | VERSION: browser-native | RUN: file -->
<meta charset="UTF-8">
<title>{GAME_TITLE}</title>
</head>
<body>
  <canvas id="game" width="800" height="600"></canvas>
  <script>
    const state = { phase: "ready", score: 0, t: 0 };
    window.gameState = state;
    const ctx = document.getElementById("game").getContext("2d");

    function update(state, dt) {
      if (state.phase === "playing") state.t += dt;
    }

    function draw(ctx, state) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.fillText(`phase: ${state.phase}`, 20, 40);
    }

    let last = 0;
    function loop(ts) {
      const dt = last === 0 ? 0 : ts - last;
      last = ts;
      update(state, dt);
      draw(ctx, state);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  </script>
</body>
</html>
```

**升级到 local-http 时：**

```html
<!-- ENGINE: canvas | VERSION: browser-native | RUN: local-http -->
<script type="module" src="./src/main.js"></script>
```

## LLM 易错点

| 错误 | 纠正 |
|---|---|
| 在 `update` 里调用绘制 API | update 不碰 ctx；draw 不改 state |
| 忘记 `clearRect` | 每帧清屏 |
| 用 setInterval | 用 `requestAnimationFrame` |
| 第一帧 dt 算错 | `last === 0 ? 0 : ts - last` |
| `run-mode=file` 还拆本地模块 | 要么内联，要么切 `local-http` |
| 按钮边界（hitBounds）混入 gameState | **UI 层临时数据放模块级变量**（见下方说明） |
| 配对游戏同侧可选多张 | **同侧必须互斥选择**（见下方说明） |
| setTimeout 回调在场景切换后仍执行 | **场景切换时清理所有 pending timer**（见下方说明） |
| 动画中间值（opacity/scale）直接改 state | **动画数据独立管理**（见下方说明） |
| 混淆"翻牌记忆"和"配对连线"概念 | 配对连线卡片始终正面朝上，不需要 `flipped` |
| 异步窗口期不加交互锁 | **setTimeout 延迟期间必须加 isProcessing 锁** |
| 只在 matchFail 重置 isProcessing | **matchSuccess 和 matchFail 都必须重置 `isProcessing = false`**，否则成功配对一次后所有卡片点不了 |

### gameState 纯净原则

Canvas 游戏中按钮的点击区域（bounds）是 draw 函数中计算的渲染层数据，**禁止存在 state 上**：

```js
// ❌ 错误：UI 层数据污染 gameState
function draw() {
  state._btnStartBounds = { x: btnX, y: 400, w: 120, h: 50 };
}

// ✅ 正确：用模块级变量
const uiBounds = {};
function draw() {
  uiBounds.btnStart = { x: btnX, y: 400, w: 120, h: 50 };
}
function handleClick(x, y) {
  if (hitTest(x, y, uiBounds.btnStart)) { /* ... */ }
}
```

### 同侧互斥选择

配对游戏中同侧只能选一张卡片。LLM 经常遗漏此检查：

```js
// ❌ 错误：没有同侧检查
function selectCard(card) {
  card.flipped = true;
  state.selected.push(card);
}

// ✅ 正确：同侧互斥
function selectCard(card) {
  if (state.isProcessing || card.matched) return;
  const sameSide = state.selected.find(c => c.side === card.side);
  if (sameSide) {
    sameSide.selected = false;
    state.selected = state.selected.filter(c => c.id !== sameSide.id);
  }
  card.selected = true;
  state.selected.push(card);
  if (state.selected.length === 2) {
    state.isProcessing = true;
    setTimeout(() => checkMatch(), 200);
  }
}

// ⚠️ 重要：matchSuccess 和 matchFail 都必须重置 isProcessing = false
// 这是最常见的 bug —— 只在 matchFail 中重置而忘记 matchSuccess
function checkMatch() {
  const [c1, c2] = state.selected;
  if (c1.pairId === c2.pairId) {
    // 配对成功
    c1.matched = true;
    c2.matched = true;
    state.score += 10;
    state.selected = [];
    state.isProcessing = false;  // ← 必须重置！
  } else {
    // 配对失败
    safeTimeout(() => {
      c1.selected = false;
      c2.selected = false;
      state.selected = [];
      state.isProcessing = false;  // ← 必须重置！
    }, 500);
  }
}
```

### 异步清理与场景切换

场景切换后，之前的 `setTimeout` 仍会执行并修改过期状态：

```js
// ✅ 正确：追踪 timeout，场景切换时统一清理
const pendingTimers = [];
function safeTimeout(fn, ms) {
  const id = setTimeout(() => {
    pendingTimers.splice(pendingTimers.indexOf(id), 1);
    fn();
  }, ms);
  pendingTimers.push(id);
}
function switchScene(newScene) {
  pendingTimers.forEach(clearTimeout);
  pendingTimers.length = 0;
  state.isProcessing = false;
  state.scene = newScene;
}
```

### 动画状态隔离

渐变动画（淡出、缩放）的中间值不应修改 gameState 上的属性：

```js
// ❌ 错误：动画数据混入 state
state.animatingCards = [{ card, startTime, type: "fadeout" }];

// ✅ 正确：动画数据独立管理
const animations = [];  // 不在 gameState 上
function addAnimation(card, type, duration) {
  animations.push({ card, type, startTime: Date.now(), duration });
}
function updateAnimations() {
  for (let i = animations.length - 1; i >= 0; i--) {
    const a = animations[i];
    const progress = Math.min(1, (Date.now() - a.startTime) / a.duration);
    if (a.type === "fadeout") a.card._renderOpacity = 1 - progress;
    if (progress >= 1) {
      a.card.matched = true;  // 动画结束时才改逻辑状态
      animations.splice(i, 1);
    }
  }
}
```

## window.gameState 暴露位置

```js
const state = { phase: "ready", score: 0 };
window.gameState = state;
```

## Playwright 断言示例

```js
await page.goto(launchUrl);
await page.waitForFunction(() => window.gameState !== undefined);
await page.mouse.click(400, 300);
expect(await page.evaluate(() => window.gameState.score)).toBeGreaterThanOrEqual(0);
```

## 目录约定

- 简单项目：

```text
template/
└── index.html
```

- 复杂项目：

```text
game/
├── index.html
├── package.json        # 若 src/*.js 用 ESM
└── src/
    ├── state.js
    ├── update.js
    ├── draw.js
    └── main.js
```
