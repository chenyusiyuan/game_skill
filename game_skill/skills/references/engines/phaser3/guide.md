---
name: engine-phaser3
description: "Phaser 3 引擎规范。适用于控制闯关物理型 / 棋盘格子型 / 单屏反应型。默认 run-mode=local-http，多文件结构是推荐路径。"
---

# Phaser 3 引擎指南（pin `phaser@3`）

## 选型建议

| 场景 | 推荐度 |
|---|---|
| 控制闯关物理型 | ✅ 最佳 |
| 棋盘格子型（带动画） | ✅ 最佳 |
| 单屏反应型 | ✅ 最佳 |
| 策略战斗型 | ⚠️ 可用 |
| 经营养成型 | ⚠️ 可用但 UI 要自己做 |
| 规则问答型 | ❌ 不适合 |
| 剧情互动型 | ❌ 不适合 |

## 技术栈

- CDN 版本锁：`https://cdn.jsdelivr.net/npm/phaser@3/dist/phaser.min.js`
- 默认 `run-mode=local-http`
- 推荐多文件：`src/main.js` + `src/scenes/*.js` + `src/state.js`
- 必须暴露 `window.gameState` 与 `window.game`

## 最小骨架代码

**index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<!-- ENGINE: phaser3 | VERSION: phaser@3.90 | RUN: local-http -->
<meta charset="UTF-8">
<title>{GAME_TITLE}</title>
<script src="https://cdn.jsdelivr.net/npm/phaser@3/dist/phaser.min.js"></script>
</head>
<body>
  <script type="module" src="./src/main.js"></script>
</body>
</html>
```

**src/state.js**

```js
export const state = { phase: "ready", score: 0, scene: "MainScene" };
window.gameState = state;
```

**src/scenes/MainScene.js**

```js
import { state } from "../state.js";
// runtime wrapper 由 codegen 在 game/src/mechanics/<node-id>.runtime.mjs 动态生成；
// import 路径由对应 mechanics node 的 runtime-module 定义。

export class MainScene extends Phaser.Scene {
  constructor() { super("MainScene"); }
  create() {
    state.phase = "playing";
    state.scene = "MainScene";
    this.input.on("pointerdown", () => {
      // TODO(codegen): 调用本 case 的 mechanics runtime wrapper。
    });
  }
}
```

**src/main.js**

```js
import { MainScene } from "./scenes/MainScene.js";

window.game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  scene: [MainScene],
});
```

## LLM 易错点

| 错误 | 纠正 |
|---|---|
| 用 `phaser@latest` | 必须 pin `phaser@3` |
| 把 Scene 状态全放 `this` 上 | 关键状态同步写回 `window.gameState` |
| `preload` 里写玩法逻辑 | preload 只做加载 |
| update 里每帧 new 对象 | 预创建对象，避免 GC 压力 |
| 还按 file 模式生成本地 module src | Phaser 默认就该走 `local-http` |
| Tween 多 target 共用 `from` 值 | **每个 target 必须独立 tween**（见下方详细说明） |
| 异步交互链路（delayedCall / tween 回调）期间不加锁 | **必须加 `isProcessing` 锁**（见下方详细说明） |
| hitArea 用场景级透明矩形覆盖 Container | **在 Container 上直接 setSize+setInteractive**（见下方详细说明） |
| `Container.setInteractive({ useHandCursor: true })` 但没 `setSize` / hitArea | **必崩或点击无效**；Container 没有纹理尺寸，必须先定义交互区域 |
| 每秒创建新 tween 导致叠加 | 复用或先停掉旧 tween |
| ResultScene.create() 中直接改 currentLevel | 只在按钮回调中修改全局状态 |
| 多个 Scene 重复定义 createButton 等工具方法 | 提取为 Scene 外的共用函数 |

### Tween 多 target 陷阱（严重）

当 `this.tweens.add()` 的 `targets` 是数组，且 `x/y` 使用 `{ from, to }` 语法时，**所有 target 共用同一组 from/to 值**。这会导致其他 target 被瞬间移动到第一个 target 的坐标。

```js
// ❌ 错误：objB 会被拉到 objA.x 的位置
this.tweens.add({
  targets: [objA, objB],
  x: { from: objA.x, to: objA.x + 5 },
  duration: 50, yoyo: true, repeat: 3
});

