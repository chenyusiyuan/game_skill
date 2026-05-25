# 端到端验收清单(v1.1 Stage 1 引导密度重构)

本文件不是新 phase,是 Phase 1-4 全部落地后的**集成验收**。三对照实验跑完,且通过判据满足,v1.1 才算 done。

> 上下文锚点:plan 文件 § "Per-Phase 大纲" `99-accept.md`、§ "Verification 12 项"、反例 `cases/vampire-glm/` / `cases/vampire-kimi/`、正例 `cases/glm/` / `cases/kimi/`

## Pre-requisites

- Phase 1 done(模板就位)
- Phase 2 done(lib/ 4 helper 就位 + 链路作者 sign-off)
- Phase 3 done(脚本扩展就位)
- Phase 4 done(SKILL.md 增段就位)
- 全部 Phase 报告 stdout 输出 STATUS=done

## 三对照实验

### 实验 1:vampire-glm-v2(吸血鬼幸存者类,GLM evaluator)

跑同一 query(原 vampire-glm 的 rawQuery),用 v1.1 链路重新生成。case ID:`vampire-glm-v2`(隔离于 vampire-glm 原始 case,不污染原数据)。

**对照基准**:
- 反例:`cases/vampire-glm/`(v1.1 之前链路输出,~845 LOC,纯黑底蓝紫圆点)
- 正例:`cases/glm/`(线上 web-extended 链路输出,1777 LOC,6 武器 × 8 等级 / 4 敌人 / 3 命名 boss)

### 实验 2:shooter-glm-v2(飞行射击,GLM evaluator)

query 例:"生成一个雷霆战机风格的小游戏,垂直滚动,玩家飞机自动开火,敌机从顶部成波出现,每 5 波一个 boss"。

**对照基准**:
- 无线上同 query 的 1:1 对照,但参考 `cases/glm/` 的视觉密度与 `cases/kimi/` 的拆分粒度
- v1.1 链路的预期表现:Phase A 模型识别 archetype = shooter → 加载 shooter primer → DESIGN.md 写出深空意象 + 玩家蓝绿冷色 vs 敌方红橙暖色 vs 命中体积小于显示体积 mustAvoid;Phase B 用 visualTheme.burstParticles + screenShake('hit') + damageNumber + bossEntry;Phase C qualityHints.visual.colorCount ≥ 6 + rubric.visual-feedback ≥ 3.5/5

### 实验 3:brick-glm-v2(打砖块,GLM evaluator)

query 例:"生成一个打砖块小游戏,玩家用底部挡板反弹球击碎顶部砖块,所有砖块清完进下一关"。

**对照基准**:
- 无线上同 query 对照
- v1.1 链路预期表现:Phase A 模型识别 archetype = breakout → 加载 breakout primer → DESIGN.md temporalShape = level-based + coreLoop.primaryAction = "移动挡板反弹球";Phase B 用 hudBuilder.statusText 显示关卡 + visualTheme.flashRing 砖块碎裂 + screenShake('micro');qualityHints.scopeReport from-genre-knowledge ≥ 3 条(出生砖块布局变化 / powerup 掉落 / 多段球)

## 通过判据

实验全部完成后,**至少 2 个 case** 满足下列条件:

### 客观指标(从 delivery.json.qualityHints 直接读)

| 指标 | 基线 | 通过判据 |
|---|---|---|
| `qualityHints.visual.colorCount` | vampire-glm 原 ~4 | **≥ 6** |
| `qualityHints.visual.shapeRegions` | vampire-glm 原 ~6 | **≥ 10** |
| `qualityHints.visual.hudOccupancy` | vampire-glm 原 ~0.04 | **≥ 0.10** |
| `qualityHints.rubric.content-density` | (无,新增) | **≥ 3.5 / 5** |
| `qualityHints.rubric.mechanical-differentiation` | (无,新增) | **≥ 3.0 / 5** |
| `qualityHints.rubric.visual-feedback` | (无,新增) | **≥ 3.5 / 5** |
| `qualityHints.loc.businessLoc` | vampire-glm 原 ~845 | **≥ 1500**(对齐线上 1777-2400) |
| `qualityHints.loc.helperImportCount` | (无,新增) | **≥ 2** |
| `qualityHints.loc.helperCallCount` | (无,新增) | **≥ 5** |

### 工序指标(从 case 文件结构直接读)

| 指标 | 通过判据 |
|---|---|
| `cases/<id>/docs/DESIGN.md` 存在 | ✅ 必须 |
| DESIGN.md 4 必填 anchor 完整 | ✅ 必须(visualIdentity / uiSurfaces / coreLoop / mustAvoid) |
| DESIGN.md mustAvoid 含 `default-purple-blue-orbs` | ✅ 必须 |
| `cases/<id>/docs/decisions.md` 存在 | ✅ 必须 |
| decisions.md A 段 ≥ 5 条 Q&A | ✅ 必须 |
| decisions.md A.1 是 archetype 识别 | ✅ 必须 |
| `plan.json.requiredMechanics[].derivedFrom` 至少 1 条引用稳定 anchor | ✅ 必须(否则 chain 会 generation-blocked) |
| `cases/<id>/.game/rubric.json` 存在 + 6 维度齐 | ✅ 必须 |
| 任何业务文件 LOC 不超 900 | ✅ 必须(若超,触发 hard warn 且 PR 必须解释) |

### 主观指标(链路作者人眼对比)

链路作者 Phase 99 验收时,跑下面对比并产出 `evolution-docs/v1.1-validation-report.md`:

| 维度 | 对比方式 |
|---|---|
| 视觉气质 | 左右并排:`cases/vampire-glm-v2/eval/screenshots/final.png` vs `cases/vampire-glm/eval/screenshots/final.png` 与 `cases/glm/`(若有线上截图);记录"v2 是否避开了默认蓝紫圆点审美" |
| 内容差异化 | 读 `vampire-glm-v2` 的 PlayScene / 武器配置;对比线上 6 武器 × 8 等级表是否复现;记录每把武器是否独立机制 |
| 反馈瞬间 | 跑 v2,人眼看击杀 / 升级 / 受伤 / boss 出场是否有可感知的视觉反馈差异 |
| 决策日志价值 | 读 `decisions.md` A/B/C 三段;判断"如果不看代码,光看 decisions.md,能否复盘出做了什么决策" |

主观指标无量化阈值,但 `validation-report.md` 必须给出**链路作者对每个维度的明确 verdict**(明显改进 / 持平 / 退化)。≥2 个对照实验在 ≥3 个维度上"明显改进" → 通过。

## 验证 plan 文件 12 项 checklist

跑 plan 文件 § "Verification" 12 项验证:

| # | 项 | 验证方式 |
|---|---|---|
| 1 | 6 文件存在 + README 阶段速查表覆盖 5 phase | `ls docs/refactor/v1.1/` + grep README 阶段速查 |
| 2 | 每个 phase 文件含 8 必填 section | grep `## Goal` / `## Pre-requisites` / `## Files to create` / `## Files to modify` / `## Interface contracts` / `## Acceptance criteria` / `## Out-of-scope` / `## Codex notes` |
| 3 | 每个 phase 至少引用 1 处 evolution-docs 或本目录其他 phase | grep `evolution-docs/` 或 `(./...)` |
| 4 | 20-lib.md 4 helper 接口签名完整(参数 / 返回 / JSDoc) | 读 20-lib.md 验证 |
| 5 | 每个 phase acceptance 至少 1 条可机械验证(如 `tsc --noEmit`) | 读 acceptance 段 |
| 6 | 24 决策每条能在某 phase 找到对应实施段落 | 跑 plan 文件 § "24 条锁定决策"逐条 grep |
| 7 | 不引入新 npm 依赖 | grep package.json diff = 0 |
| 8 | 不动锁定边界(SKILL.md Stage 1 既有判定 / cases 既有 / evolution-docs / schemas) | git diff 对应文件检查 |
| 9 | feedbackMoments 全清(全 6 文件 grep 不到) | `grep -r feedbackMoments docs/refactor/v1.1/` 应为空 |
| 10 | 20-lib.md visualTheme 段标 CANVAS-safe vs WebGL-only 边界 | grep `CANVAS-safe` / `WebGL only` 在 20-lib.md |
| 11 | 30-scripts.md check_delivery.js 改动段含 4 字段 LOC | grep `scaffoldLoc / businessLoc / helperImportCount / helperCallCount` |
| 12 | 30-scripts.md 明确 prepare_case_game.js **不**自动复制 primer + load_primer.js 仅按显式名加载 | grep "不**含字符串 `archetype-primer`" 与 unknown-archetype 处理 |

## 完整验收顺序

```bash
# 1. 检查 v1.1 docs 完整性(plan 12 项)
node /tmp/v1.1-doc-checklist.sh        # (链路作者写的辅助脚本,可选)

# 2. 跑 Phase 1-4 实施(若未做)
# Codex 按 10-templates / 20-lib / 30-scripts / 40-skill-md 顺序实施
# 每 phase 末 stdout 报告 STATUS=done

# 3. 跑 Phase 99 三对照实验
# 对每个 case:
#   prepare_case_game.js cases/<id>
#   worker 走 SKILL.md Phase A → B → C SOP 生成
#   delivery 完成

# 4. 收集对照数据
node /tmp/v1.1-collect-metrics.sh > evolution-docs/v1.1-validation-report.md

# 5. 链路作者人眼复核 + 写 verdict 段

# 6. 通过判据全部满足 → v1.1 PR 可 merge
```

## 不通过怎么办

若任一对照实验未达通过判据:

| 失败模式 | 应对 |
|---|---|
| `qualityHints.visual.colorCount < 6` | 检查 DESIGN.md mustAvoid 是否含 `default-purple-blue-orbs` + 检查 visualTheme.burstParticles 是否在多个反馈瞬间被调用 |
| `helperCallCount < 5` | SKILL.md Phase B 引导文本可能不够明确 → 增加更多引用示例 |
| `rubric.content-density < 3.5` | 模型自评低分 → 检查 archetype primer 是否被加载并读取 |
| `businessLoc < 1500` | 内容密度不足 → 检查 plan.json `requiredMechanics` 是否过短 + 检查 from-genre-knowledge Q&A 是否被识别 |
| 链路作者主观判定"持平"或"退化" | 单独开 issue 分析根因;退到 v1.1 之前的实施 phase 调引导文本 |

不通过的对照实验**不**自动 fail v1.1,但需要写入 `validation-report.md` 的"已知缺陷"段并提示是否需要 v1.1.1 patch。

## Out-of-scope

- 不在本 phase 写新代码(代码改动全在 Phase 1-4)
- 不动 N19 演进环工件
- 不在 99-accept 阶段引入新对照基准之外的实验
- 不要求 ≥3 个 case 全部通过(2/3 即可,留出 archetype 识别失败 / 模型方差 / 单点不稳的容忍空间)

## Phase 报告模板

完成时 stdout:

```
[v1.1 phase-99] STATUS=<done|partial>
experiments-run: vampire-glm-v2 / shooter-glm-v2 / brick-glm-v2
experiments-passed: <X / 3>  (通过判据 ≥2)
plan-checklist: <Y / 12>
report: evolution-docs/v1.1-validation-report.md
follow-ups:
  - <若有未通过实验,列出 + 是否计入 v1.1.1 backlog>
blockers: none
```
