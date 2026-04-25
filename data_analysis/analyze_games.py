#!/usr/bin/env python3
"""
Coze 小游戏生成项目分析脚本
规则优先 + LLM 兜底 + 低置信待澄清 混合分类流程
"""

import json
import re
import os
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Any, Optional, Tuple
import hashlib

# ==================== 规则字典 ====================

RULES = {
    "explicit_game": {
        "棋盘格子型": ["俄罗斯方块", "tetris", "2048", "五子棋", "井字棋", "扫雷", "推箱子", "贪吃蛇", "消消乐", "消除", "三消", "连珠", "围棋", "象棋", "跳棋", "黑白棋", "数独", "拼图", "对对碰", "连连看"],
        "单屏反应型": ["打地鼠", "接水果", "接金币", "点击得分", "节奏", "点按", "躲避障碍", "弹珠", "flappy", "跳跳", "弹球", "打飞机", "切水果"],
        "控制闯关/物理型": ["马里奥", "超级玛丽", "黄金矿工", "神庙逃亡", "跳一跳", "跑酷", "平台跳跃", "射击", "飞机大战", "雷电", "坦克", "小球控制", "重力", "物理", "碰撞", "赛车", "摩托", "忍者"],
        "教育练习型": ["背单词", "记单词", "单词闯关", "拼写挑战", "英语配对", "听词选义", "单词消消乐", "记忆翻牌", "口算闯关", "知识竞答", "成语接龙", "成语闯关", "答题闯关", "数学游戏", "算数", "单词游戏", "记忆游戏"],
        "剧情互动型": ["文字冒险", "多结局", "互动小说", "分支剧情", "剧情选择", "rpg", "角色扮演"],
        "经营养成型": ["模拟开店", "农场", "电子宠物", "养成", "升级", "经营", "建造", "放置", "宠物"],
        "策略战斗型": ["植物大战僵尸", "塔防", "卡牌", "回合战斗", "阵容", "技能对战", "斗地主", "大富翁", "麻将", "扑克", "德州", "moba"],
        "多人社交型": ["双人", "对战", "联机", "排行榜竞技", "派对"],
        "规则问答型": ["答题", "猜数字", "猜词", "问答", "竞答", "答题游戏", "知识问答"]
    },
    "non_game": {
        "决策工具": ["抽奖", "转盘", "抽签", "随机决定", "做决定", "抽卡", "翻牌", "运势", "占卜", "塔罗", "随机选择"],
        "测评工具": ["测试", "问卷", "mbti", "性格测试", "能力测试", "测评", "调查", "量表"],
        "实用工具": ["计时器", "倒计时", "计算器", "计数器", "提醒", "时钟", "闹钟"],
        "展示工具": ["展示", "演示", "轮播", "相册", "展示页", "展示工具"]
    },
    "ambiguous_indicators": ["做个游戏", "做个小游戏", "开发一个游戏", "帮我写个游戏", "游戏app", "小游戏", "game", "玩游戏", "游戏开发"]
}

GAME_NAME_MAPPING = {
    "俄罗斯方块": {"category": "棋盘格子型", "aliases": ["tetris", "方块"]},
    "贪吃蛇": {"category": "棋盘格子型", "aliases": ["snake", "吃蛇"]},
    "扫雷": {"category": "棋盘格子型", "aliases": ["minesweeper", "雷"]},
    "推箱子": {"category": "棋盘格子型", "aliases": ["sokoban"]},
    "2048": {"category": "棋盘格子型", "aliases": []},
    "五子棋": {"category": "棋盘格子型", "aliases": ["连珠"]},
    "马里奥": {"category": "控制闯关/物理型", "aliases": ["超级玛丽", "mario"]},
    "黄金矿工": {"category": "控制闯关/物理型", "aliases": ["miner", "挖矿"]},
    "神庙逃亡": {"category": "控制闯关/物理型", "aliases": ["temple run", "跑酷"]},
    "跳一跳": {"category": "控制闯关/物理型", "aliases": []},
    "植物大战僵尸": {"category": "策略战斗型", "aliases": ["pvz", "僵尸游戏"]},
    "斗地主": {"category": "策略战斗型", "aliases": ["doudizhu"]},
    "大富翁": {"category": "策略战斗型", "aliases": ["monopoly"]},
    "电子宠物": {"category": "经营养成型", "aliases": ["tamagotchi"]},
    "打地鼠": {"category": "单屏反应型", "aliases": ["whack-a-mole"]},
    "flappy bird": {"category": "单屏反应型", "aliases": ["flappy", "飞鸟"]},
    "背单词": {"category": "教育练习型", "aliases": ["单词记忆", "记单词"]},
    "成语接龙": {"category": "规则问答型", "aliases": ["接龙"]}
}

