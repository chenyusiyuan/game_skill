# N19 落地包(Refactor)

本目录是 [`evolution-docs/`](../../evolution-docs/) **设计契约**的**实施手册**。它面向**实施者(本轮主要交给 Codex)**,把契约里的概念翻译成具体的文件路径、函数签名、命令行调用、验收判据。

> **与 evolution-docs/ 的关系**——
> evolution-docs/ 锁定**应该长什么样**(契约、边界、协议)
> docs/refactor/n19/ 锁定**怎么落地**(路径、签名、命令、验收)
> 任何冲突以 evolution-docs/ 为准——本目录是它的实施投影,不是反向定义。

## 给 Codex 的工作约定

1. **一次只做一个 phase**。每个 phase 是一份自包含的 prompt pack,会话开始时读对应文件,会话结束时给出 verdict(全部完成 / 部分完成 / 阻塞,各自附产物列表)
2. **严格遵守 forbidden 清单**。本目录每个 phase 都有"不允许动什么"的硬边界,触碰即报告而不是绕开
3. **不改现有 Stage 1 SOP 行为**。Phase 1-4 全部以"附加产物"方式工作,`SKILL.md` / `scripts/check_delivery.js` 的现有判定逻辑不许改语义。新逻辑只能以 *新文件 / 新函数* 形式存在,且通过显式调用接入
4. **不引入新顶层依赖**。所有 phase 用现有 `package.json` 的依赖跑通(node、playwright、ajv、phaser、vite、typescript)。新增 npm 依赖需要单开 RFC,不在任何 phase 范围内
5. **每个 phase 完成时必须**:
   - 跑过该 phase 的"acceptance criteria"小节列出的所有断言
   - 在 `eval/evolution-log.jsonl`(若 Phase 1 已完成)中追加自报告条目
   - 不留任何 `TODO`、`FIXME`、`XXX`,有未尽事项写到 `nonblockingTodos` 风格的 follow-up 列表
6. **遇到契约模糊**:停下来报告,不要凭感觉决定。引用 evolution-docs 中的具体行号,问"这里 N19 没说清,我倾向 X,是否?"

## 阶段速查

| Phase | 文件 | 目标 | 依赖 | 产出 |
|-------|------|------|------|------|
| 1 | [`10-infra.md`](./10-infra.md) | baseline pointer + evolution-log 基础设施 | 无 | 两类新工件 + delivery 钩子 |
| 2 | [`20-router.md`](./20-router.md) | triage router CLI + Stage 2 端到端 POC | Phase 1 | 第一条可跑通的演进切片 |
| 3 | [`30-stages.md`](./30-stages.md) | Stage 3 新增 / Stage 4 深化 / Stage 5 美化 worker | Phase 2 | 四个 stage 全部就位 |
| 4 | [`40-runtime.md`](./40-runtime.md) | mustNot 执行 + 多 subtask 编排 + kick-back 上限 | Phase 3 | 完整运行时语义 |
| - | [`99-accept.md`](./99-accept.md) | 端到端验收清单 | Phase 1-4 | 集成测试通过 |

依赖关系是严格线性的:`1 → 2 → 3 → 4 → 验收`。**不允许跳序**——例如 Phase 3 在 Phase 2 端到端 POC 通过前不允许开工,因为 Stage 3/4/5 worker 是 Stage 2 模板的扩展。

## evolution-docs 锚点对照

实施时频繁需要回查契约。下表把每个 phase 主要触达的 evolution-docs 条款汇总:

