# cases/anchors/ — Regression Anchor Cases

**目的**：把经过 anchor 升格硬门的 case 存在这里，作为**跨 case 回归的真值基线**。任何 skill 改动都应在至少一个锚 case 上跑过 L4 `verify_all`，证明不退步。

**与 `cases/<slug>/` 的区别**：
- `cases/<slug>/` — 临时跑 case 的工作目录，随时可删
- `cases/anchors/<slug>-min/` — 冻结基线，**只允许有限的 baseline 更新**，不做开发

---

## 目录约定

```
cases/anchors/
├── README.md                             ← 本文件
└── <genre>-<engine>-min/                 ← 各锚
    ├── docs/game-prd.md                  ← 与源 case 同步，人工审阅后冻
    ├── specs/*.yaml                      ← expand 产物全量
    ├── game/                             ← codegen 产物全量
    ├── eval/
    │   ├── report.json                   ← 最近一次绿的 verify_all 输出
    │   ├── report.baseline.json          ← 人工 review 确认后冻的 baseline
    │   ├── traces/golden.ndjson          ← 可选：trace 真值对照
    │   ├── ok-skip-whitelist.md          ← 预期 ok-skip 的逐条理由
    │   └── README.md                     ← 本 anchor 存在的原因、覆盖哪些 check
    └── DEBT.md                           ← 当前挂账（必须干净）
```

---

## 升 anchor 的硬门（摘自 `iteration_testing_protocol.md` §4）

一个 case 要从 `cases/<slug>/` 升格到 `cases/anchors/<slug>-min/`，必须**全部**满足：

1. **本 case 自测全绿**：`eval/report.json` 9/9 check 全绿（或预期 ok-skip 已在 `ok-skip-whitelist.md` 登记）
2. **L4 跨 anchor 回归**：在 ≥ 1 个现有锚 case 上跑过 `verify_all.js` 并确认不退步（理想是 L5 全锚；最低 1 条）
3. **Baseline 产物齐全**：本 README 列出的 6 份文件都存在
4. **DEBT.md 干净**：无过时条目（近期 commit 已修好但未关闭的 Debt 必须在升格前清理）
5. **`.pipeline_patterns.md`**：本 case 造成的 pattern 条目 commit hash 都已回填（不是 `<pending>`）

任一不满足就**保留在 `cases/<slug>/` 作为一次性压测存档**，不升格。

---

## 基线更新规则

基线 (`report.baseline.json` 等) **禁止** 在以下场景更新：
- 只是因为某 check 变红就改 baseline 把它标绿
- 改 warning 到 ok 不留解释
- 不说明原因就更新

**允许**更新：
- 人工 review 新 report 语义正确（比如新增了一条合法的 check，旧 baseline 里没有）
- 本次改动的**意图**就是改变这份 baseline（新 check 上线、新反作弊规则生效）

更新时：

```bash
cp cases/anchors/<anchor>/eval/report.json cases/anchors/<anchor>/eval/report.baseline.json
git add cases/anchors/<anchor>/eval/report.baseline.json
git commit -m "chore(anchors): bump <anchor> baseline — <reason>"
```

---

## 最低集合（引自 `iteration_testing_protocol.md` §4.1）

| Anchor | 目的 |
|---|---|
| `board-grid-min/`（canvas 或 pixijs）| solvability 主路径 + runtime_semantics 主路径 |
| `reflex-min/` | solvability schema-only 分支、trivial probe skip |
| `edu-min/` | edu 分支、solvability skip 路径 |
| `platform-phaser-min/` | phaser3 runtime primitive 收编 |
| `dom-ui-min/` | dom-ui engine-aware subset |
| `<future>` `three-min/` | 等 P3-C 解锁后再加 |

当前状态：**空**。2026-04-29 目录刚建，等待第一个合格 case 入驻。`whack-a-mole-pixijs-min` 本来可能成为 `reflex-min/` 的候选，但 Phase 5 deep review 发现协议违规 + 双份真相 + failures 未填，判定"不够格升 anchor"；保留为 `cases/whack-a-mole-pixijs-min/` 的一次性压测存档。

---

## Changelog

- 2026-04-29 目录初建。空。首个锚等 `iteration_testing_protocol.md` §4 硬门达标的 case 入驻。
