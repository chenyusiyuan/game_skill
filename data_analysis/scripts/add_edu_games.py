import json
import os
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
CLEAN_DIR = os.path.join(DATA_DIR, "clean_project")

NEGATIVE_FEEDBACK_TYPES = {"report_bug", "not_match", "repeat_issue", "quality_issue"}


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def is_edu_game(text):
    t = text.replace('\n', ' ')

    exclude_patterns = [
        '专注力训练小程序',
        '铜鼓非遗',
        '提取长难句',
        '多语言学习网站',
        '课堂模块导航中心',
        'K12 教育.*AI数学小助手',
        'AI数学小助手',
        '足球教学方案',
        '番茄工作法',
        '互动时光轴',
        '全学段美育资源平台',
        '窦娥',
        'AI阅读/学习管家',
        'AI阅读',
        '拍照导入.*智能短文',
        '游戏策划导师',
        '火羽信息科技',
        '修订日期.*修订说明',
    ]
    for pat in exclude_patterns:
        import re
        if re.search(pat, t):
            return False

    strong_game_kws = ['背单词', '记单词', '打地鼠', '连连看', '翻翻卡', '消消乐', '跑酷']
    for kw in strong_game_kws:
        if kw in t:
            return True

    if any(kw in t for kw in ['打字训练', '打字练习', '键盘打字', '打字技能', '打字的网站', '盲打键盘', '指法练习', '指法键位', '英文单字打字', '在线打字']):
        return True

    if '小游戏' in t or '教学游戏' in t or '闯关游戏' in t:
        return True

    game_edu_combos = ['密码', '韩语', '英语', '数学', '拼成', '美食小厨房', '知识匹配', '造价', 
                       '错题博物馆', 'PLC', '课文', '政治', '学英语', '拼音', '闯关', '编程学习']
    if '游戏' in t and any(kw in t for kw in game_edu_combos):
        return True

    if '双人' in t and ('PK' in t or '答题' in t):
        return True

    if '猜地点' in t or '图寻' in t:
        return True

    if '班宠星球' in t or '拓麻歌子' in t:
        return True

    if 'MBTI' in t or 'mbti' in t.lower():
        return True

    if '智商测试' in t:
        return True

    if '心理韧性' in t and '游戏化' in t:
        return True

    if '随机点名抽奖' in t:
        return True

    if '朗诵比赛互动' in t:
        return True

    if '射击' in t and '闯关' in t:
        return True

    if '多邻国' in t or '沪江' in t:
        return True

    if '竞答' in t and ('课堂' in t or '线性代数' in t):
        return True

    if '会计科目精通闯关' in t:
        return True

    if '模拟经营' in t and ('游戏' in t or '宠物养成' in t):
        return True

    if '海东单词记忆' in t:
        return True

    if 'AI智能记单词' in t:
        return True

    if '英语单词学习AI小程序' in t:
        return True

    if '昆虫成长日记翻翻卡' in t:
        return True

    if '拼图' in t and ('历史' in t or '学习' in t or '微观' in t):
        return True

    if '职业规划' in t and 'MBTI' in t:
        return True

    return False


def compute_msg_stats(msgs):
    total = len(msgs)
    demand_types = defaultdict(int)
    feedback_types = defaultdict(int)
    has_problem_count = 0
    problem_summaries = []

    for m in msgs:
        dt = m.get("demand_type", "")
        if dt:
            demand_types[dt] += 1
        ft = m.get("feedback_type", "")
        if ft:
            feedback_types[ft] += 1
        if m.get("has_problem", False):
            has_problem_count += 1
            ps = m.get("problem_summary", "")
            if ps:
                problem_summaries.append(ps)

    return {
        "total_messages": total,
        "demand_types": dict(demand_types),
        "feedback_types": dict(feedback_types),
        "has_problem_count": has_problem_count,
        "problem_summaries": problem_summaries,
    }


