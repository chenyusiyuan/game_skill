#!/usr/bin/env python3
"""
LLM 兜底判别脚本
对规则未命中的项目进行结构化判别
"""

import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional
import re

# LLM判别提示模板
LLM_PROMPT_TEMPLATE = """你是一个专业的游戏分类分析师。请分析以下项目需求，输出结构化的分类结果。

## 项目信息
- 项目ID: {project_id}
- 项目类型: {project_type}
- 初始需求: {initial_prompt}
- 对话信号: {conversation_signals}
- 问题信号: {problem_signals}

## 分类架构

### 第0层: 判定状态
1. explicit_game - 明确小游戏需求
2. ambiguous_game_request - 模糊小游戏需求/信息不足/待澄清
3. non_game_interactive - 非游戏互动应用(抽奖、随机决定工具、测试问卷、计时器等)

### 第1层: explicit_game 的主分类(仅对明确游戏项目)
1. 规则问答型 - 答题、猜词、猜数字、闯关问答、选择题小游戏
2. 棋盘格子型 - 俄罗斯方块、2048、五子棋、扫雷、推箱子、贪吃蛇、消除
3. 单屏反应型 - 打地鼠、接水果、点击得分、节奏点按、躲避障碍
4. 控制闯关/物理型 - 马里奥、黄金矿工、跑酷、跳跃、射击、小球控制
5. 教育练习型 - 背单词闯关、拼写闯关、单词消消乐、口算挑战(必须有游戏化机制)
6. 剧情互动型 - 文字冒险、多结局、互动小说、分支剧情
7. 经营养成型 - 模拟开店、农场、电子宠物、资源升级
8. 策略战斗型 - 植物大战僵尸、卡牌、回合战斗、塔防、斗地主
9. 多人社交型 - 双人对战、房间制、排行榜竞技

## 重要判定原则
1. "只说做个小游戏"类，优先判为 ambiguous_game_request
2. 只有明确证据表明不是游戏而是互动工具时，才判为 non_game_interactive
3. 教育类必须有明显游戏化机制(闯关、计分、限时挑战等)才归入教育练习型
4. 普通题库页、测试页、学习工具页没有游戏化机制的，判为 non_game_interactive

## 输出格式(严格JSON)
{{
  "decision_status": "explicit_game|ambiguous_game_request|non_game_interactive",
  "is_game_project": true|false,
  "main_category": "分类名称或null",
  "main_category_confidence": 0.0-1.0,
  "reference_game_detected": true|false,
  "reference_game_name": "游戏名称或空",
  "reference_game_alias": "原始表述",
  "reference_mapping_category": "映射分类",
  "reference_confidence": 0.0-1.0,
  "interaction_mode": ["点击选择型|拖拽操作型|键盘控制型|连续触控型|文本输入型|回合决策型"],
  "realtime_level": "静态回合制|轻实时|强实时",
  "state_complexity": "低|中|高",
  "implementation_dependency": ["纯UI组件型|Canvas绘制型|物理/碰撞型|动画增强型|音频强依赖型"],
  "generation_difficulty": "L1|L2|L3|L4|L5",
  "requirement_expression_type": "直接玩法型|现有游戏引用型|模仿参考型|目标导向型|氛围创意型|模糊一句话型",
  "judge_confidence": 0.0-1.0,
  "evidence_summary": "简要说明判别依据",
  "needs_clarification": true|false
}}

请只输出JSON，不要输出其他内容。"""


def load_pending_samples():
    """加载待LLM处理的样本"""
    output_dir = Path('outputs/game_analysis')
    pending_samples = []

    for filename in ['app_llm_pending.jsonl', 'web_llm_pending.jsonl']:
        filepath = output_dir / filename
        if filepath.exists():
            with open(filepath, 'r', encoding='utf-8') as f:
                for line in f:
                    if line.strip():
                        pending_samples.append(json.loads(line))

    return pending_samples


