# Phase 3 — Stage 3 / 4 / 5 Worker

## Goal

把 Phase 2 落下的 Stage 2 worker 模板扩展为 Stage 3 / 4 / 5 三个 worker。每个 worker 沿用同一签名(`runStage<N>(args)` 返回 `{verdict, checkpoint?, kickBack?, errors?}`),只在 *允许变更 / 禁止变更 / 退出条件 / kick-back 触发条件* 上做差异化。

phase 完成后,`run_evolution.js` 能把 router 输出的任意 stage 子任务派发到对应 worker,而不是只能跑 Stage 2。

> 契约锚点:[`evolution-docs/20-stage-boundaries.md`](../../evolution-docs/20-stage-boundaries.md) § Stage 3 / Stage 4 / Stage 5 + § 跨 stage 禁止表

## Pre-requisites

Phase 1 + Phase 2 全部完成且通过验收。`scripts/_stage_2_worker.js` 已稳定。

## Files to create

| 路径 | 性质 |
|------|------|
| `scripts/_stage_3_worker.js` | Stage 3 新增 worker |
| `scripts/_stage_4_worker.js` | Stage 4 深化 worker |
| `scripts/_stage_5_worker.js` | Stage 5 美化 worker |
| `scripts/_stage_common.js` | 抽出三个 worker 共用的工具:in-memory backup/rollback、forbidden-mutation 自检、跑 check_delivery.js 包装 |

## Files to modify

| 路径 | 修改类型 |
|------|---------|
| `scripts/run_evolution.js` | 把"stage in [3,4,5] → blocked"占位替换为真实 dispatch:依据 `subtask.stage` 调对应 worker |
| `scripts/_stage_2_worker.js` | **抽取**共用逻辑到 `_stage_common.js`(in-memory backup、forbidden 检查模板),Stage 2 改为调用共用函数;**不改语义** |

## Interface contracts

### 共用骨架(`_stage_common.js`)

```js
/**
 * 文件级 in-memory 快照,用于 worker patch 失败 / kick-back 时回滚。
 */
export class FileSnapshot {
  capture(absPaths) { ... }    // 读取文件内容到内存
  restore() { ... }             // 把内存内容写回文件
}

/**
 * 检查 patch 是否触碰 stage 的 forbidden 集合。
 * @param {Object} args
 * @param {number} args.stage              - 2 / 3 / 4 / 5
 * @param {Object} args.beforePlan          - patch 应用前的 plan.json
 * @param {Object} args.afterPlan           - patch 应用后的 plan.json
 * @param {string[]} args.changedFilePaths  - patch 触达的文件相对路径列表
 * @returns {{ok:true} | {ok:false, kind:string, detail:string}}
 */
export function checkForbiddenMutations(args) { ... }

/**
 * 跑 check_delivery.js 子进程,返回 verdict 与摘要。
 */
export async function runDeliveryCheck(casePath) { ... }

/**
 * 把当前 delivery 结果包装成 checkpoint 对象,便于写入 evolution-log。
 */
export function buildCheckpoint({casePath, deliveryResult}) { ... }
```

### Stage 3 worker(`_stage_3_worker.js`)

```js
export async function runStage3({casePath, subtask, evolutionContext}) { ... }
```

差异化逻辑:

| 维度 | Stage 3 |
|------|---------|
| 允许 plan 变更 | 新增 `requiredMechanics` / `controls` / `acceptance.mustHave` / `winCondition` / `loseCondition` / `primaryLoop`;允许 spec correction(Stage 2 子集) |
| 允许代码变更 | `game/` 下任意业务代码(不含 KEEP scaffold) |
| 禁止变更 | 修改 `meta.caseId` / `meta.createdAt`;**让任何前置 mustHave 退化** — 这条要在 verify 后回看,而不是 patch 应用前判定 |
| 退出条件 | 新机制对应的 mustHave 全部 pass + 旧 mustHave 不退化 + smoke.steps 已配套覆盖新 control |
| kick-back 信号 | (a) 新机制依赖未声明的基础能力(查 plan + 现有 game/ 代码);(b) 与现有机制结构性冲突(新增 lose condition 与已有 win/lose 不兼容) |

prompt 关键约束:

- 给 LLM 看完整 plan.json + game/ 目录树(只 list,不读全部内容,除非 LLM 主动要)
- 要求 LLM 输出 *plan.json 增量* + *代码 patch* 两部分,严格 JSON 包装
- 强调"若你发现要做的不是 *新增* 而是 *修复* 或 *调优*,立刻返回 kick-back 信号,不要写任何 patch"

### Stage 4 worker(`_stage_4_worker.js`)

```js
export async function runStage4({casePath, subtask, evolutionContext}) { ... }
```

