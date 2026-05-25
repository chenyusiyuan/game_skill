# AGENTS.md

主入口：[SKILL.md](./SKILL.md)。Step 0 -> Phase A -> Phase B -> Phase C。

设计意图：用最朴素事实判定首轮生成：真实输入驱动、真实画面变化、真实 milestone、失败诚实停。worker 直接写 case-local Phaser/TypeScript 游戏；用一页 `plan.json` 表达主闭环；用 delivery smoke 验证。

参考文档：
- [docs/known-issues.md](./docs/known-issues.md)（Phase B 卡住时只读引导）。
- [evolution-docs/README.md](./evolution-docs/README.md)（首交付后的 Stage 2-5 演进设计说明；不影响 Stage 1 执行）。

以 `SKILL.md` 为单一真相源。
