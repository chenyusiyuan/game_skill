# Pipeline 迭代测试协议

**目的**：为 game_skill 生成链路的后续迭代建立一套"分层快速反馈"的测试流程，替代过去"每次改动都跑 e2e → 混合信号 → 打地鼠式修 → 改来改去没进展"的反模式。

**适用对象**：
- 人类开发者在提交前自己检查
- 模型（Claude / Codex）在一轮改动后接管对话，review 历史 + 代码 + log 决定下一步

**核心原则**：
1. **e2e 是体检，不是治疗**。不靠 e2e 指导改哪里；靠 L1–L4 的快速测试告诉你改对没。
2. **按改动的 blast radius 选最低验证层**，不要每次都跑全链。
3. **改动前先决定 blast layer**，实施中不跨层；跨层立刻 stash 回到规划。
4. **失败必须定位到层**，从最早红的层开始修；下游红往往是上游红级联。
5. **baseline diff 比绝对通过/失败有用 10 倍**。

---

## 0. 模型接管时的自我提问清单（开跑前必答）

接管对话时，逐条走一遍。任何一项 NO → 不要跑任何测试，先补齐上下文。

- [ ] 我能说出这轮改动触动了哪几层（schema / runtime / checker / expander / codegen / profile / 锚 case）？
- [ ] 我读过用户最后一轮消息，理解了他希望我做 "review + 判断" 还是 "直接修"？
- [ ] 我跑过 `git log --oneline -5` 和 `git status --short`，看清真实改动？
- [ ] 我知道哪一个或两个锚 case 对应这次改动？
- [ ] 如果答不上上面任何一条，我是否先向用户 clarify，而不是启动测试？

---

## 1. Layer Map（L1–L6）

每层有固定入口命令、固定通过标志、固定失败解读。

### L1 — 单元测试（fast ≤ 30s）

**入口命令**：
```bash
cd /Users/bytedance/project/game_skill
node game_skill/skills/scripts/test/run.js 2>&1 | tail -5
node --test game_skill/skills/scripts/test/*.test.mjs 2>&1 | tail -8
```

**通过标志**：`run.js` 输出 `结果: NNN passed, 0 failed`；`node --test` 输出 `pass NN / fail 0`。

**覆盖范围**：schema 单元、primitive reducer/runtime 单元、checker 单元、_profile_anti_cheat 正则、engine-subset 数据表、solvability fixtures。

**什么时候跑**：每次代码改动后的第一步，永远第一。

**失败解读**：
- 报错定位 → 问题必在本次改动的 unit scope
- 不要急着改 test，先确认 test 是不是原本就对
- 只有极少数情况（比如你明确更新了某条 assertion 的期望）才允许改 test

---

### L2 — 相邻层契约（medium ≤ 60s）

改动跨过两层之间的 schema / 输出 shape 时必跑。

**典型场景与命令**：

| 改了 | 跑 |
|---|---|
| `implementation-contract.schema.json` | `node game_skill/skills/scripts/generate_implementation_contract.js <anchor-case>` → diff 产物；再 `check_implementation_contract.js <anchor-case> --stage expand` |
| `_primitive_runtime_map.js` | `check_implementation_contract.js <anchor-case> --stage codegen` |
| 任何 expander prompt / `.claude/agents/gameplay-expander.md` | 在 1 个 case 上重跑 Phase 3（或跑 `check_mechanics.js`）|
| 任何 `codegen.md` 里的 Step 说明 | 在 1 个引擎模板的 case 上跑 Phase 4 + `check_game_boots.js` |
| `check_*.js` 规则逻辑 | 在 1 个已知应通过 / 1 个已知应失败的 fixture 上分别跑一次 |

**通过标志**：
- 产物 shape 仍然符合 schema
- 同一输入产生同一输出（idempotent）
- 已知应通过的 case 仍绿、已知应失败的 case 仍红、且失败原因仍是预期原因

**失败解读**：
- shape 变了 → schema migration 没 backward-compat，考虑加 deprecation 路径（参考 `required-test-hooks` 的 2026-06-01 死线模式）
- 已知应失败的 case 现在绿了 → 说明规则被削弱了，回查最近的改动

---

### L3 — 单 case 单层（slow ≤ 2min）

某一 checker 失败场景在某一 case 上的专项复现。

