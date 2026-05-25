# v1.1 引导密度重构(Refactor)

本目录是 Stage 1 链路 v1.1 引导密度重构的**实施手册**。它面向**实施者(本轮主要交给 Codex)**,把"补齐生成前引导密度,但不滑回小型框架库"的目标翻译成具体的文件路径、函数签名、命令行调用、验收判据。

> **与 evolution-docs/ 的关系**——
> evolution-docs/ 锁定**Stage 1-5 演进契约**的整体形状(契约、边界、协议)
> docs/refactor/n19/ 锁定**演进环 P0-P4** 的具体落地(baseline / triage / stage worker / mustNot)
> docs/refactor/v1.1/(本目录)锁定**Stage 1 首交付的引导密度**(模板 + lib helper + 决策日志 + Phaser 习语)
> 任何冲突以 evolution-docs/ 为准。本目录不动 N19 已落地的演进环工件。

## 为什么有 v1.1

vampire-glm / vampire-kimi 两个新生成 case 与线上 web-extended 链路(`cases/glm`、`cases/kimi`)对比,内容密度、视觉表现、文件拆分都明显不及。根因不是验证机制,是**生成前的引导密度**:

| 线上有 | 链路当前没有 |
|---|---|
| `design-style-thinking` skill 强制 todo 注入 DESIGN.md | DESIGN.md 不存在 → 默认蓝紫圆点审美 |
| AGENTS.md 上下文喂具体常量(MAX_ENEMIES 等) | scaffold 极简,模型从 0 开始 |
| 模型自然展开品类心智(8 武器 / 5 敌人 / Boss 警告) | plan.json 仅列 mechanics,milestone-pass 即停 |

a64ca37 commit 删了原本的 5 个品类专属 template module(`grid_logic` / `platformer` / `top_down` / `tower_defense` / `ui_heavy`),只保留 `templates/scaffold/`。简化方向**正确**(避免 OOP lock-in 与品类边界僵化),但删除后 scaffold 太空,模型走最低成本路径。

v1.1 在 a64ca37 简化方向上**补齐通用引导基础设施**:

- **不**恢复 5 个品类专属代码 scaffold(违 Option C 通用最小集原则)
- **补**通用 Phaser helper(visualTheme / inputController / hudBuilder / progressionMath,4 个,~550 LOC)
- **补**设计与决策日志模板(design-template / decisions-template)
- **补**品类知识 primer(5 个 markdown,**仅按需加载**,不参与路由)
- **补**Phase A/B/C SOP 引导文本(SKILL.md 增段)+ 决策日志原则 + Phaser 坑列表

最终重心权重:**引导 70% / gate 20% / metric 10%**,只新增 1 个 hard gate(plan↔DESIGN anchor 闭环),其他全 warn-only。

## 给 Codex 的工作约定

1. **一次只做一个 phase**。每个 phase 是一份自包含的 prompt pack,会话开始时读对应文件,会话结束时给出 verdict(全部完成 / 部分完成 / 阻塞,各自附产物列表)
2. **严格遵守 forbidden 清单**。本目录每个 phase 都有"不允许动什么"的硬边界,触碰即报告而不是绕开
3. **不改现有 Stage 1 SOP 的判定语义**。SKILL.md 的 Phase A/B/C 工序段可以**追加**新要求(模板 / 引导 / qualityHints),但不许改 milestone 反稀释规则、smoke 取证规则、case 隔离硬约束、N19 演进环既有逻辑
4. **不引入新顶层依赖**。所有 phase 用现有 `package.json` 的依赖跑通(node、playwright、ajv、phaser、vite、typescript)。新增 npm 依赖需要单开 RFC,不在任何 phase 范围内
5. **每个 phase 完成时必须**:
   - 跑过该 phase 的"Acceptance"小节列出的所有断言
   - 不留任何 `TODO`、`FIXME`、`XXX`,有未尽事项写到 `nonblockingTodos` 风格的 follow-up 列表
   - stdout 输出 phase 报告(格式见本文末)
