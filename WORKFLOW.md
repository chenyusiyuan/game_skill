# WORKFLOW — 跑 case 快速核查卡

**用途**：1 分钟上手的操作卡。详细协议在 `eval/` 下。

**详细协议路径速查**：
- 跑 case 总流程：`eval/protocols/case_driven_iteration_flow.md`
- 测试分层：`eval/protocols/iteration_testing_protocol.md`
- Phase Gate Reviewer（会话 B）：`eval/reviews/phase_gate_reviewer.md`
- Deep Review（会话 C）：`eval/reviews/case_deep_review.md`
- 模式记录：`.pipeline_patterns.md`

---

## 四会话分工

| 会话 | 身份 | 启动 prompt | 生命周期 |
|---|---|---|---|
| **A** | 跑 case 执行模型 | `eval/cases/<slug>.md` 的 PROMPT TO MODEL 段 | Stage 0 → Stage 5 |
| **B** | Phase Gate Reviewer（驻留）| `eval/reviews/phase_gate_reviewer.md` 的 DRIVER MESSAGE 段 | 跟 A 同进退 |
| **C** | Deep Review / Intervention | `eval/reviews/case_deep_review.md` | 仅 Phase 5 / 反复失败时 |
| **D** | Skill Fixer | `eval/reviews/phase_gate_reviewer.md` 末尾的会话 D prompt | 仅 SYSTEMATIC 触发 |

---

## 5 步启动

1. **A 启动**：开新会话，贴 `eval/cases/<slug>.md` 的 PROMPT TO MODEL 段
2. **A 跑 Stage 0**：产出 `cases/<slug>/INTENT.md` 后停下
3. **B 启动**：开新会话，贴 `eval/reviews/phase_gate_reviewer.md` 的 DRIVER MESSAGE 段（替换 `<CASE-slug>`）
4. **B 返回驻留待命报告**：确认读到 `.pipeline_patterns.md` 与 INTENT.md
5. **授权 A 进 Phase 1+2**：开跑

---

## 每 Phase 完成的决策树

```
会话 A 跑完 Phase N，贴 check exit + 产物摘要
   ↓
你切到会话 B，发 "Phase N 完成"
   ↓
B 返回 Verdict（含 Blocker 分类）
   │
   ├─ 全绿 ──────────→ A 授权 Phase N+1
   │
   ├─ 只 CASE-LOCAL ──→ A 修产物（docs/ specs/）
   │                    → 追加 .pipeline_patterns.md 一行
   │                    → A 重跑 Phase N check
   │                    → B 再发 "Phase N 完成"
   │
   ├─ 有 SYSTEMATIC ──→ 停 A
   │                    → 开 D 修 skill（game_skill/skills/）
   │                    → D 跑 L1+L2 单元测试
   │                    → D commit（独立，不提 case）
   │                    → A 重跑 Phase N
   │                    → B 再发 "Phase N 完成"
   │
   ├─ 失败 ≥3 次同层 ──→ 开 C，贴中间 intervention prompt
   │
   └─ Phase 5 完成 ────→ 发 "升级 deep review"
                         → 开 C，贴主 Review prompt
```

---

## Blocker 分类速查

| 信号 | 分类 | 动作 |
|---|---|---|
| 本 case 第 1 次命中 + 跨 case 累计 < 3 | **CASE-LOCAL** | 修 case 产物，继续 |
| 本 case 内第 2+ 次 | **SYSTEMATIC** | 停 case，修 skill |
| 跨 case 累计 ≥ 3 次 | **SYSTEMATIC** | 停 case，修 skill |
| 明显 skill 设计缺陷（如 codegen 漏 cp 步骤）| **SYSTEMATIC** 即使第 1 次 | 停 case，修 skill |

**Blocker vs Debt**：
- **Blocker** = 不修下一 Phase 输入就坏，必须当场处理
- **Debt** = 下一 Phase 能继续跑但产物不够理想，Stage 5 集中处理
- **伪 Debt**（需升 Blocker）= 信息缺失伪装成 "表达不精"，如漏 @entity 状态字段

---

## 在会话 B 的信号短语

- `Phase 1+2 完成` / `Phase 2.5 完成` / `Phase 3.0 完成` / `Phase 3.x 完成` / `Phase 4 完成` / `Phase 5 完成`
- `Phase N 第 M 次失败，看下`
- `升级 intervention`
- `升级 deep review`

---

## 绝对不做

- 🔴 跳过 Phase Gate Reviewer 直接进下一 Phase
- 🔴 把 SYSTEMATIC 降级为 CASE-LOCAL 让 case 跑得快
- 🔴 同会话里让跑 case 的模型自己 review 自己（局中人偏见）
- 🔴 Phase N+1 前没绿就先开跑
- 🔴 SYSTEMATIC commit 里混着 case 产物改动
- 🔴 Debt 不登记、不追加 DEBT.md
- 🔴 同类 Blocker 第 3 次还继续打 CASE-LOCAL 补丁
- 🔴 为让某个 check 过而放宽 checker 规则

---

## 常见故障排查

| 现象 | 大概率原因 | 处理 |
|---|---|---|
| B 返回 "驻留待命" 说 INTENT 缺失 | A 还没跑 Stage 0 | 先让 A 跑 Stage 0，再启 B |
| B 标所有 Blocker 都是 SYSTEMATIC | `.pipeline_patterns.md` 历史太满 | 打开核对，陈旧的标已抽象升级行，减少影响 |
| A 跑 Phase N+1 后发现 Phase N 产物有错 | 当初 B 漏判 | 补 pattern 登记，按协议重跑 Phase N+1 前先补 Phase N 修复 |
| D 修 skill 后 L1 测试挂了 | 改动跨层 | 按 `iteration_testing_protocol.md` 决策表拆小 commit，逐层验 |
| C intervention 说"起源层定位错了" | A 的 Failure Attribution 质量差 | 回 A，要求重写 analysis 加细节 |

---

## Stage 5 收尾（case 跑完后）

1. 全 Phase 绿 → 会话 B 发 "升级 deep review"
2. 开会话 C，贴 `eval/reviews/case_deep_review.md` 主 Review prompt
3. C 返回 6 维度 verdict + Overall Verdict 评分
4. 根据 verdict 决定：
   - 升 anchor：`cp -r cases/<slug> cases/anchors/<slug>-min/` + 冻 baseline
   - 修 Debt：逐条评估 DEBT.md，执行或删除
   - 改协议：按 C 的建议修订 `eval/protocols/*`
5. 关闭 B 和 C，A 可保留作参考

---

## 每日 hygiene

- 保证 `.pipeline_patterns.md` 累计次数准确（reviewer 严重依赖这份数据）
- `cases/<slug>/DEBT.md` 每轮都更新
- 若协议修订了，对应 `Changelog` 追加一行日期 + 变更点

---

## 与其他文档的关系

本文件 = **操作卡**（1 分钟上手）
`eval/README.md` = **目录导航 + 路由指南**（中等详细）
`eval/protocols/*.md` = **完整协议**（详细规则 + 反模式）
`eval/reviews/*.md` = **Agent prompt**（可直接复制喂模型）

遇到模糊情况 → 往下翻一级：WORKFLOW → eval/README → eval/protocols → eval/reviews。

---

## Changelog

- 2026-04-28 初版。覆盖 4 会话分工 + 启动 checklist + per-Phase 决策树 + CASE-LOCAL/SYSTEMATIC 分类 + 常见故障排查。
