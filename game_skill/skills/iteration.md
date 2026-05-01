---
name: game-iteration
description: "User feedback branch SOP for 7+1 iteration classes, preserve preflight, rework, extension, and pivot handling."
---

# Iteration SOP（支路迭代）

## 职责

本文档规定任意 stage 完成后插入用户反馈时，主 agent 如何记录、分类、预演 preserve 冲突、路由、执行、归档，并回到主干 Stage 1-5。

所有支路开始前都必须保留用户原文，运行 `prd_diff.js --classify` 和 `preserve_preflight.js`。主干 stage 的权威 SOP 在 `stage-roadmap.md`；本文只处理支路。

## 7+1 类处理流程

| 类型 | 输入 | 路径 | 归还主干位置 | 用户确认策略 |
|---|---|---|---|---|
| `code-bug` | 用户原文、当前 game/、当前 stage report | `phase_plan.js --mode iteration-code-bug --stage N`；只改 `game/` 中的 bug，跑当前 stage verify | 回本 stage verify | 自动；若 preserve preflight 有冲突则强制确认 |
| `tuning` | 用户原文、`specs/data.yaml`、当前 stage contract | `phase_plan.js --mode iteration-tuning --stage N`；只改数值、节奏、单条内容 | 回本 stage verify | 自动；不得改 PRD/core loop |
| `art-change` | 用户原文、`assets.yaml`、`color-scheme`、`juice-plan` | `phase_plan.js --mode iteration-art-change --stage N`；只重跑视觉、素材和表现绑定 | 回本 stage 素材 check | 自动；不得改玩法 rule |
| `scope-change` | 用户原文、`stage-contract-N.yaml`、当前 specs | `phase_plan.js --mode iteration-scope-change --stage N`；重建本 stage contract，重跑 Phase 3-5 | 当前 stage acceptance | 推荐确认；preserve 冲突时强制确认 |
| `rework` | 用户原文、目标 stage patches、stage-history | `phase_plan.js --mode iteration-rework --stage TARGET`；生成反向 patch，重放后续 stage | 最近成功 stage 或目标 stage 后续 | 推荐确认；重放失败强制确认 |
| `extension` | 用户原文、`extension-contract-K.yaml`、preserve.lock | `phase_plan.js --mode iteration-extension --stage N`；新增 extension contract，patch-based codegen | 主干交付后追加 | 推荐确认；必须 preserve 回归 |
| `pivot` | 用户原文、PRD、design-strategy、stage-history | `phase_plan.js --mode iteration-pivot`；归档旧 game/specs/preserve，重写 PRD + design-strategy | Stage 1 重新开始 | 强制确认 |
| `ambiguous` | 用户原文、分类器低置信输出 | AskUserQuestion 让用户选 7 类之一 | 由用户选择决定 | 强制确认 |

分类器输出只给建议，最终路由必须同时参考 preserve preflight。任何支路都不得直接覆盖 `.game/preserve.lock.yaml`；只有 pivot 可以归档旧 lock 后重新生成。

## preserve preflight 工作流

每次支路触发前运行：

```bash
node game_skill/skills/scripts/preserve_preflight.js cases/${PROJECT} /tmp/fb.txt
```

输出：

```json
{
  "conflicts": [],
  "recommended-type": "tuning",
  "requires-user-confirm": false
}
```

执行规则：
- `conflicts.length === 0`：按 `recommended-type` 或分类器高置信类别执行。
- `conflicts.length >= 1`：强制 AskUserQuestion，让用户选择 `rework`、升级 `pivot`、或放弃本次反馈。
- preflight 缺失 preserve.lock 或反馈文件时也视为需要确认；主 agent 不得用猜测绕开 preserve.lock。
- 支路实际 apply 后，至少跑 `check_preserve_regression.js`；主干 stage acceptance 由 `stage-roadmap.md` 决定。

## rework 反向 patch 机制

本段是 `patch-codegen.md` §6 的特化；通用 patch 协议见 `patch-codegen.md`。

1. 找到目标 stage 的归档：`cases/${PROJECT}/.game/stages/${TARGET_STAGE}/patches.json`。
2. 根据归档生成 reverse patch：`add-file` 反向为 `delete-file`；`delete-file` 反向为带原内容的 `add-file`；`edit` 和 `replace-function` 必须依赖归档中的旧内容或人工生成锚点。
3. 先 dry-run：

```bash
node game_skill/skills/scripts/apply_patch.js cases/${PROJECT} /tmp/reverse-patch.json --dry-run
```

4. dry-run 通过后 apply，并把本次 rework 事件追加到 `stage-history.yaml`。
5. 依次重放后续 stage patches。任一重放失败，停止并让用户选择升级 `pivot` 或人工介入。

## extension 追加机制

本段是 `patch-codegen.md` §6 的特化；通用 patch 协议见 `patch-codegen.md`。

extension 不占用主干 Stage 1-5 编号，命名为 `extension-1`、`extension-2`。

每次 extension 必须新增：
- `cases/${PROJECT}/specs/extension-contract-${K}.yaml`
- `scope.add[]`、`scope.preserve[]`、`scope.forbid[]`
- `acceptance[]`
- `complexity-budget`

执行前跑 preserve regression；执行时使用 patch-based codegen：

```bash
node game_skill/skills/scripts/apply_patch.js cases/${PROJECT} /tmp/extension-patch.json --archive-to .game/stages/extension-${K}/patches.json
```

交付后追加 stage-history 的 `extension-stage` 事件。extension 可以多次追加，但不能改写主干历史。

## pivot 归档协议

pivot 表示用户要求改变核心玩法，已经违背 preserve.lock 保护的 Stage 1 闭环。

执行顺序：
1. 强制确认用户确实要 pivot。
2. 归档 `game/` 为 `game.v${PIVOT_COUNT}/`。
3. 归档 `specs/` 为 `specs.v${PIVOT_COUNT}/`。
4. 归档 `.game/preserve.lock.yaml` 为 `.game/preserve.v${PIVOT_COUNT}.lock.yaml`。
5. 保留 `.game/stage-history.yaml`，追加 pivot 事件，作为新 PRD 和 design-strategy 的反例上下文。
6. 重写 `docs/game-prd.md` 和 `docs/design-strategy.yaml`。
7. 重置 cursor/state 到 Stage 1 起点。
8. 从 `stage-1-vertical-slice` 重启，Stage 1 完成后重新生成 preserve.lock。
