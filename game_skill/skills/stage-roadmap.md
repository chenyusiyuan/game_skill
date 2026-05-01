---
name: game-stage-roadmap
description: "Phase 3+ 主干 5 段 stage SOP：vertical-slice / content / variety / progression / polish，以及 stage-contract、preserve.lock、stage-history 的约束。"
---

# Stage Roadmap（主干 5 段）

## 职责

本文档是主干 5 段推进的权威 SOP。每个 stage 都围绕一个独立 `stage-contract-{N}.yaml` 执行，明确本段要新增什么、必须保留什么、禁止改什么，以及 acceptance 需要跑哪些 check。

支路反馈、rework、extension、pivot 的 SOP 放在 `iteration.md`。本文只规定主干 Stage 1-5、`preserve.lock.yaml` 生命周期、stage 契约和历史记录格式。

## 阶段定义

Stage 1 走全量 codegen（见 `codegen.md` 主流程）；Stage 2-5 以及所有支路走 patch-based codegen，协议与锚点规范详见 `patch-codegen.md`。

### Stage 1 — Vertical Slice

- 存在意义：先做出一条能开始、能操作、能产生胜负或结算、且具备 core-identity 手感的最小完整玩法闭环。
- 输入：`docs/game-prd.md`、`docs/spec-clarifications.md`、`docs/design-strategy.yaml`、`specs/mechanics.yaml` 与 `specs/stage-contract-1.yaml`。
- acceptance：由 `check_stage_contract.js --stage 1` 执行 contract 中声明的 checks；Stage 1 结束后必须运行 `generate_preserve_lock.js`。
- acceptance：`check_archetype_identity.js` 通过：若 `design-strategy.archetype-ref` 指向某 archetype，该 archetype 的 core-identity anti-pattern 必须全部实现。
- preserve invariant：抽取核心 entity、胜负/结算条件、input model、核心 UI zone、核心 scenarios 写入 `.game/preserve.lock.yaml`。
- 用户确认策略：Stage 1 完成后必须让用户确认体感方向，确认后才进入 Stage 2。

### Stage 2 — Content Expansion

- 存在意义：在 Stage 1 闭环不变的前提下扩展关卡、内容和基础数据规模。
- 输入：Stage 1 产物、`.game/preserve.lock.yaml`、`specs/stage-contract-2.yaml`。
- acceptance：`check_preserve_regression.js` 先确认 Stage 1 preserve 未破坏，再由 `check_stage_contract.js --stage 2` 执行本段 checks。
- preserve invariant：Stage 1 core-loop、input model、render style 不变；禁止重写主入口来绕开 preserve；本 stage 新增的 entity / 新 rule / 新 UI 必须带自己的 local juice（input-feedback + success/failure-feedback 最小集合），不得推迟到 Stage 5 做。
- 用户确认策略：Stage 2 完成后推荐用户确认内容规模，再进入自动推进段。

### Stage 3 — Variety

- 存在意义：增加敌人、道具、事件或局内变化，让玩法不只重复同一种操作。
- 输入：Stage 2 产物、`.game/preserve.lock.yaml`、`specs/stage-contract-3.yaml`。
- acceptance：先跑 preserve 回归，再跑 stage contract；新增变化必须进入可观察 decision/action 证据。
- preserve invariant：Stage 1 胜负/结算路径不能被新 entity 绕开，新增变化不能吞掉核心操作；本 stage 新增的 entity / 新 rule / 新 UI 必须带自己的 local juice（input-feedback + success/failure-feedback 最小集合），不得推迟到 Stage 5 做。
- 用户确认策略：默认自动推进，但用户反馈可打断并交给支路 SOP 分类。

### Stage 4 — Progression & Resource Loop

- 存在意义：补齐升级、资源、奖励、消耗和局外/局内成长，使内容有推进感。
- 输入：Stage 3 产物、`.game/preserve.lock.yaml`、`specs/stage-contract-4.yaml`。
- acceptance：preserve 回归必须通过；resource loop 必须闭环且不制造无限正反馈。
- preserve invariant：不升级或不购买时仍可完成 Stage 1 核心玩法；升级系统不能吃掉原有数值敏感度；本 stage 新增的 entity / 新 rule / 新 UI 必须带自己的 local juice（input-feedback + success/failure-feedback 最小集合），不得推迟到 Stage 5 做。
- 用户确认策略：默认自动推进，可被用户反馈打断。

