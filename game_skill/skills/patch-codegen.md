---
name: game-patch-codegen
description: "Patch-based codegen SOP for mainline Stage 2-5 and iteration branches."
---

# Patch Codegen SOP

## 职责

本文档是主干 Stage 2-5 与支路 `iteration-*` 共用的 patch-based codegen 规范。

Stage 1 走全量 codegen，即 `codegen.md` 的主流程；Stage 2+ 和所有支路走 patch。目标是把 preserve invariant 从 prompt 约束升级为物理约束：patch 不碰的行永远不变。

## 何时走 patch / 何时走全量

- Stage 1 vertical-slice：全量 codegen。第一次生成，没有可 patch 的基线。
- Stage 2 content、Stage 3 variety、Stage 4 progression、Stage 5 polish：patch-based codegen。
- `iteration-code-bug` / `iteration-tuning` / `iteration-art-change`：patch。
- `iteration-scope-change`：patch。即使重新生成 `stage-contract`，代码落地仍使用 patch。
- `iteration-rework`：反向 patch + 重放后续 stage patch。
- `iteration-extension`：新增 `extension-contract` + patch。
- `iteration-pivot`：整段归档 `game.v{N}/` 后回到 Stage 1 全量 codegen。

## patch 协议

patch 格式遵循 `game_skill/skills/schemas/patch.schema.json`，顶层可以是 patch 数组，也可以是 `{ "patches": [...] }`。

支持四种 op：
- `add-file`：新增文件。
- `edit`：anchor-insert，在唯一锚点后插入片段。
- `replace-function`：按函数粒度替换实现。
- `delete-file`：删除文件。

`edit` op 依赖代码中唯一锚点注释 `// @hook: <id>`。Stage 1 全量 codegen 必须在关键位置埋锚点，见下一节。

模型产出的 patch 不是 diff：不写整个文件，只写本次要加、改、删的片段。

## Stage 1 全量生成必须埋的锚点

这些锚点决定 Stage 2+ 的 patch 是否可定位：

- `main.js` 或对应 engine entry 文件：`// @hook: game-init`、`// @hook: update-loop`、`// @hook: render-loop`
- `state.js`：`// @hook: state-init`、`// @hook: state-reducers`
- 若有 `level-manager` / `scene-manager`：`// @hook: level-load`、`// @hook: scene-transition`

缺锚点会导致 Stage 2+ 的 `edit` op 无法定位；Stage 1 验收时必须 `grep` 命中锚点集后，才允许进入 Stage 2。

## patch 应用流程

主干 Stage 2-5 通用流程如下：

1. codegen agent 产出 `patches.json`，格式对齐 `patch.schema.json`。
2. 先 dry-run 预览：

```bash
node game_skill/skills/scripts/apply_patch.js cases/${PROJECT} /tmp/patches.json --dry-run
```

3. 如 `preserve.lock` 存在，先跑 preserve 回归：

```bash
node game_skill/skills/scripts/check_preserve_regression.js cases/${PROJECT}
```

4. 实际 apply，并归档本次 patch：

```bash
node game_skill/skills/scripts/apply_patch.js cases/${PROJECT} /tmp/patches.json --archive-to .game/stages/${N}/patches.json
```

5. 跑当前 stage 的聚合验证：

```bash
node game_skill/skills/scripts/verify_all.js cases/${PROJECT} --profile ${PROJECT} --stage ${N}
```

6. 任一失败即 rollback：`apply_patch.js` 失败会自动回滚本次已写文件；`check_preserve_regression.js` 或 `verify_all.js` 失败时，需要手动 revert `.game/stages/${N}/patches.json` 中本次归档。

## 归档与 rollback

- 每次 patch 成功后落到 `cases/${PROJECT}/.game/stages/${N}/patches.json`。
- `stage-history.yaml` 追加 `kind: stage` 条目，对齐 `game_skill/skills/schemas/stage-history.schema.json`。
- rollback：stash 最后一组 patch，无需 git 分支。
- 支路 patch 归档到 `.game/stages/extension-${K}/patches.json` 或 `.game/stages/iteration-${category}-${ts}/patches.json`。

## 与全量 codegen 的职责分界

- 全量 codegen，即 `codegen.md` 主体，负责初次搭骨架、设置 anchor、生成 per-case runtime wrapper、复制 `_trace.mjs`。
- patch codegen，即本文档，只在既有骨架之上加、改、删；禁止重写 `main.js` 整体；禁止删除 Stage 1 确定的核心 entity、win-lose、input-model。
- 如果 patch 发现需要重写超过 50% 的 `main.js`，codegen agent 应改用 `replace-function` op 按函数粒度替换；不得用 `add-file` 覆盖已有文件。
