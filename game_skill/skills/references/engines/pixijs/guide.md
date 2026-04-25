---
name: engine-pixijs
description: "PixiJS v8 引擎规范。适用于棋盘格子型 / 单屏反应型 / 经营养成型。默认 run-mode=local-http，多文件结构是推荐路径。"
---

# PixiJS v8 引擎指南（pin `pixi.js@8`）

## 选型建议

| 场景 | 推荐度 |
|---|---|
| 棋盘格子型 | ✅ 最佳 |
| 单屏反应型 | ✅ 最佳 |
| 经营养成型 | ✅ 最佳 |
| 消除类 | ✅ 最佳 |
| 控制闯关物理型 | ❌ 不适合 |
| 规则问答型 | ❌ 不适合 |
| 剧情互动型 | ❌ 不适合 |

## 技术栈

- 通过 import map 引入 `pixi.js@8`
- 默认 `run-mode=local-http`
- 推荐多文件：`src/main.js` + `src/state.js`
- 必须暴露 `window.gameState` 与 `window.app`

## 5 个破坏性变更（v8 必读）

1. `Application` 初始化是异步，必须 `await app.init()`
2. `app.canvas` 取代 `app.view`
3. `Graphics` 用 `.rect().fill()` 新链式 API
4. ticker 回调参数是 `Ticker` 实例，不是数字
5. 交互用 `eventMode = "static"`，不要再用旧式 `interactive = true`

## 最小骨架代码

**index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<!-- ENGINE: pixijs | VERSION: pixi.js@8 | RUN: local-http -->
<meta charset="UTF-8">
<title>{GAME_TITLE}</title>
<script type="importmap">
{
  "imports": {
    "pixi.js": "https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.mjs"
  }
}
</script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./src/main.js"></script>
</body>
</html>
```

**src/state.js**

```js
export const state = { phase: "ready", score: 0 };
window.gameState = state;
```

**src/main.js**

```js
import { Application, Graphics, Text, Container, Rectangle } from "pixi.js";
import { state } from "./state.js";

(async () => {
  const app = new Application();
  await app.init({ width: 800, height: 600, background: "#1e293b" });
  document.getElementById("root").appendChild(app.canvas);
  window.app = app;

  const box = new Graphics().rect(0, 0, 100, 100).fill({ color: 0x0ea5e9 });
  box.eventMode = "static";
  box.on("pointerdown", () => { state.score += 1; });
  app.stage.addChild(box);
})();
```

## LLM 易错点

| 错误 | 纠正 |
|---|---|
| 忘 `await app.init()` | v8 强制异步 |
| 用 `app.view` | 用 `app.canvas` |
| Graphics 用旧 API (`beginFill`) | 用新 API (`.rect().fill()`) |
| `sprite.interactive = true` | v8 用 `eventMode = "static"` |
| 试图走 `file://` 加 importmap + 本地模块 | Pixi 默认必须走 `local-http` |
| 动画 `from/to` 共享值用于多个 target | **每个 target 独立动画**（见下方说明） |
| 异步交互链路不加锁 | **必须加 isProcessing 锁**（见下方说明） |
| Container 交互区域设置错误 | **用 hitArea 或 eventMode 正确配置**（见下方说明） |
| 使用 `PIXI.Rectangle` 等全局命名空间 | v8 ES Module 模式无全局 `PIXI`，必须从 `"pixi.js"` 显式 import `Rectangle`、`Ticker` 等 |

### 动画独立性原则

使用 gsap / PixiJS ticker 实现动画时，如果起始/结束值依赖各对象自身属性，**必须为每个对象创建独立动画**：

```js
// ❌ 错误：两个对象共用同一组动画参数
gsap.to([objA, objB], { x: objA.x + 5, duration: 0.05, yoyo: true, repeat: 3 });
// objB 被移到 objA.x + 5 的位置

// ✅ 正确：各自独立
gsap.to(objA, { x: objA.x + 5, duration: 0.05, yoyo: true, repeat: 3 });
gsap.to(objB, { x: objB.x + 5, duration: 0.05, yoyo: true, repeat: 3 });
```

### 异步交互状态锁

PixiJS 中用 `setTimeout` 或 gsap 做延迟判定时，窗口期内用户可继续操作：

```js
// ❌ 错误：延迟期间用户可以继续点击
card.on("pointerdown", () => {
  state.selected.push(card);
  if (state.selected.length === 2) {
    setTimeout(() => checkMatch(), 200);
  }
});

// ✅ 正确：加锁
card.on("pointerdown", () => {
  if (state.isProcessing || card.matched) return;
  state.selected.push(card);
  if (state.selected.length === 2) {
    state.isProcessing = true;
    setTimeout(() => checkMatch(), 200);
  }
});
// checkMatch 所有分支末尾：state.isProcessing = false
```

### Container 交互配置

