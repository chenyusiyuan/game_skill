# Phase 1 — 基础设施(Baseline Pointer + Evolution Log)

## Goal

在不改变 Stage 1 任何判定语义的前提下,落地两类**纯追加型工件**:

- `cases/<id>/eval/baseline.json` — 上一份 passing delivery 的可回滚指针
- `cases/<id>/eval/evolution-log.jsonl` — 演进迭代的 append-only 历史

并在 `scripts/check_delivery.js` 的 `delivery-pass` 出口上**追加一个 hook 调用**,把两类工件写入。这是后续所有 Phase 的依赖基础。

> 契约锚点:[`evolution-docs/30-evidence-checkpoints.md`](../../evolution-docs/30-evidence-checkpoints.md) § Baseline Pointer / Checkpoint / Evolution Log

## Pre-requisites

无。Phase 1 是依赖图的根节点。

## Files to create

| 路径 | 性质 |
|------|------|
| `scripts/_baseline_writer.js` | internal helper,不直接 CLI 调用 |
| `scripts/_evolution_log.js` | internal helper,不直接 CLI 调用 |

## Files to modify

| 路径 | 修改类型 | 修改原则 |
|------|---------|---------|
| `scripts/check_delivery.js` | 在 `delivery-pass` / `delivery-with-warnings` 写入 `eval/delivery.json` 之后,**追加调用**新 hook;不允许改任何现有 verdict 判定逻辑 | 仅追加,不改语义 |

不动:`scripts/_delivery_runner.mjs`、`scripts/validate_plan.js`、`scripts/prepare_case_game.js`、其他 `scan_*.js`、`schemas/`、`templates/`、`cases/<id>/` 任何既有文件、`SKILL.md`、`AGENTS.md`、`evolution-docs/`。

## Interface contracts

### `_baseline_writer.js`

导出一个函数:

```js
/**
 * 在 delivery-pass 后写入 baseline.json,并旋转保留最近 3 份历史。
 * @param {Object} args
 * @param {string} args.casePath        - 绝对路径,例如 /abs/path/cases/brick-glm
 * @param {Object} args.deliveryRecord  - 已写入 eval/delivery.json 的内容(in-memory 副本)
 * @param {Object} args.runnerResult    - 已写入 eval/runner-result.json 的内容(in-memory 副本)
 * @param {string} args.planPath        - 绝对路径到 specs/plan.json
 * @returns {Promise<{baselineId:string, written:string[]}>}
 */
export async function writeBaseline(args) { ... }
```

`baseline.json` 写入内容(v1 形态):

```json
{
  "baselineId": "<ISO-8601 timestamp + caseId 哈希前 6 位>",
  "createdAt": "<ISO-8601>",
  "planHash": "<sha256 of plan.json file bytes>",
  "deliverySummary": {
    "status": "delivery-pass | delivery-with-warnings",
    "warningKinds": ["console-warning", ...],
    "milestoneCount": 7,
    "changedPixels": 12345
  },
  "artifactPointers": {
    "plan": "specs/plan.json",
    "delivery": "eval/delivery.json",
    "runnerResult": "eval/runner-result.json",
    "screenshots": {
      "mount": "eval/screenshots/mount.png",
      "afterSteps": "eval/screenshots/after-steps.png",
      "final": "eval/screenshots/final.png"
    }
  }
}
```

