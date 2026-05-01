#!/usr/bin/env python3
"""Extract gameplay data tables from rule-based game annotations."""

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
ANNOTATION_DIR = BASE_DIR / "outputs" / "game_analysis"
DEFAULT_OUTPUT_DIR = ANNOTATION_DIR

CATEGORIES = [
    "棋盘格子型",
    "控制闯关/物理型",
    "经营养成型",
    "策略战斗型",
    "单屏反应型",
    "规则问答型",
    "多人社交型",
    "教育练习型",
    "剧情互动型",
]

DIFFICULTY_LEVELS = ["L1", "L2", "L3", "L4"]

FEATURE_LEXICON = [
    "关卡",
    "升级",
    "排名",
    "boss",
    "成就",
    "解锁",
    "数值",
    "金币",
    "装备",
    "技能",
    "PVP",
    "联机",
    "多人",
    "对战",
    "匹配",
    "自动",
    "无尽",
    "无限",
    "挑战",
    "冒险",
    "任务",
    "支线",
    "背包",
    "收集",
    "图鉴",
    "合成",
    "抽奖",
    "宝箱",
    "碎片",
    "重生",
    "成长",
    "皮肤",
    "道具",
    "礼包",
    "每日",
    "签到",
    "转生",
    "荣誉",
    "段位",
    "排行榜",
]

CODE_SIGNATURES = [
    "<!DOCTYPE",
    "<html",
    "<script",
    "<style",
    "<body",
    "const ",
    "let ",
    "var ",
    "function(",
    "function ",
    "import ",
    "export ",
    "class ",
    "=> {",
    "=> (",
    "html",
    "javascript",
    "ts",
    "js",
    "```python",
    "def ",
    "#include",
    "package ",
]

META_PROMPT_SIGNATURES = [
    "任务目标是",
    "禁止更换任务目标",
    "禁止展示",
    "禁止娱乐化",
    "你将同时担任",
    "你是一个",
    "你是一名",
    "## 一、",
    "### 一、",
    "提示词",
    "prompt",
    "系统提示",
]

CATEGORY_SPECIFIC_LEXICON = {
    "棋盘格子型": [
        "方块",
        "消除",
        "连线",
        "连珠",
        "翻牌",
        "三消",
        "填格",
        "格子",
        "旋转",
        "下落",
        "成行",
        "成列",
        "邻居",
        "颜色匹配",
        "拼图",
    ],
    "控制闯关/物理型": [
        "跳跃",
        "跳跃力",
        "重力",
        "摩擦",
        "弹跳",
        "碰撞",
        "平台",
        "滑动",
        "冲刺",
        "闪避",
        "障碍",
        "陷阱",
        "跑酷",
        "横版",
        "射击",
        "滚动",
        "追逐",
        "地形",
        "速度",
        "手感",
    ],
    "经营养成型": [
        "资源",
        "循环",
        "经济",
        "产出",
        "消耗",
        "离线",
        "挂机",
        "建造",
        "种植",
        "养成",
        "饲养",
        "繁殖",
        "喂食",
        "情绪",
        "治愈",
        "碎片化",
        "轻度",
        "日常",
        "签到",
        "兑换",
    ],
    "策略战斗型": [
        "回合",
        "部署",
        "阵型",
        "塔防",
        "波次",
        "叫牌",
        "出牌",
        "牌型",
        "洗牌",
        "发牌",
        "筹码",
        "下注",
        "押注",
        "阳光",
        "法力",
        "冷却",
        "单位",
    ],
    "单屏反应型": [
        "反应",
        "节奏",
        "节拍",
        "倒计时",
        "限时",
        "连击",
        "点击",
        "接住",
        "躲避",
        "命中",
        "精准",
        "判定",
    ],
    "规则问答型": [
        "题目",
        "题库",
        "选项",
        "答题",
        "正确",
        "错误",
        "解析",
        "知识点",
        "抢答",
        "限时答题",
    ],
    "多人社交型": [
        "房间",
        "大厅",
        "匹配",
        "同步",
        "广播",
        "聊天",
        "邀请",
        "观战",
        "组队",
        "战队",
        "语音",
        "弹幕",
        "公会",
        "好友",
        "段位",
    ],
    "教育练习型": [
        "跟读",
        "发音",
        "听写",
        "听力",
        "默写",
        "复述",
        "错题",
        "复习",
        "遗忘曲线",
        "拼写",
        "填空",
        "翻译",
        "艾宾浩斯",
        "单词本",
        "闪卡",
    ],
    "剧情互动型": [
        "分支",
        "选项",
        "选择",
        "支线",
        "对话",
        "立绘",
        "对白",
        "旁白",
        "章节",
        "结局",
        "好感度",
        "NPC",
        "剧情线",
    ],
}