**命令模板**：
```bash
node game_skill/skills/scripts/<checker>.js cases/anchors/<anchor-name> [--stage codegen | --profile <id>]
```

**什么时候跑**：
- L1/L2 绿了但怀疑具体 case 会受影响
- 用户反馈某个 case 生成出问题，你需要定位挂在哪一 checker

**失败解读**：只关心这一 checker 的输出，**不看别的 checker 的串扰**。

---

### L4 — 单 case 全链 verify_all（≤ 5min）

**命令**：
```bash
node game_skill/skills/scripts/verify_all.js cases/anchors/<anchor> --profile <id> --no-write
```

**什么时候跑**：
- L1–L3 全绿
- 确认 "这一次改动在至少 1 个真实 case 上不退步"
- 准备合并 / 提交 PR 前

**通过标志**：所有 check 都 `exit_code=0`；或者只有已知的 `ok-skip`（如 reflex case 的 runtime_semantics skip、non-board-grid case 的 level_solvability skip）。

**失败解读**：
1. 从 `eval/report.json` 读出 `checks[]`
2. 按**出现顺序**挑第一条 `exit_code !== 0`
3. 把它映射到所在层（下表）
4. **先修那一条**，不要并行修多条——下游红往往是上游红的级联

| check 名 | 所在层 |
|---|---|
| `mechanics` | L0 DAG |
| `asset_selection` | L1 schema + catalog |
| `implementation_contract` | L1 schema + runtime map |
| `boot` | L3 codegen 产物 |
| `project` | L3 codegen 产物 |
| `playthrough` | L4 profile + 真实 UI |
| `runtime_semantics` | L4 runtime trace |
| `level_solvability` | L4 可玩性 |
| `compliance` | L5 工程契约 |

---

### L5 — 所有锚 case 全链（≤ 15min）

**命令**：
```bash
for anchor in cases/anchors/*/; do
  node game_skill/skills/scripts/verify_all.js "$anchor" --profile $(basename "$anchor") --no-write
done
```

**什么时候跑**：
- 发布 / 合并到 main 前
- 跨层大重构（如生成层重构 P0/P1/P2）落地后一次验收
- 新引擎 / 新 genre 引入时

**失败解读**：按 case 分组，每组走 L4 流程。

---

### L6 — Baseline diff

**前置**：每个锚 case 维护一份 `eval/report.baseline.json`，是最近一次人工审阅通过后冻结的。

**命令**：
```bash
diff cases/anchors/<anchor>/eval/report.json cases/anchors/<anchor>/eval/report.baseline.json | head -40
```

**什么时候跑**：L5 全绿后，或 L5 出现部分红时。

**读法**：
- 任何新增的红 `exit_code !== 0` → **退步**，不能合并
- 原来的红变绿 → 进步，确认是本次有意的修复后更新 baseline
- warnings 数量显著增加 → deprecation 在扩散，考虑提前激活死线

**更新 baseline**：只有在人工确认新 report 语义正确后才写回。代码：
```bash
cp cases/anchors/<anchor>/eval/report.json cases/anchors/<anchor>/eval/report.baseline.json
git add cases/anchors/<anchor>/eval/report.baseline.json
# commit 信息里说明为什么更新了基线
```

---

## 2. 改动类型 → blast layer → 跑什么（决策表）

**使用方式**：确定你本次改动的主类型，找对应行，严格按 "跑什么" 列顺序跑。跑完一层绿，才进入下一层。

| 改动类型 | Blast layers | 顺序跑的测试 |
|---|---|---|
| 单个 schema 字段 | L1 | L1 |
| primitive reducer / runtime `.mjs` | L1 + L2 | L1 → L2 (`check_implementation_contract --stage codegen`) |
| checker 正则/规则 | L1 + L3 | L1 → L3（1 个通过 fixture + 1 个失败 fixture）|
| `expand.md` / `.claude/agents/*` | L2 + L3 | L1 → L2（expander 跑一次）→ L3（对应 checker） |
| `codegen.md` / 模板 | L2 + L3 + L4 | L1 → L3（`check_game_boots` + `check_project`）→ L4（1 个 anchor）|
| profile | L3 + L4 | L3（`check_playthrough`）→ L4（对应 anchor） |
| runtime primitive 新增 | L1 + L2 + L4 | L1 → L2 → L4（1 个 anchor） |
| 引擎收编（A/B/C 这种） | L1 + L2 + L4 + L5 | L1 → L2 → L4 → L5 |
| 多层耦合重构 | L1 + L4 + L5 + L6 | L1 → L4（1 anchor 起步）→ L5（全锚）→ L6（diff baseline） |
| 文档 / 注释 / TODO md | — | 不跑；但要确认 `grep` 不引入不一致的术语 |