PixiJS v8 中 Container 默认不响应事件。正确配置方式：

```js
// ❌ 错误：Container 不会收到 pointerdown 事件
const container = new Container();
container.on("pointerdown", handler);  // 无效

// 需要 import { Rectangle } from "pixi.js"
// ✅ 正确方式 1：设置 eventMode 和 hitArea
const container = new Container();
container.eventMode = "static";
container.hitArea = new Rectangle(0, 0, width, height);
container.on("pointerdown", handler);

// ✅ 正确方式 2：在 Container 内放一个可交互的 Graphics 作为底板
const container = new Container();
const bg = new Graphics().rect(0, 0, width, height).fill({ color: 0xffffff });
bg.eventMode = "static";
bg.on("pointerdown", handler);
container.addChild(bg);
```

## 对象生命周期管理

PixiJS v8 的 DisplayObject 生命周期需要手动管理。**容器间移动 sprite** 是高频 bug 来源——AI 生成代码时极易写出"删旧不建新"或"旧引用残留"的模式。

### 容器间转移 sprite（正确模式）

当一个 sprite 需要从 Container A 移到 Container B 时，**有两种正确做法**：

```js
// ✅ 方式 1：重新挂载（保留同一个对象）
containerA.removeChild(sprite);
containerB.addChild(sprite);
// 注意：移动后必须更新 sprite 的 position（坐标系变了）
sprite.position.set(newX, newY);

// ✅ 方式 2：销毁旧的，创建新的（更安全，推荐复杂场景使用）
const data = { color: oldSprite.tint, size: oldSprite.width };  // 保存数据
oldSprite.destroy();
spriteMap.delete(entityId);         // 同步清理引用 Map
const newSprite = createSprite(data);  // 创建新 sprite
containerB.addChild(newSprite);
spriteMap.set(entityId, newSprite); // 同步更新引用 Map
```

### 引用 Map 同步规则

如果用 `Map<id, Sprite>` 管理 sprite 引用（常见于棋盘/卡牌/传送带等场景），**必须遵守以下规则**：

```js
// ❌ 错误：只删 Map 引用，不创建新 sprite → 对象在屏幕上"消失"
function moveToConveyor(pig) {
  pigSprites.delete(pig.id);  // 删了引用
  waitSlotContainer.removeChild(oldSprite);  // 删了视觉
  // 漏了！没有在 conveyor 上创建新 sprite
}

// ❌ 错误：容器 removeChildren() 但 Map 残留旧引用 → 下次检查 has() 误判
function renderSlots() {
  container.removeChildren();      // 容器清空了
  // 但 spriteMap 里还有旧引用，后续 spriteMap.has(id) 返回 true → 跳过创建
}

// ✅ 正确：容器和 Map 双向同步
function renderSlots(entities) {
  container.removeChildren();
  spriteMap.clear();               // 容器清空 = Map 也清空
  for (const entity of entities) {
    const sprite = createSprite(entity);
    container.addChild(sprite);
    spriteMap.set(entity.id, sprite);
  }
}
```

### LLM 易错点

| 错误 | 纠正 |
|---|---|
| `container.removeChildren()` 后不清理 Map | **容器清空时 Map 必须同步清空或重建** |
| 从 A 容器移到 B 容器时只做 `destroy()` + `map.delete()` | **destroy 后必须在目标容器创建新 sprite 并 map.set()** |
| 用 `spriteMap.has(id)` 判断是否需要创建 | **只在 Map 与容器严格同步时才可靠，否则改用"总是重建"模式** |
| 动画/ticker 回调引用了已 destroy 的 sprite | **destroy 前先 `app.ticker.remove(tickFn)`** |

---

## 视觉特效 Cookbook

PixiJS v8 的画面优势在于**强大的 Filter 系统、灵活的粒子插件、ColorMatrix 颜色操控**。以下是即用代码片段。

参考 `visual-styles.md` 的「游戏特效分级指南」确定每个游戏事件需要哪个层级的特效。

### 依赖引入

粒子系统需要额外的包。在 importmap 中添加：

```html
<script type="importmap">
{
  "imports": {
    "pixi.js": "https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.mjs",
    "@pixi/particle-emitter": "https://cdn.jsdelivr.net/npm/@pixi/particle-emitter@5/dist/particle-emitter.mjs"
  }
}
</script>
```

### 粒子爆发（L2 — 得分/配对成功）

