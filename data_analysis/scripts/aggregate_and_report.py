import json
import os
import math
import time
import requests
from collections import Counter, defaultdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
OUTPUT_DIR = os.path.join(DATA_DIR, "analysis_output")

API_URL = "https://api.deepseek.com/v1/chat/completions"
API_KEY = "sk-c3352e5b62dc485eac34a1aa759527c9"
MODEL = "deepseek-chat"

DIFFICULTY_WEIGHTS = {
    "w_complexity": 1.0,
    "w_runtime": 4.0,
    "complexity_base": {"simple": 0, "medium": 1, "complex": 3},
    "conv_penalty": {
        "conv_1_2": 0, "conv_3_4": 1, "conv_5_6": 2,
        "conv_7_10": 3, "conv_11_20": 5, "conv_20+": 7,
    },
    "neg_penalty": {"neg_0": 0, "neg_1": 1, "neg_2_3": 2, "neg_4+": 3},
    "no_done_penalty": 3.0,
}
DIFFICULTY_THRESHOLDS = {"easy": 2.0, "hard": 8.0}

NEGATIVE_FEEDBACK_TYPES = {"report_bug", "not_match", "repeat_issue", "quality_issue"}


def compute_difficulty(conversation_count, negative_count, has_done, complexity):
    w = DIFFICULTY_WEIGHTS
    cx_base = w["complexity_base"].get(complexity, 1)
    cp = w["conv_penalty"]
    if conversation_count <= 2:
        conv_pen = cp["conv_1_2"]
    elif conversation_count <= 4:
        conv_pen = cp["conv_3_4"]
    elif conversation_count <= 6:
        conv_pen = cp["conv_5_6"]
    elif conversation_count <= 10:
        conv_pen = cp["conv_7_10"]
    elif conversation_count <= 20:
        conv_pen = cp["conv_11_20"]
    else:
        conv_pen = cp["conv_20+"]

    np_ = w["neg_penalty"]
    if negative_count == 0:
        neg_pen = np_["neg_0"]
    elif negative_count == 1:
        neg_pen = np_["neg_1"]
    elif negative_count <= 3:
        neg_pen = np_["neg_2_3"]
    else:
        neg_pen = np_["neg_4+"]

    no_done_pen = 0 if has_done else w["no_done_penalty"]
    raw_runtime = conv_pen + neg_pen + no_done_pen
    score = w["w_complexity"] * cx_base + w["w_runtime"] * math.log2(1 + raw_runtime)

    if score < DIFFICULTY_THRESHOLDS["easy"]:
        level = "easy"
    elif score >= DIFFICULTY_THRESHOLDS["hard"]:
        level = "hard"
    else:
        level = "medium"
    return round(score, 2), level


def call_deepseek(prompt):
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"}
    payload = {"model": MODEL, "messages": [{"role": "user", "content": prompt}], "temperature": 0.1}
    for attempt in range(3):
        try:
            resp = requests.post(API_URL, headers=headers, json=payload, timeout=120)
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
        except Exception as e:
            if attempt < 2:
                time.sleep(3)
            else:
                raise


def aggregate_categories(cache):
    cats = Counter(v.get("game_category", "") for v in cache.values())
    cat_list = "\n".join(f"- {cat}: {count}个" for cat, count in cats.most_common())

    prompt = f"""你是一个游戏分类专家。以下是对682个小游戏的初始分类结果，共有{len(cats)}个类别。
请将这些类别归并为10-15个合理的大类。

## 当前类别分布
{cat_list}

## 要求
1. 合并同义/近义的类别（如"动作射击"和"动作格斗"可以合并为"动作类"）
2. 将数量极少(<=3)的长尾类别合并到最相近的大类
3. 大类名称简洁清晰
4. 输出一个JSON映射表，key是原始类别名，value是归并后的大类名

## 输出格式
仅输出JSON对象，无其他文字：
{{"原始类别1": "归并后大类", "原始类别2": "归并后大类", ...}}
"""
    print("正在调用LLM聚合分类...")
    response = call_deepseek(prompt)
    text = response.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    return json.loads(text)