LOW_SIGNAL_COMMON = ["自动", "关卡", "升级", "任务", "挑战", "道具", "金币"]

REFERENCE_ALIAS_MAP = {
    "tetris": "俄罗斯方块",
    "俄罗斯方块": "俄罗斯方块",
    "方块": "俄罗斯方块",
    "snake": "贪吃蛇",
    "贪吃蛇": "贪吃蛇",
    "吃蛇": "贪吃蛇",
    "minesweeper": "扫雷",
    "扫雷": "扫雷",
    "雷": "扫雷",
    "sokoban": "推箱子",
    "推箱子": "推箱子",
    "2048": "2048",
    "五子棋": "五子棋",
    "连珠": "五子棋",
    "mario": "马里奥",
    "马里奥": "马里奥",
    "超级玛丽": "马里奥",
    "miner": "黄金矿工",
    "黄金矿工": "黄金矿工",
    "挖矿": "黄金矿工",
    "temple run": "神庙逃亡",
    "神庙逃亡": "神庙逃亡",
    "跑酷": "神庙逃亡",
    "跳一跳": "跳一跳",
    "pvz": "植物大战僵尸",
    "植物大战僵尸": "植物大战僵尸",
    "僵尸": "植物大战僵尸",
    "doudizhu": "斗地主",
    "斗地主": "斗地主",
    "地主": "斗地主",
    "monopoly": "大富翁",
    "大富翁": "大富翁",
    "富翁": "大富翁",
    "tamagotchi": "电子宠物",
    "电子宠物": "电子宠物",
    "宠物养成": "电子宠物",
    "whack-a-mole": "打地鼠",
    "打地鼠": "打地鼠",
    "flappy bird": "flappy bird",
    "flappy": "flappy bird",
    "飞鸟": "flappy bird",
    "背单词": "背单词",
    "单词记忆": "背单词",
    "记单词": "背单词",
    "成语接龙": "成语接龙",
    "接龙": "成语接龙",
}


def warn(message):
    print(f"warning: {message}", file=sys.stderr)


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def truncate(text, limit):
    text = "" if text is None else str(text)
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "..."


def load_json(path):
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise SystemExit(f"missing file: {path}")


def load_jsonl(path):
    rows = []
    try:
        with path.open("r", encoding="utf-8") as f:
            for line_no, line in enumerate(f, 1):
                if not line.strip():
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError as exc:
                    warn(f"skip invalid json line: {path}:{line_no}: {exc}")
    except FileNotFoundError:
        raise SystemExit(f"missing file: {path}")
    return rows


def load_games():
    app_games = load_json(DATA_DIR / "games_app.json")
    web_games = load_json(DATA_DIR / "games_web.json")
    games_by_id = {}
    missing_prompt = 0
    for row in app_games + web_games:
        project_id = str(row.get("project_id") or "")
        if not project_id:
            warn("skip game row with missing project_id")
            continue
        if row.get("initial_prompt") is None:
            missing_prompt += 1
        games_by_id[project_id] = row
    if missing_prompt:
        warn(f"{missing_prompt} game rows have missing initial_prompt")
    return app_games, web_games, games_by_id


def load_annotations():
    app_rows = load_jsonl(ANNOTATION_DIR / "app_annotations.jsonl")
    web_rows = load_jsonl(ANNOTATION_DIR / "web_annotations.jsonl")
    return app_rows, web_rows