| Phase | 主要锚点 |
|-------|---------|
| 1 | [`30-evidence-checkpoints.md` § Baseline Pointer / Evolution Log](../../evolution-docs/30-evidence-checkpoints.md) |
| 2 | [`10-triage-router.md` § 输入 / 输出形状 / 路由判据 / 澄清话术](../../evolution-docs/10-triage-router.md);[`20-stage-boundaries.md` § Stage 2: 修复](../../evolution-docs/20-stage-boundaries.md#stage-2-修复) |
| 3 | [`20-stage-boundaries.md` § Stage 3 / 4 / 5 + 跨 stage 禁止表](../../evolution-docs/20-stage-boundaries.md) |
| 4 | [`30-evidence-checkpoints.md` § acceptance.mustNot](../../evolution-docs/30-evidence-checkpoints.md#acceptancemustnot);[`20-stage-boundaries.md` § Kick-back 协议 / 失败与回滚矩阵](../../evolution-docs/20-stage-boundaries.md#kick-back-协议) |

## 仓内放置约定

实施过程中会引入若干新文件,遵循以下分层:

| 层 | 路径 | 性质 |
|----|------|------|
| 工件 | `cases/<id>/eval/baseline.json`、`cases/<id>/eval/evolution-log.jsonl`、`cases/<id>/eval/baseline-prev*.json` | per-case 演进证据,gitignore 策略由后续决定;本轮**默认不进 git**(沿用现有 `eval/` 行为) |
| 脚本 | `scripts/_baseline_writer.js`、`scripts/_evolution_log.js`、`scripts/triage_router.js`、`scripts/run_evolution.js`、`scripts/_stage_<n>_worker.js`、`scripts/_mustnot_evaluator.js` | 与现有 `scripts/_delivery_runner.mjs` 同级,下划线前缀的是 internal helper,无前缀的是顶层 CLI |
| Schema | 不新增 | 本轮**禁止**新建 `schemas/*.json`;所有新工件用 inline JSON shape 描述,留待后续 mint |
| 文档 | `docs/refactor/n19/` | 本目录,实施 SOP |
| 契约 | `evolution-docs/` | 不动;若实施过程中发现契约不准,**停下来报告**,不就地改 |

## 全局禁止清单

下列动作在任何 phase 都不允许:

- 修改 `evolution-docs/` 任何文件(契约不能被实施反向定义)
- 修改 `SKILL.md` Stage 1 的 Phase A/B/C SOP 语义
- 修改 `schemas/plan.schema.json`(契约形状本轮冻结)
- 修改 `templates/scaffold/`(KEEP scaffold 不变)
- 修改任何 `cases/<id>/` 内既有文件(本轮只读;新工件只允许在 `eval/` 下追加)
- 引入新 npm 依赖
- `git commit` / `git push` / `git checkout`(由人工审核后再决定)

## 运行时配置(Transport)

triage router 在运行期支持两条 transport,实施后默认走 **local deterministic transport**:

| Transport | 何时启用 | 用途 |
|-----------|---------|------|
| **local**(默认) | 不设环境变量,或显式 `--local` | demo / acceptance 用;关键词正则匹配 query → subtask。**仅适合 fixture 测试**,真实用户 query 路由不准 |
| **llm** | `MINI_GAME_EVOLUTION_ROUTER_TRANSPORT=llm` + `OPENROUTER_API_KEY=<key>` | 生产路径;走 case 的 `.game/eval-provider.json` 配置的 LLM(默认 openrouter-api/kimi-k2.6) |

**关键不变量**:**生产环境必须显式开 LLM transport**。`MINI_GAME_EVOLUTION_ROUTER_TRANSPORT` 未设置或非 `llm` 时,router 会回 local fallback——这条对 demo 是合理 trade-off,对真实用户 query 不可靠。

调用约定:

```bash
# Demo / acceptance(deterministic local):
node scripts/run_evolution.js cases/<id> --query "..." --local

# Production(LLM,默认走 case 的 eval-provider 配置):
export OPENROUTER_API_KEY=...
export MINI_GAME_EVOLUTION_ROUTER_TRANSPORT=llm
node scripts/run_evolution.js cases/<id> --query "..."
```

LLM transport 失败时(超时 / HTTP 错 / JSON 解析失败),router 会 retry 一次;再失败则返回 `decision: "reject"`,reason 含 `router LLM unavailable`,不会静默回 local。

## Phase 报告格式

每个 phase 完成时,在 `cases/<demo-case>/eval/evolution-log.jsonl` 追加一条 `phase-report` 记录(若 Phase 1 已落地;否则写到独立日志),并 stdout 输出:

```
[phase-N] STATUS=<done|partial|blocked>
files-created: <列表>
files-modified: <列表>
acceptance-passed: <X / Y>
follow-ups: <列表 或 'none'>
blockers: <列表 或 'none'>
```

人工 review 这个报告后再决定下一 phase 是否开工。

## 术语

本目录术语全部沿用 evolution-docs/[`90-glossary-and-open-questions.md`](../../evolution-docs/90-glossary-and-open-questions.md)。如果某术语在本目录首次出现且 evolution-docs 没定义,说明实施侧引入了新概念——**停下来报告**,不就地造词。
