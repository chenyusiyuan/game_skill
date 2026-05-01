---
name: codex-adaptation
description: "Game Skill 的 Claude Code 版本与 Codex 版本差异对照表。修改 SKILL.md 时对照更新 SKILL-codex.md。"
---
# Codex 适配指南
## 职责
本文档记录 Game Skill 在 Codex 运行时的适配规则。
维护人每次修改 `SKILL.md` 时，按本文档列出的 4 类替换规则，同步更新 `SKILL-codex.md`。
`SKILL.md` 是 Claude Code 版本入口；`SKILL-codex.md` 是 Codex 版本入口。
两份入口文档必须保持同一条生成链路、同一批 SOP 子文档、同一批 check 脚本、同一批 schema。
Codex 适配只处理运行平台差异，不改变游戏生成语义。
如果修改不涉及本文列出的 4 类耦合面，Codex 版应照搬同样的 SOP 文字。
如果修改涉及本文列出的 4 类耦合面，Codex 版只在对应句子上做平台降级替换。
不要把本文件扩展成新的抽象层，也不要把本文件当作第二套 SOP。
## 共享资产（不需要任何修改）
- 所有 SOP 子文档: `expand.md` / `codegen.md` / `verify.md` / `stage-roadmap.md` / `iteration.md` / `patch-codegen.md`
- 所有澄清与策略文档: `clarify.md` / `semantic-clarify.md` / `spec-clarify.md` / `design-strategy.md` / `prd.md` / `strategy.md` / `delivery.md`
- 所有 check 脚本: `game_skill/skills/scripts/*.js`
- 所有 schema: `game_skill/skills/schemas/*.json`
- 所有 engine templates: `game_skill/skills/references/engines/*`
- 所有 common references: `game_skill/skills/references/common/*`
- `cases/` 目录结构、产物格式、`.game/state.json` 结构
- Phase 1 到 Phase 5、Stage 1 到 Stage 5、preserve lock、verify gate 的语义
## 仅在 SKILL.md ↔ SKILL-codex.md 之间需要对齐的 4 类替换
### 替换 1: 子 agent 调用
涉及位置:
- `SKILL.md` §60-65: Coze 到平台能力映射表
- `SKILL.md` §69-74: 子 agent 注册说明
- `SKILL.md` §460: `game-mechanic-decomposer` 调用
- `SKILL.md` §507: `game-gameplay-expander` 调用
Claude Code 版语义:
```text
发起一个 Agent 调用（subagent_type: game-mechanic-decomposer），prompt：
```
Codex 版替换为:
```text
在 Codex 当前会话内内联执行以下 prompt（Codex 没有子 agent 类型概念；把 prompt 作为子任务文本输入主模型上下文，执行完收集产物再继续）：
```
Claude Code 版可以依赖 agent 注册文件；Codex 版不依赖 agent 注册文件。
Codex 版的角色切换通过 prompt 明确声明。
Codex 版仍保留角色名:
- `game-mechanic-decomposer`
- `game-gameplay-expander`
- `game-engine-codegen`
- `game-game-checker`
这些角色名只作为任务边界和输出契约提示，不代表真实独立进程、隔离上下文或注册文件。
Codex 内联执行时，prompt 开头建议显式写:
```text
现在切换为 game-gameplay-expander 角色。
你只处理本次维度，不重写其他维度。
```
返回 JSON 契约不变。
`status` 字段处理不变。
`markPhase` / `markSubtask` 状态写入不变。
禁止读取文件清单不变。
禁止跨阶段提前启动不变。
### 替换 2: 用户提问工具
涉及位置:
- `SKILL.md` §258: Phase 1 clarify 必问
- `SKILL.md` §264: Phase 1 至少发起澄清
- `SKILL.md` §265: Phase 1 semantic clarify 合并提问
- `SKILL.md` §269: Phase 1 引擎选择
- `SKILL.md` §339: Phase 2.5A / 2.5B 提问预算
- `SKILL.md` §353: Phase 2.5A spec clarify
- `SKILL.md` §407: Phase 2.5B design strategy
- `SKILL.md` §697: feedback 分类不确定
- `SKILL.md` §720: ambiguous 分类矩阵
- `SKILL.md` §806: 禁止跳过引擎选择
- `SKILL.md` §824: 端到端示例
Claude Code 版语义:
```text
用 AskUserQuestion 工具（读 clarify.md 的问题模板）；每轮最多 3 问
```
Codex 版替换为:
```text
用纯文本向用户提问（格式：编号 Q1/Q2/Q3，每题带 A/B/C 选项，description 末尾带“推荐”标识；读 clarify.md 的问题模板）；每轮最多 3 问；等待用户按 Q1-A Q2-B 或自由文本格式回答
```
Claude Code 版语义:
```text
用 AskUserQuestion 一次性最多问 4 个问题
```
Codex 版替换为:
```text
用纯文本编号提问，一次性最多问 4 个问题
```
Claude Code 版语义:
```text
AskUserQuestion 工具会自动提供 Other 入口
```
Codex 版替换为:
```text
在每组选项后显式加一条 D. 其他（自由输入）
```
Claude Code 版语义:
```text
禁止手动添加“让我决定”
```
Codex 版替换为:
```text
不必在选项里加“让我决定”；若用户未作答视为取推荐项
```
Codex 纯文本问题格式建议:
```text
Q1. 目标引擎
A. Phaser 3 - 适合控制闯关物理型（推荐）
B. PixiJS v8 - 适合棋盘格子和粒子视觉
C. Canvas 2D - 适合规则清晰的轻量玩法
D. 其他（自由输入）
```
用户标准回答格式:
```text
Q1-A Q2-B
```
用户也可以自由文本回答。
如果用户只回答部分题目，未回答题目取推荐项。
如果用户沉默但继续要求推进，未回答题目取推荐项。
如果用户说“你决定”或“让我决定”，按推荐项执行。
所有默认选择仍要写入对应文档的 assumptions / ClarifiedBrief。
### 替换 3: 并发子 agent
涉及位置:
- `SKILL.md` §507: Phase 3.x 同一 turn 内并发 5 个 expander
Claude Code 版语义:
```text
同一 turn 内并发发起 5 个 Agent 调用（subagent_type 都是 game-gameplay-expander）
```
Codex 版替换为:
```text
顺序执行 5 次（Codex 不支持真并发；按 scene / rule / data / assets / event-graph 顺序分别跑 5 次 expander 任务，每次的产物写入 specs/.pending/ 后进入下一次）
```
Codex 顺序固定为:
1. `scene`
2. `rule`
3. `data`
4. `assets`
5. `event-graph`
顺序执行的原因是平台能力差异，不是链路语义变化。
每次 expander 仍只负责一个维度，并写入 `specs/.pending/`。
每次 expander 完成后才进入下一次，并由主模型调用 `markSubtask`。
5 个 pending 文件全部完成后，后续 freeze / check 语义不变。
时间成本预计比 Claude Code 并发版更高，产物一致性目标不变。
### 替换 4: Coze → 平台映射表
Claude Code 版表:
| Coze 原用法 | Claude Code 等价 |
|---|---|
| `task_new({agent_role, task})` | `Agent({subagent_type: "game-<agent_role>", prompt: task})` |
| `context: fork` | CC agent 通过 prompt 接收完整上下文，无 "fork" 概念 |
| `task_done` | 工具调用自然返回即可 |
| `multi_read` | CC 没有 multi_read；同一 message 里多个 `Read` 并行调用即可 |
| `.game/state.json` | 仍用（CC 对状态文件无要求，但我们用它来跨会话恢复） |
Codex 版表:
| Coze 原用法 | Codex 等价 |
|---|---|
| `task_new({agent_role, task})` | 内联执行子任务（Codex 无子 agent 类型概念，把 prompt 作为子任务文本输入主模型上下文） |
| `context: fork` | Codex 无 fork 概念；子任务通过 prompt 接收完整上下文 |
| `task_done` | 任务执行完自然返回 |
| `multi_read` | Codex 支持 multi_read；同一 message 多文件读取 |
| `.game/state.json` | 仍用（用于跨会话恢复） |
Claude Code 版注册说明:
```text
子 agent 在 ~/.claude/agents/ 下注册为：
```
Codex 版注册说明:
```text
子 agent 定义（仅作角色划分，Codex 内联执行，不需注册文件）：
```
Codex 版追加说明:
```text
Codex 不需要子 agent 注册文件；上述角色只是 prompt 划分，主模型按角色切换执行。
```
## 维护流程
修改 `SKILL.md` 时:
1. 定位修改是否涉及 4 类耦合面之一。
2. 是 → 按本文档对应替换规则同步改 `SKILL-codex.md`。
3. 否 → `SKILL-codex.md` 照搬改动（纯 SOP 文字）。
4. 提交时 commit message 含 `[codex-sync]` 提示。
推荐检查命令:
```bash
grep -c "subagent_type" game_skill/skills/SKILL-codex.md
grep -c "AskUserQuestion" game_skill/skills/SKILL-codex.md
grep -c "Claude Code" game_skill/skills/SKILL-codex.md
grep -c "Codex" game_skill/skills/SKILL-codex.md
```
期望结果:
- `subagent_type` 为 0
- `AskUserQuestion` 为 0
- `Claude Code` 小于等于 3
- `Codex` 大于等于 10
章节顺序检查:
```bash
grep -E "^#{1,3} " game_skill/skills/SKILL.md
grep -E "^#{1,3} " game_skill/skills/SKILL-codex.md
```
两个输出的层级顺序应一致；标题和首要原则可从 Claude Code 改为 Codex。
## 已知 Codex 降级点
- 无真并发: §507 原 5 个 expander 并行 → 顺序 5 次，时间可能接近原来的 5 倍。
- 无交互气泡: 选项 UI 降级为纯文本编号选择题。
- Other 入口变化: 需要显式写 `D. 其他（自由输入）`。
- 无子 agent 上下文隔离: Codex 主模型上下文会累积所有角色历史，prompt 开头应声明当前角色。
- 任务结束方式变化: 子任务执行完自然返回，不依赖独立 task_done。
- 状态文件、check 脚本、schema 语义不变。
## 不要做的事
- 不复制 SOP 子文档（`expand.md` 等），它们平台无关，两版共用一份。
- 不修改 check 脚本兼容 Codex，脚本是 Node 程序，Codex 直接用 bash 跑。
- 不修改 schema、engine templates、case 产物结构、`cases/` 或 `data_analysis/`。
- 不抽象中间层，方案 A/B 已否决，方案 C 维护负担最低。
- 不在 Codex 入口里保留 `subagent_type` 或 `AskUserQuestion` 字符串。
- 不把顺序 expander 写成并发 expander。
- 不把纯文本问题写成工具调用。
## 回归基线
本批 Codex 适配的回归基线 case:
```text
cases/whack-a-mole-pixijs-min
```
回归命令:
```bash
node game_skill/skills/scripts/verify_all.js cases/whack-a-mole-pixijs-min --profile whack-a-mole-pixijs-min --no-write
```
预期:
- 命令不 crash。
- 行为与适配前一致。
- 如果 failures gate 拦截，保持原拦截结果。
- 不因为新增 `SKILL-codex.md` 或 `CODEX-ADAPTATION.md` 改变 case 文件。
## 同步检查清单
- `game_skill/skills/SKILL.md` 零改动。
- `game_skill/skills/SKILL-codex.md` 存在且行数与 `SKILL.md` 接近。
- `game_skill/skills/CODEX-ADAPTATION.md` 存在且保持在 150-350 行。
- SOP 子文档、check 脚本、schema、`cases/`、`data_analysis/` 零改动。
- git diff 只包含新增两份文件。