def load_reference_alias_map():
    alias_map = {key.lower(): value for key, value in REFERENCE_ALIAS_MAP.items()}
    dictionary_path = ANNOTATION_DIR / "rule_dictionary.json"
    if not dictionary_path.exists():
        warn(f"rule dictionary not found for alias enrichment: {dictionary_path}")
        return alias_map

    data = load_json(dictionary_path)
    for canonical, meta in data.get("game_name_mapping", {}).items():
        if not canonical:
            continue
        alias_map[str(canonical).strip().lower()] = str(canonical).strip()
        for alias in meta.get("alias", []) or []:
            if alias:
                alias_map[str(alias).strip().lower()] = str(canonical).strip()
    return alias_map


def normalize_reference(name, alias, alias_map):
    candidates = [name, alias]
    for candidate in candidates:
        if candidate is None:
            continue
        value = str(candidate).strip()
        if not value:
            continue
        canonical = alias_map.get(value.lower())
        if canonical:
            return canonical
    for candidate in candidates:
        if candidate is not None and str(candidate).strip():
            return str(candidate).strip()
    return ""


def zero_difficulty_counter():
    return {level: 0 for level in DIFFICULTY_LEVELS}


def sorted_counter_dict(counter):
    return {
        key: count
        for key, count in sorted(counter.items(), key=lambda item: (-item[1], str(item[0])))
        if count > 0
    }


def is_polluted_sample(query: str) -> tuple[bool, str]:
    """Return whether a sample is code/meta-prompt pollution and why."""
    q = (query or "").strip()
    q_head_code = q[:200].lower()
    for sig in CODE_SIGNATURES:
        if sig.lower() in q_head_code:
            return True, f"code:{sig}"

    q_head_meta = q[:500].lower()
    meta_hits = sum(1 for sig in META_PROMPT_SIGNATURES if sig.lower() in q_head_meta)
    if meta_hits >= 2:
        return True, "meta-prompt-dense"
    if q.count("禁止") >= 3:
        return True, "meta-prompt-restrictive"
    return False, ""


def extract_reference_rankings(annotations, games_by_id, generated_at):
    alias_map = load_reference_alias_map()
    buckets = {}
    total_detected = 0
    missing_name = 0

    for row in annotations:
        if not row.get("reference_game_detected"):
            continue
        total_detected += 1
        name = row.get("reference_game_name")
        alias = row.get("reference_game_alias")
        canonical = normalize_reference(name, alias, alias_map)
        if not canonical:
            missing_name += 1
            continue

        project_id = str(row.get("project_id") or "")
        project_type = str(row.get("project_type") or "")
        game = games_by_id.get(project_id, {})
        query = game.get("initial_prompt")
        if query is None:
            query = row.get("initial_goal") or ""
            warn(f"use annotation initial_goal for missing query: {project_id}")

        bucket = buckets.setdefault(
            canonical,
            {
                "mention_count": 0,
                "app_count": 0,
                "web_count": 0,
                "difficulty": Counter(),
                "mapping_category": Counter(),
                "aliases": set(),
                "samples": [],
                "project_ids": [],
            },
        )
        bucket["mention_count"] += 1
        if project_type == "app":
            bucket["app_count"] += 1
        elif project_type == "web":
            bucket["web_count"] += 1
        difficulty = row.get("generation_difficulty")
        if difficulty in DIFFICULTY_LEVELS:
            bucket["difficulty"][difficulty] += 1
        category = row.get("reference_mapping_category") or row.get("main_category")
        if category:
            bucket["mapping_category"][category] += 1

        for variant in (name, alias):
            if variant is None:
                continue
            variant = str(variant).strip()
            if variant and variant != canonical:
                bucket["aliases"].add(variant)

        if project_id:
            bucket["project_ids"].append(project_id)
        bucket["samples"].append(
            {
                "project_id": project_id,
                "project_type": project_type,
                "query": str(query),
            }
        )

    if missing_name:
        warn(f"{missing_name} detected reference rows have missing reference_game_name/alias")

    ranked_items = sorted(
        buckets.items(),
        key=lambda item: (-item[1]["mention_count"], item[0]),
    )
    rankings = []
    singletons = {}

    for canonical, bucket in ranked_items:
        if bucket["mention_count"] < 2:
            singletons[canonical] = sorted(bucket["project_ids"])
            continue

        difficulty_distribution = zero_difficulty_counter()
        for level, count in bucket["difficulty"].items():
            difficulty_distribution[level] = count
        clean_sample_candidates = [
            sample for sample in bucket["samples"] if not is_polluted_sample(sample["query"])[0]
        ]
        samples = sorted(
            clean_sample_candidates,
            key=lambda sample: (-len(sample["query"]), sample["project_type"], sample["project_id"]),
        )[:3]
        rankings.append(
            {
                "rank": len(rankings) + 1,
                "reference_game_name": canonical,
                "aliases": sorted(bucket["aliases"]),
                "mapping_category": bucket["mapping_category"].most_common(1)[0][0]
                if bucket["mapping_category"]
                else "",
                "mention_count": bucket["mention_count"],
                "app_count": bucket["app_count"],
                "web_count": bucket["web_count"],
                "difficulty_distribution": difficulty_distribution,
                "sample_queries": [
                    {
                        "project_id": sample["project_id"],
                        "project_type": sample["project_type"],
                        "query": truncate(sample["query"], 120),
                    }
                    for sample in samples
                ],
            }
        )

    return {
        "generated_at": generated_at,
        "total_references_detected": total_detected,
        "total_unique_games": len(buckets),
        "rankings": rankings,
        "singletons": singletons,
    }