# 交互方式关键词
INTERACTION_KEYWORDS = {
    "点击选择型": ["点击", "选择", "按钮", "选项", "tap"],
    "拖拽操作型": ["拖拽", "拖动", "滑动", "drag", "swipe"],
    "键盘控制型": ["键盘", "方向键", "wasd", "按键", "key"],
    "连续触控型": ["连续", "触控", "触摸", "touch"],
    "文本输入型": ["输入", "文本", "打字", "input", "text"],
    "回合决策型": ["回合", "回合制", "turn"],
    "混合交互型": ["混合", "多种"]
}

# 技术依赖关键词
TECH_DEPENDENCY_KEYWORDS = {
    "Canvas绘制型": ["canvas", "绘制", "渲染", "draw", "render"],
    "物理/碰撞型": ["物理", "碰撞", "physics", "collision"],
    "动画增强型": ["动画", "animation", "动效", "过渡"],
    "音频强依赖型": ["音效", "音乐", "音频", "sound", "audio"],
    "联网同步型": ["联网", "同步", "多人", "网络", "socket"]
}

def load_data():
    """加载两个JSON文件"""
    with open('data/games_app.json', 'r', encoding='utf-8') as f:
        app_data = json.load(f)
    with open('data/games_web.json', 'r', encoding='utf-8') as f:
        web_data = json.load(f)
    return app_data, web_data

def extract_text_content(project: Dict) -> Tuple[str, List[str]]:
    """提取项目的所有文本内容用于分析"""
    texts = []

    # 1. initial_prompt
    initial_prompt = project.get('initial_prompt', '')
    texts.append(initial_prompt)

    # 2. conversations 中的用户消息
    conversation_signals = []
    tool_signals = []
    problem_signals = []

    conversations = project.get('conversations', {})
    for conv_id, conv in conversations.items():
        messages = conv.get('messages', [])
        for msg in messages:
            content_type = msg.get('content_type', '')
            text = msg.get('text', '')

            if content_type == 'user' and text:
                texts.append(text)
                conversation_signals.append(f"[用户] {text[:200]}")
            elif content_type == 'assistant' and text:
                texts.append(text)
            elif content_type == 'tool_response':
                tool_calls = msg.get('tool_calls', [])
                for tc in tool_calls:
                    tool_name = tc.get('name', '')
                    tool_signals.append(f"[工具] {tool_name}")

    # 3. problem_summaries
    msg_stats = project.get('msg_classified_stats', {})
    problem_summaries = msg_stats.get('problem_summaries', [])
    for ps in problem_summaries:
        texts.append(ps)
        problem_signals.append(ps)

    # 4. complexity
    complexity = project.get('complexity', '')
    if complexity:
        texts.append(complexity)

    full_text = ' '.join(texts).lower()
    return full_text, conversation_signals, tool_signals, problem_signals

