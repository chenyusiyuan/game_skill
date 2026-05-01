---
name: game
description: 小游戏自然语言生成专用链路。当用户说「做个XX小游戏」「生成一个YY玩法的网页游戏」「用 Phaser/PixiJS/Canvas/DOM/Three.js 做个游戏」时使用。覆盖 Understand → GamePRD → 2.5A/2.5B → Expand → Stage 1-5（Codegen/Verify 分段推进），并在 GamePRD 与 Expand 之间运行 Phase 2.5A User Clarify 与 Phase 2.5B Design Strategy。
---

# Game Skill（Codex 入口）

本项目是 game_skill 的 Codex 接入点。处理小游戏生成任务时：

## 1. 必读 SOP（按顺序加载）

1. **主 SOP**：`game_skill/skills/SKILL-codex.md`（42 章节完整链路，Codex 版本）
2. **适配对照**：`game_skill/skills/CODEX-ADAPTATION.md`（与 CC 版本的 4 类差异，维护参考）

读完上述两份文件后，按 SKILL-codex.md 声明的阶段推进：

```
Phase 1  Understand        → cases/<slug>/docs/brief.md
Phase 2  GamePRD           → cases/<slug>/docs/game-prd.md
Phase 2.5A User Clarify    → cases/<slug>/docs/spec-clarifications.md
Phase 2.5B Design Strategy → cases/<slug>/docs/design-strategy.yaml
Phase 3  Expand            → cases/<slug>/specs/*.yaml
Stage 1-5 Codegen+Verify   → cases/<slug>/game/
```

## 2. 共享资产（平台无关）

| 资产 | 路径 |
|---|---|
| 所有 SOP 子文档 | `game_skill/skills/{expand,codegen,verify,stage-roadmap,iteration,patch-codegen,clarify,design-strategy,spec-clarify}.md` |
| 所有 check 脚本 | `game_skill/skills/scripts/*.js`（node 脚本，用 bash 执行） |
| 所有 schema | `game_skill/skills/schemas/*.json` |
| 所有 engine templates | `game_skill/skills/references/engines/{phaser3,pixijs,canvas,dom,three}/` |
| 产物写入位置 | `cases/<slug>/`（除 `cases/anchors/` 外均 gitignore） |

## 3. Codex 工具约定

- 文件操作：`read` / `multi_read` / `write` / `edit`
- 脚本执行：`bash`（调用 `node game_skill/skills/scripts/*.js`）
- 用户提问：纯文本编号选择题（SKILL-codex.md 已规范，Q1/Q2/Q3 带 A/B/C/D 选项，D 为"其他"自由输入）
- 子任务：内联 prompt（Codex 无 `subagent_type`；角色切换靠 prompt 声明，如 "现在切换为 game-gameplay-expander 角色"）
- 并发：Codex 无真并发，Phase 3 的 5 个 expander 按 scene/rule/data/assets/event-graph **顺序执行**

## 4. 运行要求

- 项目根：`/Users/bytedance/Project/game_skill/`（任何 case 产物都在此下的 `cases/<slug>/`）
- Node：脚本需要 Node（已有），playwright 用于部分 runtime check
- 所有路径相对于项目根

## 5. 状态管理

跨会话恢复：读 `cases/<slug>/.game/state.json` 定位 resume 点（SKILL-codex.md §165 规范）。长任务（Stage 1-5 全链路）建议每 Stage 结束保存 state 后新开会话继续，避免 context 超限。

## 6. 不要做的事

- 不要读 `game_skill/skills/SKILL.md`（那是 Claude Code 版本，调用了 Codex 没有的工具）
- 不要复制 SOP 子文档到别处（平台无关，两版本共享同一份）
- 不要改 CC 版本产物去"兼容"Codex（`SKILL-codex.md` 已是镜像，修改任何 SOP 应参考 `CODEX-ADAPTATION.md` 的 4 类替换规则同步改两版）

## 7. 与 Claude Code 的关系

本 AGENTS.md 只被 Codex 读取；Claude Code 读的是 `CLAUDE.md`（项目根未设置，CC 从全局 `~/.claude/CLAUDE.md` + skill plugin 加载）。两个平台**互不影响**。
