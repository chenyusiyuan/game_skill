# 新增引擎接入手册

本文件说明如何在 `references/engines/` 下接入第 6 条及之后的引擎（例如 Matter.js、Babylon.js、Cocos），**不修改任何 `skills/*.md`** 即可被主链路识别和调用。

## 接入步骤

### 1. 新建引擎目录

```
references/engines/
└── {engine-id}/            ← id 必须为 kebab-case（three / matter / babylon / cocos ...）
    ├── guide.md
    └── template/
        ├── index.html
        └── src/
            └── ...
```

### 2. 更新 `engines/_index.json`

在 `engines` 数组末尾追加一条：

```json
    {
      "id": "matter",
      "name": "Matter.js",
      "version-pin": "matter-js@0.20",
      "current-stable": "0.20.0",
      "default-run-mode": "local-http",
      "template": "engines/matter/template/",
      "guide": "engines/matter/guide.md",
      "best-fit": ["物理益智", "轻量碰撞模拟"],
      "avoid-for": ["3D 展示型", "纯 DOM UI"]
}
```

**严禁**：改动已有 5 个引擎条目。新增只追加。

### 3. guide.md 必须包含 4 个章节

以 `## <章节名>` 为 h2：

| 章节 | 目的 |
|---|---|
| `## 选型建议` | 9 大类游戏分类 + 推荐度（✅/⚠️/❌） |
| `## LLM 易错点` | 用表格列出至少 5 条常见错误 + 纠正 |
| `## 最小骨架代码` | 跑得动的 index.html / 关键 JS 片段 |
| `## window.gameState 暴露位置` | 明确指出 state.js 等文件的最后一行写 `window.gameState = state;` |
| `## Playwright 断言示例` | 至少 3 行 Playwright 代码 |

### 4. template/ 强制约定

- `template/index.html` 是入口，必须声明 `RUN: file` 或 `RUN: local-http`
- 若 `RUN: file`：不应依赖本地 ES module / 相对 `import`
- 若 `RUN: local-http`：允许 `src/` 和多文件模块结构
- 若 `src/*.js` 使用 ESM，建议在 template 根补一个 `package.json`，声明 `"type": "module"`
- 不允许依赖 npm install / 本地构建
- HTML head 必须含 `<!-- ENGINE: {engine-id} | VERSION: {version-pin} | RUN: {run-mode} -->` 注释
- 任一 JS 文件必须暴露 `window.gameState`
- 视需要暴露其它诊断对象（如 `window.game` 对 phaser3 / `window.app` 对 pixijs）

### 5. （可选）新增 genre 目录

若新引擎开启了新的游戏品类（例如 3D），在 `references/genres/` 下新增 `{genre}.md`，并在本引擎 guide.md 的 `## 选型建议` 表格里关联。

## 自动识别

以下两处会自动根据 `_index.json` 读取新引擎信息：

1. **`skills/scripts/check_game_prd.js`**：`runtime` 枚举值从 `_index.json` 动态加载，新引擎 id 自动进入白名单
2. **`skills/codegen.md`**：主 agent 读 `engine-plan.runtime` 后，用 `_index.json` 中对应条目的 `guide` / `template` 字段路由到规范和模板目录

如果这两处的行为不符合预期，检查：

- `_index.json` 语法是否合法（`node -e "JSON.parse(require('fs').readFileSync('_index.json'))"`）
- 目录名与 `id` 字段是否完全一致（大小写敏感）
- 模板文件路径与 `template` 字段一致

## 接入验证

手工跑一次对比验证：

```bash
# 1. 语法
node -e "console.log(JSON.parse(require('fs').readFileSync('references/engines/_index.json', 'utf8')).engines.length)"

# 2. 新引擎跑起来
# 若 RUN=file，可直接 open；若 RUN=local-http，用本地静态服务器打开

# 3. 确认 runtime 被接受
cat > /tmp/probe.md <<EOF
---
game-aprd: "0.1"
project: probe-{engine-id}
platform: [web]
runtime: {engine-id}
mode: 单机
language: zh-CN
---
# Probe
## 1. 项目概述
### @game(main) Probe
> genre: test
> platform: [web]
> runtime: {engine-id}
> mode: 单机
> player-goal: "接入验证"
> core-loop: [@flow(one)]
... （其余必要章节按 game-aprd-format.md 填充）
EOF
node skills/scripts/check_game_prd.js /tmp/probe.md
# 期望：runtime 枚举检查通过（可能有其他错误但不应是 FM008）
```

## 禁止事项

- ❌ 改动 `skills/*.md` 里的硬编码引擎名（应无硬编码）
- ❌ 在 guide.md 里约定新字段而不同步到 `game-aprd-format.md`
- ❌ 让新引擎的 template 要求用户预先 `npm install`
- ❌ 引擎之间共享 guide.md（每个引擎独立 guide）
- ❌ 删除已有引擎目录（废弃需走单独 PR + 跨引擎迁移）
- ❌ **CDN URL 使用 `@latest` 或浮动标签**（会在主版本发布时污染现有模板；例如 `phaser@latest` 在 2026-04 后拉到 v4）

## CDN 版本锁强制条款

所有 `template/index.html` 中引入外部脚本时：

1. **必须** pin 到主版本号，例如 `phaser@3`、`pixi.js@8`、`@tailwindcss/browser@4`
2. **禁止** `@latest`、不加版本号、或只带 `>=x` 语义的区间写法
3. 建议在 HTML head 顶部注释里写死预期版本与运行模式：`<!-- ENGINE: phaser3 | VERSION: phaser@3 | RUN: local-http -->`
4. `_index.json.version-pin` 与 HTML 里的 CDN 版本必须一致

违反该条款的接入 PR 不合规。