def lexicon_matches(query, lexicon):
    query_text = "" if query is None else str(query)
    query_lower = query_text.lower()
    matches = []
    for word in lexicon:
        if word.lower() in query_lower:
            matches.append(word)
    return matches


def feature_matches(query):
    return lexicon_matches(query, FEATURE_LEXICON)


def flatten_coverage_points(value):
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        points = []
        for item in value:
            points.extend(flatten_coverage_points(item))
        return points
    if isinstance(value, dict):
        points = []
        for item in value.values():
            points.extend(flatten_coverage_points(item))
        return points
    return [str(value)] if str(value).strip() else []


def extract_category_keyword_stats(annotations, games_by_id, generated_at, source_counts):
    category_rows = {category: [] for category in CATEGORIES}
    skipped_missing_category = 0
    coverage_seen = False
    sample_filter_summary = {
        "total_high_difficulty_queries_scanned": 0,
        "polluted_code": 0,
        "polluted_meta_prompt": 0,
        "kept_for_sampling": 0,
        "by_category": {},
    }

    for row in annotations:
        if not row.get("is_game_project"):
            continue
        category = row.get("main_category")
        if category not in category_rows:
            skipped_missing_category += 1
            continue
        project_id = str(row.get("project_id") or "")
        game = games_by_id.get(project_id, {})
        query = game.get("initial_prompt")
        if query is None:
            query = row.get("initial_goal") or ""
            warn(f"use annotation initial_goal for missing query: {project_id}")
        aux_tags = row.get("aux_tags") if isinstance(row.get("aux_tags"), dict) else {}
        coverage_points = flatten_coverage_points(aux_tags.get("coverage_points"))
        if coverage_points:
            coverage_seen = True
        category_rows[category].append(
            {
                "project_id": project_id,
                "project_type": row.get("project_type") or game.get("project_type") or "",
                "difficulty": row.get("generation_difficulty") or "",
                "query": str(query),
                "coverage_points": coverage_points,
            }
        )

    if skipped_missing_category:
        warn(f"skip {skipped_missing_category} game rows with missing or out-of-scope main_category")
    if not coverage_seen:
        warn("aux_tags.coverage_points not found in rule annotations; coverage stats are empty")

    stats = {}
    for category in CATEGORIES:
        rows = category_rows[category]
        difficulty_counter = Counter(row["difficulty"] for row in rows if row["difficulty"] in DIFFICULTY_LEVELS)
        difficulty_distribution = zero_difficulty_counter()
        for level, count in difficulty_counter.items():
            difficulty_distribution[level] = count

        feature_counter = Counter()
        category_specific_counter = Counter()
        coverage_counter = Counter()
        for row in rows:
            for word in feature_matches(row["query"]):
                feature_counter[word] += 1
            for word in lexicon_matches(row["query"], CATEGORY_SPECIFIC_LEXICON.get(category, [])):
                category_specific_counter[word] += 1
            for point in row["coverage_points"]:
                coverage_counter[point] += 1

        high_difficulty = []
        category_filter_stats = {"scanned": 0, "filtered": 0, "kept": 0}
        for row in rows:
            if row["difficulty"] not in {"L3", "L4"}:
                continue
            category_filter_stats["scanned"] += 1
            sample_filter_summary["total_high_difficulty_queries_scanned"] += 1
            polluted, reason = is_polluted_sample(row["query"])
            if polluted:
                category_filter_stats["filtered"] += 1
                if reason.startswith("code:"):
                    sample_filter_summary["polluted_code"] += 1
                else:
                    sample_filter_summary["polluted_meta_prompt"] += 1
                continue
            category_filter_stats["kept"] += 1
            sample_filter_summary["kept_for_sampling"] += 1
            high_difficulty.append(row)
        sample_filter_summary["by_category"][category] = category_filter_stats
        high_difficulty.sort(
            key=lambda row: (
                -len(row["query"]),
                row["difficulty"],
                row["project_type"],
                row["project_id"],
            )
        )

        feature_freq = sorted_counter_dict(feature_counter)
        category_specific_freq = sorted_counter_dict(category_specific_counter)
        coverage_freq = sorted_counter_dict(coverage_counter)
        stats[category] = {
            "total_queries": len(rows),
            "difficulty_distribution": difficulty_distribution,
            "feature_word_freq": feature_freq,
            "top_10_features": list(feature_freq.keys())[:10],
            "category_specific_word_freq": category_specific_freq,
            "top_10_category_specific": list(category_specific_freq.keys())[:10],
            "coverage_point_freq": coverage_freq,
            "top_10_coverage_points": list(coverage_freq.keys())[:10],
            "high_difficulty_sample_queries": [
                {
                    "project_id": row["project_id"],
                    "project_type": row["project_type"],
                    "difficulty": row["difficulty"],
                    "query_length": len(row["query"]),
                    "query": row["query"],
                }
                for row in high_difficulty[:3]
            ],
        }

    return {
        "generated_at": generated_at,
        "source_counts": source_counts,
        "categorized_game_queries": sum(item["total_queries"] for item in stats.values()),
        "gameplay_feature_lexicon": FEATURE_LEXICON,
        "low_signal_common_words": LOW_SIGNAL_COMMON,
        "stats": stats,
    }, sample_filter_summary