// ✅ 正确：每个 target 用独立 tween，基于各自坐标
this.tweens.add({
  targets: objA,
  x: { from: objA.x, to: objA.x + 5 },
  duration: 50, yoyo: true, repeat: 3
});
this.tweens.add({
  targets: objB,
  x: { from: objB.x, to: objB.x + 5 },
  duration: 50, yoyo: true, repeat: 3
});
```

**规则：凡是 tween 的 `from/to` 依赖 target 自身位置的，必须为每个 target 创建独立 tween。**

### hitArea 正确用法（严重）

LLM 经常用场景级透明矩形覆盖 Container 来做点击区域，这会导致**点击热区与视觉不同步**——Container 缩放/移动后，透明矩形不跟随。

```js
// ❌ 错误：hitArea 是场景级对象，不跟随 Container 缩放
const container = this.add.container(x, y);
container.add([bg, text]);
const hitArea = this.add.rectangle(x, y, w, h, 0x000000, 0)
  .setInteractive({ useHandCursor: true });
// container.setScale(1.05) 后，hitArea 仍是原始大小

// ✅ 正确方式 1：在 Container 上直接设置交互区域
const container = this.add.container(x, y);
container.add([bg, text]);
container.setSize(w, h);
container.setInteractive({ useHandCursor: true });
container.on("pointerdown", callback);
// container.setScale(1.05) 后，交互区域跟随缩放

// ✅ 正确方式 2：用 zone 加入 Container 内部
const container = this.add.container(x, y);
const zone = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
container.add([bg, text, zone]);
zone.on("pointerdown", callback);
```

**规则：交互区域必须是 Container 的一部分（setSize 或内部 zone），不能是独立的场景级对象。**

**硬规则：任何 Phaser Container 绑定 `pointerdown` 前，必须满足以下二选一：**

```js
// A. Container 自身有尺寸
container.setSize(width, height);
container.setInteractive({ useHandCursor: true });

// B. 显式 hitArea + callback
container.setInteractive(
  new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height),
  Phaser.Geom.Rectangle.Contains,
  { useHandCursor: true }
);
```

不要对未知类型变量直接 `setInteractive({ useHandCursor: true })`。如果函数返回的是 `Container`（例如 `createPigSprite()`、`createCard()`、`createButton()`），该函数内部必须完成 `setSize` 或显式 hitArea，调用方只绑定 `pointerdown`。

### 异步交互状态锁（严重）

当交互链路包含 `this.time.delayedCall()` 或 tween 动画时，异步窗口期内用户可以继续点击，产生竞态 bug。**必须在异步开始时加锁，在所有异步分支结束后解锁。**

```js
// ❌ 错误：delayedCall 期间用户可以继续点击，破坏状态
selectCard(card) {
  state.selectedCards.push(card);
  if (state.selectedCards.length === 2) {
    this.time.delayedCall(200, () => this.checkMatch());
  }
}

// ✅ 正确：加 isProcessing 锁
selectCard(card) {
  if (this.isProcessing) return;  // 锁住
  state.selectedCards.push(card);
  if (state.selectedCards.length === 2) {
    this.isProcessing = true;  // 加锁
    this.time.delayedCall(200, () => this.checkMatch());
  }
}

// 在 checkMatch 的所有分支末尾解锁：
// - 成功分支：清理后立即 this.isProcessing = false
// - 失败分支：在 tween onComplete 回调里 this.isProcessing = false
```

**规则：凡有 `delayedCall` / `setTimeout` / tween 异步间隙的交互链路，必须在开始时加 `isProcessing` 锁，在所有异步分支的最终回调中释放。**

### 场景切换安全

Phaser Scene 切换时会自动清理 `this.time` 事件和 `this.tweens`，但有边界情况：

```js
// ⚠️ 如果 matchFail 中 shake tween 正在播放时触发 scene 切换（如超时 lose），
// tween 的 onComplete 可能不执行，isProcessing 永远不会重置。
// 解决方案：在 PlayScene 的 init() 中重置锁
init() {
  this.isProcessing = false;
}
```

### Tween 叠加防护

对于周期性触发的 tween（如每秒的计时器警告动画），必须防止新 tween 叠加旧的：

```js
// ❌ 错误：每秒创建新 tween，效果叠加
updateTimer() {
  if (state.timeLeft <= 10) {
    this.tweens.add({ targets: this.timerText, scale: { from: 1.1, to: 1 }, duration: 300 });
  }
}

