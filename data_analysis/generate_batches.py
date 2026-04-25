#!/usr/bin/env python3
"""
生成分批汇总报告
"""

import json
from pathlib import Path
from collections import defaultdict

def load_annotations():
    """加载所有标注"""
    app_anns = []
    web_anns = []

    with open('outputs/game_analysis/app_annotations.jsonl', 'r') as f:
        for line in f:
            if line.strip():
                app_anns.append(json.loads(line))

    with open('outputs/game_analysis/web_annotations.jsonl', 'r') as f:
        for line in f:
            if line.strip():
                web_anns.append(json.loads(line))

    return app_anns, web_anns

def generate_batch_summary(batch: list, batch_num: int, prefix: str) -> dict:
    """生成批次汇总"""
    stats = {
        'batch_num': batch_num,
        'prefix': prefix,
        'total': len(batch),
        'decision_status': defaultdict(int),
        'main_category': defaultdict(int),
        'generation_difficulty': defaultdict(int),
        'requirement_expression_type': defaultdict(int),
        'implementation_dependency': defaultdict(int),
        'reference_count': 0,
        'clarify_count': 0,
        'template_count': 0,
        'runtime_count': 0
    }

    for ann in batch:
        # 决策状态
        stats['decision_status'][ann.get('decision_status', 'unknown')] += 1

        # 主分类
        if ann.get('main_category'):
            stats['main_category'][ann['main_category']] += 1

        # 生成难度
        stats['generation_difficulty'][ann.get('generation_difficulty', 'unknown')] += 1

        # 需求表达方式
        exp_type = ann.get('aux_tags', {}).get('requirement_expression_type', 'unknown')
        stats['requirement_expression_type'][exp_type] += 1

        # 技术依赖
        for dep in ann.get('aux_tags', {}).get('implementation_dependency', []):
            stats['implementation_dependency'][dep] += 1

        # 计数
        if ann.get('reference_game_detected'):
            stats['reference_count'] += 1
        if ann.get('needs_clarification'):
            stats['clarify_count'] += 1
        if ann.get('should_templateize'):
            stats['template_count'] += 1
        if ann.get('should_build_runtime_support'):
            stats['runtime_count'] += 1

    return stats

def generate_batch_md(stats: dict) -> str:
    """生成批次Markdown报告"""
    md = f"""# {'App' if stats['prefix'] == 'app' else 'Web'} Batch {stats['batch_num']:02d} 汇总

## 1. 统计概览

| 指标 | 数值 |
|------|------|
| 总项目数 | {stats['total']} |
| 已知游戏引用 | {stats['reference_count']} |
| 需要澄清 | {stats['clarify_count']} |
| 模板化候选 | {stats['template_count']} |
| Runtime候选 | {stats['runtime_count']} |

## 2. 决策状态分布

| 状态 | 数量 | 占比 |
|------|------|------|
"""

    for status, count in sorted(stats['decision_status'].items(), key=lambda x: -x[1]):
        md += f"| {status} | {count} | {count/stats['total']*100:.1f}% |\n"

    md += """
## 3. 主分类分布

| 分类 | 数量 | 占比 |
|------|------|------|
"""

    for cat, count in sorted(stats['main_category'].items(), key=lambda x: -x[1]):
        md += f"| {cat} | {count} | {count/stats['total']*100:.1f}% |\n"

    md += """
## 4. 生成难度分布

| 难度 | 数量 |
|------|------|
"""

    for diff, count in sorted(stats['generation_difficulty'].items(), key=lambda x: -x[1]):
        md += f"| {diff} | {count} |\n"

    md += """
## 5. 需求表达方式分布

| 类型 | 数量 |
|------|------|
"""

    for exp, count in sorted(stats['requirement_expression_type'].items(), key=lambda x: -x[1]):
        md += f"| {exp} | {count} |\n"

    md += """
## 6. 技术依赖分布

| 依赖类型 | 数量 |
|----------|------|
"""

    for dep, count in sorted(stats['implementation_dependency'].items(), key=lambda x: -x[1]):
        md += f"| {dep} | {count} |\n"

    md += """
## 7. 关键观察

"""

    # 添加关键观察
    observations = []

    # 观察主要分类
    if stats['main_category']:
        top_cat = max(stats['main_category'].items(), key=lambda x: x[1])
        observations.append(f"本批次主要分类为 **{top_cat[0]}**，共{top_cat[1]}个项目")

    # 观察已知游戏引用
    if stats['reference_count'] > stats['total'] * 0.3:
        observations.append(f"本批次已知游戏引用比例较高({stats['reference_count']/stats['total']*100:.1f}%)")

    # 观察澄清需求
    if stats['clarify_count'] > stats['total'] * 0.2:
        observations.append(f"本批次需要澄清的需求较多({stats['clarify_count']/stats['total']*100:.1f}%)")

    # 观察模板化候选
    if stats['template_count'] > stats['total'] * 0.5:
        observations.append(f"本批次模板化候选较多({stats['template_count']/stats['total']*100:.1f}%)")

    if not observations:
        observations.append("本批次分布相对均衡，无明显异常")

    for i, obs in enumerate(observations[:5], 1):
        md += f"{i}. {obs}\n"

    return md

def main():
    print("加载标注数据...")
    app_anns, web_anns = load_annotations()
    print(f"App: {len(app_anns)}, Web: {len(web_anns)}")

    batch_dir = Path('outputs/game_analysis/batch_summaries')
    batch_dir.mkdir(exist_ok=True)

    batch_size = 50

    # 生成App batches
    print("\n生成App批次汇总...")
    num_app_batches = (len(app_anns) + batch_size - 1) // batch_size
    for i in range(1, num_app_batches + 1):
        batch = app_anns[(i-1)*batch_size:i*batch_size]
        if batch:
            stats = generate_batch_summary(batch, i, 'app')

            # 保存JSON
            with open(batch_dir / f'app_batch_{i:02d}.json', 'w', encoding='utf-8') as f:
                json.dump({k: dict(v) if isinstance(v, defaultdict) else v for k, v in stats.items()}, f, ensure_ascii=False, indent=2)

            # 保存Markdown
            md = generate_batch_md(stats)
            with open(batch_dir / f'app_batch_{i:02d}.md', 'w', encoding='utf-8') as f:
                f.write(md)

            print(f"  App Batch {i:02d}: {len(batch)} items")

    # 生成Web batches
    print("\n生成Web批次汇总...")
    num_web_batches = (len(web_anns) + batch_size - 1) // batch_size
    for i in range(1, num_web_batches + 1):
        batch = web_anns[(i-1)*batch_size:i*batch_size]
        if batch:
            stats = generate_batch_summary(batch, i, 'web')

            with open(batch_dir / f'web_batch_{i:02d}.json', 'w', encoding='utf-8') as f:
                json.dump({k: dict(v) if isinstance(v, defaultdict) else v for k, v in stats.items()}, f, ensure_ascii=False, indent=2)

            md = generate_batch_md(stats)
            with open(batch_dir / f'web_batch_{i:02d}.md', 'w', encoding='utf-8') as f:
                f.write(md)

            print(f"  Web Batch {i:02d}: {len(batch)} items")

    print(f"\n批次汇总完成！共生成 {num_app_batches} 个App批次，{num_web_batches} 个Web批次")

if __name__ == '__main__':
    main()
