---
name: engine-dom
description: "DOM + Tailwind v4 引擎规范。适用于规则问答型 / 剧情互动型 / 教育练习型等非实时小游戏。默认 run-mode=file；复杂页面可升级到 local-http。"
---

# DOM + Tailwind v4 引擎指南

## 选型建议

| 场景 | 推荐度 |
|---|---|
| 规则问答型（猜数字、闪卡、测验） | ✅ 最佳 |
| 教育练习型（单词练习、数学练习） | ✅ 最佳 |
| 剧情互动型（AVG、选择树） | ✅ 最佳 |
| 经营养成型（轻量 clicker/idle） | ⚠️ 可用，动画多时考虑 canvas |
| 棋盘格子型（静态判定） | ⚠️ 可用 |
| 控制闯关物理型 | ❌ 不适合 |
| 单屏反应型 | ❌ 不适合 |

## 技术栈

- Tailwind v4 CDN：`<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>`
- 默认 `run-mode=file`：轻量项目可直接 `open index.html`
- 复杂项目可改 `RUN: local-http` 并拆成 `src/*.js`
- 状态管理：单一 `state` 对象 + 纯函数 `render(state)`

## 最小骨架代码

**primitive-backed 默认 local-http 模式：**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<!-- ENGINE: dom-ui | VERSION: tailwind-v4 | RUN: local-http -->
<meta charset="UTF-8">
<title>{GAME_TITLE}</title>
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
</head>
<body class="bg-slate-50 min-h-screen">
  <div id="app" class="max-w-xl mx-auto p-6"></div>
  <script type="module">
    import { accumulateScore } from './src/_common/primitives/index.mjs';

    const state = { phase: "ready", score: 0 };
    window.gameState = state;
    const app = document.getElementById("app");

    function render() {
      app.innerHTML = state.phase === "ready"
        ? '<button id="btn-start">开始</button>'
        : `<div>score: ${state.score}</div><button id="btn-score">+1</button>`;
      document.getElementById("btn-start")?.addEventListener("click", () => {
        state.phase = "playing";
        render();
      });
      document.getElementById("btn-score")?.addEventListener("click", () => {
        state.score = accumulateScore({
          rule: "score-click",
          node: "scoring",
          currentScore: state.score,
          eventPayload: "input.score",
          params: { rules: [{ on: "input.score", delta: 1 }] },
        });
        render();
      });
    }

    render();
  </script>
</body>
</html>
```

**纯静态展示且没有 runtime-backed mechanics 时，可保留 file 模式：**

```html
<!-- ENGINE: dom-ui | VERSION: tailwind-v4 | RUN: file -->
<script>/* inline classic script only; do not import local modules in file mode */</script>
```

## LLM 易错点

| 错误 | 纠正 |
|---|---|
| 写成 React/Vue | 本模板是纯 vanilla JS |
| 在事件处理里直接拼 DOM 补丁 | 一律走 `mutate(state); render();` |
| 忘记 `window.gameState` | 必须暴露 |
| `run-mode=file` 还用本地 module src | primitive runtime 需要 `RUN: local-http`；file 模式只能内联 classic script |
| 混用 Tailwind v3 的 `@apply` | v4 浏览器 CDN 只用 utility class |
| 每次 render() 用 innerHTML 全量重建后直接查 DOM | **先绑定事件再操作**（见下方说明） |
| querySelector 获取元素后 render() 导致引用失效 | **动画期间禁止触发 render()**（见下方说明） |
| totalAttempts 在 onClick 和 checkMatch 中双重计数 | **计数只在 checkMatch 中+1**（见下方说明） |
| 每次 render 都重新绑定事件 | **使用事件委托**（见下方说明） |
| setInterval 计时器忘记清理 | **场景切换时必须 clearInterval** |

### innerHTML 全量重建陷阱（严重）

DOM 游戏最常见的模式是每次状态变化后 `innerHTML = ...` 全量重建。这带来两个严重问题：

**问题 1：动画期间 DOM 引用失效**

```js
// ❌ 错误：获取 DOM 引用 → render() 重建 DOM → 引用指向已销毁节点
function matchFail(card1, card2) {
  const el1 = document.querySelector(`[data-id="${card1.id}"]`);
  el1.classList.add("shake");  // 添加了动画类
  setTimeout(() => {
    el1.classList.remove("shake");  // ⚠️ 如果 render() 已重建 DOM，el1 是废弃节点
  }, 400);
}
// 如果计时器每秒触发 render()，shake 动画期间 DOM 已被重建！