---

## 3. 失败读法（cascade hint）

verify_all 失败时，别按 checks[] 顺序挨个猜；按**层拓扑**排。

### 3.1 Red Cascade Pattern（从上往下级联）

| 最早红的层 | 典型级联 | 修哪里 |
|---|---|---|
| `mechanics` 红 | 后续全红（玩法 DAG 本身不成立）| 回到 mechanics decomposer，不要动其他 |
| `implementation_contract` 红（如 `missing-probe-for-runtime-semantics`）| `boot` 可能红（probe 没暴露）、`playthrough` 可能红（probe 调用失败）| 改 contract + expander，不要改 boot check |
| `asset_selection` 红 | `implementation_contract.asset-bindings` 可能红、`boot` 可能红（资源 404）、`playthrough` 可能红 | 改 assets.yaml，不动 contract |
| `boot` 红 | `project` / `playthrough` / `runtime_semantics` 全红 | 改 codegen 产物，不改 profile |
| `project` 红 | 仅 `project` 独立红 | engine source 问题，改模板 |
| `playthrough` 红、其他绿 | profile 本身或产品逻辑问题 | 改 profile 或 rule.yaml |
| `runtime_semantics` 红、playthrough 绿 | primitive 实现漂移 | 改业务代码的 primitive 调用 |
| `level_solvability` 红、其他绿 | 关卡数据问题 | 改 data.yaml.solution-path |
| `compliance` 红、其他绿 | 工程规约问题 | 不要绕过，问清楚规约再改 |

### 3.2 自动生成 cascade hint（未实现，TODO）

考虑给 `render_case_report.js` 加一段：
```
RED:
  L1.contract    — missing-probe-for-runtime-semantics
  L3.boot        — probes.resetWithScenario not exposed (cascaded)
  L4.playthrough — 0 assertions reached play phase (cascaded)

FIX ORDER: start at L1; L3/L4 will likely self-resolve.
```

在没有这个工具前，手动按 3.1 表解读。

---

## 4. Anchor Case 维护规约

### 4.1 最低集合

| Anchor | 目的 |
|---|---|
| `board-grid-min/`（canvas 或 pixijs）| solvability 主路径 + runtime_semantics 主路径 |
| `reflex-min/` | solvability schema-only 分支、trivial probe skip |
| `edu-min/` | edu 分支、solvability skip 路径 |
| `platform-phaser-min/` | phaser3 runtime primitive 收编 |
| `dom-ui-min/` | dom-ui engine-aware subset |
| `<future>`  `three-min/` | 等 P3-C 解锁后再加 |

每个 anchor 存：
- `docs/game-prd.md` + `specs/*.yaml` + `game/` 完整产物
- `eval/report.baseline.json`
- `eval/traces/golden.ndjson`（若有 runtime trace 检测）
- `README.md` 说明此 anchor 存在的原因、覆盖哪些 check、如何更新 baseline

### 4.2 何时建 anchor

- 新 genre / 新引擎首次走通链路 → 立刻建
- 某类 regression 反复出现 → 补一条专门锚这种 regression 的 anchor
- 不为"产品不稳定的 case"建 anchor——会频繁更新 baseline 失去参考意义

### 4.3 何时更新 baseline

**允许**更新：
- 人工 review 新 report 语义正确
- 本次改动的**意图**就是改变这份 baseline（如加入一条新 check，旧 baseline 里没有这条）

**禁止**更新（如果出现，说明有问题）：
- 只是因为某 check 变红就改 baseline 把它标绿
- 改 warning 到 ok 不留解释
- 不说明原因就更新

---

## 5. 反模式清单（出现即停）

任一条出现 → 停下，回到本文档第 0 节重新走 checklist。