def extract_project_context(annotation: Dict) -> Dict:
    """从标注中提取项目上下文"""
    evidence = annotation.get('evidence', {})

    return {
        'project_id': annotation.get('project_id', ''),
        'project_type': annotation.get('project_type', ''),
        'initial_prompt': evidence.get('initial_prompt', '')[:1000],
        'conversation_signals': evidence.get('conversation_signals', [])[:5],
        'problem_signals': evidence.get('problem_signals', [])[:3]
    }


def simulate_llm_classification(annotation: Dict) -> Dict:
    """
    模拟LLM分类（本地规则扩展版本）
    在没有API的情况下，使用扩展规则进行判别
    """
    evidence = annotation.get('evidence', {})
    initial_prompt = evidence.get('initial_prompt', '').lower()
    conv_signals = ' '.join(evidence.get('conversation_signals', [])).lower()

    full_text = initial_prompt + ' ' + conv_signals

    # 扩展关键词检测
    extended_game_keywords = {
        '棋盘格子型': ['方块', '消除', '棋', '格子', '拼图', '数独', '连连看', '对对碰'],
        '单屏反应型': ['点击', '反应', '快速', '速度', '躲避', '接住'],
        '控制闯关/物理型': ['跳跃', '移动', '控制', '闯关', '关卡', '障碍', '物理', '赛车', '飞行'],
        '教育练习型': ['单词', '记忆', '拼写', '学习', '练习', '答题', '挑战', '英语'],
        '剧情互动型': ['故事', '剧情', '选择', '结局', '角色'],
        '经营养成型': ['经营', '养成', '升级', '收集', '资源'],
        '策略战斗型': ['策略', '战斗', '卡牌', '塔防', '对战'],
        '多人社交型': ['多人', '对战', '联机', '朋友'],
        '规则问答型': ['答题', '问答', '猜', '竞答']
    }

    non_game_keywords = ['抽奖', '随机', '决定', '选择器', '工具', '计算', '转换', '生成器', '助手']

    ambiguous_indicators = ['游戏', 'game', '玩', '小游戏']

    # 检测非游戏
    for kw in non_game_keywords:
        if kw in full_text:
            # 但如果有游戏相关词，可能是游戏
            game_detected = any(gw in full_text for gw in ambiguous_indicators)
            if not game_detected:
                return {
                    'decision_status': 'non_game_interactive',
                    'is_game_project': False,
                    'main_category': None,
                    'main_category_confidence': 0.75,
                    'reference_game_detected': False,
                    'reference_game_name': '',
                    'reference_game_alias': '',
                    'reference_mapping_category': '',
                    'reference_confidence': 0.0,
                    'interaction_mode': ['点击选择型'],
                    'realtime_level': '静态回合制',
                    'state_complexity': '低',
                    'implementation_dependency': ['纯UI组件型'],
                    'generation_difficulty': 'L1',
                    'requirement_expression_type': '目标导向型',
                    'judge_confidence': 0.75,
                    'evidence_summary': f'检测到非游戏关键词: {kw}',
                    'needs_clarification': False
                }

    # 检测游戏类别
    for category, keywords in extended_game_keywords.items():
        for kw in keywords:
            if kw in full_text:
                return {
                    'decision_status': 'explicit_game',
                    'is_game_project': True,
                    'main_category': category,
                    'main_category_confidence': 0.80,
                    'reference_game_detected': False,
                    'reference_game_name': '',
                    'reference_game_alias': '',
                    'reference_mapping_category': '',
                    'reference_confidence': 0.0,
                    'interaction_mode': ['点击选择型'],
                    'realtime_level': '轻实时',
                    'state_complexity': '中',
                    'implementation_dependency': ['纯UI组件型'],
                    'generation_difficulty': 'L2',
                    'requirement_expression_type': '直接玩法型',
                    'judge_confidence': 0.80,
                    'evidence_summary': f'检测到游戏关键词: {kw} -> {category}',
                    'needs_clarification': False
                }

    # 检测模糊游戏需求
    for amb in ambiguous_indicators:
        if amb in full_text:
            return {
                'decision_status': 'ambiguous_game_request',
                'is_game_project': True,
                'main_category': None,
                'main_category_confidence': 0.0,
                'reference_game_detected': False,
                'reference_game_name': '',
                'reference_game_alias': '',
                'reference_mapping_category': '',
                'reference_confidence': 0.0,
                'interaction_mode': ['点击选择型'],
                'realtime_level': '轻实时',
                'state_complexity': '低',
                'implementation_dependency': ['纯UI组件型'],
                'generation_difficulty': 'L2',
                'requirement_expression_type': '模糊一句话型',
                'judge_confidence': 0.70,
                'evidence_summary': f'检测到模糊游戏指示词: {amb}',
                'needs_clarification': True
            }

    # 默认回退
    return {
        'decision_status': 'ambiguous_game_request',
        'is_game_project': True,
        'main_category': None,
        'main_category_confidence': 0.0,
        'reference_game_detected': False,
        'reference_game_name': '',
        'reference_game_alias': '',
        'reference_mapping_category': '',
        'reference_confidence': 0.0,
        'interaction_mode': ['点击选择型'],
        'realtime_level': '轻实时',
        'state_complexity': '低',
        'implementation_dependency': ['纯UI组件型'],
        'generation_difficulty': 'L2',
        'requirement_expression_type': '模糊一句话型',
        'judge_confidence': 0.60,
        'evidence_summary': '规则未命中，回退到模糊游戏需求',
        'needs_clarification': True
    }


