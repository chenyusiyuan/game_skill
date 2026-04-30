# game_skill 生成链路收敛修复计划

## Summary

目标是把已落地的 runtime primitive、semantic gate、asset evidence、phase gate 真正闭环，优先修复会让 clean checkout、白屏、误判或漏判的硬问题。执行时先把本计划写入 `docs/runtime_checker_convergence_fix_plan.md`，再按 P0 到 P1 顺序修复并验证。

## Key Changes

- 依赖与模板可运行性
  在 root `package.json` / `package-lock.json` 声明 `js-yaml`；修正 engine templates 中 `_common` import 路径，统一让 `game/src/adapters/*` 指向 `../_common/...`。

- Runtime replay 闭环
  对齐 `predicate-match`、`fsm-transition` 的 replay 输入结构；保留现有 `win-lose-check` 修复；加强 `capacity-gate` / `slot-pool`，让 replay 能识别错误 after state，不只看事件布尔值或粗略 diff。

- Runtime semantics probe
  在 `check_runtime_semantics.js` 执行 `_runtime_probes.js` 中的 `nonMutation`，通过 `gameTest.observers.getSnapshot()` 对比指定实体的关键字段，防止“trace 对了但业务后续误伤实体”。

- Playthrough profile gate
  修复 `click-hits-nothing` 只 push error 但不影响 exit code 的问题，确保 3+ 条 inert interaction 会进入最终失败路径并写入 log/report。

- Asset evidence 升级
  将 asset usage 从单一 “requested” 证据扩展为 `requested | rendered | visible`。先覆盖 canvas/dom-ui 的 wrapper 记录，checker 对 `must-render` 至少要求 `requested + rendered`，核心视觉再要求 `visible`。

- Contract 与 phase gate 收束
  强化 runtime API call 校验：每个 mechanics node 的 runtime 调用必须在同一个 object literal 中带 `node` 和 `rule`。expand gate 加入 `check_spec_clarifications.js`，并把可静态判断的 `check_level_solvability.js` 提前到 expand 阶段。

## Test Plan

- 依赖/基础：删除或忽略 extraneous 依赖风险后跑 `npm install`、`npm test`。
- 模板路径：新增 template import resolver 测试，模拟 `_common` 拷贝到 `game/src/_common` 后逐个 resolve 本地 import。
- Runtime replay：新增 wrapper-generated trace 单测，覆盖 `predicate-match`、`fsm-transition`、`win-lose-check`、`capacity-gate`、`slot-pool` 的正反例。
- Runtime semantics：新增/扩展 probe 测试，验证 `nonMutation` 字段变化会 fail。
- Playthrough：新增最小 profile fixture，确认 3 条 inert interaction 会 exit non-zero。
- Asset usage：新增 canvas/dom-ui fixture，验证 requested-only 不通过，rendered/visible 证据满足后通过。
- 集成：跑 `run_phase_gate.js --phase expand/codegen/verify` 于至少一个 anchor case，再跑 `verify_all.js` 生成真实 report。

## Assumptions

- 第一批执行只处理 P0 和直接相关 P1，不做完整 `visual-slots.yaml` 大重构。
- `visual-primitive` 仍保留为当前主字段；`semantic-slot/visual-slots` 只作为后续升级方向，不在本轮强制迁移所有 case。
- 三方引擎 asset rendered/visible wrapper 先覆盖 canvas/dom-ui，Phaser/Pixi/Three 后续分批补齐。