- 🔴 改完直接跳 L5/e2e，跳过 L1–L4
- 🔴 e2e 红了优先改 profile（L4），而不是追查 L1 最早红
- 🔴 同一个提交里跨 3+ 层改动（除非是显式重构）
- 🔴 删 warning 不看原因（warning 是 deprecation / 边界信号，不是噪音）
- 🔴 为了让 test 过而改 test assertion
- 🔴 baseline 变红后直接写回新 report 当 baseline
- 🔴 在不跑 L1 的情况下开始下一步实现
- 🔴 e2e 红了但你说不出 red 对应哪一层
- 🔴 "反正之前也是这样的" → 没有基线对比就说"没退步"
- 🔴 "等我全改完一起跑 e2e" —— 多层改动没中间检查点，失败时无法二分

---

## 6. 模型自 review 的标准回复结构

当模型被要求 "review + 下一步"，回复必须包含这些段（可用中文）：

```
## 本轮改动识别
- 读了 git log / git diff / 对话历史后，我判断改动触及：L1 (schema) + L3 (check_asset_selection)
- 用户意图：按 P3-D 推进 catalog 语义硬化

## 已跑测试
- L1: run.js 119 passed
- L2: check_implementation_contract --stage codegen on anchor board-grid-min → ok
- L3: check_asset_selection on 1 通过 fixture + 1 失败 fixture → 行为符合预期
- L4: 未跑（本次改动 blast 在 L1+L3，按决策表不需要 L4）

## Baseline diff
- cases/anchors/board-grid-min/report.json 对比 baseline：无变化

## 建议下一步
- 本轮可以 commit
- 按 TODO 清单，下一批是 P1 profile 迁移；建议先读 profile_tri_bucket_migration_todo.md 的前置依赖段再开工

## 如果用户想发版
- 需要跑 L5 全锚 + L6 diff；今天没跑，估计 10 分钟
```

**不要**回复 "我改完了，请 review" 而不跑测试。**不要**回复 "e2e 都过了" 而不说测试了哪些层。

---

## 7. 模型与人类分工

| 场景 | 模型能做 | 模型必须停 |
|---|---|---|
| L1 失败 | 读 diff 猜原因、提议修改 | 若 3 次尝试仍 L1 红 → 停 |
| L2/L3 失败 | 解读并提议修改 | 若涉及 schema 重大破坏 → 停 |
| L4 失败、按 cascade 能定位 | 先修最早层、重跑 | 若 cascade 不清晰 → 停 |
| Baseline 要更新 | 列出哪些条目变化、各自意图 | **禁止自主更新 baseline** |
| 重构超过 3 层 | 拆分成多个独立 commit 的 plan | 拒绝在单个提交里做 |

---

## 8. 具体命令速查

```bash
# L1
node game_skill/skills/scripts/test/run.js
node --test game_skill/skills/scripts/test/*.test.mjs

# L2
node game_skill/skills/scripts/generate_implementation_contract.js cases/anchors/<a>
node game_skill/skills/scripts/check_implementation_contract.js cases/anchors/<a> --stage expand
node game_skill/skills/scripts/check_implementation_contract.js cases/anchors/<a> --stage codegen
node game_skill/skills/scripts/check_mechanics.js cases/anchors/<a>

# L3（按需任选一条）
node game_skill/skills/scripts/check_asset_selection.js cases/anchors/<a>
node game_skill/skills/scripts/check_game_boots.js cases/anchors/<a>/game
node game_skill/skills/scripts/check_project.js cases/anchors/<a>/game
node game_skill/skills/scripts/check_playthrough.js cases/anchors/<a>/game --profile <id>
node game_skill/skills/scripts/check_runtime_semantics.js cases/anchors/<a>
node game_skill/skills/scripts/check_level_solvability.js cases/anchors/<a>

# L4
node game_skill/skills/scripts/verify_all.js cases/anchors/<a> --profile <id> --no-write

# L5
for a in cases/anchors/*/; do
  node game_skill/skills/scripts/verify_all.js "$a" --profile $(basename "$a") --no-write
done

# L6
diff cases/anchors/<a>/eval/report.json cases/anchors/<a>/eval/report.baseline.json
```

---

## 9. 本协议的维护

- 本协议发生变化（新增 check、新 anchor、层级调整）→ 在本文件末尾追加 changelog 行
- 模型不得单方面修改本协议；用户授权后方可改

### Changelog

- 2026-04-28 初版。覆盖生成层重构 P0/P1/P2 + 引擎收编（canvas/pixijs/phaser3/dom-ui）+ test-hooks 三分类 + P2 solvability + catalog 语义审计。three + profile 迁移未覆盖，相关协议条款在对应 TODO 落地后再增补。