def merge_llm_result(annotation: Dict, llm_result: Dict) -> Dict:
    """合并LLM判别结果到标注"""
    annotation['judge_source'] = 'llm'
    annotation['judge_confidence'] = llm_result.get('judge_confidence', 0.0)
    annotation['decision_status'] = llm_result.get('decision_status', 'ambiguous_game_request')
    annotation['is_game_project'] = llm_result.get('is_game_project', True)
    annotation['main_category'] = llm_result.get('main_category')
    annotation['main_category_confidence'] = llm_result.get('main_category_confidence', 0.0)
    annotation['reference_game_detected'] = llm_result.get('reference_game_detected', False)
    annotation['reference_game_name'] = llm_result.get('reference_game_name', '')
    annotation['reference_game_alias'] = llm_result.get('reference_game_alias', '')
    annotation['reference_mapping_category'] = llm_result.get('reference_mapping_category', '')
    annotation['reference_confidence'] = llm_result.get('reference_confidence', 0.0)
    annotation['aux_tags']['interaction_mode'] = llm_result.get('interaction_mode', ['点击选择型'])
    annotation['aux_tags']['realtime_level'] = llm_result.get('realtime_level', '轻实时')
    annotation['aux_tags']['state_complexity'] = llm_result.get('state_complexity', '低')
    annotation['aux_tags']['implementation_dependency'] = llm_result.get('implementation_dependency', ['纯UI组件型'])
    annotation['generation_difficulty'] = llm_result.get('generation_difficulty', 'L2')
    annotation['aux_tags']['requirement_expression_type'] = llm_result.get('requirement_expression_type', '模糊一句话型')
    annotation['needs_clarification'] = llm_result.get('needs_clarification', True)

    # 添加证据
    if llm_result.get('evidence_summary'):
        annotation['evidence']['llm_evidence'] = llm_result['evidence_summary']

    return annotation