| 维度 | Stage 4 |
|------|---------|
| 允许 plan 变更 | 仅 *描述层文字*(`requiredMechanics[].summary` / `controls[].effect` 描述措辞)与 *evidence 阈值参数*(`acceptance.mustHave[].evidence[*].minChangedPixels`、`smoke.expect[*].minOccurrences` 等);**禁止改 controls[].input 字段** |
| 允许代码变更 | 数值常量、时序、反馈层代码(粒子、屏幕震动、命中停帧、tween)、关卡数据扩展(在不新增 mechanic 前提下) |
| 禁止变更 | 增删 `requiredMechanics` / `controls` / `mustHave` / `winCondition` / `loseCondition`;改 `primaryLoop`;改资源 / 渲染层 |
| 退出条件 | 全量 mustHave 仍 pass + 子任务声明的调优指标可量化改善(本 phase POC 用"runner-result.json::summary 量化对比" — 比如 changedPixels 与 milestone 数 — 而非引入新指标) |
| kick-back 信号 | (a) 体感问题来自机制缺失 → kick to Stage 3;(b) 实际是 bug → kick to Stage 2;(c) 实际是视觉/资源 → kick to Stage 5;(d) 调优空间已耗尽(数值在合理范围内仍达不到目标),记 advisory(stdout 输出但仍 verdict: "fail" + errors: ["tuning headroom exhausted"]) |

prompt 关键约束:

- LLM 不允许编辑 plan 的硬约束字段;在 prompt 写明"若你发现需要新增/删除 mustHave / requiredMechanics / controls / win-lose-condition,立刻返回 kick-back,不要写 patch"
- 输出形式:**只能** *代码 patch* + 可选 *plan 描述层文字 patch*。代码 patch 限定在 `cases/<id>/game/src/**` 下,不允许触碰 `cases/<id>/game/{index.html, package.json, tsconfig.json, vite.config.js}` 与 `cases/<id>/game/src/milestone.ts`(KEEP)
- "对比 verify"在本 phase POC 简化为"跑两次 check_delivery.js 对比 runner-result.json::summary"。具体的对比指标精化留待后续

### Stage 5 worker(`_stage_5_worker.js`)

```js
export async function runStage5({casePath, subtask, evolutionContext}) { ... }
```

| 维度 | Stage 5 |
|------|---------|
| 允许 plan 变更 | **无**(Stage 5 不动 plan.json) |
| 允许代码变更 | 渲染层代码(scene 中的 `add.rectangle` 颜色 / 字号 / `setTint` / shader / 滤镜)、布局参数(UI 元素位置、HUD 层级、对齐、HUD 显示字段)、资源文件(`cases/<id>/assets/**` 下贴图 / 字体 / 音效) |
| 禁止变更 | 任何游戏逻辑代码(运动、判定、状态机、emitMilestone 调用)、`controls` / `requiredMechanics` / `mustHave` / win-lose 条件、`smoke.steps` |
| 退出条件 | **全量回归 pass(硬合并门)** + 视觉一致性可接受(本 phase POC 简化为"截图存在且尺寸合理",不引入多模态对比) |
| kick-back 信号 | (a) 修改过程中发现需要动逻辑 → kick to Stage 2 或 4;(b) 需要 plan 形状变化 → kick to Stage 3;(c) 资源管线缺失(case 当前不支持外部资源,只用代码绘制),无法替换 → 记 advisory + verdict: "fail",errors: ["asset pipeline absent"] |

prompt 关键约束:

- 给 LLM 看 `cases/<id>/eval/screenshots/*.png` 路径与文件大小(**不传图像内容**,遵守 vision policy)
- "禁止改逻辑代码"硬约束写进 prompt;LLM 输出 patch 时,Node 侧扫:patch 是否触碰 `emitMilestone` 调用、是否改 input 处理、是否改 winCondition 相关代码 — 命中即 kick-back 不应用
- async-tail 在本 phase **不实现**;Stage 5 仍同步执行。物理异步留待后续

### `run_evolution.js` 派发更新

替换 Phase 2 的占位:

```js
// 旧(Phase 2)
if (subtask.stage in [3,4,5]) {
  result = { verdict: "blocked", errors: ["stage-N worker not yet landed"] };
}

// 新(Phase 3)
const workerMap = {
  2: () => import("./_stage_2_worker.js").then(m => m.runStage2),
  3: () => import("./_stage_3_worker.js").then(m => m.runStage3),
  4: () => import("./_stage_4_worker.js").then(m => m.runStage4),
  5: () => import("./_stage_5_worker.js").then(m => m.runStage5),
};
const runner = await workerMap[subtask.stage]();
result = await runner({casePath, subtask, evolutionContext});
```

multi-subtask 序列处理仍保持 Phase 2 的简化语义(单 subtask 完成后串行下一个);完整编排留给 Phase 4。

## Existing code to reference

- `scripts/_stage_2_worker.js`(Phase 2 产物,所有 stage worker 的母版)
- `scripts/check_delivery.js` 的 `delivery-pass` 判定逻辑(用作"通过/不通过"的真值源)
- `evolution-docs/20-stage-boundaries.md` 全文(差异化逻辑直接照抄约束)
- `cases/brick-glm/specs/plan.json` 与 `cases/brick-glm/game/src/scenes/`(用作 fixture 测试)

