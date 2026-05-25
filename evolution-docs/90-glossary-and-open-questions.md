# Evolution Docs · Glossary And Open Questions

本文是演进说明的术语单一解释点。其他文档不要重复定义这些术语。

## Glossary

| 术语 | 定义 |
|---|---|
| Stage 1 | 首轮生成入口，执行 Step 0 -> Phase A -> Phase B -> Phase C |
| Stage 2 | 修复现有行为与预期不一致的问题 |
| Stage 3 | 新增当前体验中没有的机制、规则或正向验收 |
| Stage 4 | 深化已有玩法的手感、节奏、平衡、反馈或内容数据 |
| Stage 5 | 美化视觉、听感、布局、资源和渲染表达 |
| triage router | 把自然语言 query 拆成有序 subtask 的概念组件 |
| subtask | 一次演进 query 中的最小可执行子意图 |
| `specImpact` | subtask 对 `plan.json` 契约形状的影响等级 |
| `spec-correction` | 修正现有约束、补 mustNot、修 repro 证据、显式化已隐含约束 |
| `spec-shape-change` | 新增 entity/action/rule/control/win-lose/mustHave |
| `expectedArtifacts` | 执行前 blast radius 声明，不是执行后 diff |
| checkpoint | subtask 后的可回滚交付点，不等于 git commit |
| baseline pointer | 指向最近可接受交付证据集合的轻量记录 |
| preview baseline | 指向最近可试玩版本的轻量记录；游戏能启动，但 delivery evidence 可能未通过 |
| preview handoff | Stage 1 结束后给用户的玩法、操作、检查摘要和继续迭代引导 |
| kick-back | worker 发现 stage 不匹配后，回滚该 subtask 并交回 triage 的信号 |
| evolution iteration | 用户一次演进 query 及其所有 subtask 的完整处理过程 |
| conflict | 两个 subtask 预期影响重叠且语义方向相反 |
| clarification turn | 用领域语言向用户澄清冲突或模糊意图的一轮问答 |
| regression gate | 合并演进结果前必须证明旧机制未退化的验证门 |
| `dependsOn` | subtask 的逻辑依赖关系，不是并发调度承诺 |

## Open Issues Registry

| ID | 问题 | N19 落点 | 状态 |
|---|---|---|---|
| A | baseline pointer | `30-evidence-checkpoints.md` | implemented minimal |
| B | `mustNot` 执行 | `30-evidence-checkpoints.md` | implemented in Stage 2-5 workers |
| C | 冲突检测 | `10-triage-router.md` | design only |
| D | kick-back 协议 | `20-stage-boundaries.md` | implemented minimal |
| E | 演进迭代追踪 | `30-evidence-checkpoints.md` | implemented minimal |
| H | preview handoff | `30-evidence-checkpoints.md` | implemented minimal |
| F | subtask 并发 | deferred | v2 topic |
| G | 用户结构化输入 | `10-triage-router.md` | deferred |

## Deferred

N19 不处理 subtask 并发。Stage 5 未来可以物理异步执行，但合并前仍要通过逻辑依赖和回归门。当前说明按串行理解，避免一开始就把调度复杂度引入演进层。

N19 不支持结构化用户输入。用户只提交自然语言 query；结构化输入、表单化 issue 或显式多 stage 选择都留给后续设计。

N19 不定义新 schema。所有字段名都是设计接口术语，不是机器校验契约。

## Versioning

`evolution-docs/` 是长期目录。N19 是当前文档内容版本。后续若只是补充说明，可以原地更新；若改变核心边界，例如允许 Stage 5 并发合并或改变 specImpact 权限，应在文档中标明 future 变更点，并同步更新根入口指针。