def markdown_table(rows, headers):
    lines = []
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("|" + "|".join(["---"] * len(headers)) + "|")
    for row in rows:
        lines.append("| " + " | ".join(str(cell) for cell in row) + " |")
    return lines


def render_markdown(reference_data, keyword_data, generated_at, sample_filter_summary):
    source_counts = keyword_data["source_counts"]
    lines = [
        "# Gameplay Gap Analysis (真实数据提取)",
        "",
        f"数据基底：{source_counts['app']} app + {source_counts['web']} web = {source_counts['total']} 条 query，rule-based annotations。",
        f"生成时间：{generated_at}",
        "",
        "## 1. Reference Game Top-20",
    ]

    top_rows = []
    for item in reference_data["rankings"][:20]:
        top_rows.append(
            [
                item["rank"],
                item["reference_game_name"],
                item["mapping_category"],
                item["mention_count"],
                item["app_count"],
                item["web_count"],
                item["difficulty_distribution"].get("L4", 0),
            ]
        )
    lines.extend(markdown_table(top_rows, ["Rank", "Reference", "Category", "Mentions", "App", "Web", "L4"]))

    lines.append("")
    lines.append("## 2. 每类 query gameplay feature 词频（top 10）")
    for index, category in enumerate(CATEGORIES, 1):
        category_stats = keyword_data["stats"][category]
        dist = category_stats["difficulty_distribution"]
        lines.append("")
        lines.append(f"### 2.{index} {category}（n={category_stats['total_queries']}）")
        lines.append(
            "难度分布："
            + " / ".join(f"{level}={dist.get(level, 0)}" for level in DIFFICULTY_LEVELS)
        )
        feature_rows = [
            [
                f"{feature} (低信号)" if feature in LOW_SIGNAL_COMMON else feature,
                category_stats["feature_word_freq"][feature],
            ]
            for feature in category_stats["top_10_features"]
        ]
        lines.extend(markdown_table(feature_rows, ["Feature", "Freq"]))

    lines.append("")
    lines.append("## 2.X 每类专属特征词 top 10")
    for index, category in enumerate(CATEGORIES, 1):
        category_stats = keyword_data["stats"][category]
        lines.append("")
        lines.append(f"### 2.X.{index} {category}（n={category_stats['total_queries']}）")
        specific_rows = [
            [feature, category_stats["category_specific_word_freq"][feature]]
            for feature in category_stats["top_10_category_specific"]
        ]
        if specific_rows:
            lines.extend(markdown_table(specific_rows, ["Feature", "Freq"]))
        else:
            lines.append(f"该类专属词汇无命中，建议扩充 CATEGORY_SPECIFIC_LEXICON['{category}']")

    lines.append("")
    lines.append("## 3. 每类高难度 (L3/L4) 最长样本 query")
    for index, category in enumerate(CATEGORIES, 1):
        lines.append("")
        lines.append(f"### 3.{index} {category}")
        samples = keyword_data["stats"][category]["high_difficulty_sample_queries"]
        filtered_count = sample_filter_summary["by_category"].get(category, {}).get("filtered", 0)
        if not samples:
            lines.append("- 无")
            continue
        for sample in samples:
            lines.append(
                f"- [{sample['difficulty']}] `{sample['project_id']}`: {truncate(sample['query'], 200)}"
            )
            lines.append(f"    （长度={sample['query_length']}字，已过滤 {filtered_count} 条污染样本）")

    lines.append("")
    return "\n".join(lines)