## Acceptance criteria

每个 stage 的 worker 各自有最小 POC fixture。建议跑在 `cases/brick-glm` 上(plan 字段丰富,适合所有 4 个 stage)。

### Stage 3

1. **新增 mustHave 端到端**:query "新增一个'累计破坏 10 个砖块'的进度 milestone" → router 输出 Stage 3 subtask → worker 修改 plan.json(加 mustHave + 对应 mechanic)+ 修改代码 emitMilestone → check_delivery 重跑通过 → baseline 更新
2. **越界即 kick-back**:query "把球速调慢点"被错误送进 Stage 3(模拟 router 误判) → worker 识别这是 Stage 4 工作 → verdict: "kicked-back",patch 已回滚,kickBack.suggestedStage === 4
3. **基础能力缺失停**:query "加一个跨局存档系统" → worker 发现 case 没有持久存储基础能力 → verdict: "fail",errors 提及 missing capability,patch 已回滚

### Stage 4

4. **数值调优**:query "球速太慢,提一点" → worker 修改 game/src 中球速常量 → check_delivery 重跑 → 通过(可接受;严格的体感对比留待后续)
5. **不允许动 mustHave**:故意让 LLM 试图新增 mustHave → patch 应用前的 forbidden 检查命中 → verdict: "kicked-back",kickBack.suggestedStage === 3
6. **不允许改 controls.input**:query "把空格改成回车" → worker 识别这要改 controls[].input → kick-back

### Stage 5

7. **资源/布局调整**:query "HUD 字体太小" → worker 修改 scene 中字号常量 → check_delivery 重跑 → 通过 + screenshots 已更新
8. **逻辑代码不许动**:LLM 试图把 emitMilestone 调用改了 → forbidden 检查命中 → kick-back,kickBack.suggestedStage === 2 或 4
9. **回归门强制**:故意让 LLM 写 patch 把 HUD 元素挪到挡板正上方挡住玩法(导致 milestone 仍触发但 canvas-change 被遮挡降低) → check_delivery 仍 pass(milestone 还在),但 verdict 设计上**不放过** Stage 5 — Phase 3 阶段先记 advisory,严格的视觉门留给 Phase 4 + 后续阶段

### 跨 stage

10. **stage 编号未泄漏**:对所有 worker 的 LLM prompt + LLM 输出做扫描,**0 处** 出现 "Stage N" 给用户的文本(澄清话术、kick-back 给 router 的字段除外)
11. **不破坏 Stage 1**:对 fixture 跑原始 `check_delivery.js`(不经 run_evolution),verdict 仍正确;新增的 worker 文件不被 Stage 1 流程加载

## Out-of-scope (DO NOT do in Phase 3)

- mustNot 机械执行(留 Phase 4)
- 多 subtask 复杂编排(部分回滚、循环 kick-back 上限) — Phase 4
- 异步 Stage 5 合并门 — 后续
- 任何 schema mint
- 跨 case 共享 / 模板抽取
- 任何对 `evolution-docs/`、`SKILL.md`、`AGENTS.md`、`schemas/`、`templates/` 的修改

## Codex notes

- 三个 worker 的 prompt 模板**强烈建议**统一抽出 `scripts/_stage_prompts.js`,导出 `buildStage<N>Prompt(args)` 四个函数,共用骨架 + 各 stage 差异化部分。本目录契约约束在 prompt 系统级别,不要在 user prompt 重复
- forbidden 检查务必在 *patch 应用前* 用 plan.json 与文件 diff 做静态扫描,而不是依赖 LLM 自觉。LLM 自觉有概率失效,Node 侧静态防护是硬底线
- Stage 4 的"调优指标量化对比"在 Phase 3 POC 阶段用最朴素方案:`runner-result.json::summary` 字段做改前/改后 diff,差异写进 phase-report 的 followUps。**不要**引入新指标体系
- Stage 5 prompt 给 LLM 的"图像证据"严格按 vision-policy.json:`disabled` 时只给 path + size + 尺寸(像素),`enabled` 时才传 base64
- 三个 worker 完成后,在 `cases/brick-glm/eval/evolution-log.jsonl` 追加一条 `kind: "phase-report"`,`phase: 3`,`acceptancePassed` 写实际通过比例

## Open questions for human

- 若 fixture `cases/brick-glm` 不足以覆盖所有 11 条 acceptance(例如它没有适合 Stage 5 的资源管线测试场景),报告并请求人工选择第二个 fixture(其他 case)
- LLM 在某些边角 case 下对"我应不应该 kick-back"判断不稳 — 如果 fuzz 测试中发现 kick-back 假阳率 > 10%,停下来报告 prompt 调整方向
- 跨 stage 的"Stage 4 调优指标对比"在没有真实 sim 环境下很弱 — 若发现 acceptance #4 必须靠"LLM 自报告好坏"才能通过,记 followUp 留待后续解决
