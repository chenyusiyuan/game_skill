# 端到端验收清单(N19 落地完成判定)

本文是 Phase 1-4 全部完成后,用来判断"N19 演进环已可投入使用"的整体集成测试。**任一断言失败 = N19 未完成**。

## 验收前提

- Phase 1 / 2 / 3 / 4 各自的 `phase-report` 都为 `status: "done"`,`acceptancePassed` 比例为 100%
- 仓内当前**没有未提交的本地脏改动**(避免 fixture 噪音影响 verdict diff)
- 至少一个 case(默认 `cases/brick-glm`)已通过 Stage 1 首交付,有完整 `eval/baseline.json`、`eval/delivery.json`、`eval/runner-result.json`、`eval/screenshots/*`

## 验收 Fixture 准备

```bash
# 确保 fixture 处于 baseline 状态
cd /path/to/mini-game
node scripts/check_delivery.js cases/brick-glm
# 期望:status === "delivery-pass" 或 "delivery-with-warnings"
```

如果 fixture 跑不通 Stage 1,**不要在 Stage 1 上补丁**——这是 fixture 健康度问题,先解决再做 N19 验收。

## 集成场景 A — 单 Stage 2 修复闭环

**场景**:用户报告一个 milestone bug。

```bash
# 1. 在 fixture 上故意注入小 bug:把某个 emitMilestone id 拼错(例:'paddle-moved' → 'paddle-mvoed')
# 2. 跑演进
node scripts/run_evolution.js cases/brick-glm \
  --query "我玩的时候挡板能动,但 milestone 不触发"
```

**期望**:
- [ ] router 输出 `decision: "execute"`,1 个 subtask,`stage: 2`,`subIntent` 含"挡板"或"milestone"语义,**不**含 "Stage" / "S2"
- [ ] Stage 2 worker:复现成功 → 修补 typo → 跑回归 verify pass → 写 checkpoint
- [ ] mustNot 检查 pass(无新 violation)
- [ ] 新 `eval/baseline.json` 已写入,`baselineId` 与场景前不同
- [ ] `eval/baseline-prev1.json` 是场景前的版本
- [ ] `eval/evolution-log.jsonl` 末尾出现:`triage-decision` → `subtask-result(verdict:pass)` → `subtask-checkpoint` → `delivery-baseline-written` 序列
- [ ] `cases/brick-glm/game/` 下 typo 已修;`cases/brick-glm/specs/plan.json` **未变化**(纯代码修复,不需要 spec correction)
- [ ] stdout 报告 `STATUS=done`,`failures=0`

## 集成场景 B — 跨 Stage 多 subtask 序列

**场景**:用户一句话提三件事——修 bug、加机制、调手感。

```bash
# 在场景 A 修过 bug 的基础上,继续:
node scripts/run_evolution.js cases/brick-glm \
  --query "球速太慢,加一个'连续击碎 5 个砖块'的连击成就,顺便挡板移动有点滞后修一下"
```

**期望**:
- [ ] router 输出 `decision: "execute"`,3 个 subtask,stage 序为 `[2, 3, 4]`(挡板滞后 → Stage 2,连击成就 → Stage 3 新增 mustHave/mechanic,球速调慢 → Stage 4)
- [ ] 三 subtask 串行执行,每条都有独立的 `subtask-result` 与 `subtask-checkpoint`
- [ ] Stage 3 修改 plan.json:新增 mustHave 与 requiredMechanic;forbidden 检查通过(没动 controls.input / win-lose-condition / primaryLoop)
- [ ] Stage 4 仅修改 game/ 下数值常量,**未动** plan 任何字段
- [ ] 全部 mustNot 检查 pass
- [ ] 最终 `baseline.json` 反映 3 步累积后的状态;`baseline-prev1.json` / `baseline-prev2.json` 反映前两步
- [ ] stdout 总结报告显示 `subtasks=3, passed=3, kicked-back=0, stopped=false`

## 集成场景 C — Kick-back re-entry

**场景**:故意让 router 误路由,触发 kick-back 后 re-entry。

```bash
# 构造一个 prompt-confounding query,让 router 倾向于错判
node scripts/run_evolution.js cases/brick-glm \
  --query "把球速调慢一点"   # 应该是 Stage 4,但加点修辞让 router 可能路由到 Stage 3
```

如果 router 一次就路由对了,**手动注入误判**:用 `node scripts/triage_router.js cases/brick-glm --query "..."`,把输出的 subtask `stage` 改成 3,喂给 worker(临时调试通路;不要保留到生产路径)。

**期望**:
- [ ] Stage 3 worker 识别"这是调参不是新增机制" → verdict: "kicked-back",patch 已回滚(diff `cases/brick-glm/game/` 干净,排除 `eval/`)
- [ ] `evolution-log.jsonl` 含 `kind: "subtask-result"` 且 `verdict: "kicked-back"`
- [ ] router re-entry 被触发,输出新 subtask 序列,新 subtask `stage: 4`
- [ ] Stage 4 worker 跑通,verdict: pass
- [ ] kickback ledger 对原 subtaskId 计数为 1,未触发上限;新 subtaskId 是新故事,计数 0

## 集成场景 D — 循环 kick-back 上限

**场景**:故意构造 LLM 反复横跳的 query。

```bash
# 这个比较难自然触发;通过临时改高 ledger 阈值或注入故障 prompt 实现
# 或:Phase 4 验收时已有此类用例,这里复用一下
```

**期望**:
- [ ] 同一 subtaskId 被 kick-back 累计 3 次后,run_evolution 强制 reject
- [ ] `evolution-log.jsonl` 含 `kind: "kickback-circuit-broken"`,记录 totalKickbacks: 3
- [ ] `baseline.json` 未更新(整轮失败,无 commit)
- [ ] stdout 报告 `STATUS=blocked, reason: kickback-circuit-broken`