6. **遇到契约模糊**:停下来报告,不要凭感觉决定。引用 plan 文件 / 本目录其他 phase / `evolution-docs/research-notes-phaser.md` 的具体段落,问"这里没说清,我倾向 X,是否?"

## 阶段速查

| Phase | 文件 | 目标 | 依赖 | 产出 |
|-------|------|------|------|------|
| 1 | [`10-templates.md`](./10-templates.md) | design / decisions / 5 archetype primer 模板 | 无 | 7 个 markdown 模板文件 |
| 2 | [`20-lib.md`](./20-lib.md) | scaffold/src/lib/ 4 默认 helper + 预验证 | Phase 1 | 4 个 ts 文件 + 链路作者 sign-off |
| 3 | [`30-scripts.md`](./30-scripts.md) | prepare/validate/check_delivery 扩展 + 新增 _visual_warn / load_primer | Phase 2 | 2 个新脚本 + 3 个修改脚本 + qualityHints schema |
| 4 | [`40-skill-md.md`](./40-skill-md.md) | SKILL.md Phase A/B/C SOP + Phaser 坑 + milestone 词汇 + 决策日志原则 + 视觉信号段 | Phase 3 | SKILL.md 增段 |
| - | [`99-accept.md`](./99-accept.md) | 三对照实验(vampire / shooter / brick) | Phase 1-4 | 通过判据文档 + 实验报告 |

依赖关系是严格线性的:`1 → 2 → 3 → 4 → 99`。**不允许跳序**——例如 Phase 3 在 Phase 2 lib/ 链路作者预验证 sign-off 前不允许开工,因为 prepare_case_game.js 要把 lib/ 加入 SCAFFOLD_FILES。

## 跨文档锚点对照

实施时频繁需要回查上下文。下表把每个 phase 主要触达的外部锚点汇总:

| Phase | 主要锚点 |
|-------|---------|
| 1 | plan 文件 § "通用 DESIGN.md anchor 结构";`evolution-docs/research-notes-phaser.md`(无,本 phase 不依赖 Phaser 调研) |
| 2 | `evolution-docs/research-notes-phaser.md` § 1(Phaser API 事实)、§ 4(lib 接口签名) |
| 3 | 现有 `scripts/prepare_case_game.js` / `scripts/validate_plan.js` / `scripts/check_delivery.js`;`schemas/plan.schema.json`(扩 derivedFrom) |
| 4 | 现有 `SKILL.md`(单一真相源);`evolution-docs/research-notes-phaser.md` § 6(Phaser 坑完整 16 条) |
| 99 | 反例 `cases/vampire-glm/` / `cases/vampire-kimi/`;正例 `cases/glm/` / `cases/kimi/` |

## 仓内放置约定

实施过程中会引入若干新文件,遵循以下分层:

| 层 | 路径 | 性质 |
|----|------|------|
| 模板 | `templates/design-template.md`、`templates/decisions-template.md`、`templates/archetype-primers/<X>.md` | Phase 1 产出;Phase 3 prepare_case_game.js 复制 design/decisions(primer 不自动复制) |
| Helper | `templates/scaffold/src/lib/visualTheme.ts`、`inputController.ts`、`hudBuilder.ts`、`progressionMath.ts` | Phase 2 产出;链路作者预验证后视为 known-good 契约;Phase 3 prepare_case_game.js 复制 |
| 脚本 | `scripts/_visual_warn.js`(新)、`scripts/load_primer.js`(新)、修改 `scripts/prepare_case_game.js` / `validate_plan.js` / `check_delivery.js` | Phase 3 产出 |
| 文档 | `docs/refactor/v1.1/` | 本目录;实施 SOP |
| 真相源 | `SKILL.md` | Phase 4 同步反映所有改动;不绕过 |

## 全局禁止清单

下列动作在任何 phase 都不允许:

- 修改 `evolution-docs/` 任何文件(契约不能被实施反向定义;若发现契约不准,**停下来报告**,不就地改)
- 修改 `SKILL.md` 现有判定语义(Phase 4 仅**追加**新段;反稀释规则 / smoke 取证 / case 隔离硬约束不动)
- 修改 N19 演进环既有产物(`scripts/_baseline_writer.js` / `_evolution_log.js` / `triage_router.js` / `run_evolution.js` / `_stage_<n>_worker.js` 等)
- 修改任何 `cases/<id>/` 内既有文件(本轮只读;新工件仅 Phase 99 三对照实验时按需新建 case)
- 恢复 a64ca37 删除的品类专属代码 scaffold(`templates/modules/<X>/` 任何形态)
- 引入新 npm 依赖
- ship `lib/objectPool.ts` 或 `lib/spatialGrid.ts`(已 defer 到 v1.2)
- 在 `prepare_case_game.js` 加 archetype 关键词检测或自动复制 primer 的逻辑
- 把 `final.png` 喂给模型作多模态输入(GLM 等纯文本模型不可用;走 vision-policy opt-in 即可)
- `git commit` / `git push` / `git checkout`(由人工审核后再决定)

## 重心权重(为什么 v1.1 重在引导而非 gate)

线上 web-extended 链路 0 个质量 gate,效果就那样。链路当前的力分布应该接近线上,只是把"design-style-thinking"换成"游戏专用引导",把"AGENTS.md 常量 suggestion"换成"visualTheme.ts pre-baked"。

**唯一 hard gate**:`generation-blocked: design-anchor-missing`(plan.json `derivedFrom` 必须解析到实际 DESIGN.md anchor)。这是 plan ↔ DESIGN 闭环的最低保证;没有它 DESIGN.md 写了等于没写。其他维度全 warn-only 经 qualityHints 反馈,不阻塞 delivery。

具体降级:

| 维度 | 是否 hard | 落点 |
|---|---|---|
| DESIGN.md 4 anchor 存在 + plan.json derivedFrom 引用闭环 | ✅ hard | `validate_plan.js` |
| decisions.md 结构 / Q&A 数量 | ❌ warn | `validate_plan.js` 仅 warning |
| filesplit (LOC / MainScene 占比) | ❌ warn | `check_delivery.js` qualityHints |
| visualTheme 引用 ≥ 2 helper | ❌ warn | `check_delivery.js` qualityHints |
| rubric 6 维度结构 | ❌ warn | `check_delivery.js` qualityHints |
| scope-leak (from-query 核心未在 mustHave) | ❌ warn | `validate_plan.js` 仅 warning |
| 视觉文本指标 (colorCount 等) | ❌ warn | `_visual_warn.js` → `check_delivery.js` qualityHints |

## Phase 报告格式

每个 phase 完成时,stdout 输出:

```
[v1.1 phase-N] STATUS=<done|partial|blocked>
files-created: <列表>
files-modified: <列表>
acceptance-passed: <X / Y>
follow-ups: <列表 或 'none'>
blockers: <列表 或 'none'>
```

人工 review 这个报告后再决定下一 phase 是否开工。

## 与 N19 的关系

N19 落地的是**演进环 P0-P4**(triage router / stage worker / kick-back / mustNot),覆盖 Stage 2-5。v1.1 落地的是**Stage 1 首交付的引导密度**,不动 N19 已落地的任何工件。

两者正交:即使 v1.1 完全没做,N19 演进环也能跑;反之亦然。但联合落地后,Stage 1 首交付质量更高 → Stage 2-5 演进环的 backlog 更准、kick-back 更少。

## 术语

本目录术语沿用 `SKILL.md` 与 `evolution-docs/90-glossary-and-open-questions.md`。新引入概念(如 "decision log / rationale log"、"core helper" / "FX optional fallback"、"on-demand primer"、"qualityHints.loc 分层")都在对应 phase 文件首次出现时显式定义,不依赖默契。
