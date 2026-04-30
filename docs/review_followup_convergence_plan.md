# Review Follow-up Convergence Plan

## Summary

本计划承接初始 review 报告中未在第一轮 P0/P1 完成的后续项，目标是把“素材真实可见性、视觉语义槽位、case-driven 复盘统计、高频 archetype preset”从协议建议推进到可执行脚本、模板 API 与回归测试。

## Scope

本轮落地四类内容：

1. **Phaser / PixiJS / Three.js asset rendered/visible evidence**
   - 在三方引擎 registry adapter 中提供渲染包装 API。
   - runtime evidence 统一写入 `requested | rendered | visible`。
   - `check_asset_usage.js` 对三方引擎视觉 must-render asset 也要求 rendered，核心视觉要求 visible。

2. **轻量 visual-slots**
   - 新增 `specs/visual-slots.yaml` 生成器与 checker。
   - `assets.yaml` 可用 `fulfills-slot` 指向具体视觉槽。
   - `implementation-contract.yaml` 透传为 `visual-slot`，用于 codegen 和 checker 对齐。

3. **case-driven pattern 结构化沉淀**
   - 新增脚本把失败 pattern 写入 `.pipeline_patterns.md` 的结构化 YAML block。
   - 同类 pattern 累计计数，达到 3 次时输出必须抽象升级的信号。

4. **archetype preset 骨架**
   - 新增 archetype preset 目录与校验脚本。
   - 先覆盖 `quiz-rule`、`board-grid.2048`、`board-grid.gomoku`、`board-grid.memory-match`。
   - preset 只承载 mechanics/data/visual/probe/profile 骨架，不绕过 runtime/checker gate。

## Non-goals

- 不把所有历史 case 强制迁移到 `visual-slots.yaml`。
- 不在本轮生成完整游戏模板代码。
- 不放松任何现有 P0 gate。

## Test Plan

- `npm test`
- `git diff --check`
- `node --check` 新增脚本与改动脚本
- 静态回归：
  - 三方引擎 adapter 暴露 rendered/visible wrapper。
  - `check_asset_usage.js` 对 Pixi/Phaser/Three requested-only runtime evidence fail。
  - `generate_visual_slots.js` 能从 assets/contract 生成槽位。
  - `check_visual_slots.js` 能识别 slot mismatch。
  - `record_pipeline_pattern.js` 能累计 count 并在第三次提示抽象升级。
  - `check_archetype_presets.js` 能校验 preset 必备字段。