> **明确不在 v1 范围**:完整归档 `game/` 目录、归档历史 screenshot 副本、跨 case 共享 baseline——这些都是 future 议题(契约见 [`evolution-docs/30-evidence-checkpoints.md` § Baseline Pointer 第二段](../../evolution-docs/30-evidence-checkpoints.md#baseline-pointer))。

旋转规则:写入新 `baseline.json` 前,把现有 `baseline.json` 改名为 `baseline-prev1.json`,把 `baseline-prev1.json` 改名为 `baseline-prev2.json`,以此类推保留至 `baseline-prev2.json`(共保留**当前 + 2 份历史 = 3 份**)。再老的删除。

`planHash` 算法:`crypto.createHash("sha256").update(fs.readFileSync(planPath)).digest("hex")`。Node 内置 `node:crypto`,不引入新依赖。

### `_evolution_log.js`

导出三个函数:

```js
/**
 * 追加一条 entry 到 evolution-log.jsonl。文件不存在则创建。
 * @param {Object} args
 * @param {string} args.casePath
 * @param {Object} args.entry  - 必须含 entry.kind 与 entry.timestamp;其他字段由调用方决定
 * @returns {Promise<void>}
 */
export async function appendEvolutionLog(args) { ... }

/**
 * 读取整个 log(行解析为 JSON,跳过空行 / 非法行,后者打 console.warn 但不抛)。
 * @param {string} casePath
 * @returns {Promise<Object[]>}
 */
export async function readEvolutionLog(casePath) { ... }

/**
 * 便捷封装:写入 Phase 1 自身的 phase-report 条目。
 * 后续 phase 可以照抄这个 helper 模式。
 */
export async function recordPhaseReport({casePath, phase, status, filesCreated, filesModified, acceptancePassed, followUps, blockers}) { ... }
```

`evolution-log.jsonl` 每行 JSON 形态(v1 仅约定通用骨架,`kind` 取值随 phase 增长):

```json
{ "kind": "delivery-baseline-written", "timestamp": "...", "baselineId": "...", "deliveryStatus": "delivery-pass" }
{ "kind": "phase-report", "timestamp": "...", "phase": 1, "status": "done", "filesCreated": [...], "filesModified": [...], "acceptancePassed": "5/5", "followUps": [], "blockers": [] }
```

> **`kind` 命名约定**:小写 kebab-case;`<事件类>-<具体>`。本 Phase 引入两类:`delivery-baseline-written`、`phase-report`。后续 phase 引入新 kind 时**不在本文件 enum**,因为 N19 不 mint schema。

### `check_delivery.js` 钩入点

在现有 `writeFileSync(deliveryJsonPath, JSON.stringify(deliveryRecord, ...))` 之后**追加**:

```js
// === N19 Phase 1 hook: append-only baseline + evolution-log ===
if (deliveryRecord.status === "delivery-pass" || deliveryRecord.status === "delivery-with-warnings") {
  try {
    const { writeBaseline } = await import("./_baseline_writer.js");
    const { appendEvolutionLog } = await import("./_evolution_log.js");
    const baselineResult = await writeBaseline({
      casePath, deliveryRecord, runnerResult, planPath,
    });
    await appendEvolutionLog({
      casePath,
      entry: {
        kind: "delivery-baseline-written",
        timestamp: new Date().toISOString(),
        baselineId: baselineResult.baselineId,
        deliveryStatus: deliveryRecord.status,
      },
    });
  } catch (err) {
    console.warn(`[n19-phase1] baseline/log hook failed: ${err.message}`);
    // 不抛——Phase 1 hook 失败不允许影响 Stage 1 verdict
  }
}
// === end N19 Phase 1 hook ===
```

**关键约束**:
- hook 失败**不影响** delivery verdict——只 `console.warn`,不向上抛
- hook 仅在 `delivery-pass` / `delivery-with-warnings` 触发,**不在** `generation-blocked` / `chain-blocked` 触发
- 不在 hook 内做任何 plan validation / scan 操作——这些已由 check_delivery.js 主流程处理

## Existing code to reference

实施前必读:

- `scripts/check_delivery.js` 的 `writeFileSync(deliveryJsonPath, ...)` 段落(verdict 写入位置;hook 追加在此之后)
- `scripts/_delivery_runner.mjs` 顶层导出与 `runnerResult` 形状(理解 baseline.json 中 `deliverySummary` 字段的真实数据来源)
- `cases/brick-glm/eval/delivery.json`、`cases/brick-glm/eval/runner-result.json` 真实样例(确认 baseline 摘要抽哪些字段)

## Acceptance criteria

逐项断言,Phase 完成时全部 pass:

1. **不破坏 Stage 1**:对任一现有 case(例:`cases/brick-glm`)跑一次 `node scripts/check_delivery.js cases/brick-glm`,结果与未引入 hook 时**完全一致**(diff `eval/delivery.json` 与 `eval/runner-result.json`,排除 timestamp 后无差异)
2. **baseline.json 落地**:同一次跑动后,`cases/brick-glm/eval/baseline.json` 存在,字段完整(`baselineId` / `createdAt` / `planHash` / `deliverySummary` / `artifactPointers` 全部非空)
3. **planHash 正确**:用任何外部工具(`shasum -a 256 cases/brick-glm/specs/plan.json`)计算的 hash 与 `baseline.json::planHash` 完全一致
4. **evolution-log 落地**:`cases/brick-glm/eval/evolution-log.jsonl` 存在,至少包含一条 `kind: "delivery-baseline-written"` 与一条 `kind: "phase-report"`(后者由 Phase 1 自身追加)
5. **旋转生效**:同一 case 连续跑两次 `check_delivery.js`,得到 `baseline.json` + `baseline-prev1.json`;跑三次后得到 `baseline.json` + `baseline-prev1.json` + `baseline-prev2.json`;跑四次后**仍只有这三个**(最早的被删,不是第四个版本)
6. **失败时不污染 Stage 1**:在 `_baseline_writer.js` 顶端临时插一行 `throw new Error("test")`,跑 `check_delivery.js`,verdict 仍为 `delivery-pass` 或对应原 verdict,只在 stderr 出现一行 `[n19-phase1] baseline/log hook failed: test`
7. **存在则覆盖**:对同一 case 重新跑 `check_delivery.js`,新 `baseline.json` 应**完全替换**旧文件,而不是追加内容

## Out-of-scope (DO NOT do in Phase 1)

- 触发 Phase 2-4 的任何代码(triage router、stage worker、mustNot 执行)
- 把 baseline 写入逻辑塞进 `_delivery_runner.mjs`(应留在新 helper,不污染 runner)
- 任何 schema 文件(`schemas/baseline.schema.json` / `schemas/evolution-log.schema.json` 都不许建)
- 任何 git 操作(commit、tag、checkout、status 解析)
- 修改 `cases/<id>/` 既有文件(只允许新增 `eval/baseline*.json` 与 `eval/evolution-log.jsonl`)
- 修改 `.gitignore` 让上述新工件入 / 不入 git(留给人工决策)
- 任何美化、重构、风格统一改动 — 一行代码都不要碰除上面列出的两个目标文件以外的任何位置

## Codex notes

- 跑验收时建议拿 `cases/brick-glm` 作主要 fixture,因为 plan 字段较丰富、有 nonblockingTodos 与 mustNot 实样
- ESM/CJS:本仓 `scripts/` 混用 `.js`(CJS 风格)与 `.mjs`(ESM)。`check_delivery.js` 是 ESM(顶部 `import`),所以新 helper 用 `.js` + ESM(`package.json` 已是 `"type": "module"`)即可,与 `validate_plan.js` 等保持一致
- `try/catch` 包裹 hook 调用是硬要求,不要用 `.catch(() => {})` 静默——必须 `console.warn` 显式提示
- 跑完 acceptance 1-7 后,在 `eval/evolution-log.jsonl` 写一条 `phase-report`(用 `recordPhaseReport`),内容形如:

```json
{"kind":"phase-report","timestamp":"...","phase":1,"status":"done","filesCreated":["scripts/_baseline_writer.js","scripts/_evolution_log.js"],"filesModified":["scripts/check_delivery.js"],"acceptancePassed":"7/7","followUps":[],"blockers":[]}
```

stdout 同时输出对应的简报(格式见 [README § Phase 报告格式](./README.md#phase-报告格式))。

## Open questions for human

如果实施过程中遇到下列情况,**停下来报告,不要自己决定**:

- `cases/<id>/eval/` 不存在(理论上 `delivery-pass` 时 check_delivery 已建好;若不存在说明上游异常,不应由 Phase 1 修补)
- `runner-result.json` 字段名与本文档假设不一致(以真实文件为准,但要在 phase-report 的 followUps 里写明)
- 旋转时碰到 `baseline-prev*.json` 命名冲突(同名已存在但内容不同)——不要静默覆盖,先报告