def main():
    print("=" * 60)
    print("从教育学习分类中筛选游戏并添加到 games JSON")
    print("=" * 60)

    eval_data = load_json(os.path.join(DATA_DIR, "eval_classified.json"))
    msg_data = load_json(os.path.join(DATA_DIR, "msg_classified.json"))
    games_web = load_json(os.path.join(DATA_DIR, "games_web.json"))
    games_app = load_json(os.path.join(DATA_DIR, "games_app.json"))

    existing_ids = set(g['project_id'] for g in games_web + games_app)
    print(f"现有游戏数: Web={len(games_web)}, App={len(games_app)}, 总计={len(existing_ids)}")

    msg_map = defaultdict(list)
    for m in msg_data:
        msg_map[m["project_id"]].append(m)

    edu_items = [item for item in eval_data if item.get('app_category') == '教育学习']
    print(f"教育学习分类项目总数: {len(edu_items)}")

    edu_game_ids = []
    for item in edu_items:
        pid = item['project_id']
        if pid in existing_ids:
            continue
        if is_edu_game(item['text']):
            edu_game_ids.append(pid)

    print(f"筛选出教育类游戏: {len(edu_game_ids)} 个")

    new_web = []
    new_app = []
    missing = []

    for pid in edu_game_ids:
        clean_path = os.path.join(CLEAN_DIR, f"{pid}.json")
        if not os.path.exists(clean_path):
            missing.append(pid)
            continue

        project = load_json(clean_path)

        conversations = project.get("conversations", {})
        message_count = sum(len(conv.get("messages", [])) for conv in conversations.values())
        conversation_count = len(conversations)

        timestamps = []
        for conv in conversations.values():
            for msg in conv.get("messages", []):
                ts = msg.get("created_at", 0)
                if ts:
                    timestamps.append(ts)
        time_range = [min(timestamps), max(timestamps)] if timestamps else [0, 0]

        total_tokens = sum(
            msg.get("total_token", 0) or 0
            for conv in conversations.values()
            for msg in conv.get("messages", [])
        )

        eval_info = next((e for e in eval_data if e['project_id'] == pid), {})
        complexity = eval_info.get("complexity", "medium")

        first_user_text = ""
        for conv_id in sorted(conversations.keys()):
            conv = conversations[conv_id]
            for msg in conv.get("messages", []):
                if msg.get("content_type") == "user" and msg.get("text", "").strip():
                    first_user_text = msg["text"].strip()
                    break
            if first_user_text:
                break

        msgs_for_project = msg_map.get(pid, [])
        msg_stats = compute_msg_stats(msgs_for_project)

        game_entry = {
            "project_id": pid,
            "project_type": project.get("project_type", eval_info.get("project_type", "web")),
            "creator_id": project.get("creator_id", ""),
            "message_count": message_count,
            "conversation_count": conversation_count,
            "time_range": time_range,
            "total_tokens": total_tokens,
            "complexity": complexity,
            "initial_prompt": first_user_text or eval_info.get("text", ""),
            "msg_classified_stats": msg_stats,
            "conversations": conversations,
        }

        if game_entry["project_type"] == "app":
            new_app.append(game_entry)
        else:
            new_web.append(game_entry)

    if missing:
        print(f"\n警告: {len(missing)} 个项目在 clean_project 中未找到:")
        for pid in missing:
            print(f"  - {pid}")

    print(f"\n新增 Web 游戏: {len(new_web)}")
    print(f"新增 App 游戏: {len(new_app)}")

    games_web.extend(new_web)
    games_app.extend(new_app)

    save_json(os.path.join(DATA_DIR, "games_web.json"), games_web)
    save_json(os.path.join(DATA_DIR, "games_app.json"), games_app)

    print(f"\n更新后: Web={len(games_web)}, App={len(games_app)}, 总计={len(games_web)+len(games_app)}")

    print("\n新增项目列表:")
    for g in new_web + new_app:
        prompt = g['initial_prompt'][:80].replace('\n', ' ')
        print(f"  [{g['project_type']}] {g['project_id']}: {prompt}")

    print("\n完成！")


if __name__ == "__main__":
    main()