// ✅ 正确：先停旧的再创建，或用 key 标识
updateTimer() {
  if (state.timeLeft <= 10) {
    if (this.timerPulseTween) this.timerPulseTween.stop();
    this.timerPulseTween = this.tweens.add({
      targets: this.timerText, scale: { from: 1.1, to: 1 }, duration: 300
    });
  }
}
```

## 单文件内联模式骨架

当 `run-mode=file` 或项目极简时（如单词消消乐），可用单文件内联。以下是推荐骨架：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<!-- ENGINE: phaser3 | VERSION: phaser@3.90 | RUN: file -->
<meta charset="UTF-8">
<title>{GAME_TITLE}</title>
<script src="https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js"></script>
</head>
<body>
  <div id="game-container"></div>
  <script>
    // ===== Constants =====
    const LAYOUT = { WIDTH: 800, HEIGHT: 600 };
    const TIMING = { MATCH_DELAY: 200, SHAKE_DURATION: 50 };
    const SCORING = { MATCH_POINTS: 10, COMBO_MULTIPLIER: 2, TIME_PENALTY: 3 };

    // ===== Game State (only logic data) =====
    const state = { phase: "ready", scene: "StartScene", score: 0 };
    window.gameState = state;

    // ===== Shared Utilities =====
    function createButton(scene, x, y, text, color, callback) { /* ... */ }

    // ===== Scenes =====
    class StartScene extends Phaser.Scene { /* ... */ }
    class PlayScene extends Phaser.Scene {
      init() { this.isProcessing = false; this.cardContainers = {}; }
      create() { /* ... */ }
    }
    class ResultScene extends Phaser.Scene { /* ... */ }

    // ===== Launch =====
    window.game = new Phaser.Game({
      type: Phaser.AUTO, width: LAYOUT.WIDTH, height: LAYOUT.HEIGHT,
      parent: "game-container", scene: [StartScene, PlayScene, ResultScene]
    });
  </script>
</body>
</html>
```

**关键点**：常量在最上面、state 紧随其后、共用工具函数提取到 Scene 外、Scene 的 `init()` 负责重置非逻辑状态。

## 视觉特效 Cookbook

Phaser 3 的核心画面优势在于**内置粒子系统、Camera 效果、tween + tint 组合**。以下是即用代码片段，codegen 时直接复制并按 `color-scheme` 调整参数。

参考 `visual-styles.md` 的「游戏特效分级指南」确定每个游戏事件需要哪个层级的特效。

### 粒子爆发（L2 — 得分/配对成功/combo）

```js
// 在 create() 中预创建粒子发射器（不立即发射）
// Phaser 3.60+ 使用新的粒子 API
// 先生成一个小圆形纹理用于粒子（'__DEFAULT' 不可靠）
const gfx = this.make.graphics({ add: false });
gfx.fillStyle(0xffffff, 1);
gfx.fillCircle(4, 4, 4);
gfx.generateTexture('particle', 8, 8);
gfx.destroy();

this.matchParticles = this.add.particles(0, 0, 'particle', {
  speed: { min: 100, max: 250 },
  scale: { start: 0.6, end: 0 },
  lifespan: 600,
  gravityY: 200,
  tint: [0xfbbf24, 0xfb7185, 0x34d399, 0x60a5fa],  // 按 color-scheme 调整
  emitting: false,  // 不自动发射
  quantity: 12
});

// 配对成功时在卡片位置触发
function emitMatchEffect(x, y) {
  this.matchParticles.setPosition(x, y);
  this.matchParticles.explode(12);  // 一次性爆发 12 个粒子
}
```

### 烟花粒子（L3 — 通关胜利）

```js
// 通关时全屏随机位置放烟花
// 复用 create() 中生成的 'particle' 纹理，或在此处生成
function celebrateWin(scene) {
  // 确保粒子纹理存在
  if (!scene.textures.exists('particle')) {
    const gfx = scene.make.graphics({ add: false });
    gfx.fillStyle(0xffffff, 1);
    gfx.fillCircle(4, 4, 4);
    gfx.generateTexture('particle', 8, 8);
    gfx.destroy();
  }

  const colors = [0xfbbf24, 0xfb7185, 0x34d399, 0xa78bfa];
  const firework = scene.add.particles(0, 0, 'particle', {
    speed: { min: 150, max: 350 },
    scale: { start: 0.5, end: 0 },
    lifespan: { min: 400, max: 800 },
    gravityY: 300,
    tint: colors,
    emitting: false
  });

  // 在随机位置连续发射 5 波
  for (let i = 0; i < 5; i++) {
    scene.time.delayedCall(i * 300, () => {
      const x = Phaser.Math.Between(100, scene.scale.width - 100);
      const y = Phaser.Math.Between(100, scene.scale.height / 2);
      firework.setPosition(x, y);
      firework.explode(20);
    });
  }
}
```

### 屏幕震动（L1 — 配对失败/受伤）

```js
// 轻微震动（失败反馈）
this.cameras.main.shake(150, 0.005);

// 中等震动（受伤/爆炸）
this.cameras.main.shake(200, 0.01);

// 强烈震动（boss 技能/关键时刻）
this.cameras.main.shake(300, 0.02);
```

### 屏幕闪光（L1 — 配对成功/得分）

> ⚠️ **特效克制原则**：`camera.flash` 的 alpha 不得超过 `0.1`，否则全屏闪烁会非常刺眼，严重影响体验。
> 同理，`camera.shake` 的 intensity 不得超过 `0.005`，频繁触发时尤其要克制。
> **每次配对成功/失败**这种高频事件，闪光和震动应使用最低档参数。

