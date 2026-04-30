# Case-Driven 链路迭代流程 — 从一句 prompt 到根因修复

**目的**：用真实 case 暴露链路问题并修复到根因，避免"改来改去无进展"的补丁堆积。

**与 iteration_testing_protocol.md 的关系**：
- `iteration_testing_protocol.md` — 你改代码/prompt 时的 L1-L6 快速测试协议
- **本文件** — 你跑真实用户 prompt 驱动 skill 生成游戏、并根据暴露的问题改 skill 时的完整 5-Stage 流程

**适用对象**：
- 人类开发者自己跑 case 调 skill
- 模型接手 case，review 对话历史 + 代码 + log 后决定下一步

**总时长预计**：首轮 case 2–4 小时；同类案例第二轮 30 分钟内

---

## 核心纪律（先记住这 4 条）

1. **分阶段冻结 e2e** — 不要一口气跑 Phase 1-5，每 Phase 跑完停下 inspect，绿了才进下一 Phase
2. **层归属问答** — 每次失败前必答"起源层是哪一层"，不写分析不允许开始修
3. **只在起源层修** — 症状层的 checker / profile 是信号器不是治疗器
4. **模式 3 次必抽象** — 同类失败第 3 次出现时禁止继续补丁，必须做结构升级

---

## Stage 0 — 开跑前准备（5 分钟）

```bash
# 1. 固定基线
git status         # 确保 clean
git log --oneline -1   # 记下起点 commit

# 2. 定 case 身份
CASE=word-match-lite
mkdir -p cases/$CASE

# 3. 约定本轮意图（写入文件，人/模型都能读）
cat > cases/$CASE/INTENT.md <<'EOF'
本轮目的: 测试 dom-ui 引擎 + edu-practice genre + 三分类 hooks 的完整链路
预期 blast layers: 无预设；根据失败暴露
不允许的修复: 不在 profile 层补丁，不在 checker 层加豁免

预期 ok-skip whitelist（强制段，没有就不允许开跑）:
- runtime_semantics: [预期结果]（例如 no-applicable-probes，因本 case 无 ray-cast@v1 组合）或 [必须实跑]
- level_solvability: [预期结果]（例如 done:reflex 因本 case 是 reflex genre）或 [必须实跑]
- 其它 check 若有预期 skip，逐条写上理由
EOF
```

**关键**：别在开始前就预判"这个 case 会挂在哪"。让链路说话。

---

## Stage 1 — 分阶段冻结 e2e

按 Phase 跑，每步停一下 inspect。每阶段对应的 skill Phase 和 check 见下表。

### Phase 1 Understand + Phase 2 GamePRD（10–20 分钟）

```
给模型的 prompt:
"用 game skill 的 Phase 1 + Phase 2。只做到 Phase 2 完成，
产出 cases/<CASE>/docs/game-prd.md，停在 Phase 2 末尾，
跑 check_game_prd.js 给我看退出码与报告，不要进 Phase 3。"
```

**inspect 清单**：

- `check_game_prd.js cases/$CASE` exit code = 0
- front-matter 是否完整（runtime / genre / is-3d / asset-strategy）
- `@entity` / `@rule` / `@check(layer:product)` 对得上直观理解
- 是否覆盖你对这个游戏的理解（匹配规则、失败条件、胜利条件）

**stop 条件**：

- exit != 0 → **不进 Phase 2.5**，回到 Phase 1/2 改 `prd.md` 或澄清策略
- exit == 0 但理解偏了 → 这才是 Phase 2.5 Clarify 存在的意义；让模型补 Clarify，**不是手改 PRD**

### Phase 2.5 Clarify（5–10 分钟）

```
"跑 Phase 2.5，产出 docs/spec-clarifications.md，
跑 check_spec_clarifications.js，停在这里。"
```

**inspect**：clarification 是否覆盖了 Phase 2 里未决定的歧义点。没有歧义就是没有；有但没列出来是问题。

### Phase 3.0 Decompose（5 分钟）

```
"跑 Phase 3.0，产出 specs/mechanics.yaml，跑 check_mechanics.js，
停在这里，不要并发 Phase 3.x expanders。"
```

**inspect**：
- `mechanics.yaml` 里的 primitive 组合是否对得上你的玩法理解
- invariants 是否覆盖核心规则
- win-lose-check node 存在且合理

**stop 条件**：mechanics 错了**绝对不能进 3.x**，5 个 expander 会把错放大 5 倍。回到 Phase 3.0 改 `mechanic-decomposer.md`。

