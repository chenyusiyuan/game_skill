# Data Analysis Integration TODO

## 现状（2026-05-01）

已有产物，全部为**离线数据分析结果**，**未接入 game_skill 运行时链路**：

- `data/clean_project/` 4376 条原始 project JSON
- `data/games_app.json` + `games_web.json` 合并后 734 条 query
- `outputs/game_analysis/app_annotations.jsonl` + `web_annotations.jsonl`（rule-based 打标）
- `outputs/game_analysis/app_llm_annotations.jsonl` + `web_llm_annotations.jsonl`（LLM 补充打标）
- `outputs/game_analysis/reference_games_ranking.json`（17 个 reference，265 次提及统计）
- `outputs/game_analysis/category_keyword_stats.json`（9 类 × 通用 lexicon + 类别专属词频）
- `outputs/game_analysis/gameplay_gap_analysis.md`（人读报告）
- `outputs/game_analysis/final_report.md`（441 行综合报告）
- `outputs/game_analysis/game_skill_experiment_plan.md`（550 行实验方案）
- `outputs/game_analysis/game_eval.json`（72 条种子评测集）

脚本:
- `scripts/extract_gameplay_data.py`（Prompt 8/9 产物，单文件纯 Python）
- `scripts/aggregate_and_report.py` / `regenerate_report.py`
- `analyze_games.py` / `generate_batches.py` / `generate_reports.py` / `llm_classify.py`

## 已决定不做的事

- **不把数据压缩成 prompt 素材注入 Phase 2.5B**
  - 原因 1：强模型训练数据里已有这些常识，注入 400 行 md 对单条 query 的决策帮助极小，但每次多烧 6-8k token
  - 原因 2：数据的"36% 含 reference / 6% 模糊一句话"是分布统计，对单次生成无用
  - 原因 3：污染样本识别特征（`<!DOCTYPE|<html|const`）属于数据分析场景的统计工具，**不能搬到运行时**——用户贴 GDD/代码当 prompt 本身就是明确表达，按 PRD 生成，不要反其道抽"玩法本质"
- **不生成 16 份 archetype yaml 档案**
  - 原因：违背 v2 "把机制表达自由度交还模型"的核心判断；archetype 档案 = 老 primitive 池换名
- **不生成 9 份 category playbook**
  - 同上

## 后续可探讨的接入方向（未决）

**方向A：专项 e2e 测试集**
- 从 `game_eval.json` 72 条里挑 9-15 条（每类 1-2 条）作为链路回归测试的 golden set
- 每条跑完整链路到 Stage 1，对比输出质量随 skill 迭代的变化
- 产物：一套可复现的回归基准，而非运行时材料

**方向B：类别专属 runtime check**
- 对某些高风险类别（经营养成 / 控制闯关）单独写 check 脚本
  - 如 `check_jump_forgiveness.js`（跳跃类专用：验 coyote time + jump buffer）
  - 如 `check_economy_closed_loop.js`（经营类专用：严格 sources/sinks 匹配）
- 这些 check 的判据来自数据分析，但不把数据塞 prompt
- 触发条件：design-strategy.yaml 的 identity-anchors 或 category 字段匹配

**方向C：failure-mode 驱动的 skill 优化**
- 跑完链路后对比"用户满意 vs 不满意"的 case，回溯到 SOP 哪一段不够清晰
- 把模糊地带补充到 design-strategy.md / stage-roadmap.md 的 SOP 文字里（永久嵌入，不是动态注入）
- 例：若发现"经营养成"类常翻车在 resource-loop，给 design-strategy.md 的 resource-loop 段加 2-3 行约束

**方向D：data-driven eval rubric**
- 用 72 条种子集 + reference identity 知识，写一份人工评测 rubric
- 每次链路迭代后跑人工 check，量化"好玩度"提升
- 只给评审参考，不进运行时

## 触发重启时机

满足任一条即可重新讨论：
- Stage 1-5 链路跑通、POC 出 3 个类别的真实游戏、手头有数据说"哪类做得不好"
- 有明确的空白需求（某类 query 反复翻车 + 不知道怎么约束模型）
- 团队扩充、有人专门负责数据驱动的 skill 优化
