# TODO — P1 迁移 profile + 模板文档到 test-hooks 三分类

**状态**：已推迟。原因：工作量中等（66 个 profile 批量改 + 4 处模板/文档示例 + checker 死线），且需先确认 codegen 稳定产出 `window.gameTest.drivers.clickStartButton` 命名空间——否则 profile 迁移完会找不到 driver 挂掉。

**前置依赖**：

1. 跑一次真实 codegen（canvas / pixijs / phaser3 / dom-ui 各一个小 case），确认业务代码里真的暴露了 `window.gameTest.drivers.*`、`.observers.*`、`.probes.*` 三个命名空间
2. 确认至少一条 fixture 能用新命名空间 profile 跑过 `check_playthrough`

**上游基础已齐**：

- schema 三桶已硬化（`8febe99`）
- deprecated-flat-test-hooks 死线 `2026-06-01`（`eaf418f`）
- checker 已支持两种形式同时存在，deprecated 有 warning 但不 fail

---

## Deliverable P1-A — 模板/文档 example 统一到三分类

**工作量小，风险低**。先做这项可以给 B 做 reference。

修改清单：

| 文件 | 改动 |
|---|---|
| `game_skill/skills/references/engines/_common/test-hook.js:12` | 注释里 `window.gameTest.clickStartButton` 改成 `window.gameTest.drivers.clickStartButton`，`window.simulateCorrectMatch` 改为 `window.gameTest.drivers.simulateCorrectMatch` 或明确标 legacy |
| `game_skill/skills/references/engines/three/guide.md:275` | `await page.evaluate(() => window.gameTest.clickStartButton())` 改为 `.drivers.clickStartButton()` |
| `game_skill/skills/scripts/check_asset_usage.js:388` | 兼容 fallback 代码保留，但加 `console.warn('[deprecated] flat window.gameTest.clickStartButton fallback')` 一行，且用 `typeof window?.gameTest?.drivers?.clickStartButton === "function"` 作为首选分支 |
| `game_skill/skills/scripts/test/run.js:678` | 旧 API 兼容测试更名为"旧 API 过渡兼容路径 — 仍应兼容但记 deprecation warning"；新增一条"新 API `drivers.clickStartButton()` → 应走新路径" |

Commit：`chore(test-hooks): align template and doc examples with tri-bucket namespaces`

## Deliverable P1-B — profile 批量迁移

66 个 profile 在 `game_skill/skills/scripts/profiles/`。

修改规则（脚本化或 Codex 逐条处理）：

```
window.gameTest.clickStartButton()      →  window.gameTest.drivers.clickStartButton()
window.gameTest.clickRetryButton()      →  window.gameTest.drivers.clickRetryButton()
window.simulateCorrectMatch()           →  window.gameTest.drivers.simulateCorrectMatch()
window.simulateWrongMatch()             →  window.gameTest.drivers.simulateWrongMatch()
window.gameTest.getCards()              →  window.gameTest.observers.getCards()
window.gameTest.getSnapshot()           →  window.gameTest.observers.getSnapshot()
window.gameTest.getTrace()              →  window.gameTest.observers.getTrace()
window.gameTest.getAssetUsage()         →  window.gameTest.observers.getAssetUsage()
window.gameTest.resetWithScenario(...)  →  window.gameTest.probes.resetWithScenario(...)
```

**注意**：
- 原 profile 的 `eval` 往往是 `{"action": "eval", "code": "window.gameTest.clickStartButton()"}`；同时也要检查 `js` 字段（profile 格式历史上两种都有）
- `check_playthrough.js:116` 的 shortcut 正则只禁 `gameTest.click/dispatch/...`——迁移后仍会命中（driver 调用 + 真实 UI click 共存），这是正确行为
- `check_playthrough.js:172` 禁 `gameTest.probes.*` 在 profile 里使用；如果原 profile 误用了 probe，这次要改成 observer 或 driver

Commit：`chore(test-hooks): migrate 66 profiles to observers/drivers/probes namespaces`

## Deliverable P1-C — profile 格式 deprecation 死线

对齐 `required-test-hooks` 的 `2026-06-01` 死线。

修改 `check_playthrough.js:180-190` 区域（`deprecated-flat-gameTest-hook` 的 warning 分支）：

```javascript
const DEPRECATED_FLAT_PROFILE_DEADLINE = "2026-06-01";
const flatDeadline = new Date(DEPRECATED_FLAT_PROFILE_DEADLINE);
const now = new Date();
if (now >= flatDeadline) {
  profileShapeErrors.push(`[PROFILE][test-hooks] deprecated-flat-gameTest-hook 死线 ${DEPRECATED_FLAT_PROFILE_DEADLINE} 已过；必须迁移到 observers/drivers/probes`);
} else {
  profileShapeWarnings.push(...);
}
log.entry({ type: 'deprecated-flat-gameTest-hook', deadline: DEPRECATED_FLAT_PROFILE_DEADLINE, enforced: now >= flatDeadline, ... });
```

Commit：`chore(test-hooks): set 2026-06-01 deadline for deprecated flat gameTest in profiles`

---

## 执行顺序建议

1. **P1-A 先做**：模板/文档 example 改完不影响任何 fixture，是最低风险
2. **再跑一次真实 codegen** 生成一个新 case 确认三分类命名空间确实产出（不要跳过）
3. **P1-B 大批量 profile 迁移**：每迁移一批，跑 `node game_skill/skills/scripts/check_playthrough.js` 在一两个现成 case 上验回归
4. **P1-C 死线**：独立 commit，日历触发即可自动升级

## 可选：在 P1-B 之前做一轮清理

- `profiles/` 下 66 个里有大量 `.skeleton.json` 骨架文件。先审计：哪些是活跃使用的 profile、哪些是历史残留、哪些是 skeleton 模板（可能不该提交）
- 若有超过一半是死 profile，应先删减再迁移，避免为死代码做无用功

## 不要做

- 不要把 `required-test-hooks: string[]` 的兼容分支一起砍——那是另一条死线（2026-06-01 在 `check_implementation_contract.js`），profile 是平行迁移
- 不要用 `sed -i` 一把梭——每个 profile 结构可能不同（有 `code` 有 `js`），先写 node 小脚本保留 JSON 结构
- 不要改 `_profile_anti_cheat.js`——这是 B 段，跟 P1 无关

## 相关参考

- 三分类硬化 commit：`8febe99`
- 死线模式 commit：`eaf418f`
- 模板 example 现状：`game_skill/skills/references/engines/_common/test-hook.js`
- 业务测试兼容路径：`game_skill/skills/scripts/check_asset_usage.js:386-390`
