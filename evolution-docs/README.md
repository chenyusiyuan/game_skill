# Evolution Docs

本目录保存 Post-Stage-1 演进层的设计说明。当前设计版本称为 N19，但版本号不进入路径：`evolution-docs/` 是长期说明目录，后续版本在文档内标注，不靠目录名漂移。

这些文档不是 Stage 1 的执行入口，也不是新的自动流程。Stage 1 仍以根目录 `SKILL.md` 为单一真相源，负责 Step 0 -> Phase A -> Phase B -> Phase C 的首轮生成与 delivery smoke。这里说明的是首个可玩交付之后，用户继续提出修改需求时，Stage 2-5 应如何被理解、路由和约束。

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
| `README.md` | draft | 索引和横向不变量 |
| `10-triage-router.md` | draft | 路由器概念接口，不是 schema |
| `20-stage-boundaries.md` | draft | Stage 2-5 边界说明 |
| `30-evidence-checkpoints.md` | draft | 证据和 checkpoint 说明 |
| `90-glossary-and-open-questions.md` | draft | 术语单一解释点 |

## 横向不变量

1. Stage 1 是单向首交付入口，不接收演进 query，也不是 Stage 2-5 的回流目标。
2. 用户只提交自然语言 query；Stage 2-5 是内部标签，澄清问题必须用游戏领域语言表达。
3. 路由器输出有序 subtask 列表；单 stage 只是列表长度为 1 的特例。
4. 演进从当前 `plan.json`、最近 delivery 证据、checkpoint 出发，不创建新的首轮大链路。
5. N19 只说明设计，不新增 schema，不实现 runner，不改 case。

## 与根入口的关系

`SKILL.md` 继续描述 Stage 1 的可执行 SOP。`AGENTS.md` 和 `README.md` 只把本目录列为首交付后的设计参考，避免把 Stage 2-5 的说明混入 Stage 1 主流程。

## 术语

共享术语只在 `90-glossary-and-open-questions.md` 定义。其他文档首次使用术语时可以链接到该文件，但不重复定义。
