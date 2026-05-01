# TODO（POC 前暂缓事项）

本文件汇总两块"已做审计、暂不接入链路"的工作：数据分析产物、素材层重构剩余项。两块都**等 POC 验证玩法层后再决定**。

---

## 1. 数据分析资产接入

### 现状（2026-05-01）

`data_analysis/` 下的全部产物已落盘，**未接入 game_skill 运行时链路**：

- `data/clean_project/` 4376 条原始 project JSON
- `data/games_app.json` + `games_web.json` 合并 734 条 query
- `outputs/game_analysis/app_annotations.jsonl` + `web_annotations.jsonl`（rule-based 打标）
- `outputs/game_analysis/app_llm_annotations.jsonl` + `web_llm_annotations.jsonl`（LLM 补充打标）
- `outputs/game_analysis/reference_games_ranking.json`（17 个 reference，265 次提及统计）
- `outputs/game_analysis/category_keyword_stats.json`（9 类 × 通用 lexicon + 类别专属词频）
- `outputs/game_analysis/gameplay_gap_analysis.md`（人读报告）
- `outputs/game_analysis/final_report.md`（441 行综合报告）
- `outputs/game_analysis/game_skill_experiment_plan.md`（550 行实验方案）
- `outputs/game_analysis/game_eval.json`（72 条种子评测集）

脚本:
- `scripts/extract_gameplay_data.py` / `aggregate_and_report.py` / `regenerate_report.py`
- `analyze_games.py` / `generate_batches.py` / `generate_reports.py` / `llm_classify.py`

### 已决定不做

- **不把数据压缩成 prompt 素材注入 Phase 2.5B**
  - 强模型训练数据里已有这些常识，注入 400 行 md 对单条 query 的决策帮助极小，每次多烧 6-8k token
  - "36% 含 reference / 6% 模糊一句话"是分布统计，对单次生成无用
  - 污染样本识别特征（`<!DOCTYPE|<html|const`）属于数据分析场景的统计工具，**不能搬到运行时**——用户贴 GDD/代码当 prompt 本身就是明确表达，按 PRD 生成，不反其道抽"玩法本质"
- **不生成 16 份 archetype yaml 档案**：违背 v2 "把机制表达自由度交还模型"的核心判断；archetype 档案 = 老 primitive 池换名
- **不生成 9 份 category playbook**：同上

### 后续可探讨的接入方向（未决）

**方向A：专项 e2e 测试集** — 从 `game_eval.json` 72 条挑 9-15 条（每类 1-2 条）作为链路回归 golden set；每条跑完整链路到 Stage 1，对比输出质量随 skill 迭代的变化。产物是可复现回归基准，不是运行时材料。

**方向B：类别专属 runtime check** — 对高风险类别写专用 check 脚本：
- `check_jump_forgiveness.js`（跳跃类：验 coyote time + jump buffer）
- `check_economy_closed_loop.js`（经营类：严格 sources/sinks 匹配）
判据来自数据分析，但不把数据塞 prompt；触发条件：design-strategy.yaml 的 identity-anchors 或 category 字段匹配。

**方向C：failure-mode 驱动的 skill 优化** — 跑完链路后对比"用户满意 vs 不满意"的 case，回溯到 SOP 哪一段不够清晰；把模糊地带补进 design-strategy.md / stage-roadmap.md 的 SOP 文字（永久嵌入，不动态注入）。

**方向D：data-driven eval rubric** — 用 72 条种子集 + reference identity 知识，写人工评测 rubric；每次链路迭代后跑人工 check，量化"好玩度"提升。只给评审参考，不进运行时。

### 重启触发条件

满足任一：
- Stage 1-5 链路跑通、POC 出 3 个类别的真实游戏、手头有数据说"哪类做得不好"
- 有明确的空白需求（某类 query 反复翻车 + 不知道怎么约束模型）
- 团队扩充、有人专门负责数据驱动的 skill 优化

---

## 2. 素材层重构剩余项

### 审计结论（2026-05-01）

对照 `eval/design/素材层重构.md` 的 P0/P1/P2 计划，已落地约 **60%**。

### ✅ 已落地

| 计划 | 状态 |
|---|---|
| P0.1 `check_asset_usage` per-asset required 消费绑定 | ✅ |
| P0.2 `renderSlot()` wrapper（canvas/dom-ui/pixijs） | ✅ |
| P0.3 `window.__assetUsage` runtime trace | ✅ |
| P1.1 `visual-slots.yaml` + generate/check 脚本 | ✅ |
| P1.4 `check_asset_selection` allowed/disallowed slot 硬规则 | ✅ |
| P1.5 `decor > 40%` 核心实体非空时 fail | ✅ |

### ❌ 未落地（按影响排序）

| # | 计划 | 缺口 | 优先级 |
|---|---|---|---|
| 1 | P0.4 `check_asset_rendered.js` | must-render 素材的 runtime 可见性硬闸缺失 | **高** |
| 2 | P1.3 `generate_implementation_contract.js` 去掉 `inferRole` | 核心素材 slot 语义仍靠字符串推断 | 中 |
| 3 | P1.2 `semantic-slot` / `state-driven` 进 schema | 字段可选，易被模型忽略 | 中 |
| 4 | P2.1 `_asset-index.yaml`（asset-level 而非 pack-level） | 素材选择精度上限低 | 低 |
| 5 | P2.2 tilemap 编号素材做 asset-level 标签 | 同上 | 低 |
| 6 | P2.3 `check_visual_semantics.js` 作为 Phase 3 gate | 素材语义校验缺失 | 低 |

### 当前决策

**暂不做**。POC 未验证玩法层之前，素材层质量不是瓶颈。

- P0.4 影响："不用素材"堵了约 70%，还有 30% 可能被"代码引用了但未真实渲染"漏过。在玩法层本身还没跑通前，这层缺口暴露不出来。
- P1.3 影响：核心素材用错的场景需要真实 case 跑出来才能观察，当前纸上讨论无法判断收益。
- P2 整块是"素材选对不选对"的质量问题，优先级最低。

### 重启触发条件

满足任一：
1. POC 跑通 Stage 1 → Stage 2，出现"生成的游戏视觉不达标但 check 全绿"的真实案例
2. 某类玩法（如棋盘类）反复在素材层翻车
3. 团队扩充，有专人负责素材链路

### 关联文档

- 设计文档：`eval/design/素材层重构.md`（739 行完整方案）
- 基线审计：`eval/design/asset_chain_baseline_audit.md`
- 现有素材 SOP：`game_skill/skills/expand.md` / `game_skill/skills/codegen.md` §3.1
- 现有 check 脚本：
  - `check_asset_usage.js` / `check_asset_selection.js` / `check_asset_paths.js`
  - `check_visual_slots.js` / `generate_visual_slots.js`
  - `_asset_strategy.js` / `_visual_primitive_enum.js`