def check_game_reference(text: str) -> Tuple[bool, str, str, str, float]:
    """检查是否引用了已知游戏"""
    text_lower = text.lower()

    for game_name, info in GAME_NAME_MAPPING.items():
        # 检查主名称
        if game_name.lower() in text_lower:
            return True, game_name, game_name, info['category'], 0.95

        # 检查别名
        for alias in info['aliases']:
            if alias.lower() in text_lower:
                return True, game_name, alias, info['category'], 0.85

    return False, '', '', '', 0.0

def rule_classify(project: Dict) -> Dict:
    """规则分类器"""
    full_text, conv_signals, tool_signals, problem_signals = extract_text_content(project)
    text_lower = full_text.lower()

    result = {
        'rule_hit': False,
        'rule_source': None,
        'decision_status': None,
        'main_category': None,
        'confidence': 0.0,
        'rule_match_signals': [],
        'reference_game_detected': False,
        'reference_game_name': '',
        'reference_game_alias': '',
        'reference_mapping_category': '',
        'reference_confidence': 0.0
    }

    # 1. 检查已知游戏引用
    ref_detected, ref_name, ref_alias, ref_category, ref_conf = check_game_reference(text_lower)
    if ref_detected:
        result['reference_game_detected'] = True
        result['reference_game_name'] = ref_name
        result['reference_game_alias'] = ref_alias
        result['reference_mapping_category'] = ref_category
        result['reference_confidence'] = ref_conf
        result['rule_hit'] = True
        result['rule_source'] = 'game_reference'
        result['decision_status'] = 'explicit_game'
        result['main_category'] = ref_category
        result['confidence'] = ref_conf
        result['rule_match_signals'].append(f"已知游戏引用: {ref_name}")
        return result

    # 2. 检查明确游戏关键词
    category_matches = {}
    for category, keywords in RULES['explicit_game'].items():
        for kw in keywords:
            if kw.lower() in text_lower:
                if category not in category_matches:
                    category_matches[category] = []
                category_matches[category].append(kw)

    # 3. 检查非游戏关键词
    non_game_matches = {}
    for ng_type, keywords in RULES['non_game'].items():
        for kw in keywords:
            if kw.lower() in text_lower:
                if ng_type not in non_game_matches:
                    non_game_matches[ng_type] = []
                non_game_matches[ng_type].append(kw)

    # 4. 检查模糊指示词
    ambiguous_hits = []
    for amb in RULES['ambiguous_indicators']:
        if amb.lower() in text_lower:
            ambiguous_hits.append(amb)

    # 5. 决策逻辑
    # 如果有明确游戏关键词命中
    if category_matches:
        # 检查是否有冲突
        if len(category_matches) == 1:
            category = list(category_matches.keys())[0]
            result['rule_hit'] = True
            result['rule_source'] = 'explicit_game_keyword'
            result['decision_status'] = 'explicit_game'
            result['main_category'] = category
            result['confidence'] = 0.85
            result['rule_match_signals'].append(f"游戏关键词命中: {category} -> {category_matches[category]}")
        else:
            # 多类别命中，记录冲突
            result['rule_hit'] = True
            result['rule_source'] = 'explicit_game_keyword_conflict'
            result['decision_status'] = 'explicit_game'
            # 选择命中最多的类别
            max_cat = max(category_matches.keys(), key=lambda x: len(category_matches[x]))
            result['main_category'] = max_cat
            result['confidence'] = 0.70
            result['rule_match_signals'].append(f"多类别命中: {category_matches}")
        return result

    # 如果有非游戏关键词命中
    if non_game_matches:
        result['rule_hit'] = True
        result['rule_source'] = 'non_game_keyword'
        result['decision_status'] = 'non_game_interactive'
        result['main_category'] = None
        result['confidence'] = 0.85
        result['rule_match_signals'].append(f"非游戏关键词命中: {non_game_matches}")
        return result

    # 如果只有模糊指示词
    if ambiguous_hits and not category_matches and not non_game_matches:
        result['rule_hit'] = True
        result['rule_source'] = 'ambiguous_indicator'
        result['decision_status'] = 'ambiguous_game_request'
        result['main_category'] = None
        result['confidence'] = 0.75
        result['rule_match_signals'].append(f"模糊指示词命中: {ambiguous_hits}")
        return result

    # 规则未命中
    result['rule_hit'] = False
    result['rule_source'] = None
    return result

