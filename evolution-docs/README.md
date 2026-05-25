# Evolution Docs

本目录保存 Post-Stage-1 演进层的设计说明。当前设计版本称为 N19，但版本号不进入路径：`evolution-docs/` 是长期说明目录，后续版本在文档内标注，不靠目录名漂移。

这些文档不是 Stage 1 的执行入口，也不是自动接在 Phase C 后面的流程。Stage 1 仍以根目录 `SKILL.md` 为单一真相源，负责 Step 0 -> Phase A -> Phase B -> Phase C 的首轮生成与 delivery smoke。这里说明的是首个可玩交付之后，用户继续提出修改需求时，Stage 2-5 应如何被理解、路由和约束。

## 阅读顺序

| 读者问题 | 起点 |
|---|---|
| 想知道演进层整体是什么 | 本文件，然后读 `10-triage-router.md` |
| 想判断一句用户反馈该怎么拆 | `10-triage-router.md` |
| 想知道 Stage 2-5 各自能改什么 | `20-stage-boundaries.md` |
| 想理解 checkpoint、baseline、mustNot | `30-evidence-checkpoints.md` |
| 想查术语或未决议题 | `90-glossary-and-open-questions.md` |

## 状态

| 文件 | 状态 | 说明 |
|---|---|---|
| `README.md` | implemented-notes | 索引、横向不变量和当前 runtime 状态 |
| `10-triage-router.md` | implemented-notes | 路由器概念接口；代码入口为 `scripts/triage_router.js` |
| `20-stage-boundaries.md` | implemented-notes | Stage 2-5 边界说明；worker 入口为 `scripts/_stage_*_worker.js` |
| `30-evidence-checkpoints.md` | implemented-notes | baseline、checkpoint、mustNot 与 qualityHints 快照 |
| `90-glossary-and-open-questions.md` | draft | 术语单一解释点 |

## 当前实现状态

| 模块 | 已接入的 v1.1 输入 | 当前边界 |
|---|---|---|
| triage router | `plan.json`、delivery/runner summary、baseline summary、`DESIGN.md` anchors / mustAvoid、`decisions.md` source 摘要、`qualityHints`、screenshot 路径/大小 | 本地 fallback 只覆盖可判定关键词；生产 LLM transport 仍需显式启用 |
| baseline / checkpoint | delivery summary、preview summary、artifact pointers、`qualityHintsSummary`、`designSummary`、`decisionSummary` | 支持 delivery baseline 与 preview baseline；不归档完整 `game/` |
| Stage 2 worker | runner/delivery 复现、`acceptance.mustNot`、`DESIGN.md.mustAvoid` | 只做可复现修复；无法复现或会违反 mustAvoid 时失败诚实停 |
| Stage 3 worker | `DESIGN.md` anchors、`decisions.md` B 段追加、v1.1 `derivedFrom` 校验 | 唯一允许 plan shape change；当前 deterministic POC 只覆盖破坏进度与连击进度 |
| Stage 4 worker | `qualityHints.rubric`、visual warnings、LOC 摘要作为 backlog 线索 | 不改契约形状；当前 deterministic POC 只覆盖球速/节奏调参 |
| Stage 5 worker | `qualityHints.visual.warnings` 与 visual metrics before/after | 不改 gameplay 契约；使用文本化 no-regression gate，不做多模态视觉裁判 |

## 横向不变量

1. Stage 1 是单向首交付入口，不接收演进 query，也不是 Stage 2-5 的回流目标。
2. 用户只提交自然语言 query；Stage 2-5 是内部标签，澄清问题必须用游戏领域语言表达。
3. 路由器输出有序 subtask 列表；单 stage 只是列表长度为 1 的特例。
4. 演进从当前 `plan.json`、最近 delivery 或 preview baseline、checkpoint 出发，不创建新的首轮大链路。
5. 当前 runtime 是显式 post-delivery CLI，不自动从 Stage 1 进入，也不新增 `plan.schema.json` 字段。

## 与根入口的关系

`SKILL.md` 继续描述 Stage 1 的可执行 SOP。`AGENTS.md` 和 `README.md` 只把本目录列为首交付后的设计参考，避免把 Stage 2-5 的说明混入 Stage 1 主流程。

## 术语

共享术语只在 `90-glossary-and-open-questions.md` 定义。其他文档首次使用术语时可以链接到该文件，但不重复定义。