```js
import { Emitter } from "@pixi/particle-emitter";

// 如果 @pixi/particle-emitter 引入有问题，可以用纯 PixiJS 手写简易粒子：
function emitParticles(container, x, y, count = 12) {
  const colors = [0xfbbf24, 0xfb7185, 0x34d399, 0x60a5fa];
  for (let i = 0; i < count; i++) {
    const p = new Graphics().circle(0, 0, 2 + Math.random() * 3).fill({
      color: colors[i % colors.length]
    });
    p.position.set(x, y);
    container.addChild(p);

    const angle = (Math.PI * 2 / count) * i + Math.random() * 0.5;
    const speed = 100 + Math.random() * 150;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const life = 400 + Math.random() * 400;
    const start = Date.now();

    const tick = () => {
      const elapsed = Date.now() - start;
      const t = elapsed / life;
      if (t >= 1) { p.destroy(); app.ticker.remove(tick); return; }
      p.x += vx * (1 / 60);
      p.y += vy * (1 / 60) + 200 * (1 / 60) * t;  // 重力
      p.alpha = 1 - t;
      p.scale.set(1 - t * 0.5);
    };
    app.ticker.add(tick);
  }
}
```

### Filter 效果（L2-L3）

PixiJS v8 内置多种 Filter，无需额外依赖：

```js
import { BlurFilter, ColorMatrixFilter } from "pixi.js";

// 模糊背景（游戏暂停/结算时）
const blurFilter = new BlurFilter({ strength: 4 });
app.stage.filters = [blurFilter];
// 移除：app.stage.filters = [];

// 灰度化（游戏失败）
const grayFilter = new ColorMatrixFilter();
grayFilter.desaturate();
gameContainer.filters = [grayFilter];

// 亮度闪光（得分瞬间）
function flashBrightness(container, intensity = 0.3) {
  const colorMatrix = new ColorMatrixFilter();
  colorMatrix.brightness(1 + intensity, false);
  container.filters = [colorMatrix];
  setTimeout(() => { container.filters = []; }, 150);
}

// 色调偏移（受伤/错误 — 偏红）
function tintRed(container) {
  const cm = new ColorMatrixFilter();
  cm.tint(0xff4444, false);
  container.filters = [cm];
  setTimeout(() => { container.filters = []; }, 200);
}
```

### 屏幕震动（L1）

```js
// PixiJS 没有内置 camera shake，用 stage container 偏移实现
function shakeScreen(container, intensity = 3, duration = 150) {
  const originalX = container.x;
  const originalY = container.y;
  const startTime = Date.now();

  const tick = () => {
    const elapsed = Date.now() - startTime;
    if (elapsed >= duration) {
      container.x = originalX;
      container.y = originalY;
      app.ticker.remove(tick);
      return;
    }
    const decay = 1 - elapsed / duration;
    container.x = originalX + (Math.random() - 0.5) * intensity * 2 * decay;
    container.y = originalY + (Math.random() - 0.5) * intensity * 2 * decay;
  };
  app.ticker.add(tick);
}
```

### 得分飘字（L2）

```js
import { Text } from "pixi.js";

function floatingScore(container, x, y, text, color = '#fbbf24') {
  const txt = new Text({ text, style: {
    fontSize: 24, fontFamily: 'PingFang SC', fill: color, fontWeight: 'bold',
    stroke: { color: '#000', width: 2 }
  }});
  txt.anchor.set(0.5);
  txt.position.set(x, y);
  container.addChild(txt);

  const startTime = Date.now();
  const duration = 800;
  const tick = () => {
    const t = (Date.now() - startTime) / duration;
    if (t >= 1) { txt.destroy(); app.ticker.remove(tick); return; }
    txt.y = y - 60 * t;
    txt.alpha = 1 - t;
    txt.scale.set(1 + 0.3 * t);
  };
  app.ticker.add(tick);
}
```

### Tint 闪烁（L1）

```js
// PixiJS 的 tint 属性可以直接设置
function flashTint(displayObject, color = 0x00ff00, duration = 100) {
  displayObject.tint = color;
  setTimeout(() => { displayObject.tint = 0xffffff; }, duration);
}

// 错误闪烁 3 次
function errorFlash(displayObject) {
  let count = 0;
  const interval = setInterval(() => {
    count++;
    displayObject.tint = count % 2 === 1 ? 0xff0000 : 0xffffff;
    if (count >= 6) clearInterval(interval);
  }, 80);
}
```

### 烟花全屏（L3 — 通关）

```js
function celebrateWin(container) {
  const { width, height } = app.screen;
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      const x = Math.random() * width;
      const y = Math.random() * height * 0.5;
      emitParticles(container, x, y, 20);
    }, i * 300);
  }
}
```

## window.gameState 暴露位置

- `src/state.js`：`window.gameState = state`
- `src/main.js`：`window.app = app`

## Playwright 断言示例

```js
await page.goto(launchUrl);
await page.waitForFunction(() => window.app && window.gameState);
await page.mouse.click(400, 300);
expect(await page.evaluate(() => window.gameState.score)).toBeGreaterThanOrEqual(1);
```

## 目录约定

```text
game/
├── index.html
├── package.json
└── src/
    ├── state.js
    └── main.js
```

单文件内联可作为实验手段，但不再是默认模板方向。