def determine_interaction_modes(text: str) -> List[str]:
    """确定交互方式"""
    modes = []
    text_lower = text.lower()

    for mode, keywords in INTERACTION_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in text_lower:
                if mode not in modes:
                    modes.append(mode)
                break

    return modes if modes else ["点击选择型"]

def determine_tech_dependencies(text: str) -> List[str]:
    """确定技术依赖"""
    deps = []
    text_lower = text.lower()

    for dep, keywords in TECH_DEPENDENCY_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in text_lower:
                if dep not in deps:
                    deps.append(dep)
                break

    return deps if deps else ["纯UI组件型"]

def determine_realtime_level(text: str) -> str:
    """确定实时性"""
    text_lower = text.lower()

    if any(kw in text_lower for kw in ['实时', '即时', '实时性', '帧', '动画循环', 'game loop']):
        return '强实时'
    if any(kw in text_lower for kw in ['回合', 'turn', '等待', '选择后']):
        return '静态回合制'
    return '轻实时'

def determine_state_complexity(project: Dict) -> str:
    """确定状态复杂度"""
    msg_count = project.get('message_count', 0)
    complexity = project.get('complexity', 'simple')
    conv_count = project.get('conversation_count', 0)

    if complexity == 'complex' or msg_count > 100:
        return '高'
    if complexity == 'medium' or msg_count > 30:
        return '中'
    return '低'

def determine_generation_difficulty(main_category: str, tech_deps: List[str], state_complexity: str) -> Tuple[str, List[str]]:
    """确定生成难度"""
    reasons = []

    if not main_category:
        return 'L1', ['未分类项目']

    # 基础难度映射
    base_difficulty = {
        '规则问答型': 'L1',
        '棋盘格子型': 'L2',
        '单屏反应型': 'L2',
        '教育练习型': 'L2',
        '剧情互动型': 'L2',
        '经营养成型': 'L3',
        '策略战斗型': 'L3',
        '控制闯关/物理型': 'L3',
        '多人社交型': 'L4'
    }

    level = base_difficulty.get(main_category, 'L2')

    # 根据技术依赖调整
    if '物理/碰撞型' in tech_deps:
        level = 'L3' if level in ['L1', 'L2'] else level
        reasons.append('需要物理引擎')

    if '联网同步型' in tech_deps:
        level = 'L4'
        reasons.append('需要联网同步')

    if 'Canvas绘制型' in tech_deps:
        if level in ['L1']:
            level = 'L2'
        reasons.append('需要Canvas渲染')

    # 根据状态复杂度调整
    if state_complexity == '高' and level in ['L1', 'L2']:
        level = 'L3'
        reasons.append('状态复杂度高')

    if state_complexity == '很高':
        level = 'L4'
        reasons.append('状态复杂度很高')

    if not reasons:
        reasons.append(f'主分类: {main_category}')

    return level, reasons

def analyze_requirement_expression(text: str, ref_detected: bool) -> str:
    """分析需求表达方式"""
    if ref_detected:
        return '现有游戏引用型'

    text_lower = text.lower()

    if any(kw in text_lower for kw in ['类似', '像', '仿照', '模仿', '参考']):
        return '模仿参考型'
    if any(kw in text_lower for kw in ['实现', '功能', '需要', '要求']):
        return '目标导向型'
    if any(kw in text_lower for kw in ['氛围', '风格', '创意', '独特']):
        return '氛围创意型'
    if len(text) < 20:
        return '模糊一句话型'

    return '直接玩法型'