### Phase 3.x Expand（10 分钟）

```
"跑 Phase 3.x 5 个 expander 并行，产出 7 份 spec + implementation-contract。
跑 check_asset_selection / check_implementation_contract --stage expand /
check_mechanics，给我 exit code。"
```

**inspect**：
- 7 份 yaml 都在 `specs/` 而不是 `specs/.pending/`
- `implementation-contract.yaml` 的 `required-test-hooks` 是三桶对象（observers/drivers/probes）
- `data.yaml` 的 `playability.genre` 对——消消乐是 `board-grid` 或 `edu-practice`
- `assets.yaml` 的 `selection-report` 有记录

**stop 条件**：任一 expander 失败整个 Phase 3 fail，不要用残缺 spec 进 Phase 4。

### Phase 4 Codegen（15–30 分钟）

```
"跑 Phase 4，产出 game/index.html + src/。
跑 check_game_boots / check_project / check_implementation_contract --stage codegen /
check_mechanics，给我 exit code。不要跑 Phase 5 playthrough。"
```

**inspect**：
- 产物能启动（check_game_boots 绿）
- boot-smoke 已实机点击交互目标并产生 trace 增长（若有 rule-traces）
- primitive runtime import 完整（contract check 绿）
- 三分类 hooks 按 schema 暴露（boot check 的 ENGINE-TEST-TRI）
- 手工打开 `game/index.html` 看看能不能点动

**stop 条件**：codegen 炸了**不要手补代码**——手改等于给 codegen 结果打补丁，下次重新生成还会错。回到 Phase 4 改 codegen.md 或 engine template。

### Phase 5 Verify（10–20 分钟）

```
"准备好 profile，跑 verify_all。给我完整 report.json + 每条 check 的 exit code 解读。"
```

**inspect**：
- `report.status === "passed"`
- `report.generated_by === "verify_all.js"`
- `profile_runner_smoke` 在正式 `playthrough` 前通过；若红，先怀疑 runner shape / Phase 4 交互 wiring，不先改正式 profile
- 若有红：记下**最早红的 check**

---

## Stage 2 — 失败时的层归属（每次失败必过，5 分钟）

**不允许看到红就动手**。先回答下列问题并写入 `cases/$CASE/failures/<timestamp>.md`：

```markdown
### Failure Attribution — 2026-XX-XX HH:MM

1. 最早红的 check: __________
2. 错误的起源层（只选一个，不要打多勾）:
   - [ ] PRD / Understand（用户需求没消化对）
   - [ ] Mechanics（玩法 DAG 本身错）
   - [ ] Schema / Contract（spec ↔ codegen 契约不完备）
   - [ ] Primitive runtime（缺原语 / 原语实现 bug）
   - [ ] Codegen / Template（引擎适配 / 生成逻辑错）
   - [ ] Checker / Profile（信号器准度问题，非症状治疗）
3. 下游红的 check 是否是本起源层的级联？列出:
   - ___ 因 ___ 级联
4. 能在起源层外修 vs 必须在起源层修: 必须在起源层
```

**不写这个分析不允许开始修。**

**硬门**（2026-04-29）：`verify_all.js` 启动时会扫 `cases/$CASE/failures/*.md`，任意文件仍含 `TODO` 字符串或"起源层" checkbox 一个没勾，**直接 exit 2 不跑任何 check**。填完模板才能继续跑。

### Cascade 速查表（verify_all 红时先对照）

| 最早红的 check | 典型级联 | 改哪里 |
|---|---|---|
| `mechanics` | 后续全红（玩法 DAG 本身不成立）| mechanic-decomposer，不动其他 |
| `implementation_contract` | boot 可能红、playthrough 可能红 | 改 contract + expander，不改 boot check |
| `asset_selection` | contract asset-bindings 红、boot 404、playthrough 红 | 改 assets.yaml，不动 contract |
| `boot` | project / playthrough / runtime_semantics 全红 | 改 codegen 产物，不改 profile |
| `project` | 仅 project 独立红 | engine source 问题，改模板 |
| `playthrough` 红、其他绿 | profile 或产品逻辑问题 | 改 profile 或 rule.yaml |
| `runtime_semantics` 红、playthrough 绿 | primitive 实现漂移 | 改业务代码的 primitive 调用 |
| `level_solvability` 红、其他绿 | 关卡数据问题 | 改 data.yaml.solution-path |
| `compliance` 红、其他绿 | 工程规约问题 | 不要绕过，问清楚规约再改 |

