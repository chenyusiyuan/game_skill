# eval/ — 生成链路评估与协议目录

本目录统一存放**跑 case、review 链路、推进重构**所需的参考资料。不在此目录内的 md 文件应视为临时产物或不再维护的归档。

---

## 目录结构

```
eval/
├── README.md                              ← 本文件：目录导航 + 何时用哪份
├── protocols/                              ← 稳定的测试/迭代协议
│   ├── iteration_testing_protocol.md         — L1–L6 分层测试协议（改代码用）
│   └── case_driven_iteration_flow.md         — 5-Stage case 驱动流程（跑真实 case 用）
├── design/                                 ← 原始方案 + 审计报告
│   ├── 生成层重构.md                         — P0/P1/P2 生成层重构原方案
│   ├── 素材层重构.md                         — 素材层重构原方案（未动工）
│   └── asset_chain_baseline_audit.md        — catalog 语义审计报告
├── todos/                                  ← 已识别但推迟的工作
│   ├── three_engine_todo.md                 — P3-C three 引擎收编（阻塞：无 fixture）
│   └── profile_tri_bucket_migration_todo.md — profile 三分类迁移（已完成，存档）
├── cases/                                  ← 每个 case 的启动 prompt
│   └── whack_a_mole_pixijs.md               — 当前计划跑的 case prompt
└── reviews/                                ← Review prompt 模板
    └── case_deep_review.md                  — Stage 5 深 review + 中间 intervention
```

---

## 快速路由：我现在想做什么？

### 我要改代码 / 改 skill prompt / 改 schema

→ 读 `protocols/iteration_testing_protocol.md`

查决策表（§2）找本次改动的 blast layer → 按顺序跑对应测试 → 不跳步。

### 我要跑一个真实 case（PRD → game）

→ 读 `protocols/case_driven_iteration_flow.md`
→ 找 `cases/` 里匹配的 prompt 文件 → 开新会话执行。

如果没有匹配的，看"想跑但没有 prompt"的处理方法（本文档后段）。

### Case 跑完了，要深 review

→ 读 `reviews/case_deep_review.md`
→ 开**另一个**新会话执行（不要在跑 case 的会话续）。

### 某个 Phase 连续失败 3+ 次

→ 读 `reviews/case_deep_review.md` 的"中间 intervention prompt"段
→ 短 prompt，3 分钟内给判断。

### 我要决策下一步做哪个重构

→ 读 `design/` 下相关方案原稿
→ 读 `todos/` 看哪些已登记
→ 读 `.pipeline_patterns.md`（如存在）看近期趋势

### 我想看历史上的抽象升级是怎么触发的

→ `design/生成层重构.md` 是典型例子（3 次+ 补丁 → 升级到 primitive runtime + schema + P2 可玩性层）

---

## 文件的生命周期规约

### protocols/ — 长期稳定

这里的文件是**链路操作的真值**。任何修改必须：

- 有实战驱动（跑过 case 发现协议不够用）
- 在 case_driven_iteration_flow.md Stage 5 的"协议迭代"部分有记录
- 文件末尾追加 changelog 行

**禁止**：未经实战直接改协议；模型自主改协议不经用户授权。

### design/ — 归档

原方案文档一旦落地不再修改。作为历史参考。新方案建新文件（如未来 `素材层重构v2.md`）。

### todos/ — 活跃但推迟

每份 TODO 必须有前置依赖说明。完成后有两种处理：

- 删除（简化）
- 改文件头标记 `DONE <date> at commit <hash>`（存档）

任一处理都可，团队统一即可。

### cases/ — 启动 prompt

每个 case 一份 prompt。命名建议：`<genre>_<engine>.md`（如 `whack_a_mole_pixijs.md`）。

prompt 跑完**不删**——作为 case 的起点溯源。

对应的 case **实际产物**（PRD / specs / game / eval）不放在本目录，放在项目根的 `cases/<slug>/`。

### reviews/ — 模板

review 的 prompt 模板。review 的**结果**应该存在对应 case 的目录，或写入 `.pipeline_patterns.md`。

---

## 想跑但没有 prompt 怎么办

选项 A：**套用最相近的现有 case prompt**

- 复制 `cases/whack_a_mole_pixijs.md`
- 改 case 基本信息段（项目目录 / 引擎 / genre / 玩法）
- 改覆盖矩阵段（哪些 primitive 命中）
- 保留"PROMPT TO MODEL"的执行纪律段（这部分通用）

选项 B：**让我（用户）手写 case 意图**，然后要求模型按 template 生成 prompt

```
请参考 eval/cases/whack_a_mole_pixijs.md 的结构，为下列 case 生成启动 prompt:
- 引擎: ___
- 玩法描述: ___
- genre: ___
- 覆盖重点: ___
保存到 eval/cases/<slug>.md
```

---

## 协议之间的关系

```
┌─────────────────────────────────────┐
│ case_driven_iteration_flow.md       │  ← 跑真实 case 时的总协议
│                                      │
│ Stage 1 分阶段 e2e 时 —→─┐           │
│                        ↓           │
│       ┌───────────────────────────┐ │
│       │ iteration_testing_       │ │  ← 每一步"该跑哪些测试"的具体指南
│       │   protocol.md            │ │
│       │ (L1 单元/L2 契约/L3 单   │ │
│       │  case 单层/L4 单 case    │ │
│       │  全链/L5 全锚/L6 diff)   │ │
│       └───────────────────────────┘ │
│                                      │
│ Stage 5 收尾时 ——→─┐                │
│                  ↓                  │
│       ┌───────────────────────────┐ │
│       │ reviews/case_deep_review │ │  ← 深 review prompt
│       └───────────────────────────┘ │
└─────────────────────────────────────┘
```

两份协议**配合使用**：

- `case_driven_iteration_flow` = 全局节奏（按 Phase 分阶段、起源层修复、模式抽象）
- `iteration_testing_protocol` = 每个节拍的"具体跑什么命令" + "失败解读"

任何时候只读一份都会漏。

---

## 反模式（整个 eval 体系要避免的）

任一出现 → 停下检讨：

- 🔴 **在 Phase 结束时叫 deep review 模型**：浪费，Phase 间快 review 应该你自己 3 分钟搞定
- 🔴 **跑 case 的会话和 review 会话是同一个**：review 失去冷眼价值
- 🔴 **协议文件在 case 跑完后频繁修订**：协议应该在至少 2-3 个 case 后才修；单 case 的偏差不足以动协议
- 🔴 **新开 case 不复用协议**：每次都要重建纪律，浪费时间
- 🔴 **pipeline_patterns 登记敷衍**：未来的抽象升级依赖这份记录的准确度
- 🔴 **todos/ 无限堆积**：超过 5 条还没推进，说明优先级机制失效，应该集中清一波

---

## 当前状态快照（2026-04-28）

### 已完成

- P0/P1/P2 生成层重构
- test-hooks 三分类硬化（含 2026-06-01 死线）
- P3-A phaser3 引擎收编
- P3-B dom-ui + engine-aware primitive subset
- P3-D catalog asset-level 语义审计 + 补齐
- 目录与协议基础设施建立

### 推迟中

- P3-C three 引擎收编（无真实 three fixture）
- 素材层重构（未启动）

### 建议的下一步

- **先跑一个 case 验证本轮改动** → 当前 prompt：`cases/whack_a_mole_pixijs.md`
- 跑完再决定启动素材层还是推 P3-C

---

## Changelog

- 2026-04-28 初版。整合 protocols / design / todos / cases / reviews 五子目录，附快速路由 + 反模式清单。