def detect_has_done(project_data):
    conversations = project_data.get("conversations", {})
    for conv_id, conv in conversations.items():
        messages = conv.get("messages", [])
        for msg in messages:
            if msg.get("content_type") == "assistant":
                tool_calls = msg.get("tool_calls", [])
                for tc in tool_calls:
                    name = ""
                    if isinstance(tc, dict):
                        name = tc.get("name", "") or tc.get("function", {}).get("name", "")
                    if "deploy" in name.lower() or "done" in name.lower() or "build" in name.lower():
                        return True
            if msg.get("content_type") == "tool_response":
                text = str(msg.get("text", "")).lower()
                if "deployed" in text or "build success" in text or "deploy success" in text:
                    return True
    return False


def generate_analysis(games, label):
    if not games:
        return {"label": label, "total_projects": 0}

    cat_dist = Counter(g["game_category_merged"] for g in games)
    subcat_dist = Counter(g["game_subcategory"] for g in games)
    theme_dist = Counter(g["game_theme"] for g in games)
    tech_complexity_dist = Counter(g["technical_complexity"] for g in games)
    complexity_dist = Counter(g["complexity"] for g in games)
    diff_dist = Counter(g["difficulty_level"] for g in games)

    msg_counts = [g["message_count"] for g in games]
    conv_counts = [g["conversation_count"] for g in games]
    token_counts = [g["total_tokens"] for g in games]
    diff_scores = [g["difficulty_score"] for g in games]

    def stats(arr):
        s = sorted(arr)
        return {
            "avg": round(sum(s) / len(s), 1),
            "min": s[0], "max": s[-1],
            "median": s[len(s) // 2],
            "total": sum(s),
        }

    all_feedback = Counter()
    all_demand = Counter()
    total_problems = 0
    total_msgs = 0
    for g in games:
        for k, v in g.get("feedback_types", {}).items():
            all_feedback[k] += v
        for k, v in g.get("demand_types", {}).items():
            all_demand[k] += v
        total_problems += g.get("has_problem_count", 0)
        total_msgs += sum(g.get("demand_types", {}).values())

    cat_analysis = {}
    cat_groups = defaultdict(list)
    for g in games:
        cat_groups[g["game_category_merged"]].append(g)
    for cat, items in sorted(cat_groups.items(), key=lambda x: -len(x[1])):
        cat_diff = Counter(i["difficulty_level"] for i in items)
        cat_tech = Counter(i["technical_complexity"] for i in items)
        cat_cx = Counter(i["complexity"] for i in items)
        cat_tokens = [i["total_tokens"] for i in items]
        cat_msgs = [i["message_count"] for i in items]
        cat_neg = sum(i["negative_count"] for i in items)
        cat_problems = sum(i["has_problem_count"] for i in items)
        cat_subcats = Counter(i["game_subcategory"] for i in items)
        cat_analysis[cat] = {
            "count": len(items),
            "difficulty_distribution": dict(cat_diff),
            "technical_complexity_distribution": dict(cat_tech),
            "complexity_distribution": dict(cat_cx),
            "avg_tokens": round(sum(cat_tokens) / len(cat_tokens)),
            "avg_messages": round(sum(cat_msgs) / len(cat_msgs), 1),
            "total_negative_feedback": cat_neg,
            "total_problems": cat_problems,
            "top_subcategories": dict(cat_subcats.most_common(10)),
            "sample_prompts": [i["initial_prompt"][:120] for i in items[:5]],
        }

    diff_cross_tech = defaultdict(lambda: Counter())
    for g in games:
        diff_cross_tech[g["difficulty_level"]][g["technical_complexity"]] += 1

    diff_cross_cx = defaultdict(lambda: Counter())
    for g in games:
        diff_cross_cx[g["difficulty_level"]][g["complexity"]] += 1

    return {
        "label": label,
        "total_projects": len(games),
        "game_category_distribution": dict(cat_dist.most_common()),
        "top_subcategories": dict(subcat_dist.most_common(30)),
        "game_theme_distribution": dict(theme_dist.most_common(20)),
        "technical_complexity_distribution": dict(tech_complexity_dist),
        "complexity_distribution": dict(complexity_dist),
        "difficulty_distribution": dict(diff_dist),
        "message_stats": stats(msg_counts),
        "conversation_stats": stats(conv_counts),
        "token_stats": stats(token_counts),
        "difficulty_score_stats": stats(diff_scores),
        "feedback_distribution": dict(all_feedback.most_common()),
        "demand_distribution": dict(all_demand.most_common()),
        "problem_stats": {
            "total_classified_messages": total_msgs,
            "total_problems": total_problems,
            "problem_ratio": round(total_problems / total_msgs, 4) if total_msgs > 0 else 0,
        },
        "category_detailed_analysis": cat_analysis,
        "difficulty_x_technical_complexity": {k: dict(v) for k, v in diff_cross_tech.items()},
        "difficulty_x_complexity": {k: dict(v) for k, v in diff_cross_cx.items()},
    }


def generate_markdown(analysis, output_path):
    a = analysis
    lines = []
    lines.append(f"# {a['label']}\n")
    lines.append(f"**总项目数**: {a['total_projects']}\n")

    lines.append("## 1. 游戏类型分布\n")
    lines.append("| 游戏类型 | 数量 | 占比 |")
    lines.append("|---------|------|------|")
    for cat, count in a["game_category_distribution"].items():
        ratio = count / a["total_projects"] * 100
        lines.append(f"| {cat} | {count} | {ratio:.1f}% |")

    lines.append("\n## 2. 热门子类型 TOP15\n")
    lines.append("| 子类型 | 数量 |")
    lines.append("|-------|------|")
    for sub, count in list(a["top_subcategories"].items())[:15]:
        lines.append(f"| {sub} | {count} |")

    lines.append("\n## 3. 游戏主题分布 TOP15\n")
    lines.append("| 主题/IP | 数量 |")
    lines.append("|--------|------|")
    for theme, count in list(a["game_theme_distribution"].items())[:15]:
        lines.append(f"| {theme} | {count} |")

    lines.append("\n## 4. 难度评估\n")
    lines.append("### 4.1 Difficulty Level (基于运行时信息)\n")
    lines.append("| 难度等级 | 数量 | 占比 |")
    lines.append("|---------|------|------|")
    for level in ["easy", "medium", "hard"]:
        count = a["difficulty_distribution"].get(level, 0)
        ratio = count / a["total_projects"] * 100 if a["total_projects"] > 0 else 0
        lines.append(f"| {level} | {count} | {ratio:.1f}% |")

    ds = a["difficulty_score_stats"]
    lines.append(f"\n**难度分数**: 平均 {ds['avg']}, 中位数 {ds['median']}, 最小 {ds['min']}, 最大 {ds['max']}")

    lines.append("\n### 4.2 需求复杂度 (Complexity)\n")
    lines.append("| 复杂度 | 数量 | 占比 |")
    lines.append("|-------|------|------|")
    for level in ["simple", "medium", "complex"]:
        count = a["complexity_distribution"].get(level, 0)
        ratio = count / a["total_projects"] * 100 if a["total_projects"] > 0 else 0
        lines.append(f"| {level} | {count} | {ratio:.1f}% |")

    lines.append("\n### 4.3 技术实现难度\n")
    lines.append("| 技术难度 | 数量 | 占比 |")
    lines.append("|---------|------|------|")
    for level in ["low", "medium", "high"]:
        count = a["technical_complexity_distribution"].get(level, 0)
        ratio = count / a["total_projects"] * 100 if a["total_projects"] > 0 else 0
        lines.append(f"| {level} | {count} | {ratio:.1f}% |")

    lines.append("\n## 5. 消息与Token统计\n")
    ms = a["message_stats"]
    lines.append(f"- **消息数**: 平均 {ms['avg']}, 中位数 {ms['median']}, 最小 {ms['min']}, 最大 {ms['max']}")
    cs = a["conversation_stats"]
    lines.append(f"- **对话轮次**: 平均 {cs['avg']}, 中位数 {cs['median']}, 最小 {cs['min']}, 最大 {cs['max']}")
    ts = a["token_stats"]
    lines.append(f"- **Token消耗**: 平均 {ts['avg']:,}, 中位数 {ts['median']:,}, 最大 {ts['max']:,}, 总计 {ts['total']:,}")

    lines.append("\n## 6. 用户反馈分布\n")
    lines.append("| 反馈类型 | 数量 | 占比 |")
    lines.append("|---------|------|------|")
    total_fb = sum(a["feedback_distribution"].values())
    for ft, count in a["feedback_distribution"].items():
        ratio = count / total_fb * 100 if total_fb > 0 else 0
        lines.append(f"| {ft} | {count} | {ratio:.1f}% |")

    lines.append("\n## 7. 问题统计\n")
    ps = a["problem_stats"]
    lines.append(f"- **总分类消息数**: {ps['total_classified_messages']}")
    lines.append(f"- **问题消息数**: {ps['total_problems']}")
    lines.append(f"- **问题率**: {ps['problem_ratio'] * 100:.2f}%")

    lines.append("\n## 8. 难度×技术复杂度 交叉分析\n")
    lines.append("| 难度\\技术 | low | medium | high |")
    lines.append("|----------|-----|--------|------|")
    for level in ["easy", "medium", "hard"]:
        row = a["difficulty_x_technical_complexity"].get(level, {})
        cells = [str(row.get(t, 0)) for t in ["low", "medium", "high"]]
        lines.append(f"| {level} | {' | '.join(cells)} |")

    lines.append("\n## 9. 各游戏类型详细分析\n")
    for cat, detail in a["category_detailed_analysis"].items():
        lines.append(f"### {cat} ({detail['count']}个项目)\n")
        lines.append(f"- **难度分布**: {detail['difficulty_distribution']}")
        lines.append(f"- **技术难度**: {detail['technical_complexity_distribution']}")
        lines.append(f"- **需求复杂度**: {detail['complexity_distribution']}")
        lines.append(f"- **平均Token**: {detail['avg_tokens']:,}")
        lines.append(f"- **平均消息数**: {detail['avg_messages']}")
        lines.append(f"- **负反馈总数**: {detail['total_negative_feedback']}")
        lines.append(f"- **问题总数**: {detail['total_problems']}")
        lines.append(f"- **热门子类型**: {detail['top_subcategories']}")
        lines.append(f"- **示例需求**:")
        for sp in detail["sample_prompts"]:
            lines.append(f"  - {sp}")
        lines.append("")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main():
    print("=" * 60)
    print("阶段1: 聚合LLM分类结果")
    print("=" * 60)

    with open(os.path.join(OUTPUT_DIR, "llm_classify_cache.json"), "r", encoding="utf-8") as f:
        cache = json.load(f)

    category_mapping = aggregate_categories(cache)
    with open(os.path.join(OUTPUT_DIR, "category_mapping.json"), "w", encoding="utf-8") as f:
        json.dump(category_mapping, f, ensure_ascii=False, indent=2)
    print(f"分类映射已保存: {len(set(category_mapping.values()))} 个大类")

    print("\n" + "=" * 60)
    print("阶段2: 重新计算difficulty并构建完整数据")
    print("=" * 60)

    with open(os.path.join(OUTPUT_DIR, "mini_games_web.json"), "r", encoding="utf-8") as f:
        web_games = json.load(f)
    with open(os.path.join(OUTPUT_DIR, "mini_games_app.json"), "r", encoding="utf-8") as f:
        app_games = json.load(f)

    with open(os.path.join(DATA_DIR, "eval_classified.json"), "r", encoding="utf-8") as f:
        eval_data = json.load(f)
    eval_map = {item["project_id"]: item for item in eval_data}

    with open(os.path.join(DATA_DIR, "msg_classified.json"), "r", encoding="utf-8") as f:
        msg_data = json.load(f)
    msg_map = defaultdict(list)
    for m in msg_data:
        msg_map[m["project_id"]].append(m)

    all_games = web_games + app_games
    web_enriched = []
    app_enriched = []

    for i, game in enumerate(all_games):
        if i % 100 == 0:
            print(f"  处理项目 {i}/{len(all_games)}...")
        pid = game["project_id"]
        llm_result = cache.get(pid, {})
        eval_info = eval_map.get(pid, {})
        msgs = msg_map.get(pid, [])

        negative_count = sum(1 for m in msgs if m.get("feedback_type") in NEGATIVE_FEEDBACK_TYPES)
        has_done = detect_has_done(game)
        complexity = eval_info.get("complexity", game.get("complexity", "medium"))
        diff_score, diff_level = compute_difficulty(game["conversation_count"], negative_count, has_done, complexity)

        raw_cat = llm_result.get("game_category", "未分类")
        merged_cat = category_mapping.get(raw_cat, raw_cat)

        stats = game.get("msg_classified_stats", {})

        enriched = {
            "project_id": pid,
            "project_type": game["project_type"],
            "initial_prompt": game["initial_prompt"],
            "game_category": raw_cat,
            "game_category_merged": merged_cat,
            "game_subcategory": llm_result.get("game_subcategory", ""),
            "game_theme": llm_result.get("game_theme", ""),
            "technical_complexity": llm_result.get("technical_complexity", "medium"),
            "complexity": complexity,
            "difficulty_score": diff_score,
            "difficulty_level": diff_level,
            "message_count": game["message_count"],
            "conversation_count": game["conversation_count"],
            "total_tokens": game["total_tokens"],
            "negative_count": negative_count,
            "has_done": has_done,
            "has_problem_count": stats.get("has_problem_count", 0),
            "demand_types": stats.get("demand_types", {}),
            "feedback_types": stats.get("feedback_types", {}),
        }

        if game["project_type"] == "app":
            app_enriched.append(enriched)
        else:
            web_enriched.append(enriched)

    with open(os.path.join(OUTPUT_DIR, "games_final_web.json"), "w", encoding="utf-8") as f:
        json.dump(web_enriched, f, ensure_ascii=False, indent=2)
    with open(os.path.join(OUTPUT_DIR, "games_final_app.json"), "w", encoding="utf-8") as f:
        json.dump(app_enriched, f, ensure_ascii=False, indent=2)

    print(f"  Web: {len(web_enriched)}, App: {len(app_enriched)}")

    all_enriched = web_enriched + app_enriched
    diff_dist = Counter(g["difficulty_level"] for g in all_enriched)
    print(f"  难度分布: {dict(diff_dist)}")
    done_dist = Counter(g["has_done"] for g in all_enriched)
    print(f"  has_done分布: {dict(done_dist)}")

    print("\n" + "=" * 60)
    print("阶段3: 生成分析报告")
    print("=" * 60)

    agg_analysis = generate_analysis(all_enriched, "小游戏整体聚合统计分析报告")
    web_analysis = generate_analysis(web_enriched, "Web小游戏统计分析报告")
    app_analysis = generate_analysis(app_enriched, "App小游戏统计分析报告")

    with open(os.path.join(OUTPUT_DIR, "final_analysis_aggregate.json"), "w", encoding="utf-8") as f:
        json.dump(agg_analysis, f, ensure_ascii=False, indent=2)
    with open(os.path.join(OUTPUT_DIR, "final_analysis_web.json"), "w", encoding="utf-8") as f:
        json.dump(web_analysis, f, ensure_ascii=False, indent=2)
    with open(os.path.join(OUTPUT_DIR, "final_analysis_app.json"), "w", encoding="utf-8") as f:
        json.dump(app_analysis, f, ensure_ascii=False, indent=2)

    generate_markdown(agg_analysis, os.path.join(OUTPUT_DIR, "final_report_aggregate.md"))
    generate_markdown(web_analysis, os.path.join(OUTPUT_DIR, "final_report_web.md"))
    generate_markdown(app_analysis, os.path.join(OUTPUT_DIR, "final_report_app.md"))

    print("\n完成！生成文件:")
    for f in sorted(os.listdir(OUTPUT_DIR)):
        if f.startswith("final_"):
            fpath = os.path.join(OUTPUT_DIR, f)
            sz = os.path.getsize(fpath)
            if sz > 1024 * 1024:
                sz_str = f"{sz / 1024 / 1024:.1f} MB"
            elif sz > 1024:
                sz_str = f"{sz / 1024:.1f} KB"
            else:
                sz_str = f"{sz} B"
            print(f"  {f} ({sz_str})")


if __name__ == "__main__":
    main()