---

## Stage 3 — 在起源层修（不是症状层）

### 起源层 → 修哪里 → commit message 模板

| 起源层 | 修哪里 | commit message 示例 |
|---|---|---|
| PRD / Understand | `game_skill/skills/prd.md`、`understand.md`、澄清策略 | `fix(phase-2): clarify win-condition elicitation for edu genre` |
| Mechanics | `.claude/agents/mechanic-decomposer.md`、primitive 目录 | `fix(phase-3.0): board-grid genre must declare slot-pool for elimination stack` |
| Schema / Contract | `game_skill/skills/schemas/*.json`、`generate_implementation_contract.js` | `fix(contract): require observers.getSnapshot for edu-practice genre` |
| Primitive runtime | `references/engines/_common/primitives/*.runtime.mjs` | `fix(primitive): grid-board removeCell must accept cellId alias` |
| Codegen / Template | `codegen.md`、`references/engines/<eng>/` | `fix(codegen): dom-ui Phase 4 must cp mechanics reducers` |
| Checker / Profile | **只在"checker 逻辑真的有漏洞"时** | `fix(check): level_solvability must reject 0-action solution-path` |

### 修完立刻

```bash
# 只从修复的那一 Phase 往后重跑
# 如果修 Phase 3.x 的 expander：
node game_skill/skills/scripts/run_phase_gate.js cases/$CASE --phase expand
# 再 Phase 4、Phase 5 依次

# 不要整条链路从 Phase 1 重新生成——那是"重跑不是调试"
```

---

## Stage 4 — 闭环：模式观察 + 抽象升级

改一个 case 不是终点。同类错误第 2 次、第 3 次出现时，必须停止补丁，升级抽象。

### 维护 `.pipeline_patterns.md`（每次失败追加一行）

```markdown
# Pipeline Failure Patterns

| 日期 | case | 起源层 | 症状 | 根因 | 修了哪里 | 重复计数 |
|---|---|---|---|---|---|---|
| 2026-04-28 | word-match-lite | contract | check_game_boots 报 TEST-TRI 缺 observers | implementation-contract 没给 edu genre 强制 observers.getSnapshot | generate_implementation_contract.js 加 genre-aware defaults | 1 |
| 2026-04-29 | pixel-flow-mini | primitive runtime | check_runtime_semantics 报 ray-cast hit 目标错 | grid-board removeCell 不认 cellId 别名 | grid-board.runtime.mjs | 1 |
| ...等 3 次再出现... |
```

### 升级触发规则

| 模式复现次数 | 允许的动作 |
|---|---|
| 1 次 | 修当前 case + 登记 pattern |
| 2 次 | 修当前 case + **把修复提升为 regression test**（加到 run.js 或 engine-subset.test） |
| 3 次+ | **禁止继续补丁**。必须做抽象升级：新 primitive / 新 checker rule / schema 扩展 / 新 Phase gate |

**历史参考**：P0/P1/P2 生成层重构就是 "3 次+ 抽象升级" 的实例。今后按此触发。

---

## Stage 5 — 收尾 + 提升为 anchor

case 跑通后：

```bash
# 1. 把 case 冻结
git add cases/$CASE
git commit -m "case($CASE): verified end-to-end on <engine> + <genre>

- 暴露并修复: L_Schema 的 ___ 问题
- 暴露并修复: L_Codegen 的 ___ 问题
- Pattern 登记: .pipeline_patterns.md +2 rows
"

# 2. 如果这个 case 代表一个新 genre 或新引擎覆盖，升为 anchor
mkdir -p cases/anchors/<descriptive-name>-min
cp -r cases/$CASE/{docs,specs,game,eval} cases/anchors/<descriptive-name>-min/
cp cases/$CASE/eval/report.json cases/anchors/<descriptive-name>-min/eval/report.baseline.json

# 3. 下一次改相关层时跑这个 anchor 做回归
```

---

## 时间账

| 阶段 | 首轮时长 | 第 N 轮（同类 case） |
|---|---|---|
| Stage 0 准备 | 5 分钟 | 2 分钟 |
| Stage 1 分阶段冻结 e2e | 1–2 小时 | 20 分钟 |
| Stage 2 层归属分析 | 5–10 分钟 | 2–5 分钟 |
| Stage 3 起源层修复 | 30–60 分钟 | 10–20 分钟 |
| Stage 4 模式观察 | 5 分钟 | 5 分钟（纯记录） |
| Stage 5 收尾 + anchor 升级 | 15 分钟 | 5 分钟 |
| **首轮总计** | **2–4 小时** | **30–45 分钟** |

