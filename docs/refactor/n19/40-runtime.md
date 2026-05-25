# Phase 4 — 运行时(mustNot 执行 + 多 subtask 编排 + Kick-back 上限)

## Goal

把演进环从"单 subtask 跑通"升级为"完整运行时语义":

1. **mustNot 机械执行**:把 plan 里 `acceptance.mustNot` 从人工复核线索升级为 worker 必跑的检查项
2. **多 subtask 编排**:支持 router 输出多 stage 子任务序列时的串行调度、部分回滚、kick-back re-entry
3. **循环 kick-back 上限**:同一 subtask 累计 kick-back 超过 3 次后,router 强制 reject 该 query

> 契约锚点:
> - [`evolution-docs/30-evidence-checkpoints.md` § acceptance.mustNot](../../evolution-docs/30-evidence-checkpoints.md#acceptancemustnot)
> - [`evolution-docs/20-stage-boundaries.md` § Kick-back 协议 / 失败与回滚矩阵](../../evolution-docs/20-stage-boundaries.md#kick-back-协议)

## Pre-requisites

Phase 1 + 2 + 3 全部完成,且四个 stage worker 均通过 Phase 3 的端到端验收。

## Files to create

| 路径 | 性质 |
|------|------|
| `scripts/_mustnot_evaluator.js` | 解析 `acceptance.mustNot[]` + 调用 expect 引擎判定是否被触发 |
| `scripts/_kickback_ledger.js` | 跟踪本轮 evolution iteration 内 subtask 的 kick-back 计数,实现 3 次上限 |

## Files to modify

| 路径 | 修改类型 |
|------|---------|
| `scripts/run_evolution.js` | 编排升级:支持多 subtask、部分回滚、kick-back re-entry、循环上限触发 reject |
| `scripts/triage_router.js` | 支持 re-entry 模式:接收 `--rekick <previous-subtask-id>` 参数,把上次 kick-back 的信号一起送进 LLM,让其重新分诊 |
| `scripts/_stage_2_worker.js` / `_stage_3_worker.js` / `_stage_4_worker.js` / `_stage_5_worker.js` | 每个 worker 在跑回归 verify 之后**追加**一步:用 `_mustnot_evaluator.js` 检查所有 mustNot,任一被触发即 verdict 改为 fail + 回滚 |

## Interface contracts

### `_mustnot_evaluator.js`

```js
/**
 * 评估 plan.acceptance.mustNot[] 是否被当前实现触发。
 * v1 仅在 Stage 2-5 worker 调用,Stage 1 不调用(契约要求 Stage 1 行为不变)。
 *
 * @param {Object} args
 * @param {string} args.casePath
 * @param {Object} args.plan              - 当前 plan.json 内容
 * @param {Object} args.runnerResult      - 最近一次 check_delivery.js 后的 eval/runner-result.json
 * @returns {Promise<{passed:boolean, violations:Array<{id:string, text:string, evidence:Object}>}>}
 */
export async function evaluateMustNot(args) { ... }
```

**v1 mustNot 判定语义**:`acceptance.mustNot[]` 当前 schema 只有 `id` 与 `text`,**没有 evidence 字段**。Phase 4 在不改 schema 的前提下,用以下启发式判定:

| 触发条件 | 行为 |
|---------|------|
| `mustNot[i].text` 与某个 `mustHave[*].text` 语义相反(例:mustHave: "球落底扣命";mustNot: "球落底不扣命") | 用对应 mustHave 的 evidence 反向判定:mustHave evidence pass → mustNot pass(没触发);mustHave evidence fail → mustNot violated(触发了反例) |
| 没有可对应的 mustHave | 视为"无机械证据,跳过本条";写一行 `kind: "mustnot-skipped"` 到 evolution-log,**不**当 fail 处理 |

> **关键不变量**:Phase 4 **不**给 mustNot 引入新 schema 字段。完整的 `mustNot.evidence[]` schema 留待后续决定。本 phase 用启发式 + 显式标注,先把"机械执行"这条流跑通。

worker 调用方式(以 Stage 2 为例):

```js
// Stage 2 worker 在跑完 check_delivery 之后追加:
const mustNotResult = await evaluateMustNot({casePath, plan: latestPlan, runnerResult: latestRunner});
if (!mustNotResult.passed) {
  await snapshot.restore();    // 回滚 patch
  await appendEvolutionLog({casePath, entry: {
    kind: "mustnot-violation",
    timestamp: new Date().toISOString(),
    subtaskId: subtask.id,
    violations: mustNotResult.violations,
  }});
  return {verdict: "fail", errors: ["mustNot violation: " + mustNotResult.violations.map(v => v.id).join(", ")]};
}
```

### `_kickback_ledger.js`

```js
/**
 * 跟踪本轮 evolution iteration 内每个 subtask 的累计 kick-back 次数。
 * 不持久化(挂在 EvolutionIteration 对象上)。
 */
export class KickbackLedger {
  constructor(maxRekicks = 3) {
    this.counts = new Map();          // subtaskId -> count
    this.max = maxRekicks;
  }
  recordKickback(subtaskId) {
    const next = (this.counts.get(subtaskId) || 0) + 1;
    this.counts.set(subtaskId, next);
    return next;
  }
  shouldForceReject(subtaskId) {
    return (this.counts.get(subtaskId) || 0) >= this.max;
  }
  snapshot() {
    return Object.fromEntries(this.counts);
  }
}
```

> **N 默认值取 3**——契约 [`evolution-docs/20-stage-boundaries.md` § Kick-back 协议](../../evolution-docs/20-stage-boundaries.md#kick-back-协议) 建议默认。本 phase 把 3 设成常量,不暴露为 CLI 参数(后续再决定是否参数化)。

### `run_evolution.js` 编排升级

```js
async function runEvolution({casePath, query}) {
  let routerOutput = await triageRouter({casePath, query});
  if (routerOutput.decision !== "execute") {
    return reportNonExecute(routerOutput);
  }

  const iteration = new EvolutionIteration({...routerOutput});
  const ledger = new KickbackLedger();

  for (let i = 0; i < iteration.subtasks.length; i++) {
    const subtask = iteration.subtasks[i];

    // 跳过被前序 stopIfFails 触发后的剩余 subtask
    if (iteration.isStopped()) break;

    const result = await dispatchWorker({casePath, subtask, evolutionContext: iteration});

    iteration.recordResult(subtask.id, result.verdict, result);

    if (result.verdict === "kicked-back") {
      const count = ledger.recordKickback(subtask.id);
      if (ledger.shouldForceReject(subtask.id)) {
        // 循环上限触发,写日志后强制 reject 整轮
        await appendEvolutionLog({casePath, entry: {
          kind: "kickback-circuit-broken",
          timestamp: new Date().toISOString(),
          subtaskId: subtask.id,
          totalKickbacks: count,
        }});
        iteration.forceStop("kickback-circuit-broken");
        break;
      }
      // 未到上限:把 subtask 送回 router 重新分诊
      const rekick = await triageRouter({
        casePath, query: iteration.rawQuery,
        rekick: {originalSubtaskId: subtask.id, kickBackPayload: result.kickBack},
      });
      if (rekick.decision !== "execute") {
        // router 自己也澄清/拒绝了,中止
        iteration.forceStop(rekick.decision);
        break;
      }
      // 把 rekick 输出的新 subtask 们插入当前位置之后,继续循环
      iteration.spliceAfterCurrent(i, rekick.subtasks);
      continue;
    }

    if (result.verdict === "fail" && subtask.stopIfFails) {
      iteration.forceStop("stopIfFails");
      break;
    }
    // verdict === "fail" && !stopIfFails → worker 已回滚,继续下一 subtask
    // verdict === "pass" → 继续下一 subtask
  }

  // 写 phase-report 与 iteration 总结
  await writeIterationSummary({casePath, iteration, ledger});
  return iteration;
}
```

**关键约束**:
- **部分回滚已经由 worker 内部完成**——`run_evolution` 只负责编排,不直接操作文件
- `iteration.spliceAfterCurrent` 把 rekick 返回的新 subtask **替换** 原 subtask 在序列中的位置(原 subtask 已 kick-back,不再执行)
- 每条 worker 调用都对应至少 2 条 evolution-log entry:`subtask-result` + `subtask-checkpoint`(若 pass)或 `subtask-rollback`(若 fail/kicked-back)

### `triage_router.js` re-entry 模式

CLI 新参数:

```bash
node scripts/triage_router.js cases/<id> --query "..." --rekick-from '{"originalSubtaskId":"s2-001","kickBackPayload":{...}}'
```

router 内部:

```
1. 正常加载 case 上下文
2. 若有 --rekick-from,把 kickBackPayload(含 forbidden 类型 + 推断的真实 stage)写进 prompt 的"前情"段
3. prompt 引导 LLM:你之前把这 subtask 路由到 stage X 但 worker 报告它实际属于 stage Y(或需要澄清);请重新拆分
4. 校验输出,处理同 Phase 2
5. 注意:re-entry 输出仍要满足 stage 排序约束;若 LLM 输出与之前完全相同的 subtask(即未真正改路由),记 advisory + verdict: "reject" 防止假性 re-entry
```

> **re-entry 不重置 ledger** —— `_kickback_ledger.js` 跟踪的是同一 subtaskId,re-entry 出来的新 subtask 用新 id(s2-002 等),不与原 s2-001 共享计数。但 `run_evolution.js` 在 splice 之前**先检查上限**——上限是针对 *单 subtask 反复 kick* 的,新 id 是新故事。

### worker 中追加 mustNot 检查

每个 worker 的"跑 verify"步骤后追加:

```js
// 已有:跑 check_delivery,得到 deliveryResult
// 追加:
const mustNotResult = await evaluateMustNot({casePath, plan: latestPlan, runnerResult: latestRunner});
if (!mustNotResult.passed) {
  await snapshot.restore();
  return {verdict: "fail", errors: [...mustNotResult.violations.map(v => `mustNot ${v.id}: ${v.text}`)]};
}
```

**只在 Stage 2-5 worker 中追加**;**绝不**追加到 Stage 1 的 `check_delivery.js` —— 契约要求 Stage 1 行为不变。

## Existing code to reference

- `scripts/_stage_<n>_worker.js`(Phase 2/3 产物;追加 mustNot 调用即可)
- `scripts/_delivery_runner.mjs` 中 expect 评估逻辑(用作启发式判定的"反向 evidence" 真值源)
- `cases/brick-glm/specs/plan.json::acceptance.mustNot`(若存在)与对应 mustHave(用作 fixture)
- `evolution-docs/20-stage-boundaries.md § 失败与回滚矩阵`(对照编排逻辑)

## Acceptance criteria

### mustNot 执行

1. **匹配触发**:在 `cases/brick-glm` 的 plan 中加一条 `mustNot: {id:"no-cheat", text:"球落底不扣命"}`(测试用,不要 commit),让 game 代码故意"落底不扣命"。跑 Stage 2 worker → mustNot 被触发 → verdict: "fail",patch 已回滚,evolution-log 含 `kind: "mustnot-violation"` 条目
2. **无对应 mustHave 时跳过**:plan 加一条 mustNot 但找不到反向 mustHave → evolution-log 出现 `kind: "mustnot-skipped"`,不影响 verdict
3. **Stage 1 不动**:对同一 case 直接跑 `check_delivery.js`(走 Stage 1 路径),mustNot **不被评估**;eval/delivery.json 内容与未引入 evaluator 时一致

### 多 subtask 编排

4. **多 stage 串行**:构造 query "修 X bug + 加 Y 系统 + Z 数值调慢" → router 输出 3 个 subtask(stage 2 / 3 / 4) → 全部串行执行 → 每个 stage 的 worker 各自 verdict:pass → 最终 baseline 已更新到 3 次后的状态;evolution-log 含 3 条 `subtask-checkpoint`
5. **部分回滚保留前序**:让 Stage 4 故意失败(`stopIfFails: false`) → Stage 4 子任务回滚但 Stage 2/3 的 patch 保留;最终 baseline 反映 Stage 2+3 已 commit 的状态
6. **stopIfFails 终止后续**:让 Stage 2 失败且 `stopIfFails: true` → Stage 3 / 4 不执行;evolution-log 含 `kind: "iteration-stopped"`,reason: "stopIfFails"

### Kick-back 编排

7. **单次 kick-back re-entry 成功**:故意让 router 把一个 Stage 4 query 错路由成 Stage 3 → Stage 3 worker kick-back → router re-entry → 输出新 Stage 4 subtask → Stage 4 worker 跑通;evolution-log 含 `kick-back` + `triage-decision (re-entry)` + 后续 `subtask-result`;ledger 计数为 1,未触发上限
8. **循环上限触发**:故意让所有 stage worker 对同一 subtask 都 kick-back(模拟疯狂 LLM) → 累计 3 次后 → run_evolution 强制 reject 整轮 → evolution-log 含 `kind: "kickback-circuit-broken"`,iteration 整体退出;baseline 不更新
9. **新 subtask 不继承计数**:re-entry 输出的新 subtask(id 改变) → 进入循环时 ledger 对新 id 是 0;即使后续多次 kick-back,只针对新 id 计数

### 跨

10. **不破坏 Stage 1**:Phase 4 的所有改动只发生在 `scripts/_mustnot_evaluator.js`、`_kickback_ledger.js`、`run_evolution.js`、`triage_router.js`、`_stage_<n>_worker.js`(末尾追加调用)。跑原始 `check_delivery.js` 任一 case → verdict 与 Phase 1-3 完成时一致
11. **stage 编号不泄漏**:re-entry 输出与 mustNot violation 的 evolution-log 写入中,**0 处**给用户的文本含 stage 编号(用户面意味着 "如果某天导出报告给用户看的字段")

## Out-of-scope (DO NOT do in Phase 4)

- 引入 `mustNot.evidence[]` schema 字段(future 议题)
- 异步 / 并发 subtask 执行(deferred 到 v2)
- baseline 之外的 checkpoint 物理形态变更(不动 Phase 1 baseline 写入器)
- 跨 evolution iteration 的状态共享(每轮 query 独立)
- 任何 git 操作 / commit / branch
- 修改 `evolution-docs/`、`SKILL.md`、`AGENTS.md`、`schemas/`、`templates/`、`cases/<id>/` 既有文件
- 修改 Phase 1-3 已落定的接口签名(只允许追加新文件 + 在指定文件指定位置追加调用)

## Codex notes

- mustNot 的"启发式匹配 mustHave 反向"在 Phase 4 是简化做法。建议:LLM 调用一次,把 mustHave 列表 + mustNot 列表都给它,要它产生"语义反向"的对照表。这一步建议在 worker 第一次跑 verify 之前做一次,缓存到 iteration 内,后续 mustNot 检查直接查表
- 循环 kick-back 上限是"协议层安全阀",**不是**正常路径——正常情况下应该 0~1 次 kick-back 就路由对。如果 fuzz 测试中频繁触发上限,说明 router prompt 不够准,需要回 Phase 2 改 prompt,而不是放宽上限
- splice 序列时的 subtask 排序:re-entry 出的新 subtask 仍要满足 stage 单调不减,即不允许在原 Stage 4 位置插入 Stage 2 的新 subtask。如果 LLM 真要这样做,router 应识别为"路由器内部错误"并直接 reject 整轮(否则破坏整体顺序约束)
- 写 phase-report 时,`acceptancePassed` 字段格式 `<X>/<Y>`(例 `11/11`),后续可以解析

## Open questions for human

- mustNot 启发式匹配在 fuzz 测试中假阳率/假阴率超过 20% 时,停下来报告——可能需要 后续直接 mint mustNot.evidence schema,本 phase 提前承认无法稳定执行
- ledger 上限 3 是经验值。如果在 fuzz 中发现 LLM 路由稳定性极差,频繁触发上限,**不要**自作主张提高上限,而是报告"router 路由不稳"
- Stage 5 异步 tail:契约说"v1 串行理解",但若实施过程中觉得这条值得提前实现,**报告但不实施**——属于 future 议题
