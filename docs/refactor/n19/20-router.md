# Phase 2 — Triage Router + Stage 2 端到端 POC

## Goal

落地两个东西:

1. **Triage router CLI**(`scripts/triage_router.js`):接收一句自然语言 query 与一个 case path,输出 subtask 列表 / 澄清问题 / 拒绝说明三种合法形态之一
2. **Stage 2 修复 worker**(`scripts/_stage_2_worker.js`):接收一个 Stage 2 类型的 subtask,执行最小修复,跑回归 verify,写 checkpoint

二者拼成第一条**端到端可跑通的演进切片**:用户给一句"修 X bug" → router 拆出一个 Stage 2 subtask → worker 修 → 回归通过 → 新 baseline 写入 → 演进日志追加。

> 契约锚点:
> - [`evolution-docs/10-triage-router.md`](../../evolution-docs/10-triage-router.md) 全文
> - [`evolution-docs/20-stage-boundaries.md` § Stage 2: 修复](../../evolution-docs/20-stage-boundaries.md#stage-2-修复)
> - [`evolution-docs/20-stage-boundaries.md` § 跨 stage 禁止表](../../evolution-docs/20-stage-boundaries.md#跨-stage-禁止表)(仅 Stage 2 行)

## Pre-requisites

Phase 1 已完成,且对验收 fixture(默认 `cases/brick-glm`)已写入过至少一份 `baseline.json`。

## Files to create

| 路径 | 性质 |
|------|------|
| `scripts/triage_router.js` | 顶层 CLI,可直接 `node scripts/triage_router.js cases/<id> --query "..."` |
| `scripts/_stage_2_worker.js` | internal helper,由 `run_evolution.js`(下条)调度 |
| `scripts/run_evolution.js` | 顶层 CLI,把 router 输出 + worker 调度串起来,是用户视角的演进入口 |
| `scripts/_evolution_state.js` | internal helper,封装本轮 evolution iteration 的状态结构(rawQuery、subtasks、当前 subtask index、checkpoint refs) |

## Files to modify

无。Phase 2 全部以新文件形式存在。

## Interface contracts

### `triage_router.js`(顶层 CLI)

调用形态:

```bash
node scripts/triage_router.js cases/<id> --query "boss 关掉帧修一下"
node scripts/triage_router.js cases/<id> --query-file path/to/query.txt
```

退出码:`0` = 成功输出决策(stdout 含 JSON),`1` = 流程错误(case 不存在 / baseline 缺失等),`2` = 模型调用失败可重试。

stdout 输出**单一 JSON 对象**(三种合法形态之一,由顶层字段 `decision` 区分):

```json
// 形态 A:subtask 列表
{
  "decision": "execute",
  "rawQuery": "...",
  "caseId": "...",
  "baselineRef": "<baseline.json 当时的 baselineId>",
  "subtasks": [
    {
      "id": "s2-001",
      "stage": 2,
      "subIntent": "boss 关掉帧",
      "specImpact": "none",
      "evidenceRequired": ["repro-seed", "before-after-runner-summary"],
      "stopIfFails": true,
      "dependsOn": [],
      "expectedArtifacts": ["game/src/scenes/<scene>.ts", "performance-related code"]
    }
  ],
  "conflicts": []
}

// 形态 B:澄清问题集
{
  "decision": "clarify",
  "rawQuery": "...",
  "caseId": "...",
  "baselineRef": "...",
  "clarifications": [
    {
      "id": "c-001",
      "question": "你说的连击系统,是连续命中只显示计数,还是会影响伤害/奖励/关卡节奏?",
      "context": "router 检测到该子意图属于新机制类,但具体边界与 mustHave 影响范围不明确"
    }
  ],
  "conflicts": []
}

// 形态 C:拒绝说明
{
  "decision": "reject",
  "rawQuery": "...",
  "caseId": "...",
  "reason": "query 要求推倒重做整份 plan;这属于 Stage 1 范畴,不在演进环。",
  "guidance": "请走 Stage 1 SOP 重新生成。参见 SKILL.md。"
}
```

> **关键不变量**:三种形态**互斥**——`subtasks` / `clarifications` / 只在 `reject` 出现的 `reason` 三字段中,只允许一个非空(对应 `decision` 的取值)。

字段细化:

- `subtasks[].id`:格式 `s<stage>-<3 位序号>`,本轮 query 内唯一。例:`s2-001`、`s3-002`
- `subtasks[].subIntent`:中文领域语言,**禁止**含 "Stage" / "stage" / 内部术语;一句话,≤ 30 字
- `subtasks[].specImpact`:三选一(`none` / `spec-correction` / `spec-shape-change`)。Stage 2 默认 `none` 或 `spec-correction`;Stage 3 唯一允许 `spec-shape-change`
- `subtasks[].evidenceRequired`:字符串数组,语义化标签(例:`repro-seed`、`before-after-runner-summary`、`new-mustHave-pass`、`regression-pass`)。**v1 不规定取值域**,用方约定;router 只负责声明,worker 解释执行
- `subtasks[].stopIfFails`:布尔。本 phase 默认对 Stage 2 写 `true`(复现失败必须停)
- `subtasks[].dependsOn`:数组,引用本列表前序 subtask 的 `id`。本 phase POC 只生成单 subtask,`dependsOn` 应为空数组
- `subtasks[].expectedArtifacts`:字符串数组,语义化标签(可以是文件 glob、契约字段路径、资源类别名)。**v1 不规定取值域**;路由器尽力声明,作为冲突检测/review 输入
- `clarifications[].question`:中文领域语言,**禁止**出现 stage 编号;主动表达系统的理解让用户校对,而不是要求用户填内部决策
- `baselineRef`:从 `cases/<id>/eval/baseline.json::baselineId` 读取;若缺失,router 应进入 `decision: "reject"` 并 `reason: "no passing baseline; run Stage 1 delivery first"`

### Router 内部流程

```
1. 读 cases/<id>/specs/plan.json、eval/delivery.json、eval/runner-result.json、eval/baseline.json、eval/evolution-log.jsonl
   - 任一缺失 → reject(reason 指明缺失文件)
   - delivery.json::status 不是 delivery-pass / delivery-with-warnings → reject
2. 把上述上下文 + 用户 query 喂给 LLM(prompt 在下面)
3. LLM 返回 JSON 候选
4. router 在 Node 侧做硬校验:
   - 顶层 decision 字段合法
   - subtask 字段完整且类型正确
   - subtask 中 stage 编号未泄漏到 subIntent / question / reason 文本(扫禁词 "Stage 2"/"stage 2"/"S2"/"S3"/"S4"/"S5",出现即拒绝并 retry 一次)
   - dependsOn 闭包(只引用本列表中已出现的 id)
   - subtask 排序符合 2 → 3 → 4 → 5(stage 字段单调不减)
5. 校验通过 → 写一条 evolution-log entry(kind: "triage-decision"),stdout 输出 JSON
6. 校验失败 → 用 LLM 重试一次;再失败则 stdout 输出 reject(reason 写明 router 自身校验失败)并退出码 2
```

### LLM Prompt 设计要点

prompt 模板放 `scripts/_triage_prompt.js`(导出函数 `buildTriagePrompt(args)`),**不**放外部文件。

system prompt 必含约束:

- "你是 mini-game 演进环的 triage 路由器。读完用户 query 与 case 当前状态,输出一个 JSON 决策。"
- 完整给出三种 `decision` 形态的字段约束(把上面的字段细化抄进 prompt)
- "禁止在 `subIntent` / `question` / `reason` 任何文本里出现 'Stage' / 'stage' / 'S2'/'S3'/'S4'/'S5' 等内部编号;必须用游戏领域语言"
- "拆分顺序固定为 Stage 2 修复 → Stage 3 新增 → Stage 4 深化 → Stage 5 美化;同 stage 多个相近子意图合并;不同 stage 各自一个 subtask"
- 给出 [`evolution-docs/10-triage-router.md` § 路由判据](../../evolution-docs/10-triage-router.md#路由判据) 的 stage 判据表(意图 → stage)与"为什么不用 spec 形状判"反例
- 给出 [`evolution-docs/10-triage-router.md` § 澄清话术](../../evolution-docs/10-triage-router.md#澄清话术) 的好/坏对照例(3 对)

user prompt 含:`rawQuery`、`plan.json` 全文(JSON.stringify)、`delivery.json` 摘要(只取 status / warnings)、`runner-result.json` 摘要(只取 summary / failedExpects[5 条]/ warnings[5 条])、最近 5 条 `evolution-log.jsonl` 记录。

> **不传** screenshot 二进制——遵守 vision policy(详见 `cases/<id>/.game/vision-policy.json`)。可以传 screenshot 路径与文件大小,作为存在性证据。

LLM 调用走 `cases/<id>/.game/eval-provider.json` 中的 provider(本仓默认 `openrouter-api/kimi-k2.6`)。**不要硬编码 provider**——读 case 配置。

### `_stage_2_worker.js`

导出一个函数:

```js
/**
 * 执行单个 Stage 2 修复 subtask。
 * @param {Object} args
 * @param {string} args.casePath
 * @param {Object} args.subtask              - 来自 router 输出的单条 subtask(stage 必须等于 2)
 * @param {Object} args.evolutionContext     - 当轮 evolution 状态(其他 subtask 引用)
 * @returns {Promise<{verdict: "pass"|"fail"|"kicked-back", checkpoint?: Object, kickBack?: Object, errors?: string[]}>}
 */
export async function runStage2(args) { ... }
```

worker 内部流程(关键步骤):

```
1. 复现优先:
   - 读 plan.json + runner-result.json,定位与 subtask.subIntent 关联的 mustHave / mustNot / smoke.expect / warning
   - 跑一次 check_delivery.js(完整流程),拿到当前 runner-result.json
   - 若 runner 没有任何失败迹象与 subIntent 对应 → verdict: "fail",errors: ["cannot reproduce"]
2. 边界自检:
   - LLM 调用前把 [Stage 2 跨 stage 禁止表](../../evolution-docs/20-stage-boundaries.md#跨-stage-禁止表) 的 forbidden 集合写进 prompt
   - 修复 patch 应用前用 AST 或正则检查:plan.json 是否被改了 controls[].input / requiredMechanics 增删 / mustHave 增删 / winCondition / loseCondition / primaryLoop
   - 若有越界 → 不应用 patch,verdict: "kicked-back",kickBack 字段填上 forbidden 类型 + 推断的真实 stage
3. 应用 patch:
   - 修改 game/ 下相关代码;允许做 spec-correction(改 acceptance.text、补 mustNot、调 evidence 阈值);允许新增 nonblockingTodos
   - patch 应用前先做 in-memory 备份,失败时回滚
4. 跑回归 verify:
   - 跑一次 check_delivery.js
   - 通过 → verdict: "pass",checkpoint 填该次 delivery 的 baselineId
   - 失败 → 回滚已写改动,verdict: "fail",errors 填 failedExpects 摘要
5. 写 evolution-log:
   - kind: "subtask-result",含 subtaskId / stage / verdict / checkpoint? / errors? / kickBack?
```

> **kick-back 时强制回滚已写改动**——契约 [`evolution-docs/20-stage-boundaries.md` § Kick-back 协议](../../evolution-docs/20-stage-boundaries.md#kick-back-协议) 硬要求。worker 必须先回滚再返回 `kicked-back` verdict。

### `run_evolution.js`(顶层 CLI)

调用形态:

```bash
node scripts/run_evolution.js cases/<id> --query "boss 关掉帧修一下"
```

执行步骤:

```
1. 调用 triage_router.js,获得决策
2. decision != "execute" → stdout 输出决策原文(澄清问题列表 / 拒绝说明),退出码 0(澄清和拒绝都不算运行错误)
3. decision == "execute":
   a. 遍历 subtasks(已按 stage 排序):
      - stage == 2 → _stage_2_worker.runStage2
      - stage in [3,4,5] → 暂未实现,verdict: "blocked",errors: ["stage-N worker not yet landed in Phase 2"]
   b. 单 subtask 完成后,根据 verdict 决定:
      - pass → 继续下一 subtask
      - kicked-back → 终止本轮,触发 router 重新分诊(re-entry,不在 Phase 2 实现循环上限,留给 Phase 4)
      - fail + stopIfFails: true → 终止本轮,前序 checkpoint 保留
      - fail + stopIfFails: false → 回滚本 subtask,继续下一 subtask
4. 全部完成或终止后,stdout 汇总报告(每条 subtask 的 verdict + checkpoint),exit 码 0(部分失败也是 0;真正的运行错误才用 1)
```

### `_evolution_state.js`

```js
/**
 * 当轮 evolution iteration 的 in-memory 状态对象。
 * 不持久化到磁盘(future 议题);只在 run_evolution.js 进程生命周期内传递。
 */
export class EvolutionIteration {
  constructor({rawQuery, caseId, baselineRef, subtasks}) {
    this.rawQuery = rawQuery;
    this.caseId = caseId;
    this.baselineRef = baselineRef;
    this.subtasks = subtasks;        // 只读快照
    this.results = [];                // 每条 subtask 的 verdict + checkpoint
    this.iterationId = `${caseId}-${Date.now()}`;
  }
  recordResult(subtaskId, verdict, payload) { ... }
  isStopped() { ... }                 // 返回是否触发了 stopIfFails 终止
}
```

## Existing code to reference

实施前必读:

- `scripts/check_delivery.js` 全文(`run_evolution.js` 与 `_stage_2_worker.js` 都要 spawn 它)
- `scripts/configure_eval_provider.js` 中读 `eval-provider.json` 的代码段(LLM 调用要用同一份配置)
- `cases/brick-glm/.game/eval-provider.json` 真实例
- `evolution-docs/10-triage-router.md` 全文(prompt 内容直接抄它)
- `evolution-docs/20-stage-boundaries.md` § Stage 2 全文(worker 边界)

## Acceptance criteria

POC fixture:`cases/brick-glm`(已通过 Stage 1 并有 baseline.json)。

1. **三态输出可达**:
   - 喂入清晰修复 query("boss 关掉帧") → router 输出 `decision: "execute"`,subtasks 长度 1,stage 全为 2
   - 喂入模糊 query("游戏感觉不对") → router 输出 `decision: "clarify"`,clarifications 长度 ≥ 1,问题不含 "Stage" 编号
   - 喂入越界 query("帮我重新设计这游戏") → router 输出 `decision: "reject"`,reason 提及"非演进范畴"
2. **stage 编号不泄漏**:对 100 条不同 query 做 fuzz,统计 router 输出的 `subIntent`/`question`/`reason` 文本,**0 条**含 `Stage 2/3/4/5` / `stage 2/3/4/5` / `S2/S3/S4/S5`
3. **subtask 7 字段完整**:`decision: "execute"` 的输出中,每个 subtask 的 7 字段(stage / subIntent / specImpact / evidenceRequired / stopIfFails / dependsOn / expectedArtifacts)全部存在且类型正确
4. **subtask 排序**:多 stage 输出时,`stage` 字段单调不减(2 → 3 → 4 → 5)
5. **缺 baseline 时拒绝**:删除 `cases/<demo>/eval/baseline.json` 后跑 router → `decision: "reject"`,reason 提及 baseline 缺失
6. **vision policy 遵守**:`cases/<id>/.game/vision-policy.json::visionMode === "disabled"` 时,router 不读图(可通过日志或 LLM 调用 inspector 确认 prompt 中只有 path/size,无 base64 图像)
7. **Stage 2 修复端到端可跑**:故意在 `cases/brick-glm/game/` 下注入一个轻量 bug(例:把某个 emitMilestone 的 id 拼错),`run_evolution.js cases/brick-glm --query "milestone X 没触发"` → 完成后 bug 修好、`check_delivery.js` 重跑 verdict 为 `delivery-pass`、新 `baseline.json` 已写入、`evolution-log.jsonl` 含 `kind: "triage-decision"` + `kind: "subtask-result"` + `kind: "phase-report"`
8. **kick-back 触发回滚**:故意构造一条 query 让 Stage 2 worker 误以为要新增 mustHave(例:"加一个'通关时显示恭喜'的成就检测") → worker 应识别越界、返回 `kicked-back`、本地 patch 已回滚(diff `cases/brick-glm/` 为空,排除 `eval/`)
9. **不破坏 Stage 1**:Phase 2 引入的新文件全部在 `scripts/` 下;对 fixture 跑一次原始 `check_delivery.js`(不经 run_evolution),verdict 仍正确

## Out-of-scope (DO NOT do in Phase 2)

- Stage 3 / 4 / 5 worker 的实现(留给 Phase 3)
- mustNot 机械执行(留给 Phase 4)
- 多 subtask 编排的复杂分支(本 phase 只 POC 单 Stage 2 subtask;多 subtask 写"未实现"占位即可)
- 循环 kick-back 上限保护(留给 Phase 4)
- 任何 schema 文件
- 修改 `evolution-docs/`、`SKILL.md`、`AGENTS.md`、`schemas/`、`templates/`
- 任何 git 操作

## Codex notes

- LLM 调用要做超时与 retry。建议:超时 60s,失败 retry 1 次;两次都失败 → router 返回 reject(reason: "router LLM unavailable")
- prompt 用中文(case 内容是中文,context 也是中文,统一中文减少跨语言开销)
- LLM 输出 JSON 要 robust 解析:容忍开头有 ```json、结尾有 ```、容忍尾部 trailing text。先 `JSON.parse`,失败再正则提取首个 `{...}` 块再 parse
- worker 修补时**不要让 LLM 自由编辑**——给 LLM 当前文件 + bug 描述 + 修复目标,要求返回**单文件 patch**(unified diff 或全文替换);Node 侧严格 apply,失败立刻回滚
- 切勿在 worker 里 `git stash` 来"实现回滚"——契约要求实施不依赖 git。回滚靠 in-memory 文件备份(读时记录原内容,失败时 `writeFileSync` 还原)
- POC 阶段允许 worker 只支持"修单文件 + 单 milestone 拼写错误"这类最简单的 case,跑通端到端为先;复杂 bug 模式留给 Phase 3 之后扩展

## Open questions for human

如果实施过程中遇到下列情况,**停下来报告**:

- LLM 拒绝按 prompt 输出 JSON(连续 retry 后仍失败) — 可能 prompt 太长或模型不擅长,需要切换/重设
- vision policy 配置文件结构与 README 假设不符 — 实际跑 fixture 时若发现,先报告再决定
- `_delivery_runner.mjs` 启动 Playwright 时 worker 端无法干净 spawn(端口冲突 / 锁文件) — 不要绕过 lock 机制
- 在 fixture 上做 fuzz 100 条 query 太慢/太贵 — 可降到 30 条,但要在 phase-report 里 followUps 写明