## 集成场景 E — Stage 1 完全隔离

**场景**:N19 落地后,Stage 1 SOP 仍能独立、不受影响。

```bash
# 选一个尚未演进过的全新 case(或新建一个)
node scripts/check_delivery.js cases/<fresh-case>
```

**期望**:
- [ ] verdict 与 N19 落地前(任意之前的 commit)一致
- [ ] 即使该 case 没有任何 baseline.json,Stage 1 仍能完整跑通(从首次跑动开始就会写 baseline,但不会因为之前没有而失败)
- [ ] `delivery.json` / `runner-result.json` 字段完全一致(diff 排除 timestamp)
- [ ] 如果该 case 出现 `delivery-pass`,Phase 1 hook 写入第一份 `baseline.json`(行为正确)

## 集成场景 F — Stage 5 美化不破坏玩法

**场景**:演进中的最后一步往往是美化,验证它不破坏前序工作。

```bash
node scripts/run_evolution.js cases/brick-glm \
  --query "字体太小看不清,挡板颜色太暗,HUD 排得有点乱"
```

**期望**:
- [ ] router 输出 `decision: "execute"`,1 或多个 stage 5 subtask
- [ ] Stage 5 worker 修改渲染层代码与/或资源,**未动** plan.json,**未动**逻辑代码(emitMilestone、winCondition 实现、输入处理)
- [ ] 全量回归门:跑完 patch 后 check_delivery 仍 `delivery-pass`,所有 mustHave 仍命中
- [ ] mustNot 检查 pass
- [ ] `eval/screenshots/*.png` 已被新 patch 后的 delivery 重写(文件 mtime 更新),并且尺寸/格式正常
- [ ] baseline 已更新

## 整体不变量(对所有场景成立)

- [ ] **Stage 编号不出现在用户面文本**:扫描所有场景产生的 stdout / stderr 输出 + `evolution-log.jsonl` 中 `subIntent` / `clarification.question` / `reject.reason` 三个字段,**0 处** 含 "Stage 2" / "Stage 3" / "Stage 4" / "Stage 5" / "S2" / "S3" / "S4" / "S5"(中英文均扫)
- [ ] **plan.json 形状只在 Stage 3 改**:对所有场景 git diff `cases/<id>/specs/plan.json`,被改的条目类型必须落在"Stage 3 允许变更"集合内。Stage 2 只允许 spec-correction(改文本/补 mustNot/调 evidence 阈值);Stage 4 / 5 完全不动 plan.json
- [ ] **演进过程不依赖 git**:全部场景跑动期间,**无任何** `git status` / `git diff` / `git stash` / `git commit` 调用(grep `scripts/` 与 `node_modules` 之外的代码确认)
- [ ] **失败时干净回滚**:任何 verdict !== "pass" 的子任务,跑完后 `git diff cases/<id>/game/` 与 `git diff cases/<id>/specs/` 都为空(只有 `eval/` 下的日志/baseline 变化是预期的)
- [ ] **vision policy 遵守**:对 `cases/<id>/.game/vision-policy.json::visionMode === "disabled"` 的 case 跑全部场景,LLM prompt 中**不含** base64 图像数据
- [ ] **Phase 1-4 的 phase-report 完整**:`evolution-log.jsonl` 含 4 条 `kind: "phase-report"`,`phase` 取值 `[1,2,3,4]`,`status: "done"`,`acceptancePassed` 比例 100%

## 验收报告

完成所有场景后,在 `cases/brick-glm/eval/evolution-log.jsonl` 追加一条总验收记录:

```json
{
  "kind": "n19-acceptance",
  "timestamp": "<ISO-8601>",
  "scenarios": {
    "A-stage2-fix": "pass",
    "B-multi-stage": "pass",
    "C-kickback-reentry": "pass",
    "D-circuit-breaker": "pass",
    "E-stage1-isolation": "pass",
    "F-polish-no-break": "pass"
  },
  "invariants": {
    "no-stage-id-leak": "pass",
    "plan-shape-only-by-stage3": "pass",
    "no-git-deps": "pass",
    "clean-rollback": "pass",
    "vision-policy-respected": "pass",
    "all-phase-reports-present": "pass"
  },
  "verdict": "n19-landed"
}
```

stdout 输出:

```
[n19-acceptance] STATUS=landed
scenarios-passed: 6/6
invariants-passed: 6/6
ready-for-handoff: true
```

## 不算 N19 完成的标志

下列任一情况出现,**不能**判定 N19 已完成,即使其他 acceptance 都过:

- 任何 mustNot 启发式判定假阳率 / 假阴率 > 20%(说明 mustNot 执行不稳)
- router 在 fuzz 100 条 query 时 stage 编号泄漏率 > 0(契约红线)
- Stage 1 在 N19 落地后任一 case 的 verdict 与落地前不同(说明破坏了 Stage 1 隔离)
- 某个 stage worker 在跑通 acceptance 之外的 reasonable query 时频繁假性 kick-back(假性率 > 30%)→ 报告 prompt 调整需求,不算完成

## 完成后的交接动作

N19 验收通过后,实施侧需要把以下内容交回:

1. 完整的 `evolution-log.jsonl` 一份(供 review 历史路径)
2. 4 个 `phase-report` 摘要 + 1 个 `n19-acceptance` 摘要
3. 已知 followUps 列表(deferred 待办)
4. 已知 blockers 列表(若有未完成项,说明为什么 N19 仍可声明 landed)

人工 review 这些后,决定是否 commit 全部新文件并合入主线。**未经人工 review,不要自动 commit。**
