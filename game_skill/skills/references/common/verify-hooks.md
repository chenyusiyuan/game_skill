# 校验桥规范：window.gameState 与 Playwright 集成

所有 5 条引擎模板必须遵守本规范，让 Phase 5 的 `check_playthrough.js` 能用统一接口做断言。

---

## window.gameState 暴露

每个游戏必须在**至少一处** JS 代码中执行：

```js
window.gameState = state;
```

**位置推荐**：`src/state.js` 的最后一行。

**要求**：

- `state` 必须是 **plain object**（`{}`），不能是 Proxy / Map / Class 实例
- 所有字段可通过 `JSON.stringify` 序列化（不含循环引用 / 函数）
- 字段名使用 camelCase
- 核心字段必须包含：`phase`（`ready | playing | win | lose` 或自定义状态）、`score`（数字）
- 其他游戏数据按 GamePRD 的 `@entity` / `@resource` 定义

**非核心但推荐**：`scene`（Phaser 场景名）、`level`（当前关）、`timeLeft`（倒计时）、`combo`（连击）

---

## 其他挂 window 的对象（按引擎）

| 引擎 | 挂的对象 | 用途 |
|---|---|---|
| phaser3 | `window.game`（Phaser.Game 实例） | 访问 `game.scene.getScene("MainScene")` 做场景级断言 |
| pixijs | `window.app`（Application 实例） | `app.ticker.stop()` 做确定性测试 |
| three | `window.app`（`{ renderer, camera, active }`） | 访问 renderer/camera 做 3D 运行时断言 |
| canvas | —（可选 `window.step(ms)`） | 手动推进一帧 |
| dom-ui | —（DOM 直接查询） | 不需要额外挂 |

---

## Playwright 断言模式

### 模式 1：状态断言

```js
await page.goto(launchUrl);
await page.waitForFunction(() => window.gameState !== undefined);

// 触发开始
await page.click('button[data-action="start"]'); // 或其他
expect(await page.evaluate(() => window.gameState.phase)).toBe('playing');
```

### 模式 2：状态流转

```js
// 模拟玩家完成一轮配对
for (let i = 0; i < 4; i++) {
  await page.click(`[data-card-id="${enIds[i]}"]`);
  await page.click(`[data-card-id="${zhIds[i]}"]`);
}
expect(await page.evaluate(() => window.gameState.phase)).toBe('win');
```

### 模式 3：像素级断言（Canvas / Pixi / Phaser）

```js
const canvas = await page.locator('canvas');
const buf = await canvas.screenshot();
// 和基线 compare
```

### 模式 4：hard-rule 专项断言

Pixel Flow 的"不得全屏自动索敌"→

```js
// 小猪放在顶部中间
await page.evaluate(() => {
  window.gameState.pigs = [{ color: 'red', x: 3, y: 0, dir: 'down' }];
  window.gameState.board[0][3] = { color: 'blue' };
  window.gameState.board[2][3] = { color: 'red' };
});
await page.waitForTimeout(1000);
const board = await page.evaluate(() => window.gameState.board);
// 断言：blue 方块仍在（没被穿透攻击）
expect(board[0][3]).not.toBeNull();
```

---

## Profile 文件格式

每个 case 对应一份 profile：`${SKILL_DIR}/scripts/profiles/{case-id}.json`

```json
{
  "case_id": "word-match-lite",
  "game_html_relative": "game/index.html",
  "boot_timeout_ms": 3000,
  "assertions": [
    {
      "id": "a-boot-state",
      "kind": "state",
      "description": "boot 后 phase = ready",
      "setup": [],
      "expect": {
        "selector": "window.gameState.phase",
        "op": "eq",
        "value": "ready"
      }
    },
    {
      "id": "a-start-click",
      "kind": "state",
      "description": "点击开始进入 playing",
      "setup": [
        { "action": "click", "selector": "#btn-start" },
        { "action": "wait", "ms": 200 }
      ],
      "expect": {
        "selector": "window.gameState.phase",
        "op": "eq",
        "value": "playing"
      }
    },
    {
      "id": "hr-no-autoaim",
      "kind": "hard-rule",
      "description": "不得全屏自动索敌",
      "setup": [
        { "action": "eval", "js": "window.gameState.pigs = [...]; window.gameState.board = [...]" },
        { "action": "wait", "ms": 1000 }
      ],
      "expect": {
        "selector": "window.gameState.board[0][3]",
        "op": "neq",
        "value": null
      }
    }
  ]
}
```