**关键认知**：首轮看起来比"直接跑 e2e 看报告"慢。但第二轮同类 case 就快 3 倍，因为抽象升级消除了重复工作。老方式的"改来改去"永远在 2–4 小时级别反复。

---

## 模型接管 case 的标准 prompt 骨架

把下面这段存好，每次让模型接手 case 时直接粘：

```
我现在跑一个新 case: <case-name>。用户 prompt: "<user prompt>"。

严格按 iteration_testing_protocol.md + case_driven_iteration_flow.md 的流程执行。
具体要求：

1. Stage 1 分阶段跑，每 Phase 停一次给我看产物 + check exit code
2. 每次失败先走 Stage 2 层归属问答，不写分析不动手
3. 修复只能在起源层，禁止 symptom-level patch
4. 同一类 pattern 第 3 次出现时停下，告诉我需要哪种抽象升级，让我决策
5. 跑完后更新 .pipeline_patterns.md + 建议是否升 anchor

中间不需要我授权可以直接做的: 跑 check、读产物、写 failure analysis 文档
每步必须停下等我授权的: 修源码、改 prompt 文件、更新 baseline、推 commit
```

这样不用每次重复解释规则。

---

## 反模式清单（出现即停）

任一条出现 → 停下，回第 0 节重读核心纪律。

- 🔴 跑完 Phase 1-5 所有阶段才看报告，Phase 2 的红等到 Phase 5 才发现
- 🔴 e2e 红了直接在 profile 层 / checker 层打补丁
- 🔴 看到红立刻动手修，不写 Failure Attribution
- 🔴 同一模式连续 3 次失败仍在"加 regex / 加 prompt 约束"，不做抽象升级
- 🔴 修完后整条链路从 Phase 1 重新生成（应从修复的那一 Phase 往后重跑）
- 🔴 手改 codegen 产出的 `game/` 里的代码（应改 codegen.md / 模板）
- 🔴 为让某个 case 过而放宽 checker 正则（应追问为什么 checker 原本的判定是对的）
- 🔴 改 mechanics.yaml 来绕过 runtime_semantics（应修 primitive runtime / 业务代码）
- 🔴 **单个 commit 同时修改 ≥ 3 个 skill 文件的逻辑**（本轮 whack-a-mole 触发过：跨 codegen.md + check_* + 模板三层的改动应拆独立 commit，便于 regression 时精准回滚）
- 🔴 **跑 case 的会话直接修 `game_skill/skills/**`**（WORKFLOW.md 红线；本轮 whack-a-mole 触发过 `651b49a`。修 skill 必须回会话 D / 独立冷启会话做；case 会话只能修 `cases/<slug>/` 下的产物）
- 🔴 **failures/<ts>-<check>-fail.md 有 TODO 未填就再跑 verify_all**（`verify_all.js` 已在启动时硬门拦截；如果你看到 exit 2 的"未填 attribution"信号，别用"跳过一下"绕过——补填才是 Stage 2 的全部要义）

---

## 相关参考

- `eval/protocols/iteration_testing_protocol.md` — 改代码时的 L1-L6 快速测试
- `eval/todos/three_engine_todo.md` — P3-C three 引擎收编待办
- `eval/todos/profile_tri_bucket_migration_todo.md` — profile 三分类迁移待办
- `eval/design/生成层重构.md` — 历史抽象升级的完整案例（P0/P1/P2）
- `eval/design/asset_chain_baseline_audit.md` — catalog 语义审计参考

---

## Changelog

- 2026-04-28 初版。覆盖 Phase 1-5 完整流程、Stage 0-5 阶段纪律、失败层归属模板、模式抽象升级触发规则、模型接管 prompt 骨架。
- 2026-04-29 Stage 0 模板强制写 ok-skip whitelist；Stage 2 引入 `failures/*.md` TODO 未填即拒的硬门（verify_all.js:L27 扫描）；反模式清单加 3 条：单 commit 跨 ≥3 skill 文件禁止 / 跑 case 的会话禁改 skill 源 / failures TODO 未填禁再跑 verify_all。触发事件：whack-a-mole-pixijs-min Phase 5 deep review addendum + C 会话 review 维度 4 判 FAIL。
