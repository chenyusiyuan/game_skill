# Case Deep Review Prompt

**用途**：一轮 case 走完 5-Stage 流程后，用**新对话窗口的另一个模型**对链路做冷眼深 review。不是 Phase 中间用的"快看一眼"，是 Stage 5 收尾的结构化复盘。

**什么时候用这份 prompt**：

- Case 跑完 `verify_all` 全绿 or 关键 check 全绿后
- 跑 case 的模型已经写完 Stage 5 收尾报告
- 你准备决定"要不要升 anchor、要不要登记 pattern、要不要改协议"

**什么时候不用**：

- Phase 中间失败反复——那叫 [中间 intervention](#中间-intervention-prompt-附)，短得多
- 单元测试 / L1-L3 通过验证——那是 `iteration_testing_protocol.md` 的职责

---

## 主 Review Prompt（复制给新会话）

```
我刚跑完一个 case，需要你做冷眼深 review。你没参与过这一轮的任何改动，
我希望你从结果倒推，看链路真正暴露了什么。

## 先读以下文件（必读，不要跳）

1. eval/protocols/case_driven_iteration_flow.md —— 这一 case 所遵循的协议
2. eval/protocols/iteration_testing_protocol.md —— 测试分层协议
3. cases/<CASE-SLUG>/INTENT.md —— 本 case 的意图
4. cases/<CASE-SLUG>/failures/*.md —— 所有 failure attribution
5. cases/<CASE-SLUG>/eval/report.json —— verify_all 的最终产物
6. cases/<CASE-SLUG>/docs/game-prd.md + specs/*.yaml + game/index.html 的前 200 行
7. git log --since "<case 开始时间>" --oneline —— 本轮的 commit 列表
8. git diff <case 开始 commit>..HEAD --stat —— 本轮改了多少文件
9. .pipeline_patterns.md（如果存在）—— 历史模式记录

## 不要做

- 不要改任何源码
- 不要改 PRD / specs
- 不要 commit
- 不要更新 baseline
- 不要在 review 过程中启动新的 check / verify_all

## 必须做

按下面 6 个维度逐项回答。每个维度给"结论 + 证据 + 建议"。
证据必须引用具体文件路径或 check 名。

### 维度 1：链路完整性

- 本 case 的 Phase 1-5 是否真的全部跑过？
- report.json 里每一 check 的 exit_code 分别是什么？
- 有无任何 check 被跳过但没有在 INTENT.md 里预先记录为"预期 skip"？
- 结论: PASS / PARTIAL / FAIL；证据:____；建议:____

### 维度 2：覆盖充分度

对照 iteration_testing_protocol.md 的 §2 决策表里列出的 blast layers，
以及本 case INTENT.md 里预期覆盖的范围：

- 本 case 真的走过哪些层？（逐一列出）
- 哪些层没被触达？
- 对原定的"覆盖目标"是否达成了 80% 以上？
- 结论:____；证据:____；建议:____

### 维度 3：修复质量审查

读所有 failures/*.md 和 git log，看本轮产生的修复：

- 每一个修复的起源层分别是什么？有没有 symptom-level patch 漏网？
- 有没有"为了让这个 case 过而放宽全局 checker"的痕迹？（这是反模式）
- 有没有一个 commit 跨了 3+ 层？（应该拆）
- 修复是真正消除了根因，还是加了新的规则/豁免？
- 结论:____；证据:____；建议:____

### 维度 4：协议执行度

- 跑 case 的模型是否严格遵守 case_driven_iteration_flow.md 的 5 Stage？
  是否在每个 Phase 停下等授权？
- Failure Attribution 是否每次都先于修复？质量如何（敷衍 / 合格 / 深入）？
- 有没有直接跳到 Phase 5 跑 e2e 的情况？
- 协议里哪些条款这一轮**没有被模型使用到**？可能是冗余，也可能是该用没用。
- 结论:____；证据:____；建议:____

### 维度 5：模式抽象信号

- 本 case 内部有没有同类失败出现 2+ 次的 pattern？（参见 case_driven_iteration_flow.md Stage 4）
- 这个 pattern 如果算上历史 .pipeline_patterns.md 里已有的，累计多少次？
- 到 3 次没有？到了应该做哪种抽象升级（新 primitive / 新 checker / schema / Phase gate）？
- 建议追加到 .pipeline_patterns.md 的具体行（逐字给出）：
- 结论:____

### 维度 6：anchor 升级判断 + 协议迭代

- 本 case 是否够格升为 cases/anchors/ 下的 anchor？judging criteria:
  a) check 全绿（或有合理的 ok-skip）
  b) 覆盖一个 iteration_testing_protocol.md 里尚未有 anchor 的 genre/engine 组合
  c) baseline 语义清晰，未来 diff 有参考意义
  d) 产物里没有明显的 tech debt（硬编码 magic number、临时 workaround 等）
- 如果不够，差什么？
- 本轮跑完后，协议（iteration_testing_protocol / case_driven_iteration_flow）
  是否有条款需要修订？列出具体建议（不要改，只提议）。
- 结论:____；证据:____；建议:____

## 回复格式

最后一段必须包含:

### Overall Verdict

- 本 case 健康度评分 (1-10): __
- 建议下一步:
  [ ] 可以 merge / 可以升 anchor
  [ ] 需要在 X 层补 Y 才能 merge
  [ ] 需要先抽象升级 Z 才能继续跑新 case
  [ ] 协议需要修订，列出要改的具体条款
- 风险提示 (如有): ____

## 禁止行为（再次强调）

- 你不得说 "大体上都过了" "整体还不错" —— 必须给分项证据
- 你不得替我做决策 —— 6 个维度都给建议但不要直接动手
- 你不得为了态度友好而软化判断 —— 红就是红
- 你不得猜测没读到的文件 —— 读不到就说"未能访问 X"

开始 review。
```

---

## 使用步骤

1. 把 `<CASE-SLUG>` 替换为实际 case 目录名（如 `whack-a-mole-pixijs-min`）
2. 把"`<case 开始时间>`" / "`<case 开始 commit>`"替换为真实值（从 INTENT.md 的日期或 git log 找）
3. 开一个**完全新的对话窗口**（不要在跑 case 的那个模型里续，也不要在你和我这个对话里续）
4. 粘贴整段，发送
5. Review 模型产出 6 维度 + verdict
6. 你读完，决定采纳哪些建议

---

## 中间 intervention prompt（附）

如果 case **跑到一半某个 Phase 连续失败 3+ 次**，用这个**短**的 prompt 让新模型介入判断（而不是等 Stage 5）：

```
cases/<CASE-SLUG>/failures/ 下已有 3+ 份 failure analysis，
时间戳最近的是 <YYYY-MM-DD HH:MM>。

读完后回答 3 个问题，每个限 2 句话：

1. 这 3 次失败是否有共同的起源层？原分析的定位准不准？
2. 如果准：为什么已经定位到起源层却还在反复失败？是修复方式不对，
   还是起源层之下还有更深的原因？
3. 如果不准：真正的起源层应该是哪里？

不读协议文件，不读源码，只读 failures/*.md。3 分钟内给我答案。
```

---

## Changelog

- 2026-04-28 初版。两种 prompt：主 review（Stage 5 深复盘）+ 中间 intervention（反复失败时换视角）