def create_annotation(project: Dict, rule_result: Dict, needs_llm: bool = False) -> Dict:
    """创建项目标注"""
    full_text, conv_signals, tool_signals, problem_signals = extract_text_content(project)

    # 如果需要LLM判别，创建基础标注并标记
    if needs_llm:
        return {
            'project_id': project.get('project_id', ''),
            'project_type': project.get('project_type', ''),
            'judge_source': 'pending_llm',
            'judge_confidence': 0.0,
            'decision_status': 'pending',
            'is_game_project': None,
            'main_category': None,
            'main_category_confidence': 0.0,
            'reference_game_detected': rule_result.get('reference_game_detected', False),
            'reference_game_name': rule_result.get('reference_game_name', ''),
            'reference_game_alias': rule_result.get('reference_game_alias', ''),
            'reference_mapping_category': rule_result.get('reference_mapping_category', ''),
            'reference_confidence': rule_result.get('reference_confidence', 0.0),
            'aux_tags': {
                'interaction_mode': determine_interaction_modes(full_text),
                'realtime_level': determine_realtime_level(full_text),
                'state_complexity': determine_state_complexity(project),
                'implementation_dependency': determine_tech_dependencies(full_text),
                'content_asset_dependency': '低',
                'platform_adaptation': ['Web优先'] if project.get('project_type') == 'web' else ['移动端优先'],
                'requirement_expression_type': analyze_requirement_expression(full_text, rule_result.get('reference_game_detected', False))
            },
            'generation_difficulty': 'L2',
            'generation_difficulty_reason': ['待LLM判别'],
            'initial_goal': project.get('initial_prompt', '')[:500],
            'final_goal': '',
            'requirement_changed': False,
            'requirement_evolution_summary': '',
            'ideal_tech_route': [],
            'observed_tech_route': [],
            'tech_route_gap': [],
            'risk_points': [],
            'likely_failure_stage': [],
            'needs_clarification': True,
            'special_optimization_value': '',
            'should_templateize': False,
            'should_build_runtime_support': False,
            'should_include_in_benchmark': False,
            'evidence': {
                'initial_prompt': project.get('initial_prompt', ''),
                'conversation_signals': conv_signals[:10],
                'tool_or_runtime_signals': tool_signals[:10],
                'problem_signals': problem_signals,
                'rule_match_signals': rule_result.get('rule_match_signals', [])
            }
        }

    # 规则命中，直接生成标注
    decision_status = rule_result.get('decision_status', 'ambiguous_game_request')
    main_category = rule_result.get('main_category')

    interaction_modes = determine_interaction_modes(full_text)
    tech_deps = determine_tech_dependencies(full_text)
    state_complexity = determine_state_complexity(project)
    gen_diff, gen_reasons = determine_generation_difficulty(main_category, tech_deps, state_complexity)

    is_game = decision_status in ['explicit_game', 'ambiguous_game_request']
    needs_clarification = decision_status == 'ambiguous_game_request'

    return {
        'project_id': project.get('project_id', ''),
        'project_type': project.get('project_type', ''),
        'judge_source': 'rule',
        'judge_confidence': rule_result.get('confidence', 0.0),
        'decision_status': decision_status,
        'is_game_project': is_game,
        'main_category': main_category,
        'main_category_confidence': rule_result.get('confidence', 0.0) if main_category else 0.0,
        'reference_game_detected': rule_result.get('reference_game_detected', False),
        'reference_game_name': rule_result.get('reference_game_name', ''),
        'reference_game_alias': rule_result.get('reference_game_alias', ''),
        'reference_mapping_category': rule_result.get('reference_mapping_category', ''),
        'reference_confidence': rule_result.get('reference_confidence', 0.0),
        'aux_tags': {
            'interaction_mode': interaction_modes,
            'realtime_level': determine_realtime_level(full_text),
            'state_complexity': state_complexity,
            'implementation_dependency': tech_deps,
            'content_asset_dependency': '低',
            'platform_adaptation': ['Web优先'] if project.get('project_type') == 'web' else ['移动端优先'],
            'requirement_expression_type': analyze_requirement_expression(full_text, rule_result.get('reference_game_detected', False))
        },
        'generation_difficulty': gen_diff,
        'generation_difficulty_reason': gen_reasons,
        'initial_goal': project.get('initial_prompt', '')[:500],
        'final_goal': '',
        'requirement_changed': False,
        'requirement_evolution_summary': '',
        'ideal_tech_route': [],
        'observed_tech_route': [],
        'tech_route_gap': [],
        'risk_points': [],
        'likely_failure_stage': [],
        'needs_clarification': needs_clarification,
        'special_optimization_value': '',
        'should_templateize': decision_status == 'explicit_game' and gen_diff in ['L1', 'L2'],
        'should_build_runtime_support': gen_diff in ['L3', 'L4'],
        'should_include_in_benchmark': True,
        'evidence': {
            'initial_prompt': project.get('initial_prompt', ''),
            'conversation_signals': conv_signals[:10],
            'tool_or_runtime_signals': tool_signals[:10],
            'problem_signals': problem_signals,
            'rule_match_signals': rule_result.get('rule_match_signals', [])
        }
    }

