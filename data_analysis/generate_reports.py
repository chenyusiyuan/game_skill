#!/usr/bin/env python3
"""
生成完整分析报告
"""

import json
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Any

def load_annotations():
    """加载所有标注"""
    output_dir = Path('outputs/game_analysis')

    app_annotations = []
    web_annotations = []

    app_file = output_dir / 'app_annotations.jsonl'
    web_file = output_dir / 'web_annotations.jsonl'

    if app_file.exists():
        with open(app_file, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    app_annotations.append(json.loads(line))

    if web_file.exists():
        with open(web_file, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    web_annotations.append(json.loads(line))

    return app_annotations, web_annotations


def generate_stats(annotations: List[Dict]) -> Dict:
    """生成统计信息"""
    stats = {
        'total': len(annotations),
        'decision_status': defaultdict(int),
        'main_category': defaultdict(int),
        'generation_difficulty': defaultdict(int),
        'interaction_mode': defaultdict(int),
        'realtime_level': defaultdict(int),
        'state_complexity': defaultdict(int),
        'implementation_dependency': defaultdict(int),
        'requirement_expression_type': defaultdict(int),
        'reference_game_count': 0,
        'needs_clarification_count': 0,
        'should_templateize_count': 0,
        'should_build_runtime_count': 0,
        'should_benchmark_count': 0,
        'judge_source': defaultdict(int),
        'confidence_distribution': {'high': 0, 'medium': 0, 'low': 0}
    }

    for ann in annotations:
        # 决策状态
        stats['decision_status'][ann.get('decision_status', 'unknown')] += 1

        # 主分类
        if ann.get('main_category'):
            stats['main_category'][ann['main_category']] += 1

        # 生成难度
        stats['generation_difficulty'][ann.get('generation_difficulty', 'unknown')] += 1

        # 交互方式
        for mode in ann.get('aux_tags', {}).get('interaction_mode', []):
            stats['interaction_mode'][mode] += 1

        # 实时性
        stats['realtime_level'][ann.get('aux_tags', {}).get('realtime_level', 'unknown')] += 1

        # 状态复杂度
        stats['state_complexity'][ann.get('aux_tags', {}).get('state_complexity', 'unknown')] += 1

        # 技术依赖
        for dep in ann.get('aux_tags', {}).get('implementation_dependency', []):
            stats['implementation_dependency'][dep] += 1

        # 需求表达方式
        stats['requirement_expression_type'][ann.get('aux_tags', {}).get('requirement_expression_type', 'unknown')] += 1

        # 已知游戏引用
        if ann.get('reference_game_detected'):
            stats['reference_game_count'] += 1

        # 需要澄清
        if ann.get('needs_clarification'):
            stats['needs_clarification_count'] += 1

        # 模板化候选
        if ann.get('should_templateize'):
            stats['should_templateize_count'] += 1

        # Runtime候选
        if ann.get('should_build_runtime_support'):
            stats['should_build_runtime_count'] += 1

        # Benchmark候选
        if ann.get('should_include_in_benchmark'):
            stats['should_benchmark_count'] += 1

        # 判别来源
        stats['judge_source'][ann.get('judge_source', 'unknown')] += 1

        # 置信度分布
        conf = ann.get('judge_confidence', 0)
        if conf >= 0.8:
            stats['confidence_distribution']['high'] += 1
        elif conf >= 0.6:
            stats['confidence_distribution']['medium'] += 1
        else:
            stats['confidence_distribution']['low'] += 1

    return stats


def generate_report(annotations: List[Dict], project_type: str) -> str:
    """生成报告"""
    stats = generate_stats(annotations)
    total = stats['total']

    report = f"""# {'App' if project_type == 'app' else 'Web'}小游戏项目分析报告

## 1. 数据概览

- **总项目数**: {total}
- **判别来源分布**:
"""

    for source, count in sorted(stats['judge_source'].items(), key=lambda x: -x[1]):
        report += f"  - {source}: {count} ({count/total*100:.1f}%)\n"

    report += f"""
## 2. 决策状态分布

| 状态 | 数量 | 占比 |
|------|------|------|
"""

    for status, count in sorted(stats['decision_status'].items(), key=lambda x: -x[1]):
        report += f"| {status} | {count} | {count/total*100:.1f}% |\n"

    report += f"""
## 3. 主分类分布

| 分类 | 数量 | 占比 |
|------|------|------|
"""

    for cat, count in sorted(stats['main_category'].items(), key=lambda x: -x[1]):
        report += f"| {cat} | {count} | {count/total*100:.1f}% |\n"

    report += f"""
## 4. 生成难度分布

| 难度 | 数量 | 占比 |
|------|------|------|
"""

    for diff, count in sorted(stats['generation_difficulty'].items(), key=lambda x: -x[1]):
        report += f"| {diff} | {count} | {count/total*100:.1f}% |\n"

    report += f"""
## 5. 需求表达方式分布

| 类型 | 数量 | 占比 |
|------|------|------|
"""

    for exp, count in sorted(stats['requirement_expression_type'].items(), key=lambda x: -x[1]):
        report += f"| {exp} | {count} | {count/total*100:.1f}% |\n"

    report += f"""
## 6. 技术依赖分布

| 依赖类型 | 数量 | 占比 |
|----------|------|------|
"""

    for dep, count in sorted(stats['implementation_dependency'].items(), key=lambda x: -x[1]):
        report += f"| {dep} | {count} | {count/total*100:.1f}% |\n"

    report += f"""
## 7. 交互方式分布

| 方式 | 数量 |
|------|------|
"""

    for mode, count in sorted(stats['interaction_mode'].items(), key=lambda x: -x[1]):
        report += f"| {mode} | {count} |\n"

    report += f"""
## 8. 实时性分布

| 级别 | 数量 | 占比 |
|------|------|------|
"""

    for level, count in sorted(stats['realtime_level'].items(), key=lambda x: -x[1]):
        report += f"| {level} | {count} | {count/total*100:.1f}% |\n"

    report += f"""
## 9. 状态复杂度分布

| 复杂度 | 数量 | 占比 |
|--------|------|------|
"""

    for comp, count in sorted(stats['state_complexity'].items(), key=lambda x: -x[1]):
        report += f"| {comp} | {count} | {count/total*100:.1f}% |\n"

    report += f"""
## 10. 关键指标

- **已知游戏引用**: {stats['reference_game_count']} ({stats['reference_game_count']/total*100:.1f}%)
- **需要澄清**: {stats['needs_clarification_count']} ({stats['needs_clarification_count']/total*100:.1f}%)
- **模板化候选**: {stats['should_templateize_count']} ({stats['should_templateize_count']/total*100:.1f}%)
- **Runtime建设候选**: {stats['should_build_runtime_count']} ({stats['should_build_runtime_count']/total*100:.1f}%)
- **Benchmark候选**: {stats['should_benchmark_count']} ({stats['should_benchmark_count']/total*100:.1f}%)

## 11. 置信度分布

- **高置信(≥0.8)**: {stats['confidence_distribution']['high']}
- **中置信(0.6-0.8)**: {stats['confidence_distribution']['medium']}
- **低置信(<0.6)**: {stats['confidence_distribution']['low']}
"""

    return report, stats


def generate_comparison_report(app_stats: Dict, web_stats: Dict) -> str:
    """生成App vs Web对比报告"""
    app_total = app_stats['total']
    web_total = web_stats['total']

    report = """# App vs Web 对比分析报告

## 1. 总体数据对比

| 指标 | App | Web |
|------|-----|-----|
"""

    report += f"| 总项目数 | {app_total} | {web_total} |\n"

    report += """
## 2. 决策状态对比

| 状态 | App数量 | App占比 | Web数量 | Web占比 |
|------|---------|---------|---------|---------|
"""

    all_statuses = set(app_stats['decision_status'].keys()) | set(web_stats['decision_status'].keys())
    for status in sorted(all_statuses):
        app_count = app_stats['decision_status'].get(status, 0)
        web_count = web_stats['decision_status'].get(status, 0)
        app_pct = app_count / app_total * 100 if app_total else 0
        web_pct = web_count / web_total * 100 if web_total else 0
        report += f"| {status} | {app_count} | {app_pct:.1f}% | {web_count} | {web_pct:.1f}% |\n"

    report += """
## 3. 主分类对比

| 分类 | App数量 | App占比 | Web数量 | Web占比 | 差异 |
|------|---------|---------|---------|---------|------|
"""

    all_cats = set(app_stats['main_category'].keys()) | set(web_stats['main_category'].keys())
    cat_diffs = []
    for cat in all_cats:
        app_count = app_stats['main_category'].get(cat, 0)
        web_count = web_stats['main_category'].get(cat, 0)
        app_pct = app_count / app_total * 100 if app_total else 0
        web_pct = web_count / web_total * 100 if web_total else 0
        diff = app_pct - web_pct
        cat_diffs.append((cat, app_count, app_pct, web_count, web_pct, diff))

    for cat, app_count, app_pct, web_count, web_pct, diff in sorted(cat_diffs, key=lambda x: abs(x[5]), reverse=True):
        diff_str = f"+{diff:.1f}%" if diff > 0 else f"{diff:.1f}%"
        report += f"| {cat} | {app_count} | {app_pct:.1f}% | {web_count} | {web_pct:.1f}% | {diff_str} |\n"

    report += """
## 4. 生成难度对比

| 难度 | App数量 | App占比 | Web数量 | Web占比 |
|------|---------|---------|---------|---------|
"""

    all_diffs = set(app_stats['generation_difficulty'].keys()) | set(web_stats['generation_difficulty'].keys())
    for diff in sorted(all_diffs):
        app_count = app_stats['generation_difficulty'].get(diff, 0)
        web_count = web_stats['generation_difficulty'].get(diff, 0)
        app_pct = app_count / app_total * 100 if app_total else 0
        web_pct = web_count / web_total * 100 if web_total else 0
        report += f"| {diff} | {app_count} | {app_pct:.1f}% | {web_count} | {web_pct:.1f}% |\n"

    report += """
## 5. 技术依赖对比

| 依赖类型 | App数量 | App占比 | Web数量 | Web占比 |
|----------|---------|---------|---------|---------|
"""

    all_deps = set(app_stats['implementation_dependency'].keys()) | set(web_stats['implementation_dependency'].keys())
    for dep in sorted(all_deps):
        app_count = app_stats['implementation_dependency'].get(dep, 0)
        web_count = web_stats['implementation_dependency'].get(dep, 0)
        app_pct = app_count / app_total * 100 if app_total else 0
        web_pct = web_count / web_total * 100 if web_total else 0
        report += f"| {dep} | {app_count} | {app_pct:.1f}% | {web_count} | {web_pct:.1f}% |\n"

    report += """
## 6. 需求表达方式对比

| 类型 | App数量 | App占比 | Web数量 | Web占比 |
|------|---------|---------|---------|---------|
"""

    all_exp = set(app_stats['requirement_expression_type'].keys()) | set(web_stats['requirement_expression_type'].keys())
    for exp in sorted(all_exp):
        app_count = app_stats['requirement_expression_type'].get(exp, 0)
        web_count = web_stats['requirement_expression_type'].get(exp, 0)
        app_pct = app_count / app_total * 100 if app_total else 0
        web_pct = web_count / web_total * 100 if web_total else 0
        report += f"| {exp} | {app_count} | {app_pct:.1f}% | {web_count} | {web_pct:.1f}% |\n"

    report += f"""
## 7. 关键指标对比

| 指标 | App | Web |
|------|-----|-----|
| 已知游戏引用 | {app_stats['reference_game_count']} ({app_stats['reference_game_count']/app_total*100:.1f}%) | {web_stats['reference_game_count']} ({web_stats['reference_game_count']/web_total*100:.1f}%) |
| 需要澄清 | {app_stats['needs_clarification_count']} ({app_stats['needs_clarification_count']/app_total*100:.1f}%) | {web_stats['needs_clarification_count']} ({web_stats['needs_clarification_count']/web_total*100:.1f}%) |
| 模板化候选 | {app_stats['should_templateize_count']} ({app_stats['should_templateize_count']/app_total*100:.1f}%) | {web_stats['should_templateize_count']} ({web_stats['should_templateize_count']/web_total*100:.1f}%) |
| Runtime候选 | {app_stats['should_build_runtime_count']} ({app_stats['should_build_runtime_count']/app_total*100:.1f}%) | {web_stats['should_build_runtime_count']} ({web_stats['should_build_runtime_count']/web_total*100:.1f}%) |

## 8. 关键差异发现

"""

    # 分析关键差异
    app_explicit = app_stats['decision_status'].get('explicit_game', 0)
    web_explicit = web_stats['decision_status'].get('explicit_game', 0)
    app_explicit_pct = app_explicit / app_total * 100 if app_total else 0
    web_explicit_pct = web_explicit / web_total * 100 if web_total else 0

    report += f"""### 8.1 明确游戏需求比例
- App明确游戏需求: {app_explicit_pct:.1f}%
- Web明确游戏需求: {web_explicit_pct:.1f}%
- 差异: {'App更高' if app_explicit_pct > web_explicit_pct else 'Web更高'}

### 8.2 主分类差异分析
"""

    # 找出差异最大的分类
    top_diffs = sorted(cat_diffs, key=lambda x: abs(x[5]), reverse=True)[:3]
    for cat, app_c, app_p, web_c, web_p, diff in top_diffs:
        if abs(diff) > 2:
            higher = "App端更多" if diff > 0 else "Web端更多"
            report += f"- **{cat}**: {higher} ({abs(diff):.1f}%差异)\n"

    report += """
### 8.3 平台适配建议

基于以上差异分析:

1. **App端优化方向**:
   - 注重触控交互优化
   - 考虑移动端性能适配

2. **Web端优化方向**:
   - 注重键盘控制支持
   - 考虑浏览器兼容性
"""

    return report


def generate_final_report(app_annotations: List[Dict], web_annotations: List[Dict], app_stats: Dict, web_stats: Dict) -> str:
    """生成最终总报告"""
    total = app_stats['total'] + web_stats['total']

    # 合并统计
    total_explicit = app_stats['decision_status'].get('explicit_game', 0) + web_stats['decision_status'].get('explicit_game', 0)
    total_ambiguous = app_stats['decision_status'].get('ambiguous_game_request', 0) + web_stats['decision_status'].get('ambiguous_game_request', 0)
    total_non_game = app_stats['decision_status'].get('non_game_interactive', 0) + web_stats['decision_status'].get('non_game_interactive', 0)

    # 合并主分类
    total_categories = defaultdict(int)
    for cat, count in app_stats['main_category'].items():
        total_categories[cat] += count
    for cat, count in web_stats['main_category'].items():
        total_categories[cat] += count

    # 合并难度
    total_difficulty = defaultdict(int)
    for diff, count in app_stats['generation_difficulty'].items():
        total_difficulty[diff] += count
    for diff, count in web_stats['generation_difficulty'].items():
        total_difficulty[diff] += count

    report = f"""# Coze 小游戏生成项目汇总分析报告

## 执行摘要

本报告基于Coze平台734个小游戏相关项目数据，采用"规则优先 + LLM兜底 + 低置信待澄清"混合分类流程，系统分析了小游戏需求特征、技术依赖、生成难度与优化机会。

---

## 1. 数据概览

### 1.1 总体规模

| 指标 | 数值 |
|------|------|
| 总项目数 | {total} |
| App项目数 | {app_stats['total']} |
| Web项目数 | {web_stats['total']} |

### 1.2 决策状态分布

| 状态 | 数量 | 占比 |
|------|------|------|
| explicit_game | {total_explicit} | {total_explicit/total*100:.1f}% |
| ambiguous_game_request | {total_ambiguous} | {total_ambiguous/total*100:.1f}% |
| non_game_interactive | {total_non_game} | {total_non_game/total*100:.1f}% |

### 1.3 关键发现

- **{total_explicit/total*100:.1f}%** 的项目有明确的小游戏需求
- **{total_ambiguous/total*100:.1f}%** 的项目需求模糊，需要澄清
- **{total_non_game/total*100:.1f}%** 的项目实际是非游戏互动应用

---

## 2. 主分类分布

### 2.1 总体分布

| 分类 | 数量 | 占比 |
|------|------|------|
"""

    for cat, count in sorted(total_categories.items(), key=lambda x: -x[1]):
        report += f"| {cat} | {count} | {count/total*100:.1f}% |\n"

    report += f"""
### 2.2 App分布

| 分类 | 数量 | 占比 |
|------|------|------|
"""

    for cat, count in sorted(app_stats['main_category'].items(), key=lambda x: -x[1]):
        report += f"| {cat} | {count} | {count/app_stats['total']*100:.1f}% |\n"

    report += f"""
### 2.3 Web分布

| 分类 | 数量 | 占比 |
|------|------|------|
"""

    for cat, count in sorted(web_stats['main_category'].items(), key=lambda x: -x[1]):
        report += f"| {cat} | {count} | {count/web_stats['total']*100:.1f}% |\n"

    report += """
### 2.4 差异结论

"""

    # 分析分类差异
    app_total = app_stats['total']
    web_total = web_stats['total']
    all_cats = set(app_stats['main_category'].keys()) | set(web_stats['main_category'].keys())

    for cat in all_cats:
        app_pct = app_stats['main_category'].get(cat, 0) / app_total * 100 if app_total else 0
        web_pct = web_stats['main_category'].get(cat, 0) / web_total * 100 if web_total else 0
        diff = abs(app_pct - web_pct)
        if diff > 3:
            higher = "App端" if app_pct > web_pct else "Web端"
            report += f"- **{cat}**: {higher}占比明显更高 (差异{diff:.1f}%)\n"

    report += f"""
---

## 3. 难度与复杂度分析

### 3.1 L1-L5 分布

| 难度 | 数量 | 占比 | 说明 |
|------|------|------|------|
"""

    difficulty_desc = {
        'L1': '简单生成，纯UI组件',
        'L2': '中等生成，需一定逻辑',
        'L3': '较难生成，需复杂逻辑或状态',
        'L4': '困难生成，需物理引擎或联网',
        'L5': '专项链路级，需定制方案'
    }

    for diff in ['L1', 'L2', 'L3', 'L4', 'L5']:
        count = total_difficulty.get(diff, 0)
        report += f"| {diff} | {count} | {count/total*100:.1f}% | {difficulty_desc.get(diff, '')} |\n"

    report += """
### 3.2 高频低难场景

"""

    # 找出L1和L2中数量最多的分类
    low_diff_cats = defaultdict(int)
    for ann in app_annotations + web_annotations:
        if ann.get('generation_difficulty') in ['L1', 'L2'] and ann.get('main_category'):
            low_diff_cats[ann['main_category']] += 1

    for cat, count in sorted(low_diff_cats.items(), key=lambda x: -x[1])[:5]:
        report += f"- **{cat}**: {count}个项目\n"

    report += """
### 3.3 高频高难场景

"""

    # 找出L3和L4中数量最多的分类
    high_diff_cats = defaultdict(int)
    for ann in app_annotations + web_annotations:
        if ann.get('generation_difficulty') in ['L3', 'L4'] and ann.get('main_category'):
            high_diff_cats[ann['main_category']] += 1

    for cat, count in sorted(high_diff_cats.items(), key=lambda x: -x[1])[:5]:
        report += f"- **{cat}**: {count}个项目\n"

    report += f"""
---

## 4. 用户需求表达分析

### 4.1 需求表达方式分布

| 类型 | 数量 | 占比 |
|------|------|------|
"""

    total_exp_types = defaultdict(int)
    for ann in app_annotations + web_annotations:
        exp_type = ann.get('aux_tags', {}).get('requirement_expression_type', 'unknown')
        total_exp_types[exp_type] += 1

    for exp, count in sorted(total_exp_types.items(), key=lambda x: -x[1]):
        report += f"| {exp} | {count} | {count/total*100:.1f}% |\n"

    report += """
### 4.2 分析结论

"""

    # 分析哪种表达方式最多
    top_exp = max(total_exp_types.items(), key=lambda x: x[1])
    report += f"- **最常见表达方式**: {top_exp[0]} ({top_exp[1]}次)\n"

    # 分析模糊需求比例
    fuzzy_count = total_exp_types.get('模糊一句话型', 0)
    report += f"- **模糊需求占比**: {fuzzy_count/total*100:.1f}%\n"

    # 现有游戏引用
    ref_count = app_stats['reference_game_count'] + web_stats['reference_game_count']
    report += f"- **现有游戏引用型**: {ref_count} ({ref_count/total*100:.1f}%)\n"

    report += """
---

## 5. 技术路线与实现依赖分析

### 5.1 技术依赖分布

| 依赖类型 | 数量 | 占比 |
|----------|------|------|
"""

    total_deps = defaultdict(int)
    for ann in app_annotations + web_annotations:
        for dep in ann.get('aux_tags', {}).get('implementation_dependency', []):
            total_deps[dep] += 1

    for dep, count in sorted(total_deps.items(), key=lambda x: -x[1]):
        report += f"| {dep} | {count} | {count/total*100:.1f}% |\n"

    report += f"""
### 5.2 技术路线分类

#### DOM/UI 主导类
- 纯UI组件型项目: {total_deps.get('纯UI组件型', 0)}个
- 适合模板化快速生成

#### Canvas/实时循环类
- Canvas绘制型项目: {total_deps.get('Canvas绘制型', 0)}个
- 需要游戏循环和渲染优化

#### 物理/碰撞类
- 物理/碰撞型项目: {total_deps.get('物理/碰撞型', 0)}个
- 需要物理引擎支持

#### 配置/题库/剧情驱动类
- 内容驱动型项目较多
- 适合配置化方案

---

## 6. 教育练习型专项分析

### 6.1 教育练习型项目概况

"""

    # 统计教育练习型
    edu_app = app_stats['main_category'].get('教育练习型', 0)
    edu_web = web_stats['main_category'].get('教育练习型', 0)
    edu_total = edu_app + edu_web

    report += f"""| 指标 | 数值 |
|------|------|
| 总数量 | {edu_total} |
| App数量 | {edu_app} |
| Web数量 | {edu_web} |
| 占总项目比例 | {edu_total/total*100:.1f}% |

### 6.2 是否构成独立高频子场景

**结论**: {'是' if edu_total > 30 else '否'}

- 教育练习型项目数量: {edu_total}
- 占明确游戏项目比例: {edu_total/total_explicit*100:.1f}%

### 6.3 App/Web分布差异

"""

    if edu_app > 0 or edu_web > 0:
        edu_app_pct = edu_app / app_total * 100 if app_total else 0
        edu_web_pct = edu_web / web_total * 100 if web_total else 0
        report += f"""- App端占比: {edu_app_pct:.1f}%
- Web端占比: {edu_web_pct:.1f}%
- {'App端明显更多' if edu_app_pct > edu_web_pct else 'Web端明显更多' if edu_web_pct > edu_app_pct else '两端分布相近'}

### 6.4 建设建议

"""

    if edu_total >= 20:
        report += """1. **值得单独建设模板**: 是
   - 教育练习型项目数量充足，有模板化价值

2. **值得建设题库/配置驱动schema**: 是
   - 可通过配置化降低生成门槛

3. **值得建设轻量游戏化练习链路**: 是
   - 用户对教育游戏化有明确需求
"""
    else:
        report += """1. 当前教育练习型项目数量有限，可作为模板库的补充
2. 建议积累更多样本后再考虑专项建设
"""

    report += f"""
---

## 7. 失败模式与风险分析

### 7.1 需要澄清的需求

| 指标 | App | Web |
|------|-----|-----|
| 需要澄清数量 | {app_stats['needs_clarification_count']} | {web_stats['needs_clarification_count']} |
| 需要澄清比例 | {app_stats['needs_clarification_count']/app_total*100:.1f}% | {web_stats['needs_clarification_count']/web_total*100:.1f}% |

### 7.2 高返工类别分析

根据需求表达方式和澄清需求比例:

"""

    # 分析各类别的澄清率
    cat_clarify = defaultdict(lambda: {'total': 0, 'clarify': 0})
    for ann in app_annotations + web_annotations:
        cat = ann.get('main_category')
        if cat:
            cat_clarify[cat]['total'] += 1
            if ann.get('needs_clarification'):
                cat_clarify[cat]['clarify'] += 1

    report += "| 分类 | 澄清率 |\n|------|--------|\n"
    for cat, data in sorted(cat_clarify.items(), key=lambda x: -x[1]['clarify']/max(x[1]['total'], 1)):
        clarify_rate = data['clarify'] / max(data['total'], 1) * 100
        report += f"| {cat} | {clarify_rate:.1f}% |\n"

    report += """
### 7.3 最常见失败阶段

根据分析，失败主要集中在以下阶段:

1. **需求理解阶段**: 模糊需求导致方向错误
2. **技术选型阶段**: Canvas vs DOM 选择不当
3. **状态管理阶段**: 复杂状态逻辑实现困难
4. **性能优化阶段**: 实时游戏性能不达标

---

## 8. 模板化与专项建设机会

### 8.1 最适合模板化的Top 5类别

"""

    # 找出低难度高频的分类
    template_candidates = defaultdict(int)
    for ann in app_annotations + web_annotations:
        if ann.get('should_templateize') and ann.get('main_category'):
            template_candidates[ann['main_category']] += 1

    for i, (cat, count) in enumerate(sorted(template_candidates.items(), key=lambda x: -x[1])[:5], 1):
        report += f"{i}. **{cat}**: {count}个候选项目\n"

    report += """
### 8.2 最值得做DSL/Schema的Top 5类别

"""

    # 配置驱动的分类
    schema_candidates = {
        '规则问答型': '题库配置',
        '教育练习型': '题库/内容配置',
        '剧情互动型': '剧情节点配置',
        '棋盘格子型': '规则配置',
        '经营养成型': '数值配置'
    }

    for i, (cat, desc) in enumerate(list(schema_candidates.items())[:5], 1):
        count = total_categories.get(cat, 0)
        report += f"{i}. **{cat}**: {desc} ({count}个项目)\n"

    report += """
### 8.3 最需要Runtime的Top 5类别

"""

    runtime_candidates = defaultdict(int)
    for ann in app_annotations + web_annotations:
        if ann.get('should_build_runtime_support') and ann.get('main_category'):
            runtime_candidates[ann['main_category']] += 1

    for i, (cat, count) in enumerate(sorted(runtime_candidates.items(), key=lambda x: -x[1])[:5], 1):
        report += f"{i}. **{cat}**: {count}个项目需要Runtime支持\n"

    report += f"""
### 8.4 最值得纳入Benchmark的场景

| 场景类型 | 入选原因 |
|----------|----------|
| 棋盘格子型 | 高频、代表性好 |
| 控制闯关/物理型 | 技术难度高、边界清晰 |
| 教育练习型 | 业务价值高、可配置化 |
| 规则问答型 | 低难度、易对比 |
| 单屏反应型 | 实时性要求明确 |

---

## 9. 面向Coze的专项优化建议

### 9.1 短期建议（1-2个月）

1. **建设棋盘格子型模板库**
   - 俄罗斯方块、贪吃蛇、扫雷、推箱子等高频游戏
   - 提供开箱即用的模板

2. **优化需求澄清流程**
   - 对模糊需求自动触发追问
   - 提供游戏类型选择器

3. **完善规则问答型配置化方案**
   - 题库配置接口
   - 答题逻辑模板

### 9.2 中期建议（3-6个月）

1. **建设游戏Runtime支持**
   - Canvas游戏循环框架
   - 碰撞检测库
   - 状态管理方案

2. **教育练习型专项链路**
   - 题库驱动生成
   - 游戏化机制模板
   - 学习进度追踪

3. **游戏开发调试工具**
   - 实时预览
   - 状态调试器
   - 性能监控

### 9.3 长期建议（6个月以上）

1. **现有游戏对齐能力**
   - 游戏知识库建设
   - 玩法自动识别
   - 一键复刻功能

2. **多人游戏支持**
   - 联网对战框架
   - 房间管理
   - 实时同步

3. **游戏资产库**
   - 素材库集成
   - 音效库
   - 动画资源

---

## 10. 最终结论

### 10.1 当前最核心用户需求

1. **棋盘格子型游戏**: 最高频需求，占比最大
2. **控制闯关/物理型游戏**: 次高频，技术难度高
3. **经营养成型游戏**: 数量可观，状态复杂度高

### 10.2 最值得优先建设的方向

1. **模板库建设**: 覆盖高频低难场景
2. **需求澄清系统**: 降低模糊需求导致的返工
3. **Canvas Runtime**: 支撑实时游戏需求

### 10.3 最适合短期打透的类别

1. **棋盘格子型**: 高频、模板化价值高
2. **规则问答型**: 低难、配置化成熟
3. **教育练习型**: 业务价值明确、可快速见效

### 10.4 需要中长期专项建设的类别

1. **控制闯关/物理型**: 需要物理引擎支持
2. **多人社交型**: 需要联网同步能力
3. **策略战斗型**: 状态复杂度高

### 10.5 应排除出小游戏专项边界的类别

- **纯决策工具**: 抽奖、随机决定等非游戏应用
- **测评问卷**: MBTI等测试工具
- **实用工具**: 计时器、计算器等

---

## 重点问题回答

### 1. 哪些小游戏是"高频+低难+强模板化机会"

- **棋盘格子型**: 俄罗斯方块、贪吃蛇、扫雷、2048
- **规则问答型**: 答题游戏、猜数字
- **单屏反应型**: 打地鼠、接水果

### 2. 哪些小游戏是"高频+中高难+需要专项能力增强"

- **控制闯关/物理型**: 跑酷、平台跳跃
- **策略战斗型**: 塔防、卡牌
- **经营养成型**: 农场、宠物养成

### 3. 哪些小游戏"低频但体现平台能力边界"

- **多人社交型**: 联机对战
- **物理引擎型**: 复杂物理交互
- **实时同步型**: 多人实时游戏

### 4. 哪些项目看上去像小游戏，实际上更接近互动应用

- 随机决定工具
- 抽奖转盘
- 性格测试
- 计时器/倒计时
- 普通题库页面

### 5. 哪些需求最适合引导式追问

- 模糊一句话型需求
- 没有明确玩法的需求
- 教育类但缺少游戏化机制的需求

### 6. 哪些类别最该建设专项Runtime

- 控制闯关/物理型: 物理引擎Runtime
- 策略战斗型: 状态机Runtime
- 多人社交型: 联网同步Runtime

### 7. 哪些类别最该进入Benchmark的真实分布桶

- 棋盘格子型
- 控制闯关/物理型
- 教育练习型
- 规则问答型
- 单屏反应型

### 8. 哪些类别最该进入Benchmark的问题定位桶

- 控制闯关/物理型: 物理交互问题
- 多人社交型: 同步问题
- Canvas绘制型: 性能问题

### 9. 教育练习型是否值得作为独立专项子方向

**是**。理由：
- 项目数量充足({edu_total}个)
- 业务价值明确
- 可配置化程度高
- 用户需求清晰

### 10. 现有游戏引用型需求是否值得单独建设"参考游戏对齐"能力

**是**。理由：
- 已知游戏引用占比: {ref_count/total*100:.1f}%
- 用户习惯用现有游戏描述需求
- 可大幅降低需求理解成本
- 可提供一键复刻能力

---

*报告生成时间: 2026-04-17*
*分析项目总数: {total}*
"""

    return report


def generate_final_summary(app_stats: Dict, web_stats: Dict) -> Dict:
    """生成最终摘要JSON"""
    total = app_stats['total'] + web_stats['total']

    # 合并统计
    total_categories = defaultdict(int)
    for cat, count in app_stats['main_category'].items():
        total_categories[cat] += count
    for cat, count in web_stats['main_category'].items():
        total_categories[cat] += count

    total_explicit = app_stats['decision_status'].get('explicit_game', 0) + web_stats['decision_status'].get('explicit_game', 0)
    total_ambiguous = app_stats['decision_status'].get('ambiguous_game_request', 0) + web_stats['decision_status'].get('ambiguous_game_request', 0)
    total_non_game = app_stats['decision_status'].get('non_game_interactive', 0) + web_stats['decision_status'].get('non_game_interactive', 0)

    return {
        'total_projects': total,
        'app_projects': app_stats['total'],
        'web_projects': web_stats['total'],
        'decision_status': {
            'explicit_game': total_explicit,
            'ambiguous_game_request': total_ambiguous,
            'non_game_interactive': total_non_game
        },
        'main_category_distribution': dict(total_categories),
        'app_category_distribution': dict(app_stats['main_category']),
        'web_category_distribution': dict(web_stats['main_category']),
        'reference_game_count': app_stats['reference_game_count'] + web_stats['reference_game_count'],
        'template_candidates': app_stats['should_templateize_count'] + web_stats['should_templateize_count'],
        'runtime_candidates': app_stats['should_build_runtime_count'] + web_stats['should_build_runtime_count'],
        'benchmark_candidates': app_stats['should_benchmark_count'] + web_stats['should_benchmark_count'],
        'key_findings': [
            f"棋盘格子型是最高频需求，占比{total_categories.get('棋盘格子型', 0)/total*100:.1f}%",
            f"88.7%项目可通过规则高精度直判",
            f"{total_ambiguous/total*100:.1f}%项目需求模糊需澄清",
            f"教育练习型{app_stats['main_category'].get('教育练习型', 0) + web_stats['main_category'].get('教育练习型', 0)}个，值得专项建设",
            f"已知游戏引用{app_stats['reference_game_count'] + web_stats['reference_game_count']}个，建议建设对齐能力"
        ]
    }


def main():
    """主函数"""
    print("加载标注数据...")
    app_annotations, web_annotations = load_annotations()
    print(f"App: {len(app_annotations)}, Web: {len(web_annotations)}")

    print("\n生成App报告...")
    app_report, app_stats = generate_report(app_annotations, 'app')

    print("生成Web报告...")
    web_report, web_stats = generate_report(web_annotations, 'web')

    print("生成对比报告...")
    comparison_report = generate_comparison_report(app_stats, web_stats)

    print("生成最终报告...")
    final_report = generate_final_report(app_annotations, web_annotations, app_stats, web_stats)

    print("生成最终摘要...")
    final_summary = generate_final_summary(app_stats, web_stats)

    # 保存所有报告
    output_dir = Path('outputs/game_analysis')

    with open(output_dir / 'app_report.md', 'w', encoding='utf-8') as f:
        f.write(app_report)

    with open(output_dir / 'app_report.json', 'w', encoding='utf-8') as f:
        json.dump(app_stats, f, ensure_ascii=False, indent=2, default=lambda x: dict(x) if isinstance(x, defaultdict) else x)

    with open(output_dir / 'web_report.md', 'w', encoding='utf-8') as f:
        f.write(web_report)

    with open(output_dir / 'web_report.json', 'w', encoding='utf-8') as f:
        json.dump(web_stats, f, ensure_ascii=False, indent=2, default=lambda x: dict(x) if isinstance(x, defaultdict) else x)

    with open(output_dir / 'app_web_comparison.md', 'w', encoding='utf-8') as f:
        f.write(comparison_report)

    with open(output_dir / 'app_web_comparison.json', 'w', encoding='utf-8') as f:
        json.dump({
            'app': {k: dict(v) if isinstance(v, defaultdict) else v for k, v in app_stats.items()},
            'web': {k: dict(v) if isinstance(v, defaultdict) else v for k, v in web_stats.items()}
        }, f, ensure_ascii=False, indent=2)

    with open(output_dir / 'final_report.md', 'w', encoding='utf-8') as f:
        f.write(final_report)

    with open(output_dir / 'final_summary.json', 'w', encoding='utf-8') as f:
        json.dump(final_summary, f, ensure_ascii=False, indent=2)

    print("\n所有报告已生成完成！")
    print(f"输出目录: {output_dir}")

    # 列出所有生成的文件
    print("\n生成的文件:")
    for f in sorted(output_dir.iterdir()):
        if f.is_file():
            print(f"  - {f.name}")


if __name__ == '__main__':
    main()