- `kind`: `state`（普通状态）/ `hard-rule`（强约束，必须通过）/ `pixel`（截图对比）
- `op`: `eq` / `neq` / `gte` / `lte` / `in` / `truthy`
- `selector`: JS 表达式字符串，Playwright 会 `page.evaluate("() => " + selector)`

---

## 校验退出码约定

`check_playthrough.js` 的退出码：

- `0`: 所有 assertion 通过
- `1`: 至少 1 个 `kind: state` 失败
- `2`: 至少 1 个 `kind: hard-rule` 失败（更严重）
- `3`: Playwright 启动失败（环境问题）
- `4`: Profile 覆盖率不足（PRD 中有 `@check(layer: product)` 未被 profile assertion 覆盖，或缺少交互类 assertion）

Phase 5 verify 按退出码决定是否进入下一轮修复。退出码 4 时不进修复循环，而是要求先补全 profile。

---

## 最佳实践

1. 修改 state 时**必须**保持 `window.gameState` 引用不变（`state.foo = bar`，不是 `window.gameState = newObj`）
2. 异步操作（动画、setTimeout）完成后**再**修改 phase，否则断言可能在中间态失败
3. 调试时用 `window.__debug = true` 开关，不要在 `gameState` 里塞调试字段
4. 不要暴露函数到 gameState（只能序列化数据）

---

## 游戏测试 API 暴露（Canvas / Pixi / Phaser 必须）

> DOM 引擎可通过 Playwright `page.click('[data-card-id="en-0"]')` 直接点击真实 DOM 元素，不需要额外 API。
> 但 Canvas / Pixi / Phaser 引擎的交互对象在像素层面，Playwright 无法精确定位卡片，必须暴露测试 API。

### 要求

Canvas / Pixi / Phaser 游戏**必须**在 `window.gameTest` 上按三分类暴露至少以下测试函数（按游戏类型选择）：

```js
window.gameTest = {
  observers: {
    getCards: function() { return structuredClone(state.cards); }, // 获取卡片列表
    getSnapshot: function() { return structuredClone(state); }
  },
  drivers: {
    clickStartButton: function() { ... },      // 点击开始按钮
    clickRetryButton: function() { ... },       // 点击重试按钮
    selectCard: function(cardId) { ... },       // 选中指定卡片
    simulateCorrectMatch: function() { ... },   // 模拟一次正确配对
    simulateWrongMatch: function() { ... }      // 模拟一次错误配对
  },
  probes: {
    resetWithScenario: function(scenario) { ... } // 仅 runtime_semantics checker 使用
  }
};
```

### 关键约束

- **测试函数必须走游戏的真实逻辑路径**，不能直接修改 gameState
  - ✅ `window.gameTest.drivers.simulateCorrectMatch = () => { selectCard(cards[0]); selectCard(cards[1]); }` — 调用了游戏的 `selectCard` 函数
  - ❌ `window.gameTest.drivers.simulateCorrectMatch = () => { state.score += 10; state.matchedPairs++; }` — 直接改 state，跳过了交互逻辑
- 测试函数应考虑 `isProcessing` 锁、动画等待等真实游戏流程
- 旧 `window.simulateCorrectMatch` 仅为 legacy flat 兼容路径，新 profile 必须使用 `window.gameTest.drivers.*`
- 测试函数暴露到 `window.gameTest` 上，但不要污染 `window.gameState`