def run_rule_pass():
    """执行规则判别"""
    print("加载数据...")
    app_data, web_data = load_data()
    all_data = app_data + web_data

    print(f"总项目数: {len(all_data)} (App: {len(app_data)}, Web: {len(web_data)})")

    rule_annotations = []
    llm_pending = []

    stats = {
        'total': len(all_data),
        'rule_hit': 0,
        'rule_miss': 0,
        'explicit_game': 0,
        'ambiguous_game_request': 0,
        'non_game_interactive': 0,
        'by_source': defaultdict(int),
        'by_category': defaultdict(int),
        'reference_game_count': 0
    }

    for i, project in enumerate(all_data):
        if (i + 1) % 100 == 0:
            print(f"处理进度: {i+1}/{len(all_data)}")

        rule_result = rule_classify(project)

        if rule_result['rule_hit']:
            stats['rule_hit'] += 1
            stats['by_source'][rule_result['rule_source']] += 1

            if rule_result['decision_status'] == 'explicit_game':
                stats['explicit_game'] += 1
                if rule_result['main_category']:
                    stats['by_category'][rule_result['main_category']] += 1
            elif rule_result['decision_status'] == 'ambiguous_game_request':
                stats['ambiguous_game_request'] += 1
            elif rule_result['decision_status'] == 'non_game_interactive':
                stats['non_game_interactive'] += 1

            if rule_result['reference_game_detected']:
                stats['reference_game_count'] += 1

            annotation = create_annotation(project, rule_result, needs_llm=False)
            rule_annotations.append(annotation)
        else:
            stats['rule_miss'] += 1
            annotation = create_annotation(project, rule_result, needs_llm=True)
            llm_pending.append(annotation)

    # 输出统计
    print("\n" + "="*60)
    print("规则判别统计")
    print("="*60)
    print(f"总项目数: {stats['total']}")
    print(f"规则命中: {stats['rule_hit']} ({stats['rule_hit']/stats['total']*100:.1f}%)")
    print(f"规则未命中(需LLM): {stats['rule_miss']} ({stats['rule_miss']/stats['total']*100:.1f}%)")
    print(f"\n决策状态分布:")
    print(f"  - explicit_game: {stats['explicit_game']}")
    print(f"  - ambiguous_game_request: {stats['ambiguous_game_request']}")
    print(f"  - non_game_interactive: {stats['non_game_interactive']}")
    print(f"\n规则来源分布:")
    for source, count in sorted(stats['by_source'].items(), key=lambda x: -x[1]):
        print(f"  - {source}: {count}")
    print(f"\n主分类分布:")
    for cat, count in sorted(stats['by_category'].items(), key=lambda x: -x[1]):
        print(f"  - {cat}: {count}")
    print(f"\n已知游戏引用: {stats['reference_game_count']}")

    # 保存结果
    output_dir = Path('outputs/game_analysis')
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(output_dir / 'rule_pass_summary.json', 'w', encoding='utf-8') as f:
        json.dump({
            'stats': {k: dict(v) if isinstance(v, defaultdict) else v for k, v in stats.items()},
            'rule_annotations_count': len(rule_annotations),
            'llm_pending_count': len(llm_pending)
        }, f, ensure_ascii=False, indent=2)

    # 分离app和web
    app_annotations = [a for a in rule_annotations if a['project_type'] == 'app']
    web_annotations = [a for a in rule_annotations if a['project_type'] == 'web']

    app_pending = [a for a in llm_pending if a['project_type'] == 'app']
    web_pending = [a for a in llm_pending if a['project_type'] == 'web']

    # 保存规则命中的标注
    with open(output_dir / 'app_rule_annotations.jsonl', 'w', encoding='utf-8') as f:
        for ann in app_annotations:
            f.write(json.dumps(ann, ensure_ascii=False) + '\n')

    with open(output_dir / 'web_rule_annotations.jsonl', 'w', encoding='utf-8') as f:
        for ann in web_annotations:
            f.write(json.dumps(ann, ensure_ascii=False) + '\n')

    # 保存待LLM处理的样本
    with open(output_dir / 'app_llm_pending.jsonl', 'w', encoding='utf-8') as f:
        for ann in app_pending:
            f.write(json.dumps(ann, ensure_ascii=False) + '\n')

    with open(output_dir / 'web_llm_pending.jsonl', 'w', encoding='utf-8') as f:
        for ann in web_pending:
            f.write(json.dumps(ann, ensure_ascii=False) + '\n')

    # 生成Markdown报告
    with open(output_dir / 'rule_pass_summary.md', 'w', encoding='utf-8') as f:
        f.write("# 规则判别结果摘要\n\n")
        f.write("## 总体统计\n\n")
        f.write(f"- **总项目数**: {stats['total']}\n")
        f.write(f"- **规则命中**: {stats['rule_hit']} ({stats['rule_hit']/stats['total']*100:.1f}%)\n")
        f.write(f"- **规则未命中(需LLM兜底)**: {stats['rule_miss']} ({stats['rule_miss']/stats['total']*100:.1f}%)\n\n")

        f.write("## 决策状态分布\n\n")
        f.write(f"| 状态 | 数量 | 占比 |\n")
        f.write(f"|------|------|------|\n")
        f.write(f"| explicit_game | {stats['explicit_game']} | {stats['explicit_game']/stats['total']*100:.1f}% |\n")
        f.write(f"| ambiguous_game_request | {stats['ambiguous_game_request']} | {stats['ambiguous_game_request']/stats['total']*100:.1f}% |\n")
        f.write(f"| non_game_interactive | {stats['non_game_interactive']} | {stats['non_game_interactive']/stats['total']*100:.1f}% |\n\n")

        f.write("## 规则来源分布\n\n")
        f.write(f"| 来源 | 数量 |\n")
        f.write(f"|------|------|\n")
        for source, count in sorted(stats['by_source'].items(), key=lambda x: -x[1]):
            f.write(f"| {source} | {count} |\n")

        f.write("\n## 主分类分布\n\n")
        f.write(f"| 分类 | 数量 |\n")
        f.write(f"|------|------|\n")
        for cat, count in sorted(stats['by_category'].items(), key=lambda x: -x[1]):
            f.write(f"| {cat} | {count} |\n")

        f.write(f"\n## 已知游戏引用\n\n")
        f.write(f"引用已知游戏的项目数: **{stats['reference_game_count']}**\n")

    print("\n结果已保存到 outputs/game_analysis/")

    return stats, rule_annotations, llm_pending

if __name__ == '__main__':
    run_rule_pass()