def write_json(path, data):
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def print_sample_filtering_summary(summary):
    print("Sample filtering summary:", file=sys.stderr)
    print(
        f"  total high-difficulty queries scanned: {summary['total_high_difficulty_queries_scanned']}",
        file=sys.stderr,
    )
    print(f"  polluted (code): {summary['polluted_code']}", file=sys.stderr)
    print(f"  polluted (meta-prompt): {summary['polluted_meta_prompt']}", file=sys.stderr)
    print(f"  kept for sampling: {summary['kept_for_sampling']}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Extract gameplay data products from rule annotations.")
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="directory for generated outputs",
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    generated_at = now_iso()
    app_games, web_games, games_by_id = load_games()
    app_annotations, web_annotations = load_annotations()
    annotations = app_annotations + web_annotations
    source_counts = {
        "app": len(app_games),
        "web": len(web_games),
        "total": len(app_games) + len(web_games),
        "app_annotations": len(app_annotations),
        "web_annotations": len(web_annotations),
        "total_annotations": len(annotations),
    }

    reference_data = extract_reference_rankings(annotations, games_by_id, generated_at)
    keyword_data, sample_filter_summary = extract_category_keyword_stats(
        annotations, games_by_id, generated_at, source_counts
    )
    markdown = render_markdown(reference_data, keyword_data, generated_at, sample_filter_summary)

    write_json(output_dir / "reference_games_ranking.json", reference_data)
    write_json(output_dir / "category_keyword_stats.json", keyword_data)
    (output_dir / "gameplay_gap_analysis.md").write_text(markdown, encoding="utf-8")
    print_sample_filtering_summary(sample_filter_summary)

    print(f"wrote {output_dir / 'reference_games_ranking.json'}")
    print(f"wrote {output_dir / 'category_keyword_stats.json'}")
    print(f"wrote {output_dir / 'gameplay_gap_analysis.md'}")


if __name__ == "__main__":
    main()