```js
// 白色闪光（成功）— alpha 控制在 0.05 以内
this.cameras.main.flash(100, 255, 255, 255, false, null, null, 0.05);
// 参数：duration, r, g, b, force, callback, context, alpha

// 红色闪光（失败/受伤）— alpha 控制在 0.1 以内
this.cameras.main.flash(100, 255, 50, 50, false, null, null, 0.08);

// ❌ 反模式：alpha 过高导致全屏闪瞎
// this.cameras.main.flash(200, 255, 255, 255, false, null, null, 0.3);
```

### Tint 闪烁（L1 — 选中/错误反馈）

> ⚠️ `setTint()` / `clearTint()` 只能用于 Sprite、Image、Text 等 GameObject，**不能用于 Container**。
> 如果需要对 Container 做颜色反馈，应修改 Container 内部 Graphics 的 fillStyle。

```js
// 选中时绿色 tint 闪烁
function flashTint(gameObject, color = 0x00ff00, duration = 100) {
  gameObject.setTint(color);
  scene.time.delayedCall(duration, () => gameObject.clearTint());
}

// 错误时红色 tint 闪烁 3 次
function errorFlash(gameObject) {
  let count = 0;
  const timer = scene.time.addEvent({
    delay: 80,
    repeat: 5,
    callback: () => {
      count++;
      if (count % 2 === 1) gameObject.setTint(0xff0000);
      else gameObject.clearTint();
    }
  });
}
```

### 得分飘字（L2 — 得分/combo）

```js
// 在位置 (x, y) 显示飘字 "+10"，向上飘走并淡出
function floatingText(scene, x, y, text, color = '#fbbf24') {
  const txt = scene.add.text(x, y, text, {
    fontSize: '24px', fontFamily: 'PingFang SC', color, fontStyle: 'bold',
    stroke: '#000', strokeThickness: 2
  }).setOrigin(0.5);

  scene.tweens.add({
    targets: txt,
    y: y - 60,
    alpha: 0,
    scale: 1.3,
    duration: 800,
    ease: 'Power2',
    onComplete: () => txt.destroy()
  });
}
```

### Combo 文字弹跳（L2）

```js
// combo 数字弹跳 + 颜色随等级变化
function showCombo(scene, comboCount) {
  const colors = ['#60a5fa', '#34d399', '#fbbf24', '#fb7185', '#a78bfa'];
  const color = colors[Math.min(comboCount - 1, colors.length - 1)];
  const size = Math.min(28 + comboCount * 2, 48);

  if (scene.comboText) scene.comboText.destroy();
  scene.comboText = scene.add.text(
    scene.scale.width / 2, 80,
    `🔥 ${comboCount} COMBO!`,
    { fontSize: `${size}px`, color, fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }
  ).setOrigin(0.5).setAlpha(0);

  scene.tweens.add({
    targets: scene.comboText,
    alpha: 1, scale: { from: 0.5, to: 1.2 },
    duration: 200, ease: 'Back.easeOut',
    yoyo: true, hold: 500,
    onComplete: () => { if (scene.comboText) scene.comboText.destroy(); }
  });
}
```

### 时间警告边缘红晕（L2）

```js
// 创建屏幕边缘红色渐晕（用 Graphics 画一个半透明红色边框）
function createTimeWarning(scene) {
  const vignette = scene.add.graphics();
  vignette.setAlpha(0).setDepth(999);

  // 画一个中间透明、边缘红色的矩形
  const w = scene.scale.width, h = scene.scale.height;
  vignette.fillGradientStyle(0xff0000, 0xff0000, 0xff0000, 0xff0000, 0.6, 0.6, 0, 0);
  vignette.fillRect(0, 0, w, 30);       // 上
  vignette.fillRect(0, h - 30, w, 30);  // 下
  vignette.fillRect(0, 0, 30, h);       // 左
  vignette.fillRect(w - 30, 0, 30, h);  // 右

  return vignette;
}

// 时间 <= 10 秒时脉冲显示
function pulseTimeWarning(scene, vignette) {
  if (scene.warningTween) scene.warningTween.stop();
  scene.warningTween = scene.tweens.add({
    targets: vignette, alpha: { from: 0, to: 0.5 },
    duration: 500, yoyo: true, repeat: -1
  });
}
```

## window.gameState 暴露位置

- `src/state.js`：`window.gameState = state`
- `src/main.js`：`window.game = new Phaser.Game(...)`
- Scene 关键状态切换时同步 `state.phase / state.scene / state.score`

## Playwright 断言示例

```js
await page.goto(launchUrl);
await page.waitForFunction(() => window.game && window.gameState?.scene === "MainScene");
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
    ├── main.js
    └── scenes/
        └── MainScene.js
```

单文件只作为极小 demo 的兼容方案，不再是默认要求。