// ✅ 正确：动画期间不触发 render()，或用 CSS animation-fill-mode 让动画自然结束
function matchFail(card1, card2) {
  state.isProcessing = true;
  const el1 = document.querySelector(`[data-id="${card1.id}"]`);
  el1.classList.add("shake");
  setTimeout(() => {
    card1.selected = false;
    card2.selected = false;
    state.isProcessing = false;
    render();  // 动画结束后再统一 render
  }, 400);
}
// 计时器只更新 state.timeLeft，不直接 render()；用单独的 HUD 更新函数
function updateTimerDisplay() {
  const timerEl = document.getElementById("timer");
  if (timerEl) timerEl.textContent = formatTime(state.timeLeft);
}
```

**问题 2：每次 render 都重新绑定事件**

```js
// ❌ 错误：每次 render 都 querySelector + addEventListener
function render() {
  app.innerHTML = `<div id="cards">...</div>`;
  document.querySelectorAll(".card").forEach(el => {
    el.addEventListener("click", () => onCardClick(el.dataset.id));
  });
}

// ✅ 正确：使用事件委托，只绑定一次
app.addEventListener("click", (e) => {
  const cardEl = e.target.closest("[data-card-id]");
  if (cardEl) onCardClick(cardEl.dataset.cardId);

  const btnEl = e.target.closest("[data-action]");
  if (btnEl) onAction(btnEl.dataset.action);
});
function render() {
  app.innerHTML = `<div id="cards">...</div>`;  // 不需要再绑定事件
}
```

### 计数逻辑规范

"尝试次数"只在**配对判定时**+1，不能在每次点击时+1：

```js
// ❌ 错误：点击+1 且 matchFail 又+1 → 一次失败 = 3次
function onCardClick(card) {
  state.totalAttempts++;  // 第一次+1
  // ...
}
function matchFail() {
  state.totalAttempts++;  // 第二次+1（同一次配对内）
}

// ✅ 正确：只在 checkMatch 入口+1
function checkMatch() {
  state.totalAttempts++;
  if (card1.pairId === card2.pairId) matchSuccess();
  else matchFail();
}
```

### 计时器与 render 的配合

```js
// ❌ 错误：setInterval 里每秒 render() → 打断进行中的动画
state.timerInterval = setInterval(() => {
  state.timeLeft--;
  render();  // 全量重建 DOM！
}, 1000);

// ✅ 正确：计时器只更新数字，不全量 render
state.timerInterval = setInterval(() => {
  state.timeLeft--;
  updateTimerDisplay();  // 只更新计时器文本
  if (state.timeLeft <= 0) {
    clearInterval(state.timerInterval);
    state.phase = "result";
    render();
  }
}, 1000);
```

## window.gameState 暴露位置

建议在 state 初始化处：

```js
const state = { phase: "ready", score: 0 };
window.gameState = state;
```

## Playwright 断言示例

```js
await page.goto(launchUrl);
await page.waitForFunction(() => window.gameState !== undefined);
await page.click("#btn-start");
expect(await page.evaluate(() => window.gameState.phase)).toBe("playing");
```

## 目录约定

- 默认：

```text
template/
└── index.html
```

- 复杂项目可切：

```text
game/
├── index.html
├── package.json        # 若 src/*.js 用 ESM
└── src/
    ├── state.js
    ├── render.js
    └── main.js
```