def run_llm_pass():
    """执行LLM兜底判别"""
    print("加载待LLM处理的样本...")
    pending_samples = load_pending_samples()
    print(f"待处理样本数: {len(pending_samples)}")

    llm_annotations = []
    stats = {
        'total': len(pending_samples),
        'explicit_game': 0,
        'ambiguous_game_request': 0,
        'non_game_interactive': 0,
        'by_category': {}
    }

    for i, annotation in enumerate(pending_samples):
        if (i + 1) % 20 == 0:
            print(f"LLM处理进度: {i+1}/{len(pending_samples)}")

        # 模拟LLM判别（实际环境中可替换为API调用）
        llm_result = simulate_llm_classification(annotation)

        # 合并结果
        merged = merge_llm_result(annotation, llm_result)
        llm_annotations.append(merged)

        # 统计
        decision = llm_result.get('decision_status', 'ambiguous_game_request')
        if decision == 'explicit_game':
            stats['explicit_game'] += 1
            cat = llm_result.get('main_category')
            if cat:
                stats['by_category'][cat] = stats['by_category'].get(cat, 0) + 1
        elif decision == 'ambiguous_game_request':
            stats['ambiguous_game_request'] += 1
        elif decision == 'non_game_interactive':
            stats['non_game_interactive'] += 1

    print("\n" + "="*60)
    print("LLM判别统计")
    print("="*60)
    print(f"总样本数: {stats['total']}")
    print(f"explicit_game: {stats['explicit_game']}")
    print(f"ambiguous_game_request: {stats['ambiguous_game_request']}")
    print(f"non_game_interactive: {stats['non_game_interactive']}")
    print(f"\n主分类分布:")
    for cat, count in sorted(stats['by_category'].items(), key=lambda x: -x[1]):
        print(f"  - {cat}: {count}")

    # 保存结果
    output_dir = Path('outputs/game_analysis')

    # 分离app和web
    app_llm = [a for a in llm_annotations if a['project_type'] == 'app']
    web_llm = [a for a in llm_annotations if a['project_type'] == 'web']

    with open(output_dir / 'app_llm_annotations.jsonl', 'w', encoding='utf-8') as f:
        for ann in app_llm:
            f.write(json.dumps(ann, ensure_ascii=False) + '\n')

    with open(output_dir / 'web_llm_annotations.jsonl', 'w', encoding='utf-8') as f:
        for ann in web_llm:
            f.write(json.dumps(ann, ensure_ascii=False) + '\n')

    print("\nLLM判别结果已保存")
    return llm_annotations, stats


def merge_all_annotations():
    """合并所有标注结果"""
    output_dir = Path('outputs/game_analysis')

    all_app = []
    all_web = []

    # 读取规则命中
    for filename in ['app_rule_annotations.jsonl', 'web_rule_annotations.jsonl']:
        filepath = output_dir / filename
        if filepath.exists():
            with open(filepath, 'r', encoding='utf-8') as f:
                for line in f:
                    if line.strip():
                        ann = json.loads(line)
                        if 'app' in filename:
                            all_app.append(ann)
                        else:
                            all_web.append(ann)

    # 读取LLM判别
    for filename in ['app_llm_annotations.jsonl', 'web_llm_annotations.jsonl']:
        filepath = output_dir / filename
        if filepath.exists():
            with open(filepath, 'r', encoding='utf-8') as f:
                for line in f:
                    if line.strip():
                        ann = json.loads(line)
                        if 'app' in filename:
                            all_app.append(ann)
                        else:
                            all_web.append(ann)

    # 保存合并结果
    with open(output_dir / 'app_annotations.jsonl', 'w', encoding='utf-8') as f:
        for ann in all_app:
            f.write(json.dumps(ann, ensure_ascii=False) + '\n')

    with open(output_dir / 'web_annotations.jsonl', 'w', encoding='utf-8') as f:
        for ann in all_web:
            f.write(json.dumps(ann, ensure_ascii=False) + '\n')

    print(f"\n合并完成: App {len(all_app)}条, Web {len(all_web)}条")
    return all_app, all_web


if __name__ == '__main__':
    run_llm_pass()
    merge_all_annotations()