### Stage 5 — Balance & Polish

- 存在意义：（重定位）收敛为：难度曲线调参 + 跨阶段节奏整合 + 高级 polish（粒子/屏震/相机/音频 mix）+ 新手引导 + 失败归因 UI。Stage 5 不再承担“第一次出现手感”——core-identity 在 Stage 1 必达，local juice 在各 stage 就位。
- 输入：Stage 4 产物、`.game/preserve.lock.yaml`、`specs/stage-contract-5.yaml`。
- acceptance：preserve 回归通过，stage contract 中所有 checks 通过，交付报告基于真实 verify 结果生成。
- preserve invariant：Stage 4 resource loop 与 Stage 3 variety 行为不变，只改表现、节奏和反馈。
- 用户确认策略：默认自动完成交付；交付后反馈进入支路 SOP。

## Juice 分层原则

- core-identity：archetype 的 anti-patterns severity==core-identity 项；Stage 1 必达。
- local juice：每 stage 新增内容自带的基础反馈；所在 stage 必达，不向 Stage 5 延后。
- advanced polish：粒子 / 屏震 / 相机 / 音频 mix / 跨 stage 节奏 / 新手引导；Stage 5 必达。

## preserve.lock 生命周期

- 生成时机：Stage 1 结束后运行 `node game_skill/skills/scripts/generate_preserve_lock.js cases/${PROJECT}`。
- 写入位置：`cases/${PROJECT}/.game/preserve.lock.yaml`。
- 内容来源：`specs/mechanics.yaml`、`docs/design-strategy.yaml`、`specs/scene.yaml`。
- 只读时机：Stage 2-5 以及所有支路处理都只读它；除 pivot 或显式 `--force` 外不得覆盖。
- 回归入口：Stage 2-5 入口和支路触发前运行 `check_preserve_regression.js`。
- 冻结入口：`freeze_specs.js` 会把 `.game/preserve.lock.yaml` 纳入冻结指纹。

## stage-contract schema 速查

每个 stage 在 `cases/${PROJECT}/specs/stage-contract-{N}.yaml` 声明：

```yaml
stage-n: 1
stage-type: vertical-slice
goal: "..."
scope:
  add: []
  preserve: []
  forbid: []
acceptance:
  - check: check_mechanics.js
    threshold: {}
complexity-budget:
  max-new-systems: 2
  max-new-entities: 3
  max-new-rules: 5
```

`scope.preserve` 中出现的 entity、rule、scene id 必须仍存在；`scope.forbid` 中出现的 id 不应出现在当前 specs。`acceptance[].check` 由 `check_stage_contract.js` 按顺序调用。

## stage-history schema 速查

`cases/${PROJECT}/.game/stage-history.yaml` 追加记录，不覆盖历史：

```yaml
version: 1
entries:
  - kind: stage
    n: 1
    type: vertical-slice
    status: completed
    preserve-updated: true
    triggered-by: mainline
    ended-at: "2026-04-30T00:00:00.000Z"
  - kind: iteration
    after-stage: 1
    category: tuning
    user-feedback: "太简单了"
    status: completed
    replay-status: not-needed
  - kind: extension-stage
    n: 1
    goal: "add leaderboard"
    user-feedback: "加排行榜"
    status: completed
    ended-at: "2026-04-30T00:00:00.000Z"
```

stage-history 是审计轨迹：主干、支路、extension、pivot 都只追加事件，不删除旧记录。

## 状态机

- 进入 Stage N：phase plan 使用 `stage-{N}-...` mode，state 里标记 `phases.stage-{N}.status = running`。
- 执行 Stage N：只做本 stage contract 允许的新增、preserve 和 forbid 范围。
- 退出 Stage N：运行 `check_stage_contract.js --stage N`；N > 1 时先运行 `check_preserve_regression.js`。
- Stage 1 退出：成功后运行 `generate_preserve_lock.js`，再把 `phases.stage-1.status` 标 completed。
- Stage 2-5 退出：preserve 不更新；只追加 stage-history，并把对应 stage 标 completed。
- 用户确认：Stage 1 必须确认，Stage 2 推荐确认，Stage 3-5 自动推进但允许用户打断。
